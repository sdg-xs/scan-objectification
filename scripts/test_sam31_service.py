"""Worker behavior tests run in the separate SAM environment."""

import base64
import io
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image

from sam31_service import create_worker


def capture():
    buffer = io.BytesIO()
    Image.new("RGB", (16, 12), "black").save(buffer, format="PNG")
    return buffer.getvalue()


class Engine:
    def detect(self, path):
        self.path = path
        for kind in ("linear", "round", "bulb"):
            mask = np.zeros((1, 12, 16), dtype=bool)
            mask[0, 3:6, 4:9] = True
            yield kind, {"out_binary_masks": mask, "out_probs": np.array([0.9]), "out_boxes_xywh": np.array([[0.25, 0.25, 0.3125, 0.25]])}


def test_custom_prompt_reaches_engine_and_returns_individual_mask(tmp_path):
    class CustomEngine(Engine):
        def detect(self, path, prompt):
            self.prompt = prompt
            _, output = next(super().detect(path))
            yield "custom", output
    engine = CustomEngine()
    with TestClient(create_worker(tmp_path, engine), base_url="http://127.0.0.1:8768") as client:
        response = client.post("/lights", content=capture(), headers={"Content-Type": "image/png", "X-SAM-Prompt": "red%20pipe"})
    assert response.status_code == 200
    assert engine.prompt == "red pipe"
    result = response.json()
    assert result["prompt"] == "red pipe"
    mask = Image.open(io.BytesIO(base64.b64decode(result["groups"][0]["detections"][0]["mask_png"])))
    assert mask.getpixel((5, 4)) == 255
    assert mask.getpixel((0, 0)) == 0


def test_worker_draws_masks_boxes_and_cleans_up_capture(tmp_path):
    engine = Engine()
    app = create_worker(tmp_path, engine=engine)
    with TestClient(app, base_url="http://127.0.0.1:8768") as client:
        response = client.post("/lights", content=capture(), headers={"Content-Type": "image/png"})
    assert response.status_code == 200
    result = response.json()
    assert result["model"] == "sam3.1"
    assert (result["width"], result["height"]) == (16, 12)
    assert [len(group["detections"]) for group in result["groups"]] == [1, 1, 1]
    overlay = Image.open(io.BytesIO(base64.b64decode(result["overlay_png"])))
    assert overlay.size == (16, 12)
    assert overlay.convert("RGB").getpixel((5, 4)) != (0, 0, 0)
    assert not engine.path.exists()


def test_worker_rejects_browser_requests_and_corrupt_images(tmp_path):
    with TestClient(create_worker(tmp_path, engine=Engine()), base_url="http://127.0.0.1:8768") as client:
        assert client.post("/lights", content=capture(), headers={"Content-Type": "image/png", "Origin": "http://localhost:5173"}).status_code == 403
        assert client.post("/lights", content=capture()[:40], headers={"Content-Type": "image/png"}).status_code == 422


def test_worker_rejects_concurrent_work_and_recovers_after_failure(tmp_path):
    class FailingEngine:
        def detect(self, path):
            raise RuntimeError("internal path must not be returned")
            yield

    app = create_worker(tmp_path, engine=FailingEngine())
    with TestClient(app, base_url="http://127.0.0.1:8768") as client:
        app.state.inference_lock.acquire()
        try:
            assert client.post("/lights", content=capture(), headers={"Content-Type": "image/png"}).status_code == 429
        finally:
            app.state.inference_lock.release()
        response = client.post("/lights", content=capture(), headers={"Content-Type": "image/png"})
        assert response.status_code == 503
        assert "internal" not in response.text
        assert app.state.inference_lock.acquire(blocking=False)
        app.state.inference_lock.release()


def test_worker_never_silently_discards_instances(tmp_path):
    class CrowdedEngine:
        def detect(self, path):
            yield "linear", {"out_binary_masks": np.zeros((51, 12, 16), dtype=bool), "out_probs": np.ones(51), "out_boxes_xywh": np.ones((51, 4))}

    with TestClient(create_worker(tmp_path, engine=CrowdedEngine()), base_url="http://127.0.0.1:8768") as client:
        response = client.post("/lights", content=capture(), headers={"Content-Type": "image/png"})
    assert response.status_code == 422
    assert response.json()["code"] == "too_many_lights"
