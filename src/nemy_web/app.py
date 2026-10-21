"""FastAPI construction for the local pilot.

The app owns the HTTP API, the SQLite records, and the same-origin static
frontend. Project routes, uploads, jobs, and media are added by later tasks.
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

from nemy_web import db
from nemy_web.config import Settings

# Same-origin only. `worker-src` allows the blob workers that Spark creates,
# and `img-src` allows the blob textures the viewer generates.
CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "script-src 'self'",
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
    application shell.
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
            if scope["path"].startswith(("/api", "/media")):
                raise
            try:
                return await super().get_response("index.html", scope)
            except HTTPException:
                # The frontend has not been built, so there is no shell to
                # serve. A 404 is the honest answer.
                raise error


def default_dist_dir() -> Path:
    """Locate the built frontend directory.

    The build output lives in the repository-root `dist/`. The directory may
    not exist yet: the API must start and serve the API whether or not the
    frontend has been built.
    """
    repo_dist = Path(__file__).resolve().parents[2] / "dist"
    cwd_dist = Path.cwd() / "dist"
    if (repo_dist / "index.html").is_file():
        return repo_dist
    if (cwd_dist / "index.html").is_file():
        return cwd_dist
    return repo_dist


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

    # Mounted last so the API routes above win. The directory is optional:
    # the app starts and serves the API before the frontend is built.
    app.mount(
        "/",
        SpaStaticFiles(
            directory=dist_dir if dist_dir is not None else default_dist_dir(),
            html=True,
            check_dir=False,
        ),
        name="frontend",
    )

    return app


def main() -> None:
    """Console-script entry point for the API."""
    import uvicorn

    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host=settings.bind, port=settings.port)


if __name__ == "__main__":
    main()
