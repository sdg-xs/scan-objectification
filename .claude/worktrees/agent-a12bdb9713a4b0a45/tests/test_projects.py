"""Capability-link projects: create, read, rotate, delete, and version checks.

The pilot has no accounts. A project is reachable only through its capability
link, `/p/<project-id>#key=<secret>`. These tests cover the whole secret
lifecycle and the rules that protect it:

* the server stores only a hash of the secret, never the plaintext,
* a missing or wrong secret is a 404, so the API is not an existence oracle,
* rotation replaces the secret and invalidates the old link immediately,
* a mutating call carries the state version the caller believes is current,
  and a stale version is a 409 instead of a lost update,
* deletion disables access at once and enqueues the purge job.
"""

from __future__ import annotations

import hashlib
import logging
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from nemy_web import db
from nemy_web.app import create_app
from nemy_web.config import Settings

UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def bearer(secret: str) -> dict[str, str]:
    """The header the browser client sends for a project API."""
    return {"Authorization": f"Bearer {secret}"}


def create_project(client: TestClient) -> dict[str, Any]:
    """Create a project and return the creation body."""
    response = client.post("/api/projects")
    assert response.status_code == 201, response.text
    return response.json()


def project_row(settings: Settings, project_id: str) -> sqlite3.Row:
    """Read one project row straight from SQLite."""
    connection = db.connect(settings.db_path)
    try:
        row = connection.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
    finally:
        connection.close()
    assert row is not None, f"no project row for {project_id}"
    return row


def job_rows(settings: Settings, project_id: str) -> list[sqlite3.Row]:
    """Read the job rows of one project straight from SQLite."""
    connection = db.connect(settings.db_path)
    try:
        return connection.execute(
            "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at", (project_id,)
        ).fetchall()
    finally:
        connection.close()


def test_creating_a_project_returns_a_capability_link(client: TestClient) -> None:
    response = client.post("/api/projects")

    assert response.status_code == 201
    body = response.json()
    project_id = body["projectId"]
    secret = body["capabilitySecret"]
    assert body["link"] == f"/p/{project_id}#key={secret}"
    assert body["stateVersion"] == 0
    assert body["mediaEpoch"] == 0


def test_the_project_id_is_a_uuid_without_a_dot(client: TestClient) -> None:
    """The SPA fallback treats a last path segment with a dot as an asset."""
    body = create_project(client)
    project_id = body["projectId"]

    assert UUID_PATTERN.match(project_id)
    assert uuid.UUID(project_id).version == 4
    assert "." not in project_id


def test_the_secret_is_256_random_bits_and_differs_per_project(
    client: TestClient,
) -> None:
    first = create_project(client)["capabilitySecret"]
    second = create_project(client)["capabilitySecret"]

    assert first != second
    assert len(first) == 43
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", first)


def test_the_database_never_stores_the_plaintext_secret(
    client: TestClient, settings: Settings
) -> None:
    body = create_project(client)
    secret = body["capabilitySecret"].encode("utf-8")

    for path in sorted(settings.data_dir.glob("nemy.db*")):
        assert secret not in path.read_bytes(), f"the secret leaked into {path.name}"


def test_the_stored_secret_hash_is_the_sha256_of_the_secret(
    client: TestClient, settings: Settings
) -> None:
    body = create_project(client)
    row = project_row(settings, body["projectId"])

    assert row["secret_hash"] == hashlib.sha256(
        body["capabilitySecret"].encode("utf-8")
    ).digest()


def test_reading_a_project_with_the_capability_secret(client: TestClient) -> None:
    body = create_project(client)

    response = client.get(
        f"/api/projects/{body['projectId']}", headers=bearer(body["capabilitySecret"])
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["projectId"] == body["projectId"]
    assert payload["stateVersion"] == 0
    assert payload["mediaEpoch"] == 0
    assert payload["deleted"] is False


def test_reading_a_project_without_a_secret_is_a_404(client: TestClient) -> None:
    body = create_project(client)

    response = client.get(f"/api/projects/{body['projectId']}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_reading_a_project_with_the_wrong_secret_is_a_404(client: TestClient) -> None:
    body = create_project(client)

    response = client.get(
        f"/api/projects/{body['projectId']}", headers=bearer("not-the-secret")
    )

    assert response.status_code == 404


def test_reading_an_unknown_project_is_a_404(client: TestClient) -> None:
    response = client.get(
        f"/api/projects/{uuid.uuid4()}", headers=bearer("irrelevant")
    )

    assert response.status_code == 404


def test_the_secret_is_never_accepted_in_a_url(client: TestClient) -> None:
    """A capability secret belongs in a header, never in a request URL."""
    body = create_project(client)

    response = client.get(
        f"/api/projects/{body['projectId']}?key={body['capabilitySecret']}"
    )

    assert response.status_code == 404


def test_rotating_the_secret_returns_a_new_secret_and_a_new_version(
    client: TestClient,
) -> None:
    body = create_project(client)

    response = client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(body["capabilitySecret"]),
    )

    assert response.status_code == 200
    rotated = response.json()
    assert rotated["capabilitySecret"] != body["capabilitySecret"]
    assert rotated["stateVersion"] == body["stateVersion"] + 1
    assert rotated["link"] == (
        f"/p/{body['projectId']}#key={rotated['capabilitySecret']}"
    )


def test_the_old_secret_stops_working_after_a_rotation(client: TestClient) -> None:
    body = create_project(client)
    rotated = client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(body["capabilitySecret"]),
    ).json()

    old = client.get(
        f"/api/projects/{body['projectId']}", headers=bearer(body["capabilitySecret"])
    )
    new = client.get(
        f"/api/projects/{body['projectId']}", headers=bearer(rotated["capabilitySecret"])
    )

    assert old.status_code == 404
    assert new.status_code == 200


def test_rotation_requires_the_current_version(client: TestClient) -> None:
    body = create_project(client)
    stale = body["stateVersion"] - 1

    response = client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={"expectedVersion": stale},
        headers=bearer(body["capabilitySecret"]),
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["error"]["code"] == "version_conflict"
    assert payload["error"]["details"]["currentVersion"] == body["stateVersion"]


def test_rotation_increments_the_media_epoch(
    client: TestClient, settings: Settings
) -> None:
    """A media cookie issued through the old link must fail after a rotation."""
    body = create_project(client)
    before = project_row(settings, body["projectId"])["media_epoch"]

    client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(body["capabilitySecret"]),
    )

    assert project_row(settings, body["projectId"])["media_epoch"] == before + 1


def test_deleting_a_project_denies_access_immediately(client: TestClient) -> None:
    body = create_project(client)

    response = client.request(
        "DELETE",
        f"/api/projects/{body['projectId']}",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(body["capabilitySecret"]),
    )

    assert response.status_code == 200
    assert response.json()["deleted"] is True
    read = client.get(
        f"/api/projects/{body['projectId']}", headers=bearer(body["capabilitySecret"])
    )
    assert read.status_code == 404


def test_deleting_a_project_records_the_deletion_and_enqueues_a_purge_job(
    client: TestClient, settings: Settings
) -> None:
    body = create_project(client)

    client.request(
        "DELETE",
        f"/api/projects/{body['projectId']}",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(body["capabilitySecret"]),
    )

    row = project_row(settings, body["projectId"])
    assert row["deleted_at"] is not None
    assert row["state_version"] == body["stateVersion"] + 1
    assert row["media_epoch"] == body["mediaEpoch"] + 1

    jobs = job_rows(settings, body["projectId"])
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "purge"
    assert jobs[0]["status"] == "queued"
    assert jobs[0]["phase"]
    assert jobs[0]["idempotency_key"]
    assert jobs[0]["created_at"]


def test_deleting_a_project_requires_the_current_version(
    client: TestClient, settings: Settings
) -> None:
    body = create_project(client)

    response = client.request(
        "DELETE",
        f"/api/projects/{body['projectId']}",
        json={"expectedVersion": body["stateVersion"] - 1},
        headers=bearer(body["capabilitySecret"]),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "version_conflict"
    # The project survives a rejected delete.
    assert project_row(settings, body["projectId"])["deleted_at"] is None
    assert client.get(
        f"/api/projects/{body['projectId']}", headers=bearer(body["capabilitySecret"])
    ).status_code == 200


def test_a_deleted_project_cannot_be_rotated_or_deleted_again(
    client: TestClient,
) -> None:
    body = create_project(client)
    client.request(
        "DELETE",
        f"/api/projects/{body['projectId']}",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(body["capabilitySecret"]),
    )

    rotate = client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={"expectedVersion": body["stateVersion"] + 1},
        headers=bearer(body["capabilitySecret"]),
    )
    delete = client.request(
        "DELETE",
        f"/api/projects/{body['projectId']}",
        json={"expectedVersion": body["stateVersion"] + 1},
        headers=bearer(body["capabilitySecret"]),
    )

    assert rotate.status_code == 404
    assert delete.status_code == 404


def test_a_missing_expected_version_is_rejected(client: TestClient) -> None:
    body = create_project(client)

    response = client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={},
        headers=bearer(body["capabilitySecret"]),
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_the_secret_never_appears_in_the_logs(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    body = create_project(client)
    secret = body["capabilitySecret"]
    client.get(f"/api/projects/{body['projectId']}", headers=bearer(secret))
    rotated = client.post(
        f"/api/projects/{body['projectId']}/rotate-key",
        json={"expectedVersion": body["stateVersion"]},
        headers=bearer(secret),
    ).json()

    assert secret not in caplog.text
    assert rotated["capabilitySecret"] not in caplog.text
    # The project was logged, so the check above is not vacuous.
    assert body["projectId"] in caplog.text


def test_the_error_body_uses_the_documented_shape(client: TestClient) -> None:
    response = client.get("/api/projects/" + str(uuid.uuid4()))

    assert response.status_code == 404
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "details"}
    assert isinstance(body["error"]["details"], dict)
