from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from nemy_web import asset_library_service as service


@pytest.fixture
def launch(monkeypatch, tmp_path):
    root = tmp_path / "library"
    script = root / "dist-server/server/index.js"
    script.parent.mkdir(parents=True)
    script.write_text("", encoding="utf-8")
    monkeypatch.setenv("NEMY_ASSET_LIBRARY_DIR", str(root))
    monkeypatch.setattr(service.shutil, "which", lambda _: "node.exe")
    process = Mock()
    process.poll.return_value = None
    spawn = Mock(return_value=process)
    monkeypatch.setattr(service.subprocess, "Popen", spawn)
    monkeypatch.setattr(service, "_process", None)
    return root, spawn, process


def test_reuses_running_library_without_launch(monkeypatch, launch, tmp_path):
    monkeypatch.setattr(service, "ready", lambda: True)
    service.ensure_running(tmp_path / "logs")
    launch[1].assert_not_called()


def test_starts_library_in_its_own_directory_and_waits(monkeypatch, launch, tmp_path):
    checks = iter([False, False, True])
    monkeypatch.setattr(service, "ready", lambda: next(checks))
    service.ensure_running(tmp_path / "logs")
    root, spawn, _ = launch
    assert spawn.call_count == 1
    assert spawn.call_args.kwargs["cwd"] == root
    assert spawn.call_args.args[0] == ["node.exe", str(root / "dist-server/server/index.js")]
    assert spawn.call_args.kwargs["env"]["PORT"] == "3001"


def test_failed_launch_can_be_retried(monkeypatch, launch, tmp_path):
    monkeypatch.setattr(service, "ready", lambda: False)
    launch[2].poll.return_value = 1
    with pytest.raises(HTTPException) as error:
        service.ensure_running(tmp_path / "logs")
    assert error.value.status_code == 503
    checks = iter([False, False, True])
    monkeypatch.setattr(service, "ready", lambda: next(checks))
    service.ensure_running(tmp_path / "logs")
    assert launch[1].call_count == 2


def test_missing_installation_reports_configuration(monkeypatch, launch, tmp_path):
    monkeypatch.setattr(service, "ready", lambda: False)
    monkeypatch.setenv("NEMY_ASSET_LIBRARY_DIR", str(tmp_path / "missing"))
    with pytest.raises(HTTPException) as error:
        service.ensure_running(tmp_path / "logs")
    assert error.value.status_code == 503
    assert "NEMY_ASSET_LIBRARY_DIR" in error.value.detail
    launch[1].assert_not_called()


def test_timeout_does_not_launch_duplicate_on_retry(monkeypatch, launch, tmp_path):
    monkeypatch.setattr(service, "ready", lambda: False)
    clock = iter([0, 31, 40, 71])
    monkeypatch.setattr(service.time, "monotonic", lambda: next(clock))
    for _ in range(2):
        with pytest.raises(HTTPException) as error:
            service.ensure_running(tmp_path / "logs")
        assert error.value.status_code == 503
    assert launch[1].call_count == 1


def test_concurrent_requests_share_one_start(monkeypatch, launch, tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    running = Event()
    monkeypatch.setattr(service, "ready", running.is_set)
    def start(*args, **kwargs):
        running.set()
        return launch[2]
    launch[1].side_effect = start
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: service.ensure_running(tmp_path / "logs"), range(4)))
    assert launch[1].call_count == 1
