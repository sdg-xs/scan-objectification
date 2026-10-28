"""Read-only same-origin adapter to the separately owned local asset library."""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from nemy_web.lights import require_local_viewer

router = APIRouter(prefix="/api/local/assets")
LIBRARY_URL = "http://127.0.0.1:3001"
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPException(502, "The asset library redirected the request.")


_opener = build_opener(ProxyHandler({}), NoRedirect())
MAX_JSON = 64 * 1024 * 1024
MAX_IFC = 512 * 1024 * 1024


def read_bytes(path: str, limit: int) -> bytes:
    try:
        with _opener.open(LIBRARY_URL + path, timeout=60) as response:
            if response.geturl() != LIBRARY_URL + path:
                raise HTTPException(502, "The asset library redirected the request.")
            data = response.read(limit + 1)
            if len(data) > limit:
                raise HTTPException(413, "The library geometry exceeds the supported size.")
            return data
    except HTTPError as error:
        raise HTTPException(404 if error.code == 404 else 502, "The library source is unavailable.") from None
    except (URLError, TimeoutError, OSError):
        raise HTTPException(503, "Start the asset library on localhost:3001, then retry.") from None


def read_library(path: str):
    try:
        return json.loads(read_bytes(path, MAX_JSON))
    except (ValueError, TypeError):
        raise HTTPException(502, "The asset library returned invalid data.") from None


def catalog():
    result = read_library("/api/catalog-library")
    if not isinstance(result, dict) or not isinstance(result.get("entries"), list):
        raise HTTPException(502, "The asset catalog is invalid.")
    return result


def resolve(asset_id: str):
    state = catalog()
    entry = next((e for e in state["entries"] if e.get("id") == asset_id and e.get("status") != "archived"), None)
    if not entry:
        raise HTTPException(404, "This asset definition is unavailable.")
    reference = entry.get("geometryReference")
    if reference and reference.get("kind") == "mesh":
        return {"kind": "mesh", "geometry": read_library("/api/geometry/" + quote(reference["geometryId"], safe=""))["geometry"]}
    models = read_library("/api/models")
    if not isinstance(models, list):
        raise HTTPException(502, "The asset model index is invalid.")
    if reference:
        model = next((m for m in models if m["id"] == reference.get("modelId")), None)
        if not model or model.get("fingerprint") != reference.get("fingerprint"):
            raise HTTPException(409, "The source IFC changed or is unavailable. Refresh the library definition.")
        return {"kind": "ifc", "modelId": model["id"], "occurrenceId": reference["occurrenceId"], "fingerprint": model["fingerprint"]}
    for ref in entry.get("sourceReferences", []):
        source = next((s for s in state.get("sources", []) if s["id"] == ref["sourceId"] and s.get("current") and s.get("fingerprint") == ref.get("fingerprint")), None)
        if not source:
            continue
        model = next((m for m in models if m["id"] == source["modelId"] and m.get("fingerprint") == ref["fingerprint"]), None)
        if not model:
            continue
        candidates = (model.get("creationIndex") or {}).get("candidates", []) + (model.get("index") or {}).get("types", [])
        observed = source.get("observation", {}).get("occurrenceIds", [])
        ids = ref.get("occurrenceIds", [])
        candidate = next((c for c in candidates if set(c.get("occurrenceIds", [])) == set(observed)), None)
        if candidate and ids and all(i in observed for i in ids):
            return {"kind": "ifc", "modelId": model["id"], "occurrenceId": ids[0], "fingerprint": model["fingerprint"]}
    raise HTTPException(404, "No available representative geometry. Add geometry in the asset library first.")


@router.get("")
async def list_assets(request: Request):
    require_local_viewer(request)
    def read():
        state = catalog()
        categories = {c["id"]: c["name"] for c in state.get("categories", [])}
        result = []
        for entry in state["entries"]:
            if entry.get("status") == "archived":
                continue
            ref = entry.get("geometryReference") or {}
            kind = "mesh" if ref.get("kind") == "mesh" else "ifc" if ref.get("modelId") or entry.get("sourceReferences") else None
            result.append({"id": entry["id"], "name": entry["definition"]["name"], "category": categories.get(entry["definition"].get("categoryId"), "Uncategorized"), "geometryKind": kind})
        return result
    return await run_in_threadpool(read)


@router.get("/{asset_id}/geometry")
async def asset_geometry(asset_id: str, request: Request):
    require_local_viewer(request)
    return await run_in_threadpool(resolve, asset_id)


@router.get("/{asset_id}/source")
async def asset_source(asset_id: str, fingerprint: str, request: Request):
    require_local_viewer(request)
    def read():
        ref = resolve(asset_id)
        if ref["kind"] != "ifc" or ref["fingerprint"] != fingerprint:
            raise HTTPException(409, "The asset source changed. Choose the asset again.")
        data = read_bytes("/api/models/" + quote(ref["modelId"], safe="") + "/file", MAX_IFC)
        if not data.lstrip().startswith(b"ISO-10303-21;"):
            raise HTTPException(502, "The library source is not an IFC file.")
        return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
    return await run_in_threadpool(read)
