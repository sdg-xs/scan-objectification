"""Same-origin, bounded gateway to the separate local SAM 3.1 runtime."""

from __future__ import annotations

import atexit
import base64
import binascii
import json
import os
from pathlib import Path
import struct
import subprocess
import threading
import time
from typing import Annotated, Literal
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, build_opener, ProxyHandler

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool

MAX_INPUT = 8 * 1024 * 1024
MAX_RESPONSE = 16 * 1024 * 1024
MAX_SIDE = 1600
SAM_URL = "http://127.0.0.1:8768"
REPO_ROOT = Path(__file__).resolve().parents[2]
Unit = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
router = APIRouter(prefix="/api/local")
_opener = build_opener(ProxyHandler({}))
_start_lock = threading.Lock()
_worker: subprocess.Popen | None = None


def png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[8:16] != b"\x00\x00\x00\rIHDR":
        raise ValueError("A PNG capture is required.")
    width, height = struct.unpack(">II", data[16:24])
    if not (1 <= width <= MAX_SIDE and 1 <= height <= MAX_SIDE):
        raise ValueError("Capture dimensions must be between 1 and 1600 pixels.")
    return width, height


class LightDetection(BaseModel):
    score: Unit
    box: tuple[Unit, Unit, Unit, Unit]

    @model_validator(mode="after")
    def contained_box(self):
        x, y, width, height = self.box
        if width <= 0 or height <= 0 or x + width > 1.000001 or y + height > 1.000001:
            raise ValueError("Box must fit the captured frame.")
        return self


class LightGroup(BaseModel):
    kind: Literal["linear", "round", "bulb"]
    detections: list[LightDetection] = Field(max_length=50)


class LightResult(BaseModel):
    model: Literal["sam3.1"]
    width: int = Field(ge=1, le=MAX_SIDE)
    height: int = Field(ge=1, le=MAX_SIDE)
    groups: list[LightGroup] = Field(min_length=3, max_length=3)
    overlay_png: str = Field(max_length=MAX_RESPONSE)

    @model_validator(mode="after")
    def matching_frame(self):
        if [group.kind for group in self.groups] != ["linear", "round", "bulb"]:
            raise ValueError("Expected the three light categories.")
        try:
            overlay = base64.b64decode(self.overlay_png, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("Invalid overlay.") from error
        if png_size(overlay) != (self.width, self.height):
            raise ValueError("Overlay dimensions do not match the capture.")
        return self


def _ready() -> bool:
    try:
        with _opener.open(SAM_URL + "/health", timeout=2) as response:
            health = json.loads(response.read(4096))
    except (URLError, OSError):
        return False
    except (ValueError, TypeError):
        raise HTTPException(503, "The local service is not a compatible SAM 3.1 worker.") from None
    if not isinstance(health, dict) or health.get("model") != "sam3.1" or health.get("status") != "ready":
        raise HTTPException(503, "The local service is not a compatible SAM 3.1 worker.")
    return True


def _stop_worker() -> None:
    if _worker is not None and _worker.poll() is None:
        _worker.terminate()
        try:
            _worker.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _worker.kill()


atexit.register(_stop_worker)


def _ensure_worker(log_dir: Path) -> None:
    global _worker
    if _ready():
        return
    with _start_lock:
        if _ready():
            return
        python = REPO_ROOT / ".venv-sam31" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        script = REPO_ROOT / "scripts/sam31_service.py"
        runtime = REPO_ROOT / "data/sam31"
        if not all(path.is_file() for path in (python, script, runtime / "model/sam3.1_multiplex.pt")):
            raise HTTPException(503, "Local SAM 3.1 is not installed. See the viewer setup instructions.")
        if _worker is None or _worker.poll() is not None:
            log_dir.mkdir(parents=True, exist_ok=True)
            try:
                with (log_dir / "sam31-service.log").open("ab") as log:
                    _worker = subprocess.Popen(
                        [str(python), str(script), "--runtime", str(runtime)],
                        cwd=REPO_ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    )
            except OSError:
                raise HTTPException(503, "The local SAM 3.1 worker could not start.") from None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if _ready():
                return
            if _worker.poll() is not None:
                break
            time.sleep(0.15)
        raise HTTPException(503, "The local SAM 3.1 worker could not start. See its local service log.")


def _detect(data: bytes, dimensions: tuple[int, int], log_dir: Path) -> LightResult:
    _ensure_worker(log_dir)
    request = UrlRequest(SAM_URL + "/lights", data=data, headers={"Content-Type": "image/png"}, method="POST")
    try:
        with _opener.open(request, timeout=300) as response:
            body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError("Response too large")
        result = LightResult.model_validate_json(body)
        if (result.width, result.height) != dimensions:
            raise ValueError("Wrong frame")
        return result
    except HTTPError as error:
        if error.code == 429:
            raise HTTPException(429, "SAM 3.1 is finishing another view. Try again shortly.") from None
        if error.code == 422:
            try:
                failure = json.loads(error.read(4096))
            except (ValueError, OSError):
                failure = None
            if isinstance(failure, dict) and failure.get("code") == "too_many_lights":
                raise HTTPException(422, "More than 50 lights matched a category. Aim at a smaller area and try again.") from None
            raise HTTPException(422, "SAM 3.1 could not decode the captured PNG.") from None
        if error.code == 503:
            raise HTTPException(503, "SAM 3.1 could not process this view. Free GPU memory and try again.") from None
        raise HTTPException(502, "The local SAM 3.1 worker failed to process the view.") from None
    except (URLError, OSError):
        raise HTTPException(503, "The local SAM 3.1 worker is unavailable. Try again.") from None
    except (ValueError, ValidationError):
        raise HTTPException(502, "SAM 3.1 returned an invalid detection result.") from None


@router.post("/lights")
async def detect_lights(request: Request) -> JSONResponse:
    if request.url.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "Local viewer access only.")
    origin = request.headers.get("origin")
    allowed = {str(request.base_url).rstrip("/"), "http://localhost:5173", "http://127.0.0.1:5173"}
    if (origin is not None and origin not in allowed) or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Local viewer access only.")
    if request.headers.get("content-type", "").split(";", 1)[0].lower().strip() != "image/png":
        raise HTTPException(415, "Send a PNG capture.")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_INPUT:
            raise HTTPException(413, "The captured image exceeds 8 MiB.")
        data.extend(chunk)
    try:
        dimensions = png_size(data)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    result = await run_in_threadpool(_detect, bytes(data), dimensions, request.app.state.settings.logs_dir)
    return JSONResponse(result.model_dump(), headers={"Cache-Control": "no-store"})
