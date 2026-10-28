"""Resumable fixed-size uploads and bounded, local-only bundle staging."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import tempfile
import threading
import uuid
import zipfile
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from nemy_web import db
from nemy_web.projects import authorize_project, _error, _not_found, _now

router = APIRouter(prefix="/api/projects", tags=["uploads"])
STAGE_SUFFIXES = {".usd", ".usda", ".usdc", ".usdz"}
# ponytail: one local API process serializes disk publication; use per-project
# locks if this single-user pilot ever needs concurrent upload throughput.
_disk_lock = threading.Lock()


class StagingError(ValueError):
    def __init__(self, code="unsafe_bundle", status=400):
        self.code = code
        self.status = status
        super().__init__(code)


def relative_name(name: str) -> str:
    """Reject traversal and Windows aliases before any filesystem access."""
    normalized = name.replace("\\", "/")
    if not normalized or normalized.startswith("/"):
        raise StagingError()
    parts = normalized.rstrip("/").split("/")
    reserved = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
                *(f"lpt{i}" for i in range(1, 10))}
    for part in parts:
        if (part in {"", ".", ".."} or part.endswith((" ", "."))
            or any(ord(c) < 32 or c in ':<>"|?*' for c in part)
            or part.split(".")[0].casefold() in reserved):
            raise StagingError()
    return "/".join(parts)


def checked_path(root: Path, name: str) -> Path:
    """Resolve within root and reject links/reparse points in every component."""
    relative = relative_name(name)
    target = root / relative
    current = root
    for part in [None, *relative.split("/")]:
        if part is not None:
            current /= part
        if current.is_symlink():
            raise StagingError()
        try:
            attributes = current.lstat()
        except FileNotFoundError:
            continue
        if getattr(attributes, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise StagingError()
    if not target.resolve().is_relative_to(root.resolve()):
        raise StagingError()
    return target


def stage_source(source: Path, destination: Path, suffix: str, root: str | None,
                 generated: str, limit: int) -> str:
    """Write only to a new private directory; publication belongs to finalize."""
    if suffix != ".zip":
        target = checked_path(destination, generated)
        with source.open("rb") as incoming, target.open("xb") as output:
            shutil.copyfileobj(incoming, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        return generated

    total = 0
    names: set[str] = set()
    with zipfile.ZipFile(source) as archive:
        for member in archive.infolist():
            name = relative_name(member.filename)
            if name.casefold() in names:
                raise StagingError()
            names.add(name.casefold())
            mode = member.external_attr >> 16
            kind = stat.S_IFMT(mode)
            is_directory = member.is_dir()
            if (kind not in {0, stat.S_IFREG, stat.S_IFDIR}
                or (kind == stat.S_IFDIR) != is_directory and kind != 0
                or member.external_attr & 0x448  # DOS volume/device or Windows reparse
                or member.flag_bits & 1):
                raise StagingError()
            target = checked_path(destination, name)
            if is_directory:
                if member.file_size or member.external_attr & 0x18 not in {0, 0x10}:
                    raise StagingError()
                target.mkdir(parents=True, exist_ok=True)
                continue
            if member.file_size > limit - total:
                raise StagingError("expansion_limit", 413)
            target.parent.mkdir(parents=True, exist_ok=True)
            checked_path(destination, name)
            with archive.open(member) as incoming, target.open("xb") as output:
                while block := incoming.read(1024 * 1024):
                    total += len(block)
                    if total > limit:
                        raise StagingError("expansion_limit", 413)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
    if root is None:
        raise StagingError("missing_root_stage")
    normalized = relative_name(root)
    target = checked_path(destination, normalized)
    if not target.is_file() or target.suffix.lower() not in STAGE_SUFFIXES:
        raise StagingError("missing_root_stage")
    return normalized


def _project(connection, project_id, authorization):
    return authorize_project(connection.execute(
        "SELECT * FROM projects WHERE id=?", (project_id,)).fetchone(), authorization)


def _upload(connection, project_id, upload_id):
    return connection.execute("SELECT * FROM uploads WHERE project_id=? AND id=?",
                              (project_id, upload_id)).fetchone()


def _status(connection, row, chunk_size):
    received = [r[0] for r in connection.execute(
        "SELECT chunk_index FROM upload_chunks WHERE upload_id=? ORDER BY chunk_index", (row["id"],))]
    return {"uploadId": row["id"], "filename": row["filename"], "totalSize": row["total_size"],
            "sha256": row["expected_sha256"], "rootStage": row["root_stage_relpath"],
            "status": row["status"], "chunkSize": chunk_size, "receivedChunks": received}


@router.post("/{project_id}/uploads")
def create_upload(request: Request, project_id: str, body: dict | None = Body(default=None),
                  authorization: str | None = Header(default=None)):
    settings = request.app.state.settings
    with _disk_lock, db.transaction(settings.db_path) as connection:
        project = _project(connection, project_id, authorization)
        if project is None:
            return _not_found()
        if project["source_revision_id"] is not None:
            return _error(409, "source_already_fixed", "A successful source requires a new project.")
        if not isinstance(body, dict):
            return _error(400, "invalid_request", "Upload metadata is required.")
        filename, size, digest = body.get("filename"), body.get("totalSize"), body.get("sha256")
        root = body.get("rootStage")
        if (not isinstance(filename, str) or not 0 < len(filename) <= 1024
            or Path(filename).suffix.lower() not in STAGE_SUFFIXES | {".zip"}
            or isinstance(size, bool) or not isinstance(size, int) or size <= 0
            or not isinstance(digest, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", digest)
            or root is not None and (not isinstance(root, str) or len(root) > 4096)):
            return _error(400, "invalid_request", "Invalid upload metadata.")
        if size > settings.max_upload_bytes:
            return _error(413, "upload_limit", "The upload exceeds the configured size limit.")
        active = connection.execute("SELECT * FROM uploads WHERE project_id=? AND status != 'replaced'",
                                    (project_id,)).fetchall()
        for prior in active:
            job = connection.execute("SELECT status FROM jobs WHERE project_id=? AND kind='ingest'"
                                     " AND idempotency_key=?", (project_id, prior["id"])).fetchone()
            if job and job["status"] in {"queued", "running", "succeeded"}:
                return _error(409, "upload_in_progress", "The existing source is being processed.")
        connection.execute("UPDATE uploads SET status='replaced', updated_at=? WHERE project_id=?",
                           (_now(), project_id))
        upload_id = str(uuid.uuid4())
        connection.execute("INSERT INTO uploads VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?)",
                           (upload_id, project_id, filename, size, digest.lower(), root, _now(), _now()))
        row = _upload(connection, project_id, upload_id)
        return JSONResponse(_status(connection, row, settings.upload_chunk_bytes), status_code=201)


@router.get("/{project_id}/uploads/{upload_id}")
def upload_status(request: Request, project_id: str, upload_id: str,
                  authorization: str | None = Header(default=None)):
    settings = request.app.state.settings
    with closing(db.connect(settings.db_path)) as connection:
        if _project(connection, project_id, authorization) is None:
            return _not_found()
        row = _upload(connection, project_id, upload_id)
        if row is None:
            return _not_found()
        return JSONResponse(_status(connection, row, settings.upload_chunk_bytes))


def _commit_chunk(settings, project_id, upload_id, authorization, index, offset, size, digest, temporary):
    with _disk_lock, db.transaction(settings.db_path) as connection:
        if _project(connection, project_id, authorization) is None:
            return _not_found()
        row = _upload(connection, project_id, upload_id)
        if row is None:
            return _not_found()
        if row["status"] not in {"uploading", "failed"}:
            return _error(409, "upload_closed", "This upload no longer accepts chunks.")
        prior = connection.execute("SELECT * FROM upload_chunks WHERE upload_id=? AND chunk_index=?",
                                   (upload_id, index)).fetchone()
        if prior:
            if prior["byte_count"] == size and prior["sha256"] == digest:
                return Response(status_code=204)
            return _error(409, "chunk_conflict", "The received chunk differs from its stored bytes.")
        incoming = settings.projects_dir / project_id / "incoming"
        part = incoming / f"{upload_id}.part"
        with part.open("r+b" if part.exists() else "w+b") as output, temporary.open("rb") as source:
            output.seek(offset)
            shutil.copyfileobj(source, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        connection.execute("INSERT INTO upload_chunks VALUES (?, ?, ?, ?, ?)",
                           (upload_id, index, offset, size, digest))
        connection.execute("UPDATE uploads SET status='uploading', updated_at=? WHERE id=?", (_now(), upload_id))
    return Response(status_code=204)


@router.put("/{project_id}/uploads/{upload_id}/chunks/{index}")
async def upload_chunk(request: Request, project_id: str, upload_id: str, index: str,
                       authorization: str | None = Header(default=None)):
    settings = request.app.state.settings
    with closing(db.connect(settings.db_path)) as connection:
        if _project(connection, project_id, authorization) is None:
            return _not_found()
        row = _upload(connection, project_id, upload_id)
        if row is None:
            return _not_found()
    if not re.fullmatch(r"[0-9]{1,12}", index):
        return _error(400, "invalid_chunk", "Chunk index is invalid.")
    index = int(index)
    offset = index * settings.upload_chunk_bytes
    size = min(settings.upload_chunk_bytes, row["total_size"] - offset)
    expected_range = f"bytes {offset}-{offset + size - 1}/{row['total_size']}"
    if index < 0 or size <= 0 or request.headers.get("content-range") != expected_range:
        return _error(400, "invalid_chunk", "Chunk offset or length is invalid.")
    declared = request.headers.get("content-length")
    if declared is not None and declared != str(size):
        return _error(400, "invalid_chunk", "Chunk offset or length is invalid.")
    incoming = settings.projects_dir / project_id / "incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    descriptor, filename = tempfile.mkstemp(prefix="chunk-", dir=incoming)
    temporary = Path(filename)
    count = 0
    digest = hashlib.sha256()
    try:
        with os.fdopen(descriptor, "wb") as output:
            async for block in request.stream():
                count += len(block)
                if count > size:
                    return _error(400, "invalid_chunk", "Chunk offset or length is invalid.")
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        if count != size:
            return _error(400, "invalid_chunk", "Chunk offset or length is invalid.")
        return await run_in_threadpool(_commit_chunk, settings, project_id, upload_id, authorization,
                                       index, offset, count, digest.hexdigest(), temporary)
    finally:
        temporary.unlink(missing_ok=True)


@router.post("/{project_id}/uploads/{upload_id}/finalize")
def finalize_upload(request: Request, project_id: str, upload_id: str,
                    authorization: str | None = Header(default=None)):
    settings = request.app.state.settings
    with _disk_lock:
        with closing(db.connect(settings.db_path)) as connection:
            if _project(connection, project_id, authorization) is None:
                return _not_found()
            row = _upload(connection, project_id, upload_id)
            if row is None:
                return _not_found()
            job = connection.execute("SELECT id FROM jobs WHERE project_id=? AND kind='ingest'"
                                     " AND idempotency_key=?", (project_id, upload_id)).fetchone()
            if job:
                return JSONResponse({"uploadId": upload_id, "jobId": job["id"]}, status_code=202)
            if row["status"] == "replaced":
                return _error(409, "upload_closed", "This upload has been replaced.")
            chunks = connection.execute("SELECT chunk_index FROM upload_chunks WHERE upload_id=? ORDER BY chunk_index",
                                         (upload_id,)).fetchall()
        expected = (row["total_size"] + settings.upload_chunk_bytes - 1) // settings.upload_chunk_bytes
        if [r[0] for r in chunks] != list(range(expected)):
            return _error(409, "incomplete_upload", "Some upload chunks are missing.")
        project_dir = settings.projects_dir / project_id
        part = project_dir / "incoming" / f"{upload_id}.part"
        suffix = Path(row["filename"]).suffix.lower()
        generated = f"{upload_id}{suffix}"
        original_dir = project_dir / "source" / "original"
        original_dir.mkdir(parents=True, exist_ok=True)
        original = original_dir / generated
        # A restart between durable file publication and the DB commit can retry.
        assembled = original if original.exists() else part
        if not assembled.is_file():
            return _error(409, "incomplete_upload", "The upload bytes are missing.")
        with assembled.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if assembled.stat().st_size != row["total_size"] or digest != row["expected_sha256"]:
            with db.transaction(settings.db_path) as connection:
                connection.execute("UPDATE uploads SET status='failed', updated_at=? WHERE id=?", (_now(), upload_id))
            return _error(400, "digest_mismatch", "The assembled file does not match the declared SHA-256.")
        staging = Path(tempfile.mkdtemp(prefix="staging-", dir=project_dir / "source"))
        discarded = None
        original_temporary = None
        try:
            root = stage_source(assembled, staging, suffix, row["root_stage_relpath"], generated,
                                settings.max_expanded_bytes)
            if assembled != original:
                descriptor, filename = tempfile.mkstemp(prefix="original-", dir=original_dir)
                original_temporary = Path(filename)
                with os.fdopen(descriptor, "wb") as output, assembled.open("rb") as source:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                    output.flush()
                    os.fsync(output.fileno())
            with db.transaction(settings.db_path) as connection:
                if _project(connection, project_id, authorization) is None:
                    return _not_found()
                if original_temporary is not None:
                    os.replace(original_temporary, original)
                original.chmod(stat.S_IREAD)
                staged = project_dir / "source" / "staged"
                if staged.exists():
                    discarded = project_dir / "source" / f"old-{uuid.uuid4()}"
                    os.replace(staged, discarded)
                os.replace(staging, staged)
                job_id = str(uuid.uuid4())
                connection.execute("INSERT INTO jobs (id,project_id,kind,idempotency_key,status,phase,created_at)"
                                   " VALUES (?,?,'ingest',?,'queued','pending',?)",
                                   (job_id, project_id, upload_id, _now()))
                connection.execute("UPDATE uploads SET status='complete',root_stage_relpath=?,updated_at=? WHERE id=?",
                                   (root, _now(), upload_id))
            part.unlink(missing_ok=True)
            return JSONResponse({"uploadId": upload_id, "jobId": job_id}, status_code=202)
        except (StagingError, zipfile.BadZipFile, RuntimeError, FileExistsError, NotADirectoryError) as error:
            with db.transaction(settings.db_path) as connection:
                connection.execute("UPDATE uploads SET status='failed',updated_at=? WHERE id=?", (_now(), upload_id))
            return _error(getattr(error, "status", 400), getattr(error, "code", "unsafe_bundle"),
                          "The bundle could not be safely staged.")
        finally:
            if original_temporary is not None:
                original_temporary.unlink(missing_ok=True)
            if staging.exists():
                shutil.rmtree(staging)
            if discarded is not None and discarded.exists():
                shutil.rmtree(discarded)
