"""SQLite schema and short transactions for pilot records.

Only metadata and references live in the database. Gaussian arrays and JSON
manifests stay on disk and are addressed by project-relative POSIX paths.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  secret_hash BLOB NOT NULL,
  media_epoch INTEGER NOT NULL DEFAULT 0,
  state_version INTEGER NOT NULL DEFAULT 0,
  source_revision_id TEXT,
  manifest_relpath TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  filename TEXT NOT NULL,
  total_size INTEGER NOT NULL,
  expected_sha256 TEXT NOT NULL,
  root_stage_relpath TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress_current INTEGER,
  progress_total INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(project_id, kind, idempotency_key)
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a connection with the settings every pilot connection needs."""
    connection = sqlite3.connect(db_path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def transaction(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Run one short write transaction."""
    connection = connect(db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.execute("COMMIT")
    except BaseException:
        # Only roll back a transaction that actually began. If `BEGIN
        # IMMEDIATE` itself failed (for example because the database is
        # locked), an unconditional ROLLBACK raises "cannot rollback - no
        # transaction is active" and hides the real cause.
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()


def initialize(db_path: Path) -> None:
    """Create the schema and record the schema version."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = connect(db_path)
    try:
        connection.executescript(SCHEMA)
        connection.execute("PRAGMA journal_mode = WAL")
        current = connection.execute("PRAGMA user_version").fetchone()[0]
        if current < SCHEMA_VERSION:
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    finally:
        connection.close()
