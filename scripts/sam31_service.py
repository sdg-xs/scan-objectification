"""Loopback SAM 3.1 worker; launched by the viewer API in its own environment."""

from __future__ import annotations

import argparse
import base64
from contextlib import closing, asynccontextmanager
import gc
import io
import logging
from pathlib import Path
import sys
import tempfile
import threading
import time
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import numpy as np
from PIL import Image, ImageDraw, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from nemy_web.lights import MAX_INPUT, MAX_RESPONSE, LightResult, png_size, read_prompt

PROMPTS = (
    ("linear", "linear light fixture", (70, 220, 130)),
    ("round", "round ceiling light", (70, 160, 255)),
    ("bulb", "light bulb", (255, 190, 50)),
)


class SamEngine:
    def __init__(self, runtime: Path, idle_seconds: float = 120):
        self.runtime = runtime
        self.idle_seconds = idle_seconds
        self._predictor = None
        self._lock = threading.RLock()
        self._timer = None
        self._generation = 0
        self.phase = "idle"
        self.last_timings = {}

    @property
    def model_loaded(self):
        return self._predictor is not None

    def _build_predictor(self):
        from sam3.model_builder import build_sam3_predictor
        return build_sam3_predictor(
            version="sam3.1", checkpoint_path=str(self.runtime / "model/sam3.1_multiplex.pt"),
            use_fa3=False, compile=False, warm_up=False, async_loading_frames=False,
        )

    def _cancel_idle(self):
        self._generation += 1
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _drop_predictor(self):
        self._predictor = None
        gc.collect()
        torch = sys.modules.get("torch")
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _expire(self, generation):
        with self._lock:
            if generation == self._generation:
                self._drop_predictor()
                self._timer = None
                logging.info("SAM model released after inactivity")

    def close(self):
        with self._lock:
            self._cancel_idle()
            self._drop_predictor()

    def detect(self, image_path: Path, prompt: str | None = None):
        with self._lock:
            self._cancel_idle()
            self.phase = "loading_model"
            started = time.perf_counter()
            import torch
            if not torch.cuda.is_available():
                self.phase = "idle"
                raise RuntimeError("CUDA is unavailable.")
            state = {}
            reused = self.model_loaded
            timings = {"reused_model": reused, "model_load_ms": 0.0, "image_setup_ms": 0.0, "detection_ms": 0.0}
            try:
                if self._predictor is None:
                    self._predictor = self._build_predictor()
                    # The upstream constructor enters thread-local autocast.
                    # Exit it here; every request enters its own context below.
                    self._predictor.bf16_context.__exit__(None, None, None)
                    torch.cuda.synchronize()
                    timings["model_load_ms"] = (time.perf_counter() - started) * 1000
                with torch.inference_mode(), torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                    self.phase = "preparing_image"
                    frame_started = time.perf_counter()
                    state = self._predictor.model.init_state(resource_path=str(image_path), offload_video_to_cpu=True, async_loading_frames=False)
                    torch.cuda.synchronize()
                    timings["image_setup_ms"] = (time.perf_counter() - frame_started) * 1000
                    for kind, description, _color in (("custom", prompt, (70, 220, 130)),) if prompt else PROMPTS:
                        self.phase = "detecting"
                        detection_started = time.perf_counter()
                        _frame, output = self._predictor.model.add_prompt(inference_state=state, frame_idx=0, text_str=description)
                        torch.cuda.synchronize()
                        timings["detection_ms"] += (time.perf_counter() - detection_started) * 1000
                        self.phase = "encoding"
                        yield kind, output
            except Exception:
                self._predictor = None
                raise
            finally:
                state.clear()
                gc.collect()
                torch.cuda.empty_cache()
                self.last_timings = timings
                self.phase = "idle"
                if self.model_loaded:
                    self._timer = threading.Timer(self.idle_seconds, self._expire, args=(self._generation,))
                    self._timer.daemon = True
                    self._timer.start()


class DetectionLimit(ValueError):
    pass


def annotated_result(image: Image.Image, outputs, prompt: str | None = None) -> dict:
    width, height = image.size
    overlay = image.convert("RGBA")
    groups = []
    labels = []
    prompts = (("custom", prompt, (70, 220, 130)),) if prompt else PROMPTS
    for (kind, _prompt, color), (output_kind, output) in zip(prompts, outputs, strict=True):
        if output_kind != kind:
            raise ValueError("Unexpected category.")
        masks = np.asarray(output["out_binary_masks"], dtype=bool)
        scores = np.asarray(output["out_probs"])
        boxes = np.asarray(output["out_boxes_xywh"])
        count = len(masks)
        if count > 50:
            raise DetectionLimit("More than 50 lights matched one category. Capture a smaller area.")
        if masks.shape != (count, height, width) or scores.shape != (count,) or boxes.shape != (count, 4):
            raise ValueError("Unexpected detection dimensions.")
        tint = np.zeros((height, width, 4), dtype=np.uint8)
        detections = []
        for index, mask in enumerate(masks):
            score = float(scores[index])
            x, y, box_width, box_height = map(float, boxes[index])
            if not np.isfinite([score, x, y, box_width, box_height]).all():
                raise ValueError("Non-finite detection.")
            right, bottom = np.clip([x + box_width, y + box_height], 0, 1)
            x, y = np.clip([x, y], 0, 1)
            box = [float(x), float(y), float(right - x), float(bottom - y)]
            if box[2] <= 0 or box[3] <= 0:
                continue
            mask_buffer = io.BytesIO()
            Image.fromarray(mask.astype(np.uint8) * 255).save(mask_buffer, format="PNG")
            detections.append({"score": score, "box": box, "mask_png": base64.b64encode(mask_buffer.getvalue()).decode()})
            tint[mask] = (*color, 100)
            labels.append((kind, len(detections), color, box))
        overlay = Image.alpha_composite(overlay, Image.fromarray(tint))
        groups.append({"kind": kind, "detections": detections})
    draw = ImageDraw.Draw(overlay)
    for kind, index, color, (x, y, box_width, box_height) in labels:
        x, y = x * width, y * height
        draw.rectangle((x, y, x + box_width * width, y + box_height * height), outline=color, width=2)
        draw.text((x, max(0, y - 13)), f"{kind} {index}", fill=color, stroke_width=1, stroke_fill="black")
    buffer = io.BytesIO()
    overlay.convert("RGB").save(buffer, format="PNG")
    result = LightResult(model="sam3.1", width=width, height=height, groups=groups, prompt=prompt, overlay_png=base64.b64encode(buffer.getvalue()).decode())
    if len(result.model_dump_json().encode()) > MAX_RESPONSE:
        raise ValueError("Detection response too large.")
    return result.model_dump(exclude_none=True)


def create_worker(runtime: Path, engine=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        yield
        close = getattr(app.state.engine, "close", None)
        if close is not None:
            await run_in_threadpool(close)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])
    app.state.inference_lock = threading.Lock()
    app.state.engine = engine if engine is not None else SamEngine(runtime)

    @app.middleware("http")
    async def native_clients_only(request: Request, call_next):
        if request.headers.get("origin") is not None:
            return JSONResponse({"detail": "Use the viewer's same-origin API."}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health")
    def health():
        ready = engine is not None or (runtime / "model/sam3.1_multiplex.pt").is_file()
        busy = app.state.inference_lock.locked()
        phase = getattr(app.state.engine, "phase", "idle")
        return JSONResponse({"model": "sam3.1", "status": "ready" if ready else "unavailable", "busy": busy,
            "phase": ("encoding" if phase == "idle" else phase) if busy else "idle",
            "model_loaded": bool(getattr(app.state.engine, "model_loaded", False))}, status_code=200 if ready else 503)

    def run(data: bytes, prompt: str | None):
        if not app.state.inference_lock.acquire(blocking=False):
            return JSONResponse({"detail": "Another view is being processed."}, status_code=429)
        started = time.perf_counter()
        try:
            try:
                dimensions = png_size(data)
                with Image.open(io.BytesIO(data)) as source:
                    if source.format != "PNG" or source.size != dimensions or getattr(source, "n_frames", 1) != 1:
                        raise ValueError("Invalid PNG capture.")
                    image = source.convert("RGB")
            except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
                return JSONResponse({"detail": "Invalid PNG capture."}, status_code=422)
            with tempfile.TemporaryDirectory(prefix="nemy-sam31-") as directory:
                path = Path(directory) / "view.png"
                image.save(path, format="PNG")
                inference = app.state.engine.detect(path, prompt) if prompt else app.state.engine.detect(path)
                with closing(inference) as outputs:
                    result = annotated_result(image, outputs, prompt)
                timings = getattr(app.state.engine, "last_timings", None)
                if timings:
                    total = (time.perf_counter() - started) * 1000
                    measured = sum(timings[key] for key in ("model_load_ms", "image_setup_ms", "detection_ms"))
                    result["timings"] = {**timings, "other_ms": max(0, total - measured), "total_ms": total}
                    logging.info("SAM request timings %s", result["timings"])
                return result
        except DetectionLimit:
            return JSONResponse({"code": "too_many_lights", "detail": "Capture a smaller area; more than 50 lights matched a category."}, status_code=422)
        except Exception as error:
            logging.exception("SAM 3.1 inference failed")
            traceback.clear_frames(error.__traceback__)
            close = getattr(app.state.engine, "close", None)
            if close is not None:
                close()
            gc.collect()
            torch = sys.modules.get("torch")
            if torch is not None and torch.cuda.is_available():
                torch.cuda.empty_cache()
            return JSONResponse({"detail": "SAM 3.1 could not process this view."}, status_code=503)
        finally:
            app.state.inference_lock.release()

    @app.post("/lights")
    async def detect(request: Request):
        if request.headers.get("content-type", "").split(";", 1)[0] != "image/png":
            raise HTTPException(415, "Send a PNG capture.")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_INPUT:
                raise HTTPException(413, "Capture exceeds 8 MiB.")
            data.extend(chunk)
        prompt = read_prompt(request.headers.get("x-sam-prompt"))
        return await run_in_threadpool(run, bytes(data), prompt)

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=Path("data/sam31"))
    args = parser.parse_args()
    import uvicorn
    uvicorn.run(create_worker(args.runtime.resolve()), host="127.0.0.1", port=8768, workers=1, access_log=False)
