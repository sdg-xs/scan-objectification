"""Shared fixtures for the pilot test suite."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nemy_web.app import create_pilot_app
from nemy_web.config import Settings


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    """A data directory that does not exist yet, like a fresh pilot install."""
    return tmp_path / "data"


@pytest.fixture
def settings(data_dir: Path) -> Settings:
    """Pilot settings pointed at a temporary data directory."""
    return Settings(data_dir=data_dir)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """A started application, so the lifespan has run."""
    with TestClient(create_pilot_app(settings)) as test_client:
        yield test_client
