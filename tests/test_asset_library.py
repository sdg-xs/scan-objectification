import pytest
from fastapi.testclient import TestClient
from nemy_web.app import create_pilot_app
from nemy_web import asset_library

@pytest.fixture
def library_client(settings, monkeypatch):
    entry = {"id": "asset-1", "status": "draft", "definition": {"name": "Linear light", "categoryId": "lights"},
             "geometryReference": {"kind": "mesh", "geometryId": "mesh-1"}}
    payloads = {"/api/catalog-library": {"entries": [entry], "categories": [{"id": "lights", "name": "Lighting"}], "sources": []},
                "/api/models": [], "/api/geometry/mesh-1": {"geometry": {"meshes": []}}}
    monkeypatch.setattr(asset_library, "read_library", lambda path: payloads[path])
    with TestClient(create_pilot_app(settings), base_url="http://127.0.0.1:8767") as client:
        yield client, payloads, entry

def test_catalog_and_mesh_resolution(library_client):
    client, _, _ = library_client
    result = client.get("/api/local/assets")
    assert result.status_code == 200
    assert result.json() == [{"id": "asset-1", "name": "Linear light", "category": "Lighting", "geometryKind": "mesh"}]
    assert client.get("/api/local/assets/asset-1/geometry").json() == {"kind": "mesh", "geometry": {"meshes": []}}
    assert client.get("/api/local/assets/missing/geometry").status_code == 404

def test_ifc_resolution_and_revision_guard(library_client):
    client, payloads, entry = library_client
    entry["geometryReference"] = {"modelId": "model-1", "fingerprint": "version-1", "occurrenceId": 7}
    payloads["/api/models"] = [{"id": "model-1", "fingerprint": "version-1"}]
    assert client.get("/api/local/assets").json()[0]["geometryKind"] == "ifc"
    assert client.get("/api/local/assets/asset-1/geometry").json() == {"kind": "ifc", "modelId": "model-1", "occurrenceId": 7, "fingerprint": "version-1"}
    payloads["/api/models"][0]["fingerprint"] = "version-2"
    assert client.get("/api/local/assets/asset-1/geometry").status_code == 409

def test_source_reference_fallback(library_client):
    client, payloads, entry = library_client
    del entry["geometryReference"]
    entry["sourceReferences"] = [{"sourceId": "s1", "fingerprint": "v1", "occurrenceIds": [11]}]
    payloads["/api/catalog-library"]["sources"] = [{"id": "s1", "current": True, "modelId": "m1", "fingerprint": "v1", "observation": {"occurrenceIds": [11]}}]
    payloads["/api/models"] = [{"id": "m1", "fingerprint": "v1", "index": {"types": [{"occurrenceIds": [11]}]}}]
    assert client.get("/api/local/assets/asset-1/geometry").json()["occurrenceId"] == 11
    entry["sourceReferences"][0]["occurrenceIds"] = [99]
    assert client.get("/api/local/assets/asset-1/geometry").status_code == 404

def test_source_bytes_are_revision_checked_and_local_only(library_client, monkeypatch):
    client, payloads, entry = library_client
    entry["geometryReference"] = {"modelId": "model-1", "fingerprint": "v1", "occurrenceId": 7}
    payloads["/api/models"] = [{"id": "model-1", "fingerprint": "v1"}]
    monkeypatch.setattr(asset_library, "read_bytes", lambda path, limit: b"ISO-10303-21;\nEND-ISO-10303-21;")
    assert client.get("/api/local/assets/asset-1/source?fingerprint=stale").status_code == 409
    result = client.get("/api/local/assets/asset-1/source?fingerprint=v1")
    assert result.status_code == 200
    assert result.content.startswith(b"ISO-10303-21;")
    assert client.get("/api/local/assets", headers={"Origin": "https://example.com"}).status_code == 403


def test_transport_is_bounded_and_reports_library_offline(monkeypatch):
    from contextlib import contextmanager
    from fastapi import HTTPException
    from urllib.error import URLError
    class Fake:
        def geturl(self): return asset_library.LIBRARY_URL + "/test"
        def read(self, count): return b"x" * count
    @contextmanager
    def opened(*args, **kwargs):
        yield Fake()
    monkeypatch.setattr(asset_library._opener, "open", opened)
    with pytest.raises(HTTPException) as error:
        asset_library.read_bytes("/test", 10)
    assert error.value.status_code == 413
    def offline(*args, **kwargs): raise URLError("offline")
    monkeypatch.setattr(asset_library._opener, "open", offline)
    with pytest.raises(HTTPException) as error:
        asset_library.read_bytes("/test", 10)
    assert error.value.status_code == 503
