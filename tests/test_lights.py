"""The local light endpoint transports bounded images, never arbitrary URLs."""

import base64
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading

import pytest
from fastapi.testclient import TestClient

from nemy_web.app import create_app, create_pilot_app

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")


def result():
    return {
        "model": "sam3.1", "width": 1, "height": 1,
        "groups": [{"kind": kind, "detections": []} for kind in ("linear", "round", "bulb")],
        "overlay_png": base64.b64encode(PNG).decode(),
    }


@contextmanager
def worker(monkeypatch, payload=None, status=200, prompt=None):
    from nemy_web import lights

    received = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"model":"sam3.1","status":"ready"}')

        def do_POST(self):
            if prompt is not None:
                assert self.headers["X-SAM-Prompt"] == prompt
            received.append((self.path, self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(status)
            self.end_headers()
            self.wfile.write(json.dumps(payload if payload is not None else result()).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(lights, "SAM_URL", f"http://127.0.0.1:{server.server_port}")
    try:
        yield received
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.fixture
def light_client(settings):
    with TestClient(create_pilot_app(settings), base_url="http://127.0.0.1:8767") as client:
        yield client


def test_lights_proxy_preserves_capture_and_validates_result(light_client, monkeypatch):
    with worker(monkeypatch) as received:
        response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png", "Origin": "http://localhost:5173"})
    assert response.status_code == 200
    assert response.json() == result()
    assert received == [("/lights", PNG)]
    assert response.headers["Cache-Control"] == "no-store"


def test_custom_prompt_returns_matching_category(light_client, monkeypatch):
    payload = result() | {"prompt": "red pipe", "groups": [{"kind": "custom", "detections": []}]}
    with worker(monkeypatch, payload, prompt="red%20pipe"):
        response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png", "X-SAM-Prompt": "red%20pipe"})
    assert response.status_code == 200
    assert response.json()["prompt"] == "red pipe"


@pytest.mark.parametrize("prompt", ["", "x" * 241, "%00pipe", "%FF"])
def test_invalid_prompt_rejected_before_inference(light_client, prompt):
    response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png", "X-SAM-Prompt": prompt})
    assert response.status_code == 422


@pytest.mark.parametrize("change", [
    {"prompt": "different object"},
    {"groups": [{"kind": "custom", "detections": [{"score": 0.9, "box": [0, 0, 1, 1]}]}]},
    {"groups": [{"kind": "custom", "detections": [{"score": 0.9, "box": [0, 0, 1, 1], "mask_png": "invalid"}]}]},
], ids=["wrong-prompt", "missing-mask", "invalid-mask"])
def test_custom_result_must_match_prompt_and_include_valid_masks(light_client, monkeypatch, change):
    payload = result() | {"prompt": "red pipe", "groups": [{"kind": "custom", "detections": []}]} | change
    with worker(monkeypatch, payload):
        response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png", "X-SAM-Prompt": "red%20pipe"})
    assert response.status_code == 502


@pytest.mark.parametrize("origin", ["https://example.com", "http://localhost:9999", "null"])
def test_lights_rejects_other_origins(light_client, origin):
    response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png", "Origin": origin})
    assert response.status_code == 403


def test_lights_rejects_rebound_host(light_client):
    response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png", "Host": "attacker.example"})
    assert response.status_code == 403


@pytest.mark.parametrize("body,content_type,expected", [(b"not PNG", "image/png", 422), (PNG[:24], "image/png", 422), (PNG, "text/plain", 415), (b"x" * (8 * 1024 * 1024 + 1), "image/png", 413)], ids=["not-png", "truncated", "content-type", "too-large"])
def test_lights_rejects_invalid_captures_before_forwarding(light_client, body, content_type, expected):
    response = light_client.post("/api/local/lights", content=body, headers={"Content-Type": content_type})
    assert response.status_code == expected


def test_lights_rejects_oversized_dimensions(light_client):
    body = PNG[:16] + (1601).to_bytes(4, "big") + PNG[20:]
    response = light_client.post("/api/local/lights", content=body, headers={"Content-Type": "image/png"})
    assert response.status_code == 422


def test_lights_reports_missing_runtime_without_spawning(light_client, monkeypatch, tmp_path):
    from nemy_web import lights
    monkeypatch.setattr(lights, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(lights, "SAM_URL", "http://127.0.0.1:1")
    response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png"})
    assert response.status_code == 503
    assert "SAM 3.1" in response.json()["detail"]


@pytest.mark.parametrize("change", [{"model": "sam3"}, {"width": 2}, {"overlay_png": "not-an-image"}, {"groups": []}])
def test_lights_rejects_incompatible_worker_results(light_client, monkeypatch, change):
    with worker(monkeypatch, result() | change):
        response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png"})
    assert response.status_code == 502


def test_worker_errors_do_not_leak_internal_details(light_client, monkeypatch):
    with worker(monkeypatch, {"detail": "private server path and credential"}, status=500):
        response = light_client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png"})
    assert response.status_code == 502
    assert "private" not in response.text


def test_bare_app_does_not_register_light_api(settings):
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/local/lights", content=PNG, headers={"Content-Type": "image/png"}).status_code == 404
