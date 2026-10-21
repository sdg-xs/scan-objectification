"""FastAPI construction for the local pilot.

The app owns the HTTP API, the SQLite records, and the same-origin static
frontend. The project API is added by `create_pilot_app`; uploads, jobs, and
media are added by later tasks.

Route ordering: the frontend is installed as the router's *default* handler,
not as a mounted route. A `Mount` at `/` matches every path, so it would
shadow any route a later task registers after `create_app()` returns. The
default handler is consulted only after every registered route has failed to
match, so routes added later stay reachable.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.websockets import WebSocketClose

from nemy_web import db, projects
from nemy_web.config import Settings

# Same-origin only. `worker-src` allows the blob workers that Spark creates,
# and `img-src` allows the blob textures the viewer generates.
#
# `'wasm-unsafe-eval'` permits WebAssembly compilation, which both pinned
# WASM dependencies need: Spark compiles its Rust module at import time and
# hash-wasm compiles its SHA-256 kernel. It does not permit `eval()` or
# `new Function()`, and neither dependency uses them.
CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self' blob:",
    )
)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
}


class SecurityHeadersMiddleware:
    """Add the pilot's security headers to every HTTP response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Any) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


class SpaStaticFiles(StaticFiles):
    """Serve the built frontend, falling back to `index.html` for app routes.

    The capability link is `/p/<project-id>#key=<secret>`. The fragment never
    reaches the server, so the server must answer `/p/<project-id>` with the
    application shell rather than a 404.

    The fallback is restricted to navigational requests. A missing asset must
    stay a 404: serving the HTML shell for a missing `.js` file would hand the
    browser an HTML document it cannot execute.
    """

    async def check_config(self) -> None:
        """Tolerate a frontend that has not been built yet.

        The API must start and serve its routes whether or not `dist/` exists.
        Without this, Starlette raises on the first non-API request.
        """
        if self.directory is None or not Path(self.directory).is_dir():
            return
        await super().check_config()

    async def get_response(self, path: str, scope: Scope) -> Any:
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            if not self._is_app_route(scope):
                raise
            try:
                return await super().get_response("index.html", scope)
            except HTTPException:
                # The frontend has not been built, so there is no shell to
                # serve. A 404 is the honest answer.
                raise error

    @staticmethod
    def _is_app_route(scope: Scope) -> bool:
        """Whether a request is a client-side navigation the shell answers.

        App routes are the capability links (`/p/<project-id>`) and the root.
        API and media paths are excluded so a missing API route stays a 404.
        """
        path = scope["path"]
        if path.startswith(("/api", "/media")):
            return False
        # A request that names a file extension is an asset request, not a
        # navigation. Only the app's own routes lack an extension.
        last_segment = path.rsplit("/", 1)[-1]
        return "." not in last_segment


def default_dist_dir() -> Path:
    """Locate the built frontend directory.

    The build output always lives in the repository-root `dist/`: `vite.config.ts`
    writes it there. The directory may not exist yet — the API must start and
    serve the API whether or not the frontend has been built.

    Only the repository root is consulted. A `dist/` in the current working
    directory is not a build output of this project and must never be served.
    """
    return Path(__file__).resolve().parents[2] / "dist"


def converter_state(settings: Settings) -> str:
    """`ok` when the pinned Spark converter is present, otherwise `missing`."""
    build_lod = settings.build_lod
    if build_lod is not None and build_lod.is_file():
        return "ok"
    return "missing"


def database_state(settings: Settings) -> str:
    """`ok` when the SQLite database answers, otherwise `error`."""
    connection = db.connect(settings.db_path)
    try:
        connection.execute("SELECT 1").fetchone()
    except Exception:
        return "error"
    finally:
        connection.close()
    return "ok"


def create_app(settings: Settings | None = None, dist_dir: Path | None = None) -> FastAPI:
    """Build the pilot application.

    The settings are stored on `app.state` so routes and later tasks read one
    validated source of truth instead of re-reading the environment.

    `dist_dir` overrides the location of the built frontend. It exists so the
    "frontend not built yet" path can be exercised in tests.
    """
    resolved = settings if settings is not None else Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        for directory in (
            resolved.data_dir,
            resolved.projects_dir,
            resolved.trash_dir,
            resolved.logs_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        db.initialize(resolved.db_path)
        yield

    app = FastAPI(
        title="Nemy local USD web pilot",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = resolved
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/api/health")
    def health() -> JSONResponse:
        """Report API, database, and converter state.

        A missing converter is diagnostic, not an unhealthy API: the API must
        start so project and upload work can be tested without it.
        """
        database = database_state(resolved)
        payload = {
            "status": "ok" if database == "ok" else "error",
            "database": database,
            "converter": converter_state(resolved),
        }
        return JSONResponse(payload)

    # The project routes are registered by `create_pilot_app`, *after*
    # `create_app()` returns, not here. Starlette matches routes in
    # registration order and the first match wins, so registering
    # `/api/projects` inside `create_app()` would shadow any route a later
    # task registers for the same path, and would make a bare `create_app()`
    # answer `POST /api/projects` instead of leaving it to the frontend
    # fallback's 404. Both are the behaviour Task 1 pinned.

    # The frontend is the router's *default* handler, not a mounted route.
    # A `Mount` at "/" matches every path and would shadow any route a later
    # task registers after `create_app()` returns. The default handler runs
    # only after every registered route has failed to match, so later routes
    # stay reachable.
    frontend = SpaStaticFiles(
        directory=dist_dir if dist_dir is not None else default_dist_dir(),
        html=True,
        check_dir=False,
    )

    async def serve_frontend(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            # No websocket route matched. Close the socket the way Starlette's
            # own not-found handler does.
            await WebSocketClose()(scope, receive, send)
            return
        # Only the browser's navigational GET and HEAD requests reach the
        # frontend. Anything else is an unrouted API call and is a 404.
        if scope["method"] not in ("GET", "HEAD"):
            raise HTTPException(status_code=404)
        await frontend(scope, receive, send)

    app.router.default = serve_frontend

    return app


def create_pilot_app(
    settings: Settings | None = None, dist_dir: Path | None = None
) -> FastAPI:
    """Build the pilot application with the project API attached.

    `create_app()` deliberately knows nothing about the project API. It
    installs the frontend as the router's default handler, and Task 1 pinned
    two facts about that arrangement: a bare `create_app()` answers
    `POST /api/projects` with the fallback's 404, and a route registered
    *after* `create_app()` returns still wins for that path.

    Starlette matches routes in registration order, so the project router
    cannot be included from inside `create_app()`: it would be matched
    before any later route and would take the path away from it. It is
    included here, after `create_app()` has returned, which keeps both
    properties intact and still leaves the frontend as the default handler.
    """
    app = create_app(settings, dist_dir)
    app.include_router(projects.router)
    return app


def main() -> None:
    """Console-script entry point for the API."""
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_pilot_app(settings), host=settings.bind, port=settings.port)


if __name__ == "__main__":
    main()
