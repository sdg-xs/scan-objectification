# USD Web Segmentation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the one-PC foundation that creates a capability-link project, resumes a self-contained USD upload, validates and converts static Gaussian prims into a protected streamable Spark scene, restores job status after restart, displays it in a bounded Three.js viewer, rotates the link, and deletes all project data.

**Architecture:** A single FastAPI application owns the HTTP API, SQLite records, and same-origin static frontend. A separate one-at-a-time Python worker claims persistent SQLite jobs and uses OpenUSD, NumPy, and a pinned Spark `build-lod` binary. Project files live below one configured data directory; immutable uploads, temporary work, published media, and source-index files have separate subdirectories. The browser is plain TypeScript with Three.js, Spark, and OrbitControls. No React, account system, cloud storage, distributed queue, or container platform is introduced.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, SQLite, OpenUSD (`usd-core`/`pxr`), NumPy, pytest; TypeScript, Vite, Vitest, Three.js 0.180+, `@sparkjsdev/spark` 2.3.1; Spark 2.3.1 Rust `build-lod` binary.

**Spec:** [Approved foundation design](../specs/2026-10-20-usd-web-segmentation-foundation-design.md)

## Global Constraints

- Run the browser, API, worker, storage, OpenUSD, and Spark conversion on the same NVIDIA GPU PC. Bind to `127.0.0.1` by default.
- The API uses port `8767`. Port `8766` belongs to the existing SAM3 mask service, which must keep running on the same PC; the two services must never contend for a port.
- One project has one immutable source revision. A different source requires a new project.
- The source identity is exactly `(sourceRevisionId, sourcePrimPath, sourceIndex)`. `sourceIndex` is an unsigned 64-bit index into the immutable USD `positions` array.
- Never use Spark LoD nodes or PLY row positions as authoritative edit IDs.
- Accept static Gaussian attributes only. Reject time-varying required attributes and unsupported transforms with explicit structured errors.
- Publish the scene manifest and `.RAD` files only after validation, source indexing, conversion, and parity checks succeed.
- Treat every filename, archive member, USD asset path, and project link as untrusted input. Do not interpolate user paths into a shell command.
- Keep code proportional to the pilot: raw SQLite, filesystem storage, one worker, polling, and vanilla TypeScript.
- Use the real sample scenes in `C:\Users\JoshuaRetuta\Documents\USD FOLDER` only for read-only acceptance and performance checks. Do not commit or copy them into the repository.
- Run backend commands through the project virtual environment and frontend commands through the locked npm toolchain. `rtk` is absent on the current host, so use the underlying commands directly unless it becomes available.

## Review Focus

- Capability secrets never enter server URLs, logs, database plaintext, media URLs, or error bodies.
- Range media cannot be read with a missing, expired, rotated, or deleted-project session.
- ZIP and USD dependency checks cannot escape the staged project directory, including Windows case folding and junction/symlink behavior.
- A crash cannot publish partial media, duplicate an ingest job, or destroy a previously successful publication.
- Coordinate, scale, opacity, color, and quaternion conversion are proven with anisotropic test fixtures before a real scene is accepted.
- The representative-scene acceptance run reports peak memory, elapsed time, disk amplification, initial view time, detail settling, and browser frame time instead of asserting an unmeasured performance target. The measured baseline for the 6,366,784-splat scene is recorded in Task 7 Step 6.

## Host Prerequisites (verified 2026-10-21)

These are properties of the development host, not design decisions. Verify each on the target GPU PC before the acceptance gates.

| Prerequisite | Required | Status on development host |
|---|---|---|
| Python | `>=3.12,<3.13` | **Missing.** Only Python 3.14.6 is installed; install 3.12 before creating the virtual environment. |
| Node.js | `^20.19.0 \|\| >=22.12.0` (Vite 8) and `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` (Vitest 5) | Present (v24.16.0, satisfies both), but `npm` resolves to `npm.ps1` and is blocked by the PowerShell execution policy. Run `npm.cmd` (e.g. `npm.cmd test -- --run`). |
| `pxr` (OpenUSD) | `usd-core==26.8` | Present and matching the pin. |
| Rust toolchain | `cargo` + `rustc` | **Missing.** `build-lod` must be built from source. |
| NVIDIA GPU | CUDA-capable | **Missing.** The host has only Intel graphics. SAM3 cannot run here; GPU work is a target-PC step. |
| Free disk | >= 3x the largest source scene | ~558 GiB free on `C:`. |

The `@sparkjsdev/spark@2.3.1` npm package ships only `dist/`; it contains no `build-lod` executable and no `rust/` source. Its `build-lod` script is `cargo run --manifest-path rust/build-lod/Cargo.toml --release --`, so the binary must be built from a source checkout of the `v2.3.1` tag. The GitHub release `v2.3.1` publishes **zero** assets, so there is no prebuilt binary to download.

---

## File Map

Create this deliberately small structure:

```text
.
├── .env.example
├── README.md
├── package.json
├── package-lock.json
├── pyproject.toml
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── scripts/
│   ├── install-spark-build-lod.ps1
│   └── run-pilot.ps1
├── src/nemy_web/
│   ├── __init__.py
│   ├── app.py                 # FastAPI construction and route wiring
│   ├── auth.py                # capability hash/check and media sessions
│   ├── config.py              # validated pilot settings
│   ├── db.py                  # SQLite schema and short transactions
│   ├── jobs.py                # idempotent enqueue, claim, status, recovery
│   ├── projects.py            # create, read, rotate, version, delete
│   ├── uploads.py             # resumable upload and safe bundle staging
│   ├── usd_ingest.py          # OpenUSD validation, index, PLY, manifest
│   ├── media.py               # protected byte-range responses
│   └── worker.py              # one-job worker entry point
├── tests/
│   ├── conftest.py
│   ├── fixtures/
│   │   └── make_gaussian_stage.py
│   ├── test_app.py
│   ├── test_projects.py
│   ├── test_uploads.py
│   ├── test_usd_ingest.py
│   ├── test_jobs.py
│   └── test_media.py
└── web/
    ├── index.html
    └── src/
        ├── api.test.ts
        ├── api.ts
        ├── hash-worker.ts
        ├── main.ts
        ├── styles.css
        ├── viewer.test.ts
        └── viewer.ts
```

Do not add a general repository layer, service classes, dependency-injection framework, state library, component library, or ORM. Split a module only after it becomes hard to review.

## Fixed Contracts

### Configuration

`Settings` in `src/nemy_web/config.py` reads these environment values:

| Name | Pilot default | Purpose |
|---|---:|---|
| `NEMY_BIND` | `127.0.0.1` | API bind address |
| `NEMY_PORT` | `8767` | API and frontend port |
| `NEMY_DATA_DIR` | `./data` | all mutable state |
| `NEMY_MAX_UPLOAD_BYTES` | `8589934592` | 8 GiB upload guard, adjustable after benchmark |
| `NEMY_MAX_EXPANDED_BYTES` | `34359738368` | 32 GiB ZIP expansion guard |
| `NEMY_UPLOAD_CHUNK_BYTES` | `16777216` | 16 MiB chunks |
| `NEMY_JOB_TIMEOUT_SECONDS` | `21600` | six-hour ingest timeout |
| `NEMY_MEDIA_SESSION_SECONDS` | `900` | 15-minute read-only media session |
| `NEMY_BUILD_LOD` | unset | required path to pinned `build-lod` executable |

The API must start without `NEMY_BUILD_LOD` so project and upload tests run, but an ingest job fails as `converter_unavailable` before conversion.

### SQLite schema

`db.initialize()` creates and migrates one schema version with foreign keys and WAL mode:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  secret_hash BLOB NOT NULL,
  media_epoch INTEGER NOT NULL DEFAULT 0,
  state_version INTEGER NOT NULL DEFAULT 0,
  source_revision_id TEXT,
  manifest_relpath TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  filename TEXT NOT NULL,
  total_size INTEGER NOT NULL,
  expected_sha256 TEXT NOT NULL,
  root_stage_relpath TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE upload_chunks (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  progress_current INTEGER,
  progress_total INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(project_id, kind, idempotency_key)
);
```

Large arrays and JSON manifests stay on disk. Store only project-relative POSIX paths in SQLite.

### HTTP API

Use JSON errors shaped as `{"error":{"code":"...","message":"...","details":{...}}}`. After creation, every project API requires `Authorization: Bearer <capability-secret>` and returns `404` for an unknown project or bad secret to avoid an existence oracle.

| Method and path | Contract |
|---|---|
| `POST /api/projects` | Return `projectId`, 256-bit URL-safe `capabilitySecret`, `stateVersion`, and `/p/{id}#key={secret}` |
| `GET /api/projects/{id}` | Return current project, upload, source, and job state |
| `POST /api/projects/{id}/rotate-key` | Require `expectedVersion`; return a new secret and incremented version; old key fails immediately |
| `DELETE /api/projects/{id}` | Require `expectedVersion`; mark deleted and increment `media_epoch`; enqueue purge |
| `POST /api/projects/{id}/uploads` | Create an upload attempt using filename, total size, whole-file SHA-256, and optional bundle root path; reject a new attempt after a source succeeds |
| `GET /api/projects/{id}/uploads/{uploadId}` | Return chunk size and received chunk indexes |
| `PUT /api/projects/{id}/uploads/{uploadId}/chunks/{index}` | Require `X-Chunk-SHA256`; accept exactly the calculated range; identical retry is `204`, conflicting retry is `409` |
| `POST /api/projects/{id}/uploads/{uploadId}/finalize` | Verify length and whole digest; atomically retain immutable bytes; enqueue one ingest job |
| `GET /api/projects/{id}/jobs/{jobId}` | Return status, phase, progress, timestamps, and safe structured error |
| `POST /api/projects/{id}/jobs/{jobId}/retry` | Requeue a failed or canceled job against the same immutable input; increment `attempt` on claim |
| `GET /api/projects/{id}/manifest` | Return the active published manifest after capability authorization |
| `POST /api/projects/{id}/media-session` | Set short-lived HttpOnly, SameSite=Strict cookie bound to project and `media_epoch` |
| `GET /media/{projectId}/{path}` | Require valid media cookie; implement one byte range and return `206`, `Content-Range`, `Accept-Ranges: bytes`, and `Cache-Control: private, no-store` |

Requests carrying `expectedVersion` return `409 version_conflict` with the current version when stale. A repeated finalize returns the existing job and cannot enqueue another.

### Published manifest

Write `published/{sourceRevisionId}/manifest.json` in an unpublished sibling directory, then atomically rename that directory and update the database only after all referenced files are durable:

```json
{
  "schemaVersion": 1,
  "sourceRevisionId": "uuid",
  "stage": {"upAxis": "Z", "metersPerUnit": 1.0},
  "webFromUsdWorld": [16, "column-major numbers"],
  "boundsWeb": {"min": [0, 0, 0], "max": [1, 1, 1]},
  "prims": [{
    "sourcePrimPath": "/World/Gaussians",
    "count": 4,
    "boundsWeb": {"min": [0, 0, 0], "max": [1, 1, 1]},
    "webFromPrimLocalCentered": [16, "column-major numbers"],
    "radUrl": "/media/{projectId}/scene/prim-000.rad",
    "sourceIndex": {
      "positions": "source-index/prim-000/positions.npy",
      "order": "source-index/prim-000/order.npy",
      "cells": "source-index/prim-000/cells.npz",
      "gridSize": 64
    }
  }]
}
```

JSON contains actual arrays, not the illustrative `[16, ...]` notation. Use a deterministic prim order sorted by USD path.

## Task 1: Bootstrap the Local Pilot

**Files:**
- Create: `pyproject.toml`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/nemy_web/__init__.py`
- Create: `src/nemy_web/config.py`
- Create: `src/nemy_web/db.py`
- Create: `src/nemy_web/app.py`
- Create: `tests/conftest.py`
- Create: `tests/test_app.py`
- Create: `web/index.html`
- Create: `web/src/main.ts`
- Create: `web/src/styles.css`

- [ ] **Step 1: Pin the minimal toolchains.**

  In `pyproject.toml`, require Python `>=3.12,<3.13`; pin runtime dependencies `fastapi==0.150.0`, `uvicorn[standard]==0.54.0`, `numpy==2.5.4`, and `usd-core==26.8`; pin development dependencies `pytest==9.1.1`, `httpx==0.28.1`, and `pytest-timeout==2.4.0`. Add console scripts `nemy-api = nemy_web.app:main` and `nemy-worker = nemy_web.worker:main`. Configure pytest to use `tests` and a 30-second default timeout.

  Install Python 3.12 and create the virtual environment with it before installing dependencies. The development host currently has only Python 3.14.6, which this pin excludes; wheels for every pinned dependency exist for 3.12, 3.13, and 3.14, so the pin is the only blocker.

  In `package.json`, pin `three==0.186.1`, `@sparkjsdev/spark==2.3.1`, `hash-wasm==4.12.0`, `vite==8.3.4`, `typescript==7.0.2`, and `vitest==5.0.5`. Commit `package-lock.json`; it is the exact frontend dependency record. Scripts: `dev`, `build`, `test`, and `typecheck`.

- [ ] **Step 2: Write failing configuration and health tests.**

  Add `tests/test_app.py` tests that use a temporary data directory, verify invalid negative limits fail startup, verify directories and SQLite are created, and expect `GET /api/health` to return:

  ```json
  {"status":"ok","database":"ok","converter":"missing"}
  ```

  The missing converter is diagnostic, not an unhealthy API.

- [ ] **Step 3: Run the tests and confirm the intended failure.**

  Run: `python -m pytest tests/test_app.py -q`

  Expected: failure because `Settings`, `initialize`, and `create_app` do not exist.

- [ ] **Step 4: Implement settings, database initialization, and app factory.**

  Use a frozen dataclass and `Path.resolve()` for `NEMY_DATA_DIR`. `create_app(settings)` stores settings in `app.state`, initializes the DB during lifespan, serves built frontend files when present, and adds headers `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a same-origin Content Security Policy compatible with Three/Spark workers. Do not enable wildcard CORS.

- [ ] **Step 5: Add the smallest usable shell.**

  Show four states in `main.ts`: create project, upload, processing, and viewer. At this task only the create button is wired in a later task; the shell must build without errors and clearly say it is a local pilot.

- [ ] **Step 6: Verify both toolchains.**

  Run:

  ```powershell
  python -m pytest -q
  npm.cmd test -- --run
  npm.cmd run typecheck
  npm.cmd run build
  ```

  Expected: all tests pass, TypeScript exits 0, and Vite writes `dist/`.

- [ ] **Step 7: Commit.**

  ```powershell
  git add pyproject.toml package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts .env.example src tests web
  git commit -m "Bootstrap local USD web pilot"
  ```

  The repository `.gitignore` ends with `.env.*`, which also matches `.env.example`. It carries a `!.env.example` negation so this tracked template is addable, and ignores `/data/` so the SQLite database, `data/server-secret`, uploads, and logs can never be committed.

## Task 2: Implement Capability Projects and Version Checks

**Files:**
- Create: `src/nemy_web/auth.py`
- Create: `src/nemy_web/projects.py`
- Create: `tests/test_projects.py`
- Create: `web/src/api.ts`
- Create: `web/src/api.test.ts`
- Modify: `src/nemy_web/app.py`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Write failing API tests for the complete secret lifecycle.**

  Cover create, authorized read, missing/wrong secret returning 404, rotation with an expected version, old-secret rejection, new-secret success, stale-version 409, and deleted-project rejection. Rotation must increment `media_epoch` so a media cookie issued through the old link fails immediately. Assert the database never contains the returned plaintext secret. Capture logs and assert the secret is absent.

- [ ] **Step 2: Write failing browser key tests.**

  `readProjectLocation()` must parse `/p/{uuid}#key={secret}`, remove the fragment with `history.replaceState`, retain the secret only in module memory and `sessionStorage`, and return no key for malformed input. `apiFetch()` must add the bearer header only for same-origin `/api/` calls. It must never append the key to a URL.

- [ ] **Step 3: Run the focused tests.**

  Run:

  ```powershell
  python -m pytest tests/test_projects.py -q
  npm.cmd test -- --run web/src/api.test.ts
  ```

  Expected: failure because project routes and browser client are absent.

- [ ] **Step 4: Implement secrets and project transactions.**

  Generate 32 random bytes with `secrets.token_urlsafe(32)`. Store `SHA-256(UTF-8 secret)` as bytes and compare with `hmac.compare_digest`. The random 256-bit secret makes a fast hash appropriate here; document that this would change for user-chosen passwords. Generate UUIDv4 project IDs. Use one short `BEGIN IMMEDIATE` transaction for version check plus rotate/delete mutation.

  Rotation replaces `secret_hash` and increments both `state_version` and `media_epoch` in the same transaction. `DELETE` first sets `deleted_at`, increments both counters, then enqueues the purge job in the same transaction. File removal occurs in Task 7.

- [ ] **Step 5: Implement the browser client and create flow.**

  The home page creates a project, rewrites the browser to `/p/{id}#key={secret}`, then immediately strips the fragment and renders a Copy Project Link button that reconstructs the secret link in memory. Display the recovery warning: losing the link loses access.

- [ ] **Step 6: Verify and commit.**

  Run all backend and frontend tests plus `npm.cmd run typecheck`, then:

  ```powershell
  git add src/nemy_web tests web/src
  git commit -m "Add capability-link projects"
  ```

## Task 3: Add Resumable Upload and Safe Bundle Staging

**Files:**
- Create: `src/nemy_web/uploads.py`
- Create: `tests/test_uploads.py`
- Modify: `src/nemy_web/app.py`
- Modify: `web/src/api.ts`
- Modify: `web/src/main.ts`

- [ ] **Step 1: Write failing upload protocol tests.**

  Test a file spanning at least three small test chunks: create, out-of-order chunk upload, status query, identical retry, conflicting retry, bad offset/length, oversized declaration, interrupted resume, whole-file digest mismatch, successful finalize, and repeated finalize returning the same job ID. A failed upload may be replaced by another upload in the same project; once a source revision succeeds, attempts to start a different source return `409 source_already_fixed`. Override the configured chunk size to 16 bytes in tests.

- [ ] **Step 2: Write failing archive safety tests.**

  Build ZIP fixtures in memory for a valid local bundle and reject: absolute paths, `..`, drive-letter paths, case-insensitive duplicates, symlink entries, unsupported special entries, too many bytes after expansion, a root stage not present in the bundle, and a root outside the extraction root. On Windows, reject any extracted component that resolves to a reparse point.

  `C:\Users\JoshuaRetuta\Documents\USD FOLDER\SOL10.usd` is a natural real-world bundle fixture because it references four sibling stages under `SubUSDs/`. That `SubUSDs/` directory is **absent** from the pilot machine, so the stage currently opens with unresolved references and cannot be used as-is. Either stage the referenced files into a local bundle fixture or synthesize an equivalent local-reference bundle in the test fixtures; do not depend on files outside the repository.

- [ ] **Step 3: Run the focused test and confirm failure.**

  Run: `python -m pytest tests/test_uploads.py -q`

- [ ] **Step 4: Implement chunk storage without loading chunks into memory twice.**

  Store the sparse temporary file at `projects/{projectId}/incoming/{uploadId}.part`. Validate the request's calculated offset and size, stream it to a temporary chunk while hashing, then write it at the exact offset. Record a chunk only after `flush()` and `os.fsync()`. An existing chunk with the same byte count and digest returns `204`; any difference returns `409 chunk_conflict`.

  Finalize only when every expected chunk exists. Stream the assembled file through SHA-256, then `os.replace()` it into `source/original/{safe-generated-name}`. Preserve the user's filename only as metadata. Set the file read-only as a defense against accidental changes; application correctness must still rely on never opening it for write.

- [ ] **Step 5: Implement safe staging.**

  `.usd`, `.usda`, `.usdc`, and `.usdz` become the root stage directly. `.zip` is extracted to a new temporary directory using normalized forward-slash relative names and per-member streaming limits, then atomically renamed to `source/staged`. Reject archive links from `ZipInfo.external_attr`. Never call `extractall()`.

- [ ] **Step 6: Implement resumable browser upload.**

  Hash the chosen file incrementally in `hash-worker.ts` with the pinned `hash-wasm` SHA-256 implementation so the page remains responsive and the multi-gigabyte file is never buffered in full. This is the only extra frontend runtime dependency because Web Crypto has no streaming digest API. Query received indexes before sending. Send at most one 16 MiB chunk at a time in the pilot, retry a transient failure with bounded exponential delays, and show bytes sent, digest progress, and the current error. Keep `uploadId`, filename, size, and digest in `sessionStorage`; verify they still match the reselected local file before resuming after a browser restart.

- [ ] **Step 7: Verify and commit.**

  Run backend/frontend tests, typecheck, and build. Commit:

  ```powershell
  git add src/nemy_web tests web/src
  git commit -m "Add resumable self-contained uploads"
  ```

## Task 4: Validate USD and Build the Authoritative Source Index

**Files:**
- Create: `src/nemy_web/usd_ingest.py`
- Create: `tests/fixtures/make_gaussian_stage.py`
- Create: `tests/test_usd_ingest.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Create tiny deterministic OpenUSD fixtures.**

  Generate fixtures during tests rather than committing binary USD files. Include:

  - two anisotropic splats under a translated prim with Z-up and explicit `metersPerUnit`;
  - known red/green degree-0 SH coefficients, scales, normalized quaternions, and opacities;
  - one valid local referenced layer inside the bundle;
  - variants with mismatched array lengths, NaN data, zero particles, time samples, unresolved references, an external absolute reference, nonuniform transform scale, shear, and an unsupported prim type.

- [ ] **Step 2: Write failing validation tests.**

  Assert `validate_stage(staged_root, root_stage)` returns deterministic prim records or a list of structured errors. Require the supported Gaussian prim schema/type used by the real scenes and these attributes:

  ```text
  positions
  scales
  orientations
  opacities
  radiance:sphericalHarmonicsCoefficients
  radiance:sphericalHarmonicsDegree
  ```

  Check every required attribute has no time samples, arrays align with particle count and SH degree, values are finite, scales are positive, opacities are in `[0,1]`, and orientations have nonzero norm. For the pilot, allow rigid transforms plus uniform scale; reject shear and nonuniform scale with `unsupported_transform`.

  Use OpenUSD composition/dependency discovery to enumerate layers and asset dependencies. Resolve paths, compare them with `Path.is_relative_to(staged_root.resolve())`, and reject unresolved, network, or outside-root assets. Return safe project-relative names only.

- [ ] **Step 3: Write failing coordinate and source-index tests.**

  Specify:

  ```python
  def web_from_usd_world(up_axis: str, meters_per_unit: float) -> np.ndarray: ...
  def build_source_index(positions: np.ndarray, output_dir: Path, grid_size: int = 64) -> dict: ...
  ```

  The transform converts USD units to meters and maps Z-up `(x,y,z)` to Three.js Y-up `(x,z,-y)` with determinant `+1`; Y-up keeps axes and applies units. Round-trip points within `1e-5` meters. Each prim also receives `webFromPrimLocalCentered = webFromUsdWorld * usdWorldFromPrimLocal * translate(localCenter)`. The PLY stores `localPosition - localCenter`; Spark applies this one per-prim matrix, preventing precision loss from large world translations without baking the transform twice.

  The index copies positions once to `positions.npy` as float32, creates a stable uint64 `order.npy`, and writes occupied cell keys, ranges, and actual grouped lower/upper bounds to `cells.npz`. Use the existing extension's 64×64×64 uniform-grid rule from `crop_tool.py:261-297`: clamp cell coordinates to 0–63, compute `x + 64*y + 4096*z`, stable-sort, and calculate bounds from actual points so float rounding cannot exclude a hit. Assert every original index appears exactly once and a box query matches brute force.

- [ ] **Step 4: Write failing Gaussian-to-PLY conversion tests.**

  Specify a streaming binary little-endian PLY writer. For each source splat:

  - write locally recentered XYZ as float32 and record the restoring transform in the manifest;
  - write `scale_0..2 = log(actual local scale)`; the per-prim Spark matrix applies the supported uniform transform scale exactly once;
  - write `opacity = logit(clamp(actual_opacity, nextafter(0,1), nextafter(1,0)))`;
  - normalize the USD quaternion and write Graphdeco/Spark order `rot_0..3 = (w,x,y,z)`;
  - write `f_dc_0..2` from the first RGB SH coefficient;
  - for degree 1–3, write the remaining RGB coefficients in Graphdeco channel-major `f_rest_*` order; reject other degrees.

  The source index retains unclamped authoritative values. Test both endpoints of opacity, a non-unit quaternion, an anisotropic rotated splat, and coefficient ordering. Read the resulting PLY through Spark's supported path during Task 5; these unit tests first verify the binary header and numeric rows directly.

- [ ] **Step 5: Run the focused tests and confirm failure.**

  Run: `python -m pytest tests/test_usd_ingest.py -q`

- [ ] **Step 6: Implement validation, indexing, and chunked conversion.**

  Use `numpy.lib.format.open_memmap` for normalized on-disk arrays. Copy one USD attribute at a time so all source arrays are not duplicated in RAM at once. Emit PLY rows in configurable chunks, initially 250,000 rows, and call a progress callback between chunks. Delete the temporary PLY and index directory on any exception. Do not catch and downgrade OpenUSD composition errors.

- [ ] **Step 7: Run a read-only compatibility probe on an existing scene.**

  Run validation only, with no copy or conversion, on:

  ```text
  C:\Users\JoshuaRetuta\Documents\USD FOLDER\SOL10_OUTDOOR_1.usd
  ```

  Expected evidence: `/SOL10_OUTDOOR_1` is detected, count is `6,366,784`, attributes are static, and its large world translation is represented in the manifest transform rather than baked into float32 local positions. Record the command and result under `README.md` troubleshooting or a short dated note; do not commit the asset.

- [ ] **Step 8: Verify and commit.**

  Run all Python tests and commit:

  ```powershell
  git add pyproject.toml src/nemy_web/usd_ingest.py tests README.md
  git commit -m "Validate USD and preserve source identities"
  ```

## Task 5: Run Persistent Ingest Jobs and Publish Spark Media Atomically

**Files:**
- Create: `src/nemy_web/jobs.py`
- Create: `src/nemy_web/worker.py`
- Create: `tests/test_jobs.py`
- Create: `scripts/install-spark-build-lod.ps1`
- Modify: `src/nemy_web/uploads.py`
- Modify: `src/nemy_web/app.py`
- Modify: `README.md`

- [ ] **Step 1: Write failing job tests.**

  Test idempotent enqueue, transactional claim, one running job at a time, progress updates, safe failure details, timeout, cancellation between phases, and startup recovery. A worker startup changes orphaned `running` ingest jobs back to `queued`, increments `attempt` only on the next claim, and cleans that job's unpublished temporary directory before retry.

  Use a fake converter executable that can succeed, fail, sleep, and write a known output. Assert command arguments are a list with `shell=False` and paths containing spaces work.

- [ ] **Step 2: Write failing atomic-publication tests.**

  Simulate failure after PLY creation, after `.RAD` creation, and before publication. No `projects.manifest_relpath` or partial versioned publication may appear. On success, fsync output files, write the manifest into a sibling temporary directory, atomically rename it to `published/{sourceRevisionId}`, then update the project record in one DB transaction.

- [ ] **Step 3: Run the focused tests.**

  Run: `python -m pytest tests/test_jobs.py -q`

- [ ] **Step 4: Implement the one-worker state machine.**

  `python -m nemy_web.worker` loops with a short bounded poll interval, claims one queued job through `BEGIN IMMEDIATE`, and handles `ingest` and `purge` only. The ingest phases are:

  ```text
  stage -> validate -> index -> write_ply -> build_lod -> verify -> publish
  ```

  Run `build-lod --quick --rad <temp/prim-NNN.ply>` from the binary named by `NEMY_BUILD_LOD`, with the unpublished job directory as the working directory. Spark 2.3.1 has no output-path flag; it deterministically writes `<temp/prim-NNN-lod.rad>`, which the worker verifies and renames during publication. Pass no user-controlled option strings. Capture bounded stdout/stderr, enforce `NEMY_JOB_TIMEOUT_SECONDS`, and report safe phase-specific errors. Preserve the immutable source on every failure. Keep this invocation pinned to the [Spark 2.3.1 CLI source](https://github.com/sparkjsdev/spark/blob/v2.3.1/rust/build-lod/src/main.rs#L368-L384).

- [ ] **Step 5: Pin and document Spark's converter.**

  `scripts/install-spark-build-lod.ps1` accepts an explicit install directory, checks out Spark tag `v2.3.1` into a temporary directory, runs Cargo for `rust/build-lod`, copies only the executable, prints its SHA-256, and removes the temporary checkout. Fail with a clear Rust prerequisite message when `cargo` is missing. Never install Rust silently.

  The checkout must be a full source clone of the `v2.3.1` tag. The `@sparkjsdev/spark@2.3.1` npm package ships only `dist/`: it contains no `build-lod` executable and no `rust/` directory, and its `build-lod` script is `cargo run --manifest-path rust/build-lod/Cargo.toml --release --`. The GitHub release `v2.3.1` publishes zero assets, so there is no prebuilt binary to download. Building from source requires the Rust toolchain plus a C++ linker and the Spark crate's native dependencies.

  Record the expected Spark tag and the locally observed binary hash in `README.md`; set `NEMY_BUILD_LOD` to that file. The current development PC has no Rust toolchain and no NVIDIA GPU, so execution of this script and the real conversion acceptance run are target-PC prerequisites.

- [ ] **Step 6: Verify generated media.**

  Verify a `.RAD` exists, is nonempty, and can be opened by a small Node/Spark compatibility smoke or by the Task 6 browser fixture. Compare decoded PLY fixture values and manifest bounds against the known USD fixture. Mark the job successful only after this check.

- [ ] **Step 7: Verify and commit.**

  Run all Python tests. Exercise worker restart with a fake converter. Commit:

  ```powershell
  git add src/nemy_web tests scripts README.md
  git commit -m "Add persistent Spark ingestion worker"
  ```

## Task 6: Protect Range Media and Display the Spark Scene

**Files:**
- Create: `src/nemy_web/media.py`
- Create: `tests/test_media.py`
- Create: `web/src/viewer.ts`
- Create: `web/src/viewer.test.ts`
- Modify: `src/nemy_web/app.py`
- Modify: `web/src/api.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write failing media-session tests.**

  Cover valid media session issuance, cookie flags, expiry, wrong project, tampering, key rotation, project deletion, traversal attempts, encoded separators, missing media, and expired `media_epoch`. Sign a compact cookie payload containing project ID, epoch, expiry, and random session ID with an application secret persisted at `data/server-secret`; create it once with owner-only permissions where supported.

- [ ] **Step 2: Write failing byte-range tests.**

  Verify complete GET, `bytes=0-99`, open-ended, suffix range, invalid/multiple ranges returning `416`, correct `Content-Length`/`Content-Range`, and streaming a large fake file without reading it all into memory. Always include `Accept-Ranges: bytes` and `Cache-Control: private, no-store`.

- [ ] **Step 3: Write failing viewer helper tests.**

  Test manifest schema rejection, column-major matrix construction, union bounds, camera framing, source-prim visibility state, and friendly loading/error text. A transform fixture must map a known USD point into the expected Three.js point.

- [ ] **Step 4: Run focused tests and confirm failure.**

  Run:

  ```powershell
  python -m pytest tests/test_media.py -q
  npm.cmd test -- --run web/src/viewer.test.ts
  ```

- [ ] **Step 5: Implement media sessions and streaming.**

  Authorize `POST /media-session` with the capability header. Set `HttpOnly`, `SameSite=Strict`, `Path=/media/{projectId}/`, `Max-Age=900`, and `Secure` only under HTTPS. Validate the current DB epoch for every media request. Resolve requested files beneath the active versioned published directory and reject any path that does not remain inside it.

  Stream ranges in 1 MiB server reads using a generator that closes the file. Support exactly one range because Spark requires ordinary single-range reads; do not implement multipart ranges.

- [ ] **Step 6: Implement the viewer without a UI framework.**

  Create one Three.js renderer, perspective camera, OrbitControls, and one Spark `SplatMesh` per manifest prim. Request a media session first, use same-origin `radUrl`, apply the manifest's transform, frame the union bounds, and render on animation frames only while controls, resize, or Spark loading require it. Dispose Spark meshes, materials, controls, and renderer when leaving the project.

  Show source prim checkboxes, current loaded/detail information exposed by Spark, job polling during ingestion, Retry Status, Rotate Link, Copy Link, and Delete Project. Do not expose segmentation controls in build 1. If Spark does not expose a stable percent, show `loading`, `settling`, or `ready` based on its documented state rather than inventing a percentage.

- [ ] **Step 7: Perform the visual fixture check.**

  Open the generated two-splat fixture in the browser and compare against expected screenshots/data:

  - translated bounds match the manifest;
  - anisotropic orientation is visibly correct;
  - red/green colors and opacity ordering are correct;
  - changing prim visibility works;
  - reload with the secret link restores access and the view frames the scene.

  If the Spark API differs from the pinned documentation, adapt only `viewer.ts`; do not leak Spark types into the API or source-index modules.

- [ ] **Step 8: Verify and commit.**

  Run all tests, typecheck, and production build. Commit:

  ```powershell
  git add src/nemy_web tests web/src
  git commit -m "Stream protected Gaussian scenes"
  ```

## Task 7: Complete Deletion, Recovery, and Hardware Acceptance

**Files:**
- Create: `scripts/run-pilot.ps1`
- Modify: `src/nemy_web/worker.py`
- Modify: `tests/test_jobs.py`
- Modify: `README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing purge and recovery tests.**

  A purge job must remove incoming chunks, staged source, immutable source, temporary conversion data, source indexes, media, and job artifacts, then delete or tombstone the remaining records according to foreign-key safety. Access is denied from the moment `deleted_at` is set, even if physical deletion retries after a locked file. Test retry after a simulated Windows file lock and ensure paths are resolved under `NEMY_DATA_DIR` before recursive deletion.

- [ ] **Step 2: Implement bounded purge and startup cleanup.**

  Purge by renaming the project directory to `trash/{projectId}-{jobId}` first, then delete it. Before rename or deletion, resolve and verify both source and destination remain below configured `projects`/`trash` roots. Retry bounded transient failures through the job record. On startup, remove only unpublished temp directories associated with failed/canceled jobs and abandoned uploads older than a documented default of seven days. Never age-delete completed projects.

- [ ] **Step 3: Add the pilot launcher and operating guide.**

  `scripts/run-pilot.ps1` validates Python, Node-built frontend, `pxr`, configured data directory, converter path, free disk space, and loopback bind; then starts the worker and API as hidden child processes and prints `http://127.0.0.1:8767/`. It must preserve logs under `data/logs` with authorization values filtered. Stop both children on script exit.

  `README.md` must contain exact setup, converter prerequisite, environment values, startup, backup statement, source immutability, secret-link warning, recovery, update, and uninstall/delete instructions. State that build 1 does not yet segment or export results.

- [ ] **Step 4: Run the automated release gate.**

  ```powershell
  python -m pytest -q
  npm.cmd test -- --run
  npm.cmd run typecheck
  npm.cmd run build
  git diff --check
  ```

  Expected: every command exits 0. Review logs for an injected capability secret and absolute staged path; neither may appear.

- [ ] **Step 5: Run the end-to-end small fixture gate on the target GPU PC.**

  Using the production build and real worker:

  1. Create a project and save its link.
  2. Interrupt and resume a multi-chunk upload.
  3. Observe one persistent ingest job through API and worker restart.
  4. Render the fixture and perform the visual checks from Task 6.
  5. Confirm Range requests return `206`.
  6. Open two tabs, rotate the key in one, and confirm the old tab loses access.
  7. Delete the project, confirm immediate denial, and wait for physical purge.

- [ ] **Step 6: Run the representative large-scene gate.**

  Use `C:\Users\JoshuaRetuta\Documents\USD FOLDER\SOL10_OUTDOOR_1.usd` as the representative scene: a self-contained static Gaussian scene with **6,366,784 splats**. It is the largest Gaussian scene available on the pilot machine and the only one that exercises the `ParticleField3DGaussianSplat` schema. Record in a dated `docs/benchmarks/<date>-<machine>.md`:

  - CPU, RAM, GPU, VRAM, disk type, software versions, and converter hash;
  - input bytes and splat count;
  - peak worker resident memory and total ingest time;
  - bytes for source, temporary PLY, source index, and published `.RAD`;
  - initial view time, time until the view settles, browser peak memory, and frame time while orbiting;
  - a sampled source-ID check against original USD;
  - coordinate round-trip maximum error;
  - visual parity results for geometry, transform, color, scale, opacity, orientation, and bounds.

  The gate passes only when the scene finishes without exhausting the target PC and the browser stays within a documented bounded Spark splat budget. If it fails, keep the product claim limited to the largest measured passing scene and tune only chunk size, `build-lod` flags, quotas, or worker limits before repeating.

  **Measured baseline (development host, 2026-10-21, OpenUSD 26.8).** These are the numbers the gate is compared against.

  | Quantity | Measured |
  |---|---|
  | Source file size | 339,618,990 bytes |
  | Splat count | 6,366,784 |
  | `positions` | 76,401,408 B (float32 × 3) |
  | `scales` | 76,401,408 B (float32 × 3) |
  | `orientations` | 101,868,544 B (float32 × 4) |
  | `opacities` | 25,467,136 B (float32) |
  | `radiance:sphericalHarmonicsCoefficients` | 76,401,408 B (float32 × 3) |
  | Total source arrays | 356,539,904 B (0.332 GiB) |
  | Stage open | 0.02 s |

  Two memory figures bound the requirement:

  | Ingest pattern | Peak RSS | Note |
  |---|---|---|
  | All five arrays resident at once | 733.0 MB | 2.16x the 356,539,904 B of array data. |
  | One attribute at a time, freed before the next | 466.0 MB | Matches the Task 4 Step 6 streaming requirement. |

  The streaming path must stay at or below 466 MB for this scene. A run above 600 MB peak RSS means more than one source array is being held at once and has violated the one-attribute-at-a-time rule in Task 4 Step 6.

  **Scaling note.** The original 50-million-splat target was dropped after a search of the pilot machine found no scene above 6,366,784 Gaussian splats. `SOL10 Outdoors.usd` holds 42,352,092 points, but it is a `Points` prim with no `positions`/`scales`/`orientations`/SH arrays and is therefore not a Gaussian scene. Extrapolating the measured 2.16x amplification, a 50-million-splat scene with this array set would need roughly 2.8 GiB of source arrays and about 6.0 GiB peak RSS if all arrays were resident at once. Supporting that scale is a measured-claim decision for the target PC, not a current deliverable.

- [ ] **Step 7: Request code review and address only evidenced blockers.**

  Use `superpowers:requesting-code-review` with emphasis on the Review Focus above. Re-run the affected focused tests after every correction, then rerun the automated release gate once.

- [ ] **Step 8: Commit the completed foundation.**

  ```powershell
  git add .gitignore README.md scripts src tests web docs/benchmarks
  git commit -m "Complete local USD viewer foundation"
  ```

## Final Evidence Checklist

- [ ] The approved spec's build-1 acceptance cases each point to an automated test or recorded target-PC check.
- [ ] `git status --short` is clean.
- [ ] No source asset, capability secret, data directory, generated `.RAD`, PLY, SQLite database, or server secret is tracked by Git.
- [ ] The final response links the implementation commits, test output, fixture evidence, and large-scene benchmark.
- [ ] Remaining work is described as Build 2 segmentation/refinement and Build 3 save/metadata, each requiring its own approved spec before implementation.
