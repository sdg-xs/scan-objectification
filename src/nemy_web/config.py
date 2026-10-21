"""Validated pilot settings, read from the environment."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_BIND = "127.0.0.1"
DEFAULT_PORT = 8767
DEFAULT_DATA_DIR = Path("data")

# Byte and second limits that must be positive for the pilot to make sense.
POSITIVE_FIELDS = (
    "max_upload_bytes",
    "max_expanded_bytes",
    "upload_chunk_bytes",
    "job_timeout_seconds",
    "media_session_seconds",
)


@dataclass(frozen=True)
class Settings:
    """Everything the API and the worker must agree on.

    The values are read once at startup. An invalid value is a startup
    failure, not a runtime surprise.
    """

    bind: str = DEFAULT_BIND
    port: int = DEFAULT_PORT
    data_dir: Path = DEFAULT_DATA_DIR
    max_upload_bytes: int = 8589934592
    max_expanded_bytes: int = 34359738368
    upload_chunk_bytes: int = 16777216
    job_timeout_seconds: int = 21600
    media_session_seconds: int = 900
    build_lod: Path | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "data_dir", Path(self.data_dir).expanduser().resolve())
        if self.build_lod is not None:
            # Resolved like `data_dir` so the converter check does not depend
            # on the process working directory.
            object.__setattr__(self, "build_lod", Path(self.build_lod).expanduser().resolve())
        if not 1 <= self.port <= 65535:
            raise ValueError(f"NEMY_PORT must be between 1 and 65535, got {self.port}")
        for name in POSITIVE_FIELDS:
            value = getattr(self, name)
            if value <= 0:
                raise ValueError(f"{name} must be greater than zero, got {value}")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "nemy.db"

    @property
    def projects_dir(self) -> Path:
        return self.data_dir / "projects"

    @property
    def trash_dir(self) -> Path:
        return self.data_dir / "trash"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Settings":
        """Build settings from environment values.

        ``environ`` defaults to the process environment. Passing a mapping
        reads only that mapping, which keeps tests independent of the shell.
        """
        env = os.environ if environ is None else environ

        def text(name: str, default: str) -> str:
            value = env.get(name)
            if value is None or not value.strip():
                return default
            return value.strip()

        def number(name: str, default: int) -> int:
            raw = text(name, str(default))
            try:
                return int(raw)
            except ValueError as error:
                raise ValueError(f"{name} must be an integer, got {raw!r}") from error

        build_lod = text("NEMY_BUILD_LOD", "")
        return cls(
            bind=text("NEMY_BIND", DEFAULT_BIND),
            port=number("NEMY_PORT", DEFAULT_PORT),
            data_dir=Path(text("NEMY_DATA_DIR", str(DEFAULT_DATA_DIR))),
            max_upload_bytes=number("NEMY_MAX_UPLOAD_BYTES", 8589934592),
            max_expanded_bytes=number("NEMY_MAX_EXPANDED_BYTES", 34359738368),
            upload_chunk_bytes=number("NEMY_UPLOAD_CHUNK_BYTES", 16777216),
            job_timeout_seconds=number("NEMY_JOB_TIMEOUT_SECONDS", 21600),
            media_session_seconds=number("NEMY_MEDIA_SESSION_SECONDS", 900),
            build_lod=Path(build_lod) if build_lod else None,
        )
