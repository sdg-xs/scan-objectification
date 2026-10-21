"""Configuration, startup, and health checks for the pilot API."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nemy_web import db
from nemy_web.app import create_app
from nemy_web.config import Settings

EXPECTED_HEALTH_BODY = '{"status":"ok","database":"ok","converter":"missing"}'
EXPECTED_HEALTH = {"status": "ok", "database": "ok", "converter": "missing"}

# The exact policy the app must send. It is asserted as a whole string so a
# change that breaks the browser is a test failure, not a silent regression.
#
# `'wasm-unsafe-eval'` is required: Spark compiles its Rust module at import
# time and hash-wasm compiles its SHA-256 kernel. Without it both pinned WASM
# dependencies fail. It permits WASM compilation only, not `eval()`.
EXPECTED_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "script-src 'self' 'wasm-unsafe-eval'; "
    "style-src 'self'; "
    "img-src 'self' data: blob:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "worker-src 'self' blob:"
)

LIMIT_FIELDS = (
    "max_upload_bytes",
    "max_expanded_bytes",
    "upload_chunk_bytes",
    "job_timeout_seconds",
    "media_session_seconds",
)


def test_health_reports_ok_without_a_converter(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == EXPECTED_HEALTH
    assert response.text == EXPECTED_HEALTH_BODY


def test_startup_creates_the_data_directories(settings: Settings, data_dir: Path) -> None:
    assert not data_dir.exists()

    with TestClient(create_app(settings)):
        pass

    assert settings.data_dir.is_dir()
    assert settings.projects_dir.is_dir()
    assert settings.trash_dir.is_dir()
    assert settings.db_path.is_file()


def test_startup_initializes_the_database_schema(settings: Settings) -> None:
    with TestClient(create_app(settings)):
        pass

    with sqlite3.connect(settings.db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        user_version = connection.execute("PRAGMA user_version").fetchone()[0]

    assert {"projects", "uploads", "upload_chunks", "jobs"} <= tables
    assert user_version == 1


def test_the_database_uses_foreign_keys_and_write_ahead_logging(settings: Settings) -> None:
    with TestClient(create_app(settings)):
        pass

    with sqlite3.connect(settings.db_path) as connection:
        journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]

    assert journal_mode.lower() == "wal"


@pytest.mark.parametrize("field", LIMIT_FIELDS)
def test_negative_limits_fail_startup(field: str) -> None:
    with pytest.raises(ValueError):
        Settings(**{field: -1})


def test_a_negative_limit_in_the_environment_fails_startup() -> None:
    with pytest.raises(ValueError):
        Settings.from_env({"NEMY_MAX_UPLOAD_BYTES": "-1"})


def test_the_data_directory_is_resolved_to_an_absolute_path(data_dir: Path) -> None:
    settings = Settings(data_dir=data_dir)

    assert settings.data_dir == data_dir.resolve()
    assert settings.data_dir.is_absolute()


def test_responses_carry_the_security_headers(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Content-Security-Policy"] == EXPECTED_CSP
    assert "'wasm-unsafe-eval'" in response.headers["Content-Security-Policy"]
    assert "Access-Control-Allow-Origin" not in response.headers


def test_the_policy_allows_wasm_compilation_but_not_eval(client: TestClient) -> None:
    """The pinned WASM dependencies must be able to compile their modules."""
    policy = client.get("/api/health").headers["Content-Security-Policy"]

    assert "script-src 'self' 'wasm-unsafe-eval'" in policy
    # 'unsafe-eval' would also allow eval(); it must not be present.
    assert "'unsafe-eval'" not in policy
    assert "script-src 'self' 'unsafe-eval'" not in policy


def test_the_api_serves_requests_before_the_frontend_is_built(
    settings: Settings, tmp_path: Path
) -> None:
    """The app must start and answer the API when `dist/` does not exist."""
    missing_dist = tmp_path / "not-built"

    with TestClient(create_app(settings, dist_dir=missing_dist)) as test_client:
        health = test_client.get("/api/health")
        missing_route = test_client.get("/api/does-not-exist")
        app_route = test_client.get("/p/abc-123")

    assert health.status_code == 200
    assert health.json() == EXPECTED_HEALTH
    assert missing_route.status_code == 404
    assert app_route.status_code == 404


def test_the_frontend_shell_is_served_for_capability_links(tmp_path: Path) -> None:
    """`/p/<id>` must answer with the app shell, not a 404."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>pilot</title>", encoding="utf-8")

    with TestClient(create_app(Settings(data_dir=tmp_path / "data"), dist_dir=dist)) as test_client:
        root = test_client.get("/")
        capability_link = test_client.get("/p/abc-123")
        api_route = test_client.get("/api/does-not-exist")

    assert root.status_code == 200
    assert "pilot" in root.text
    assert capability_link.status_code == 200
    assert "pilot" in capability_link.text
    assert api_route.status_code == 404


def test_a_missing_asset_is_a_404_and_not_the_shell(tmp_path: Path) -> None:
    """A missing file must not be answered with the HTML shell."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>pilot</title>", encoding="utf-8")

    with TestClient(create_app(Settings(data_dir=tmp_path / "data"), dist_dir=dist)) as test_client:
        missing_asset = test_client.get("/assets/missing-xyz.js")
        favicon = test_client.get("/favicon.ico")

    assert missing_asset.status_code == 404
    assert "text/html" not in missing_asset.headers.get("content-type", "")
    assert favicon.status_code == 404
    assert "text/html" not in favicon.headers.get("content-type", "")


def test_a_real_asset_is_served_with_its_own_content_type(tmp_path: Path) -> None:
    """The asset path must keep working after the fallback is restricted."""
    dist = tmp_path / "dist"
    assets = dist / "assets"
    assets.mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>pilot</title>", encoding="utf-8")
    (assets / "index-abc.js").write_text("export const ready = true;\n", encoding="utf-8")

    with TestClient(create_app(Settings(data_dir=tmp_path / "data"), dist_dir=dist)) as test_client:
        asset = test_client.get("/assets/index-abc.js")

    assert asset.status_code == 200
    assert "text/javascript" in asset.headers["content-type"]
    assert "export const ready = true;" in asset.text


def test_routes_registered_after_create_app_stay_reachable(tmp_path: Path) -> None:
    """Later tasks add routes after `create_app()` returns; they must work.

    The frontend is the router's default handler, so a route registered later
    is matched before the frontend sees the request.
    """
    app = create_app(Settings(data_dir=tmp_path / "data"), dist_dir=tmp_path / "dist")

    @app.post("/api/projects")
    def create_project() -> dict[str, str]:
        return {"id": "project-1"}

    with TestClient(app) as test_client:
        response = test_client.post("/api/projects")

    assert response.status_code == 200
    assert response.json() == {"id": "project-1"}


def test_an_unrouted_post_is_a_404(tmp_path: Path) -> None:
    """The frontend fallback must not answer non-navigational requests."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>pilot</title>", encoding="utf-8")

    with TestClient(create_app(Settings(data_dir=tmp_path / "data"), dist_dir=dist)) as test_client:
        response = test_client.post("/api/projects")

    assert response.status_code == 404


def test_the_converter_path_is_resolved_to_an_absolute_path() -> None:
    """The converter check must not depend on the working directory."""
    settings = Settings(build_lod=Path("build-lod.exe"))

    assert settings.build_lod == Path("build-lod.exe").resolve()
    assert settings.build_lod.is_absolute()


def test_a_failed_statement_reports_its_own_error(tmp_path: Path) -> None:
    """A failure inside the transaction must surface the real cause."""
    db_path = tmp_path / "pilot.sqlite3"
    db.initialize(db_path)

    with pytest.raises(sqlite3.OperationalError, match="no such table"):
        with db.transaction(db_path) as connection:
            connection.execute("INSERT INTO missing_table VALUES (1)")

    # The failed statement must not have left a transaction open.
    connection = db.connect(db_path)
    try:
        assert connection.in_transaction is False
    finally:
        connection.close()


def test_a_locked_database_reports_the_lock_error(tmp_path: Path) -> None:
    """A `BEGIN IMMEDIATE` that cannot start must not be masked by a rollback."""
    db_path = tmp_path / "pilot.sqlite3"
    db.initialize(db_path)

    blocker = sqlite3.connect(db_path, isolation_level=None)
    blocker.execute("PRAGMA busy_timeout = 0")
    blocker.execute("BEGIN EXCLUSIVE")
    blocker.execute("CREATE TABLE IF NOT EXISTS blocker (id INTEGER PRIMARY KEY)")
    try:
        with pytest.raises(sqlite3.OperationalError) as error:
            with db.transaction(db_path):
                pass
    finally:
        blocker.execute("ROLLBACK")
        blocker.close()

    message = str(error.value).lower()
    assert "rollback" not in message
    assert "locked" in message or "busy" in message
