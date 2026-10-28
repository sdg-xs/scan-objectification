"""Capability-link projects: create, read, rotate, and delete.

A project is reachable only through its capability link,
``/p/<project-id>#key=<secret>``. There is no account and no recovery, so the
link is the key. Two rules shape every route here:

* **No existence oracle.** A missing secret, a wrong secret, an unknown id,
  and a deleted project all answer ``404`` with an identical body. A caller
  cannot tell a wrong key from a project that never existed.
* **Check-then-act in one transaction.** A mutating call carries the state
  version the caller believes is current. The capability check, the version
  check, and the mutation all happen inside one ``BEGIN IMMEDIATE``
  transaction, so two callers racing on the same version cannot both win.

The plaintext secret exists in exactly two places: the creation or rotation
response, and the browser that received it. The server keeps only a digest;
see :mod:`nemy_web.auth`.
"""

from __future__ import annotations

import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse

from nemy_web import auth, db
from nemy_web.config import Settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])

# The phase a queued job starts in. The worker replaces it with the phase it
# is actually in.
QUEUED_PHASE = "pending"


def _now() -> str:
    """The current time as an ISO 8601 UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


def _settings(request: Request) -> Settings:
    """The validated settings the app was started with."""
    return request.app.state.settings


def _error(
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    """The documented error body: ``{"error": {"code", "message", "details"}}``."""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details if details is not None else {},
            }
        },
    )


def _not_found() -> JSONResponse:
    """The single answer for every access the caller is not entitled to.

    The message is deliberately identical for an unknown project, a missing
    secret, a wrong secret, and a deleted project. Distinguishing them would
    turn the API into an existence oracle.
    """
    return _error(404, "not_found", "No project matches that capability.")


def _version_conflict(current_version: int) -> JSONResponse:
    """The caller believed a version that is no longer current."""
    return _error(
        409,
        "version_conflict",
        "The project changed since it was loaded.",
        {"currentVersion": current_version},
    )


def _invalid_request(message: str) -> JSONResponse:
    """The request body did not carry a usable expected version."""
    return _error(400, "invalid_request", message, {"field": "expectedVersion"})


def _expected_version(body: dict[str, Any] | None) -> int | None:
    """The caller's believed state version, or ``None`` when it is unusable.

    A negative number is a usable version: it is simply a version the project
    has never had, so it is a conflict rather than a malformed request. Only a
    missing or non-integer version is unusable.
    """
    if not isinstance(body, dict):
        return None
    if "expectedVersion" not in body:
        return None
    value = body["expectedVersion"]
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _authorized_row(
    row: sqlite3.Row | None, header: str | None
) -> sqlite3.Row | None:
    """The project row when the request carries that project's capability.

    A deleted project is never authorized: access is denied the moment
    ``deleted_at`` is set, whether or not the purge has run yet.
    """
    if row is None or row["deleted_at"] is not None:
        return None
    secret = auth.bearer_token(header)
    if secret is None:
        return None
    if not auth.secret_matches(secret, row["secret_hash"]):
        return None
    return row


def authorize_project(
    row: sqlite3.Row | None, header: str | None
) -> sqlite3.Row | None:
    """Shared capability check for project-scoped APIs."""
    return _authorized_row(row, header)


@router.post("", status_code=201)
def create_project(request: Request) -> JSONResponse:
    """Create a project and hand back its capability link.

    The secret is generated here and never stored: only its digest reaches
    the database, and the plaintext leaves the server in this response and
    nowhere else.
    """
    settings = _settings(request)
    project_id = str(uuid.uuid4())
    secret = auth.generate_secret()

    with db.transaction(settings.db_path) as connection:
        connection.execute(
            "INSERT INTO projects"
            " (id, secret_hash, media_epoch, state_version, created_at)"
            " VALUES (?, ?, 0, 0, ?)",
            (project_id, auth.hash_secret(secret), _now()),
        )

    logger.info("project %s created", project_id)
    return JSONResponse(
        status_code=201,
        content={
            "projectId": project_id,
            "capabilitySecret": secret,
            "link": f"/p/{project_id}#key={secret}",
            "stateVersion": 0,
            "mediaEpoch": 0,
        },
    )


@router.get("/{project_id}")
def read_project(
    request: Request,
    project_id: str,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Return the current state of a project the caller is entitled to.

    The secret is read from the ``Authorization`` header only. A secret in
    the query string is ignored, so it can never be used to authorize a
    request.
    """
    settings = _settings(request)
    connection = db.connect(settings.db_path)
    try:
        raw = connection.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
    finally:
        connection.close()

    row = _authorized_row(raw, authorization)
    if row is None:
        logger.debug("project %s read denied", project_id)
        return _not_found()

    logger.debug("project %s read", project_id)
    return JSONResponse(
        content={
            "projectId": row["id"],
            "stateVersion": row["state_version"],
            "mediaEpoch": row["media_epoch"],
            "deleted": False,
        }
    )


@router.post("/{project_id}/rotate-key")
def rotate_key(
    request: Request,
    project_id: str,
    body: dict[str, Any] | None = Body(default=None),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Replace the capability secret and invalidate the old link at once.

    The old secret stops working in the same transaction that installs the
    new one, so there is no window in which both are valid. ``media_epoch``
    is incremented with it, because a media cookie handed out through the old
    link must stop working too.
    """
    settings = _settings(request)
    expected = _expected_version(body)
    failure: JSONResponse | None = None
    result: dict[str, Any] = {}

    with db.transaction(settings.db_path) as connection:
        raw = connection.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        row = _authorized_row(raw, authorization)
        if row is None:
            logger.debug("project %s rotate denied", project_id)
            failure = _not_found()
        elif expected is None:
            failure = _invalid_request("expectedVersion is required.")
        elif expected != row["state_version"]:
            failure = _version_conflict(row["state_version"])
        else:
            secret = auth.generate_secret()
            connection.execute(
                "UPDATE projects SET secret_hash = ?, state_version = state_version + 1,"
                " media_epoch = media_epoch + 1 WHERE id = ?",
                (auth.hash_secret(secret), project_id),
            )
            result = {
                "projectId": project_id,
                "capabilitySecret": secret,
                "link": f"/p/{project_id}#key={secret}",
                "stateVersion": row["state_version"] + 1,
                "mediaEpoch": row["media_epoch"] + 1,
            }

    if failure is not None:
        return failure

    logger.info("project %s key rotated", project_id)
    return JSONResponse(content=result)


@router.delete("/{project_id}")
def delete_project(
    request: Request,
    project_id: str,
    body: dict[str, Any] | None = Body(default=None),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """Disable access at once and queue the purge of the project's files.

    ``deleted_at`` is set in the same transaction that increments the state
    and media epochs, and the purge job is enqueued in that same
    transaction. The files themselves are removed by the worker, which is a
    later task: until it runs, the purge job is the record that the data must
    go.
    """
    settings = _settings(request)
    expected = _expected_version(body)
    failure: JSONResponse | None = None
    result: dict[str, Any] = {}

    with db.transaction(settings.db_path) as connection:
        raw = connection.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        row = _authorized_row(raw, authorization)
        if row is None:
            logger.debug("project %s delete denied", project_id)
            failure = _not_found()
        elif expected is None:
            failure = _invalid_request("expectedVersion is required.")
        elif expected != row["state_version"]:
            failure = _version_conflict(row["state_version"])
        else:
            state_version = row["state_version"] + 1
            media_epoch = row["media_epoch"] + 1
            deleted_at = _now()
            connection.execute(
                "UPDATE projects SET deleted_at = ?, state_version = ?, media_epoch = ?"
                " WHERE id = ?",
                (deleted_at, state_version, media_epoch, project_id),
            )
            connection.execute(
                "INSERT INTO jobs"
                " (id, project_id, kind, idempotency_key, status, phase, attempt,"
                " created_at)"
                " VALUES (?, ?, 'purge', ?, 'queued', ?, 0, ?)",
                (
                    str(uuid.uuid4()),
                    project_id,
                    f"delete-v{state_version}",
                    QUEUED_PHASE,
                    deleted_at,
                ),
            )
            result = {
                "projectId": project_id,
                "deleted": True,
                "stateVersion": state_version,
                "mediaEpoch": media_epoch,
            }

    if failure is not None:
        return failure

    logger.info("project %s deleted and purge queued", project_id)
    return JSONResponse(content=result)
