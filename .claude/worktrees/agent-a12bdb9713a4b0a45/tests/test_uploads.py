"""Upload protocol and archive trust-boundary regressions."""
import hashlib
import io
import os
import stat
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nemy_web import db, uploads
from nemy_web.app import create_pilot_app
from nemy_web.config import Settings
from tests.fixtures.make_bundle import bundle_bytes


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path / "data", upload_chunk_bytes=16,
                    max_upload_bytes=4096, max_expanded_bytes=1024)


@pytest.fixture
def client(settings):
    with TestClient(create_pilot_app(settings)) as result:
        yield result


@pytest.fixture
def project(client):
    result = client.post("/api/projects").json()
    return (f"/api/projects/{result['projectId']}/uploads",
            CapabilityHeaders(Authorization=f"Bearer {result['capabilitySecret']}"), result['projectId'])


class CapabilityHeaders(dict):
    def __repr__(self):
        return "<redacted capability headers>"


DATA = b"#usda 1.0\n" + b" " * 27


def begin(client, project, data=DATA, filename="scene.usda", **extra):
    url, headers, _ = project
    return client.post(url, headers=headers, json={"filename": filename,
        "totalSize": len(data), "sha256": hashlib.sha256(data).hexdigest(), **extra})


def chunk(client, project, upload, index, data=DATA, **extra):
    url, headers, _ = project
    start = index * 16
    part = data[start:start + 16]
    return client.put(f"{url}/{upload}/chunks/{index}", content=part,
        headers={**headers, "Content-Range": f"bytes {start}-{start + len(part)-1}/{len(data)}", **extra})


def send(client, project, data=DATA, filename="scene.usda", **extra):
    result = begin(client, project, data, filename, **extra)
    assert result.status_code == 201
    upload = result.json()["uploadId"]
    for index in range((len(data) + 15) // 16):
        assert chunk(client, project, upload, index, data).status_code == 204
    return upload


def finalize(client, project, upload):
    url, headers, _ = project
    return client.post(f"{url}/{upload}/finalize", headers=headers)


def test_create_upload_metadata(client, project, settings):
    response = begin(client, project, filename="../../metadata.usda", rootStage=None)
    assert response.status_code == 201
    with db.connect(settings.db_path) as connection:
        row = connection.execute("SELECT * FROM uploads").fetchone()
    assert row["filename"] == "../../metadata.usda"
    assert row["total_size"] == 37
    assert row["expected_sha256"] == hashlib.sha256(DATA).hexdigest()


def test_out_of_order_chunks(client, project, settings):
    upload = begin(client, project).json()["uploadId"]
    for index in [2, 0, 1]:
        assert chunk(client, project, upload, index).status_code == 204
    assert (settings.projects_dir / project[2] / "incoming" / f"{upload}.part").read_bytes() == DATA


def test_status_lists_chunk_size_and_indexes(client, project):
    upload = begin(client, project).json()["uploadId"]
    chunk(client, project, upload, 1)
    result = client.get(f"{project[0]}/{upload}", headers=project[1]).json()
    assert result["chunkSize"] == 16
    assert result["receivedChunks"] == [1]


def test_identical_retry(client, project):
    upload = begin(client, project).json()["uploadId"]
    assert chunk(client, project, upload, 0).status_code == 204
    assert chunk(client, project, upload, 0).status_code == 204


def test_conflicting_retry(client, project):
    upload = begin(client, project).json()["uploadId"]
    chunk(client, project, upload, 0)
    response = chunk(client, project, upload, 0, b"x" * len(DATA))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "chunk_conflict"


@pytest.mark.parametrize("index,body,range_", [(0, b"x"*16, "bytes 1-16/37"),
    (0, b"x", "bytes 0-15/37"), (3, b"x", "bytes 48-48/37"),
    (-1, b"x", "bytes 0-0/37"), (0, b"x"*17, "bytes 0-15/37")])
def test_rejects_bad_chunk_geometry(client, project, index, body, range_):
    upload = begin(client, project).json()["uploadId"]
    response = client.put(f"{project[0]}/{upload}/chunks/{index}", content=body,
        headers={**project[1], "Content-Range": range_})
    assert response.status_code == 400
    assert client.get(f"{project[0]}/{upload}", headers=project[1]).json()["receivedChunks"] == []


def test_oversized_declaration(client, project):
    assert begin(client, project, totalSize=4097).status_code == 413


def test_resume_across_app_restart(client, project, settings):
    upload = begin(client, project).json()["uploadId"]
    chunk(client, project, upload, 1)
    with TestClient(create_pilot_app(settings)) as restarted:
        assert restarted.get(f"{project[0]}/{upload}", headers=project[1]).json()["receivedChunks"] == [1]
        assert chunk(restarted, project, upload, 0).status_code == 204


def test_digest_mismatch_stays_resumable(client, project):
    upload = send(client, project, sha256="0"*64)
    response = finalize(client, project, upload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "digest_mismatch"
    assert client.get(f"{project[0]}/{upload}", headers=project[1]).json()["receivedChunks"] == [0, 1, 2]
    assert chunk(client, project, upload, 0).status_code == 204


def test_finalize_requires_all_chunks(client, project):
    upload = begin(client, project).json()["uploadId"]
    assert finalize(client, project, upload).status_code == 409


def test_finalize_preserves_original_and_stages_generated_name(client, project, settings):
    upload = send(client, project, filename="../../never-path.usda")
    response = finalize(client, project, upload)
    assert response.status_code == 202
    source = settings.projects_dir / project[2] / "source"
    original = source / "original" / f"{upload}.usda"
    assert original.read_bytes() == DATA
    assert not original.stat().st_mode & stat.S_IWRITE
    assert (source / "staged" / f"{upload}.usda").read_bytes() == DATA
    with db.connect(settings.db_path) as connection:
        row = connection.execute("SELECT * FROM uploads WHERE id=?", (upload,)).fetchone()
    assert row["status"] == "complete"
    assert row["root_stage_relpath"] == f"{upload}.usda"


def test_repeated_finalize_returns_same_job(client, project, settings):
    upload = send(client, project)
    first = finalize(client, project, upload)
    second = finalize(client, project, upload)
    assert first.status_code == second.status_code == 202
    assert first.json()["jobId"] == second.json()["jobId"]
    with db.connect(settings.db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM jobs WHERE kind='ingest'").fetchone()[0] == 1


def test_original_publishes_from_durable_temporary_in_destination(client, project, monkeypatch):
    upload = send(client, project)
    replace = os.replace
    sources = []
    def tracked_replace(source, destination):
        if Path(destination).parent.name == "original":
            sources.append(Path(source).parent == Path(destination).parent)
        return replace(source, destination)
    monkeypatch.setattr(os, "replace", tracked_replace)
    assert finalize(client, project, upload).status_code == 202
    assert sources == [True]


def test_invalid_index_still_checks_capability_first(client, project):
    upload = begin(client, project).json()["uploadId"]
    response = client.put(f"{project[0]}/{upload}/chunks/not-an-index", content=b"x")
    assert response.status_code == 404


def test_concurrent_finalize_enqueues_once(client, project):
    upload = send(client, project)
    with ThreadPoolExecutor(2) as executor:
        results = list(executor.map(lambda _: finalize(client, project, upload), range(2)))
    assert [r.status_code for r in results] == [202, 202]
    assert results[0].json()["jobId"] == results[1].json()["jobId"]


def test_failed_upload_can_be_replaced(client, project):
    upload = send(client, project, sha256="0"*64)
    finalize(client, project, upload)
    assert begin(client, project).status_code == 201
    assert chunk(client, project, upload, 0).status_code == 409


def test_failed_ingest_can_be_replaced(client, project, settings):
    upload = send(client, project)
    finalize(client, project, upload)
    with db.transaction(settings.db_path) as connection:
        connection.execute("UPDATE jobs SET status='failed' WHERE kind='ingest'")
    assert begin(client, project).status_code == 201


def test_source_success_prevents_replacement(client, project, settings):
    with db.transaction(settings.db_path) as connection:
        connection.execute("UPDATE projects SET source_revision_id='revision' WHERE id=?", (project[2],))
    response = begin(client, project)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "source_already_fixed"


@pytest.mark.parametrize("method,suffix", [("POST", ""), ("GET", "/unknown"),
    ("PUT", "/unknown/chunks/0"), ("POST", "/unknown/finalize")])
@pytest.mark.parametrize("header", [None, "Bearer wrong"])
def test_every_route_requires_capability(client, project, method, suffix, header):
    response = client.request(method, project[0]+suffix,
        headers={} if header is None else {"Authorization": header})
    assert response.status_code == 404


def zip_bytes(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, value in entries:
            archive.writestr(name, value)
    return buffer.getvalue()


def test_valid_local_reference_bundle(client, project, settings):
    upload = send(client, project, bundle_bytes(), "bundle.zip", rootStage="root.usda")
    assert finalize(client, project, upload).status_code == 202
    root = settings.projects_dir / project[2] / "source" / "staged"
    assert (root / "root.usda").is_file()
    assert (root / "SubUSDs" / "child.usda").is_file()


@pytest.mark.parametrize("name", ["/etc/passwd", "C:\\Windows\\x", "../escape.usda", "a/../root.usda",
    "D:root.usda", "a:stream.usda", "dir/NUL.usda", "root.usda.", "dir /root.usda"])
def test_rejects_unsafe_archive_names(client, project, name):
    upload = send(client, project, zip_bytes([(name, DATA)]), "bundle.zip", rootStage=name)
    assert finalize(client, project, upload).status_code == 400


def test_rejects_case_insensitive_duplicates(client, project):
    data = zip_bytes([("A/Stage.usda", DATA), ("a/stage.usda", DATA)])
    upload = send(client, project, data, "bundle.zip", rootStage="A/Stage.usda")
    assert finalize(client, project, upload).status_code == 400


@pytest.mark.parametrize("mode", [stat.S_IFLNK|0o777, stat.S_IFIFO|0o600,
    stat.S_IFCHR|0o600, stat.S_IFDIR|0o755])
def test_rejects_archive_links_and_special_entries(client, project, mode):
    entry = zipfile.ZipInfo("root.usda")
    entry.create_system = 3
    entry.external_attr = mode << 16
    upload = send(client, project, zip_bytes([(entry, DATA)]), "bundle.zip", rootStage="root.usda")
    assert finalize(client, project, upload).status_code == 400


@pytest.mark.parametrize("attributes", [0x40, 0x08, 0x400])
def test_rejects_dos_device_volume_and_reparse_entries(client, project, attributes):
    entry = zipfile.ZipInfo("root.usda")
    entry.create_system = 0
    entry.external_attr = attributes
    upload = send(client, project, zip_bytes([(entry, DATA)]), "bundle.zip", rootStage="root.usda")
    assert finalize(client, project, upload).status_code == 400


def test_rejects_expansion_over_quota(client, project):
    upload = send(client, project, zip_bytes([("root.usda", b" "*1025)]), "bundle.zip", rootStage="root.usda")
    response = finalize(client, project, upload)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "expansion_limit"


@pytest.mark.parametrize("root", ["absent.usda", "../outside.usda", "/outside.usda", "C:/outside.usda"])
def test_rejects_missing_or_outside_root(client, project, root):
    upload = send(client, project, bundle_bytes(), "bundle.zip", rootStage=root)
    assert finalize(client, project, upload).status_code == 400


@pytest.mark.skipif(os.name != "nt", reason="Windows reparse-point boundary")
def test_rejects_existing_reparse_component(tmp_path):
    import subprocess
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    subprocess.run(["cmd", "/c", "mklink", "/J", str(root / "junction"), str(outside)],
                   check=True, capture_output=True)
    try:
        with pytest.raises(uploads.StagingError):
            uploads.checked_path(root, "junction/root.usda")
    finally:
        (root / "junction").rmdir()


def test_closed_upload_rejects_chunks_and_finalize(client, project):
    upload = send(client, project)
    # A second attempt replaces the first; the closed attempt accepts nothing.
    begin(client, project)
    assert chunk(client, project, upload, 0).status_code == 409
    response = finalize(client, project, upload)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "upload_closed"
