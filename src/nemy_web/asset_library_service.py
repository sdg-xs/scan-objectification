"""Start the existing local library on demand without taking ownership of its data."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

from fastapi import HTTPException

LIBRARY_URL = "http://127.0.0.1:3001"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LIBRARY_DIR = REPO_ROOT.parents[1] / "Development/Omniverse/ThatOpenPlatform/asset.library"
_lock = threading.Lock()
_process: subprocess.Popen | None = None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = build_opener(ProxyHandler({}), NoRedirect())


def ready() -> bool:
    try:
        with _opener.open(LIBRARY_URL + "/api/health", timeout=2) as response:
            health = json.loads(response.read(4097))
        if health != {"status": "ok"}:
            raise ValueError("Unexpected health response")
        return True
    except HTTPError:
        raise HTTPException(503, "Port 3001 is not responding as the asset library. Close the conflicting service and reload the library.") from None
    except (ValueError, TypeError):
        raise HTTPException(503, "The asset library returned an invalid health response. Reload the library after checking its service.") from None
    except (URLError, OSError):
        return False


def ensure_running(log_dir: Path) -> None:
    global _process
    if ready():
        return
    with _lock:
        if ready():
            return
        if _process is None or _process.poll() is not None:
            root = Path(os.environ.get("NEMY_ASSET_LIBRARY_DIR") or DEFAULT_LIBRARY_DIR).expanduser().resolve()
            script = root / "dist-server/server/index.js"
            node = shutil.which("node")
            if not script.is_file() or node is None:
                raise HTTPException(503, "Asset library startup is unavailable. Set NEMY_ASSET_LIBRARY_DIR to the built asset.library folder and install Node.js, then reload the library.")
            try:
                log_dir.mkdir(parents=True, exist_ok=True)
                with (log_dir / "asset-library-service.log").open("ab") as log:
                    _process = subprocess.Popen(
                        [node, str(script)], cwd=root,
                        env={**os.environ, "PORT": "3001"},
                        stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    )
            except OSError:
                raise HTTPException(503, "The asset library could not start. Check its service log, then reload the library.") from None
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if ready():
                return
            if _process.poll() is not None:
                break
            time.sleep(0.2)
        raise HTTPException(503, "The asset library did not become ready. Check asset-library-service.log, then reload the library.")
