"""Configuration, startup, and health checks for the pilot API."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nemy_web.app import create_app
from nemy_web.config import Settings

EXPECTED_HEALTH_BODY = '{"status":"ok","database":"ok","converter":"missing"}'
EXPECTED_HEALTH = {"status": "ok", "database": "ok", "converter": "missing"}

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
    policy = response.headers["Content-Security-Policy"]

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'self'" in policy
    assert "worker-src 'self' blob:" in policy
    assert "Access-Control-Allow-Origin" not in response.headers


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
