# Session — Task 4 code review (2026-10-23)

Worktree: `C:\Users\JoshuaRetuta\Documents\TRANSITION TO 3js\.claude\worktrees\agent-a12bdb9713a4b0a45`
Commit reviewed: `31a2571` "Validate USD and build the authoritative source index" (diff `426e577..31a2571`)
Files: `src/nemy_web/usd_ingest.py` (526), `tests/fixtures/make_gaussian_stage.py` (226), `tests/test_usd_ingest.py` (319)
Tests: 24/24 task tests pass, 122/122 full suite. Worktree left clean — no files changed, nothing committed.

## Verdict: Approved-with-fixes

Blocking: Finding 1 (validation memory) and Finding 2 (swallowed composition errors).

## Numerical claims verified correct

1. **SH transpose** — `usd_ingest.py:352-357`: `f_dc = sh[0][c]`; transpose (0,2,1) gives PLY index `c*(ncoeff-1)+k` = `f_rest[c][k] = sh[k][c]` (channel-major). Degree-1 fixture uses distinct per-channel values so a swap cannot pass.
2. **Source index** — `usd_ingest.py:289-311` matches `crop_tool.py:268-291` line-for-line: float32 cell math, int64 truncation, clamp 0–63, `x + 64*y + 4096*z`, stable argsort, bounds from actual grouped points (reduceat, one axis at a time). Test recomputes independently + box query vs brute force.
3. **Coordinates** — Z-up→Y-up (x,y,z)→(x,z,−y), det +1, metersPerUnit applied; `webFromPrimLocalCentered = web @ usdWorld @ translate(center)`; PLY stores recentered rows, `positions.npy` stores raw; manifest records the restoring transform. Manifest matches the parent plan's "Published manifest" schema exactly.
4. **Opacity/quats/scales** — float64 nextafter clamp; logits ≈ −744.4 / +36.7, finite float32; quaternion (x,y,z,w) read-back → (w,x,y,z) normalized (proven by the non-unit test); scales = log(actual).
5. **Streaming** — conversion path correct (one attribute at a time, 250k-row chunks ≈ 59 MB at degree 3); validation is the exception (Finding 1).
6. **Validation checks** — all present and pinned by tests (time samples, alignment, finiteness, positive scales, opacity range, nonzero quat norm, uniform-scale-only, is_relative_to after resolve); two gaps → Findings 2, 4.
7. **Cleanup** — present at both levels; one Windows leak path → Finding 3.

## Findings

### 1. CRITICAL — `validate_stage` holds all five source arrays resident
`usd_ingest.py:131-136` keeps positions/scales/orientations/opacities in the `arrays` dict, then loads SH (:148-149) while the dict is alive — the measured 733 MB all-five-resident config on the 6.37M-splat acceptance scene. `convert()` (:490) runs `validate_stage` every run, so the peak exceeds the 600 MB violation threshold before streaming starts.
**Fix:** restructure `_prim_errors` to one attribute at a time (load, check, del; SH last). ~20 lines.

### 2. IMPORTANT — a corrupt referenced layer is silently dropped from composition
`usd_ingest.py:70-94, 181-182`. Verified at runtime on usd-core 26.8: `Usd.Stage.Open` on a stage referencing an unparseable `.usda` only warns; the bad layer never appears in `GetUsedLayers()`, nothing raises, `_dependency_errors` passes it. Rejection comes out as misleading `no_splats`, or worse a partial scene converts silently.
**Fix:** in `_dependency_errors`, call `Sdf.Layer.FindOrOpen(resolved)` per resolved layer path (verified it raises `Tf.ErrorException` on a corrupt file) and convert to a structured error.

### 3. MINOR — mid-copy `_memmap_copy` failure leaks raw files on Windows
`usd_ingest.py:376-383, 414-421`. The `target` memmap's frame survives via the traceback, so `gc.collect()` can't close it and `rmtree(ignore_errors=True)` fails silently.
**Fix:** `except BaseException: target._mmap.close(); raise` inside `_memmap_copy`.

### 4. MINOR — negative-determinant transforms pass the rigidity check
`usd_ingest.py:106-118`. A reflection / negative uniform scale has uniform row norms + orthonormal rotation → publishes a mirrored cloud with unmirrored orientations.
**Fix:** reject `np.linalg.det(linear) <= 0` in `_transform_errors`.

### 5. MINOR — `root_stage` joined without a containment check
`usd_ingest.py:177-180`. `staged_root / root_stage` accepts absolute paths / `..` segments.
**Fix:** reject unless `stage_path.resolve().is_relative_to(staged_root)`.

## Not checked / risk

- No runtime RSS measurement on the real 6.37M-splat scene (Finding 1 is by code reading — the five-array residency is unambiguous).
- Variant-spec-nested references in `_walk_spec_references` not audited.
- Graphdeco channel-major order verified against the binding plan and its distinct-channel test, not re-derived from Spark's reader — Task 5's PLY-through-Spark check is the backstop.

## Mid-session Q&A

- **Run on website:** artifact publishing blocked this session (ANTHROPIC_AUTH_TOKEN auth, no claude.ai login — every Artifact call refused). Fix: unset `ANTHROPIC_AUTH_TOKEN`, run `/login`, choose "Claude account with subscription".
- **Run the app in a browser:** `npm.cmd run build`, then `.\.venv\Scripts\python.exe -m nemy_web.app` (or `nemy-api`), open `http://127.0.0.1:8767`. Splat viewer is Task 6 — not written yet. Never bare `python` / bare `npm`.
- **Languages:** Python 3.12 (backend/worker/tests), TypeScript (frontend), Rust (Spark `build-lod` converter only), SQL (raw SQLite in `db.py`), HTML/CSS (SPA shell), PowerShell (host scripts); TOML/JSON config.
- **Tech stack:** FastAPI 0.150.0 + Uvicorn 0.54.0, SQLite (no ORM), usd-core 26.8, NumPy 2.5.4, pytest 9.1.1; Vite 8 + Vitest 5, Three.js 0.186.1, `@sparkjsdev/spark` 2.3.1, hash-wasm 4.12.0; Rust/Cargo for `build-lod`. One NVIDIA GPU PC, port 8767, no cloud/accounts/React/DI.
