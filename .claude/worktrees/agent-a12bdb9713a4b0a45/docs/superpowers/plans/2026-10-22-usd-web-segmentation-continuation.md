# USD Web Segmentation Foundation — Continuation Plan (Tasks 3–7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the one-PC USD Gaussian-splat web foundation: resumable self-contained upload, USD validation with authoritative source identity, a persistent Spark ingest worker, protected Range media with a Three.js viewer, and complete deletion plus hardware acceptance.

**Architecture:** Unchanged from the original plan. A single FastAPI application owns the HTTP API, SQLite records, and the same-origin static frontend. A separate one-at-a-time Python worker claims persistent SQLite jobs and uses OpenUSD, NumPy, and a pinned Spark `build-lod` binary. Project files live below one configured data directory. The browser is plain TypeScript with Three.js, Spark, and OrbitControls.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn, SQLite, OpenUSD (`usd-core`/`pxr` 26.8), NumPy, pytest; TypeScript, Vite 8, Vitest 5, Three.js 0.186.1, `@sparkjsdev/spark` 2.3.1, `hash-wasm` 4.12.0; Spark 2.3.1 Rust `build-lod` binary.

**Spec:** [Approved foundation design](../specs/2026-10-20-usd-web-segmentation-foundation-design.md) (binding authority)

**Parent plan:** [USD Web Segmentation Foundation](2026-10-20-usd-web-segmentation-foundation.md) — Tasks 1 and 2 are complete and reviewed clean. **This plan continues from that plan's Task 3 and supersedes it for Tasks 3–7**, adding the decisions those tasks need that the parent plan could not know.

**Resume point:** commit `89f2c63` ("Add capability-link projects"). The SDD ledger is at `.superpowers/sdd/2026-10-20-usd-web-segmentation-foundation/progress.md` — read it before dispatching anything; it holds every ruling made so far.

---

## Global Constraints

These hold for every task below. They are copied from the parent plan's Global Constraints and spec, plus the decisions Tasks 1 and 2 established.

- Run the browser, API, worker, storage, OpenUSD, and Spark conversion on the same NVIDIA GPU PC. Bind to `127.0.0.1` by default.
- The API uses port `8767`. Port `8766` belongs to the existing SAM3 mask service, which must keep running on the same PC; the two services must never contend for a port.
- One project has one immutable source revision. A different source requires a new project.
- The source identity is exactly `(sourceRevisionId, sourcePrimPath, sourceIndex)`. `sourceIndex` is an unsigned 64-bit index into the immutable USD `positions` array.
- Never use Spark LoD nodes or PLY row positions as authoritative edit IDs.
- Accept static Gaussian attributes only. Reject time-varying required attributes and unsupported transforms with explicit structured errors.
- Publish the scene manifest and `.RAD` files only after validation, source indexing, conversion, and parity checks succeed.
- Treat every filename, archive member, USD asset path, and project link as untrusted input. Do not interpolate user paths into a shell command.
- Keep code proportional to the pilot: raw SQLite, filesystem storage, one worker, polling, and vanilla TypeScript. No ORM, no DI framework, no state library, no component library.
- Use the real sample scenes in `C:\Users\JoshuaRetuta\Documents\USD FOLDER` only for read-only acceptance and performance checks. Do not commit or copy them into the repository.
- **Errors:** every project-scoped API returns `{"error":{"code":"...","message":"...","details":{...}}}`. A missing or wrong capability secret returns **404**, never 401/403 — the API must not be an existence oracle.
- **The capability secret never enters a URL, a log, the database plaintext, a media URL, or an error body.** It travels only in the `Authorization: Bearer <secret>` header.
- **CSP:** `script-src 'self' 'wasm-unsafe-eval'`. The `'wasm-unsafe-eval'` token is required — Spark compiles WASM at import time and `hash-wasm` compiles its SHA-256 kernel. Bare `'unsafe-eval'` and `'unsafe-inline'` must never appear. There is no wildcard CORS.
- **Dependency pins are fixed.** `pyproject.toml` and `package.json` may not gain, lose, or change a pinned version. Do not install `httpx2`; the plan pins `httpx==0.28.1` and the `StarletteDeprecationWarning` is already suppressed by a narrow message-scoped `filterwarnings` rule.
- **Environment:** use `.\.venv\Scripts\python.exe` (never bare `python`/`pytest`) and `npm.cmd` (never `npm`/`npm.ps1` — the execution policy blocks it). The `bash` binary is NOT on `PATH`; the SDD scripts need the full path `C:\Program Files\Git\bin\bash.exe`.
- `data/` and `*.egg-info/` are gitignored. Never commit a source asset, capability secret, SQLite database, server secret, generated `.RAD`, or PLY.

### Route registration — decided in Task 2, not open for re-litigation

The frontend is the router's **default handler** (`app.router.default = serve_frontend`), never a `Mount`. `create_app()` deliberately knows nothing about project routes: Task 1's reviewed tests require a bare `create_app()` to answer `POST /api/projects` with 404 **and** require a route registered after `create_app()` returns to win. A router included *inside* `create_app()` breaks the first.

Every new router goes in `create_pilot_app()`:

```python
def create_pilot_app(settings=None, dist_dir=None) -> FastAPI:
    app = create_app(settings, dist_dir)
    app.include_router(projects.router)
    app.include_router(uploads.router)     # Task 3
    app.include_router(jobs.router)        # Task 5
    app.include_router(media.router)       # Task 6
    return app
```

`main()` already calls `create_pilot_app(settings)`. Do not change it.

### `%2F` path smuggling — a real constraint on Task 5 and Task 6

The browser's `apiFetch` decides whether to attach the capability header by checking `pathname.startsWith("/api/")` on the **browser-normalized** path. Uvicorn unquotes `%2F` into a real path separator. So `/api/..%2f..%2fmedia/x` keeps `/api/` in the browser but decodes server-side to `/api/../../media/x`.

Today this 404s because no `/media` route exists — so there is no leak yet. It becomes live the moment Task 6 adds `GET /media/{projectId}/{path}`: a crafted same-origin URL could carry the capability header to the media route, which is supposed to be reachable only by the **media cookie**. The media cookie is the intended `/media` credential; the header is API-only.

**Task 6 must** either reject the capability header on any path whose *decoded* form escapes `/api/`, or compare the browser's check against the decoded server-side path. Task 5's job routes live under `/api/` and are unaffected, but must not introduce a non-`/api` route that the header could reach.

---

## Review Focus

These are the input classes and failure modes the spec implies that no task's tests fully exercise — most likely to bite a real user first.

- **A ZIP whose member name differs only by case** (`A/Stage.usda` vs `a/stage.usda`) on Windows, where the filesystem is case-insensitive — must be rejected, not silently overwrite. Also: a member that resolves to a junction/reparse point, and a drive-letter or UNC path.
- **A `.usd` file that is not a ZIP** but has a `.zip` name, and a `.zip` whose root stage is absent or points outside the extraction root — both must fail with a clear message, not a 500.
- **An upload resumed after the browser restarts** where the user re-selects a *different* file of the same name and size — the stored digest must not be reused.
- **A chunk uploaded at an offset that does not align with the configured chunk size** — must be rejected, and must not corrupt the sparse file.
- **A USD stage whose `radiance:sphericalHarmonicsDegree` is 1, 2, or 3** — the Graphdeco `f_rest_*` channel-major order must be right, or colour is silently corrupted on every higher-degree scene.
- **A media request whose path contains an encoded separator** (`%2f`, `%5c`) or `..` — must not escape the published directory, even after decoding.
- **A media cookie presented after key rotation or project deletion** — must fail on the `media_epoch` check, not just on signature validity.
- **A crash between `.RAD` creation and publication** — no partial `manifest_relpath` may ever appear.
- **A request with a wrong secret AND a stale version** — the capability check must run first, so the answer is `404`, not `409`. A `409` would confirm the project exists. Task 2 established this; Tasks 3, 5, and 6 must not invert the order when they add their own routes.

Each line above is pinned by a test in the task that owns the code (see the task steps). The spec is a vision document: it says what the software must do, not everything it will meet.

---

## File Map (Tasks 3–7 only)

Already present and **not** to be modified except where a task says so:

```text
src/nemy_web/
├── app.py          # create_app() + create_pilot_app(); Task 3/5/6 add routers here
├── auth.py         # generate_secret, hash_secret, secret_matches, bearer_token  [DONE]
├── config.py       # Settings: frozen dataclass, from_env(environ)  [DONE]
├── db.py           # connect, transaction, initialize  [DONE]
└── projects.py     # router + capability/version helpers  [DONE]
tests/
├── conftest.py     # settings + client fixtures (client uses create_pilot_app)  [DONE]
├── test_app.py     # 22 tests  [DONE]
├── test_projects.py# 21 tests  [DONE]
└── fixtures/
    └── make_bundle.py   # synthetic local-reference USD bundle  [Task 3, already written]
```

To be created:

```text
src/nemy_web/
├── uploads.py         # resumable upload + safe bundle staging       (Task 3)
├── usd_ingest.py      # OpenUSD validation, index, PLY, manifest       (Task 4)
├── jobs.py            # idempotent enqueue, claim, status, recovery    (Task 5)
├── media.py           # protected byte-range responses                (Task 6)
└── worker.py          # one-job worker entry point                    (Task 5)
tests/
├── test_uploads.py    # Task 3
├── test_usd_ingest.py # Task 4
├── test_jobs.py       # Task 5
├── test_media.py      # Task 6
└── fixtures/
    └── make_gaussian_stage.py  # deterministic OpenUSD fixtures      (Task 4)
web/src/
├── hash-worker.ts     # incremental hash-wasm digest in a blob worker (Task 3)
├── viewer.ts          # Three.js + Spark viewer                      (Task 6)
└── viewer.test.ts     # Task 6
scripts/
├── install-spark-build-lod.ps1  # build the pinned converter         (Task 5)
└── run-pilot.ps1                # launcher + operating guide        (Task 7)
README.md               # setup, converter prereq, operations        (Task 5, Task 7)
docs/benchmarks/<date>-<machine>.md  # large-scene measurements       (Task 7)
```

---

## Task 3: Add Resumable Upload and Safe Bundle Staging

**Status: not started.** A previous implementer was cancelled before writing any implementation. Only `tests/fixtures/make_bundle.py` exists (a synthetic local-reference USD bundle — keep it; it solves the `SOL10.usd` problem the parent plan flagged). `src/nemy_web/uploads.py`, `tests/test_uploads.py`, and `web/src/hash-worker.ts` do **not** exist yet.

**Files:**
- Create: `src/nemy_web/uploads.py`
- Create: `tests/test_uploads.py`
- Create: `web/src/hash-worker.ts`
- Modify: `src/nemy_web/app.py` (add `app.include_router(uploads.router)` inside `create_pilot_app()`)
- Modify: `web/src/api.ts` (upload helpers)
- Modify: `web/src/main.ts` (upload UI)
- Keep: `tests/fixtures/make_bundle.py` (already written)

**Interfaces:**
- Consumes: `db.transaction(db_path)`, `db.connect(db_path)`; `auth.bearer_token(header)`, `auth.secret_matches(secret, stored_hash)`; the capability check in `projects.py`. **Reuse it; do not write a second one.** In Task 3's Step 1, add a public `authorize_project(row: sqlite3.Row | None, header: str | None) -> sqlite3.Row | None` to `projects.py` that simply delegates to the existing `_authorized_row` (which already returns `None` for a deleted project). Tasks 3, 5, and 6 import the public name. This adds a name; it must not change behavior.
- Produces: `uploads.router` — an `APIRouter` mounted under the project prefix. The plan's HTTP API table fixes the paths:
  - `POST /api/projects/{id}/uploads`
  - `GET /api/projects/{id}/uploads/{uploadId}`
  - `PUT /api/projects/{id}/uploads/{uploadId}/chunks/{index}`
  - `POST /api/projects/{id}/uploads/{uploadId}/finalize`

  Build it as `uploads.router = APIRouter(prefix="/api/projects", tags=["uploads"])` with route paths `/{project_id}/uploads`, `/{project_id}/uploads/{upload_id}`, `/{project_id}/uploads/{upload_id}/chunks/{index}`, and `/{project_id}/uploads/{upload_id}/finalize`. Include it in `create_pilot_app()` next to `projects.router`. Two routers sharing a prefix is fine — FastAPI dispatches on the full path, and no uploads path collides with a projects path (the projects routes are `""`, `/{project_id}`, `/{project_id}/rotate-key`).
- Produces for Task 5: the `uploads` and `upload_chunks` rows are read by the worker; the staged root lives at `projects/{projectId}/source/staged/`, the immutable source at `projects/{projectId}/source/original/{generated-name}`.

- [ ] **Step 1: Write the failing upload protocol tests.**

  `tests/test_uploads.py` must cover, each as its own test:
  - create an upload attempt with filename, total size, whole-file SHA-256, and an optional bundle root path
  - out-of-order chunk upload
  - status query returns chunk size and received chunk indexes
  - identical chunk retry → `204`
  - conflicting chunk retry (different bytes at the same index) → `409 chunk_conflict`
  - bad offset/length → rejected
  - oversized declaration → rejected
  - interrupted resume (chunks survive a new request cycle)
  - whole-file digest mismatch on finalize → fails clearly, upload stays resumable
  - successful finalize
  - repeated finalize returns the **same job id** and enqueues no second job
  - a failed upload may be replaced by another upload in the same project
  - once a source revision succeeds, a new upload attempt → `409 source_already_fixed`

  Override the configured chunk size to **16 bytes** by constructing `Settings(upload_chunk_bytes=16)`. The `client` fixture in `tests/conftest.py` uses the default settings — add a local fixture in `test_uploads.py` that builds a `TestClient(create_pilot_app(settings))` with the overridden settings, and do not change the shared fixture (Task 1's tests depend on it).

  Every upload route needs the capability header. A missing or wrong secret → **404**.

- [ ] **Step 2: Write the failing archive safety tests.**

  Build ZIP fixtures in memory (use `tests/fixtures/make_bundle.py`'s `bundle_bytes()` for the valid case). Reject:
  - absolute paths (`/etc/passwd`, `C:\Windows\x`)
  - `..` segments
  - drive-letter paths
  - **case-insensitive duplicates** (`A/Stage.usda` and `a/stage.usda` in one archive) — the Windows filesystem folds case, so this is a real overwrite, not a theoretical one
  - symlink entries (Unix mode bits in `ZipInfo.external_attr`)
  - unsupported special entries (fifo, device, directory-with-unexpected-attributes)
  - too many bytes after expansion (exceed `max_expanded_bytes`)
  - a root stage not present in the bundle
  - a root outside the extraction root
  - on Windows, any extracted component that resolves to a **reparse point** (junction or symlink)

  Never call `extractall()`.

- [ ] **Step 3: Run the focused test and confirm failure.**

  Run: `.\.venv\Scripts\python.exe -m pytest tests/test_uploads.py -q`
  Expected: FAIL — `nemy_web.uploads` does not exist.

- [ ] **Step 4: Implement chunk storage without loading chunks into memory twice.**

  - The sparse temporary file lives at `projects/{projectId}/incoming/{uploadId}.part`.
  - Validate the request's calculated offset and size **before** writing.
  - Stream the request to a temporary chunk file while hashing it, then write it at the exact offset. Record the chunk row only after `flush()` and `os.fsync()`.
  - An existing chunk with the same byte count and digest → **204**. Any difference → **409 chunk_conflict**.
  - Finalize only when every expected chunk exists. Stream the assembled file through SHA-256, then `os.replace()` it into `source/original/{safe-generated-name}`. **The safe name is generated by you — the user's filename is metadata only and must never become a path component.** Set the file read-only.
  - Windows note: `os.replace()` fails if the destination exists, and the source must not be open elsewhere. Write to a temporary name in the destination directory, then replace. `os.fsync()` is available on Windows and must be called.
  - The finalize response returns the **same job id** on a repeated finalize and enqueues exactly one `ingest` job row.

- [ ] **Step 5: Implement safe staging.**

  `.usd`, `.usda`, `.usdc`, `.usdz` become the root stage directly. `.zip` is extracted to a new temporary directory using normalized forward-slash relative names and per-member streaming limits, then atomically renamed to `source/staged`.

  Extraction rules, all of them: reject archive links from `ZipInfo.external_attr`; normalize names to forward slashes; reject absolute paths, `..` segments, and drive letters; reject case-insensitive duplicates; enforce `max_expanded_bytes` while streaming; resolve the root stage and require it to stay inside the extraction root via `Path.is_relative_to(extraction_root.resolve())`; on Windows, reject any component that resolves to a reparse point.

  Use `zipfile.ZipFile.open(member)` for per-member streaming — never `extractall()`, never `read()` a whole member into memory.

- [ ] **Step 6: Implement resumable browser upload.**

  `web/src/hash-worker.ts` computes the file's SHA-256 **incrementally** with the pinned `hash-wasm` implementation, so the page stays responsive and a multi-gigabyte file is never buffered in full. This is the only extra frontend runtime dependency because Web Crypto has no streaming digest API.

  The worker is created from a `Blob` URL, which the current CSP already permits (`worker-src 'self' blob:`), and hash-wasm's WASM compile is already permitted (`script-src 'self' 'wasm-unsafe-eval'`). **Do not change the CSP to make this work** — it already works. Verify that claim in the browser before assuming it.

  Client behaviour: query the received chunk indexes before sending; send **at most one 16 MiB chunk at a time**; retry a transient failure with bounded exponential delays; show bytes sent, digest progress, and the current error. Keep `uploadId`, filename, size, and digest in `sessionStorage`, and **verify they still match the reselected local file before resuming** after a browser restart — a different file of the same name and size must not reuse the stored digest.

  Extend `web/src/api.ts` with the upload calls, using the existing `apiFetch` so the capability header is attached. The upload paths are under `/api/`, so the existing same-origin check covers them.

- [ ] **Step 7: Verify and commit.**

  Run:
  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_uploads.py -q
  .\.venv\Scripts\python.exe -m pytest -q
  npm.cmd test -- --run
  npm.cmd run typecheck
  npm.cmd run build
  ```
  Expected: every command exits 0. The full suite must not regress the **43** existing tests.

  Commit:
  ```powershell
  git add src/nemy_web tests web/src
  git commit -m "Add resumable self-contained uploads"
  ```

---

## Task 4: Validate USD and Build the Authoritative Source Index

**Status: not started.**

**Files:**
- Create: `src/nemy_web/usd_ingest.py`
- Create: `tests/fixtures/make_gaussian_stage.py`
- Create: `tests/test_usd_ingest.py`
- **No dependency change needed:** `numpy==2.5.4` and `usd-core==26.8` are already pinned in `pyproject.toml` and already installed in the venv (verified: numpy 2.5.4, `pxr` 26.8). The parent plan listed `pyproject.toml` as a file to modify; that turns out to be unnecessary — **do not touch `pyproject.toml`.**

**Interfaces:**
- Consumes: `db.connect(db_path)` for the source-index metadata; nothing from Tasks 1–3 at runtime (this module is called by the **worker**, not by the API).
- Produces: `validate_stage(staged_root: Path, root_stage: str) -> list[dict]` — the deterministic prim records, or a list of structured errors. Each record carries the source prim path, per-prim local-to-world transform, stage up axis, `metersPerUnit`, array length, and the source revision ID.
- Produces: `web_from_usd_world(up_axis: str, meters_per_unit: float) -> np.ndarray` — a 4×4 column-major matrix.
- Produces: `build_source_index(positions: np.ndarray, output_dir: Path, grid_size: int = 64) -> dict`.
- Produces for Task 5: a PLY writer and a manifest dict matching the parent plan's "Published manifest" JSON exactly.

- [ ] **Step 1: Create tiny deterministic OpenUSD fixtures.**

  Generate fixtures during tests rather than committing binary USD files. `tests/fixtures/make_gaussian_stage.py` must build:
  - two anisotropic splats under a translated prim with Z-up and explicit `metersPerUnit`
  - known red/green degree-0 SH coefficients, scales, normalized quaternions, and opacities
  - one valid local referenced layer inside the bundle
  - variants with: mismatched array lengths, NaN data, zero particles, time samples, unresolved references, an external absolute reference, nonuniform transform scale, shear, and an unsupported prim type

  The supported prim schema is `ParticleField3DGaussianSplat` — a real registered OpenUSD schema (`IsA ParticleField` is True; `ParticleField` itself has **no** `positions` attribute). Required attributes: `positions`, `scales`, `orientations`, `opacities`, `radiance:sphericalHarmonicsCoefficients`, `radiance:sphericalHarmonicsDegree`.

- [ ] **Step 2: Write failing validation tests.**

  Assert `validate_stage(staged_root, root_stage)` returns deterministic prim records or a list of structured errors. Check every required attribute has no time samples, arrays align with particle count and SH degree, values are finite, scales are positive, opacities are in `[0,1]`, and orientations have nonzero norm. For the pilot, allow rigid transforms plus **uniform** scale; reject shear and nonuniform scale with `unsupported_transform`.

  Use OpenUSD composition/dependency discovery to enumerate layers and asset dependencies. Resolve paths, compare them with `Path.is_relative_to(staged_root.resolve())`, and reject unresolved, network, or outside-root assets. Return safe project-relative names only.

- [ ] **Step 3: Write failing coordinate and source-index tests.**

  `web_from_usd_world` converts USD units to meters and maps Z-up `(x,y,z)` to Three.js Y-up `(x,z,-y)` with determinant `+1`; Y-up keeps the axes and applies units. Round-trip points within `1e-5` meters.

  Each prim also receives `webFromPrimLocalCentered = webFromUsdWorld * usdWorldFromPrimLocal * translate(localCenter)`. The PLY stores `localPosition - localCenter`; Spark applies this one per-prim matrix, preventing precision loss from large world translations without baking the transform twice.

  The index copies positions once to `positions.npy` as float32, creates a stable uint64 `order.npy`, and writes occupied cell keys, ranges, and **actual** grouped lower/upper bounds to `cells.npz`.

  Use the extension's 64×64×64 uniform-grid rule. The reference implementation is `Source Code/nemy.asset_metadata_property-0.5.0/nemy/asset_metadata_property/crop_tool.py` (that whole `Source Code/` tree is untracked and gitignored — it is reference material, not repo source; the path is verified to exist on the development host, and two other copies exist under `C:\Users\JoshuaRetuta\Documents\`). The rule, at `crop_tool.py:270-271`:
  ```python
  cell = np.clip(((points[start:stop]-lower)/step).astype(np.int64), 0, 63)
  keys[start:stop] = cell[:,0] + 64*cell[:,1] + 4096*cell[:,2]
  ```
  Clamp cell coordinates to 0–63, compute `x + 64*y + 4096*z`, stable-sort (`np.argsort(..., kind='stable')` at `:277`), and calculate bounds from the **actual** grouped points (`:281-283` explains why: float32 cell arithmetic can round a point across an ideal grid edge, so the bounds must come from the real points or a hit can be excluded). Assert every original index appears exactly once and a box query matches brute force.

- [ ] **Step 4: Write failing Gaussian-to-PLY conversion tests.**

  A streaming binary little-endian PLY writer. For each source splat:
  - write locally recentered XYZ as float32 and record the restoring transform in the manifest
  - write `scale_0..2 = log(actual local scale)`; the per-prim Spark matrix applies the supported uniform transform scale exactly once
  - write `opacity = logit(clamp(actual_opacity, nextafter(0,1), nextafter(1,0)))`
  - normalize the USD quaternion and write Graphdeco/Spark order `rot_0..3 = (w,x,y,z)`
  - write `f_dc_0..2` from the first RGB SH coefficient
  - for degree 1–3, write the remaining RGB coefficients in Graphdeco **channel-major** `f_rest_*` order; reject other degrees

  **The transpose that is easy to get backwards.** OpenUSD stores `radiance:sphericalHarmonicsCoefficients` as a `Float3Array` of shape `(nsplat, ncoeff, 3)` — coefficient-major, last axis RGB. Graphdeco `f_rest_*` is channel-major: `f_rest[c][k]`. The conversion is `f_rest[c][k] = sh[k][c]`, and `f_dc_c = sh[0][c]`. Getting this backwards silently corrupts colour on every degree-1..3 scene, and the only real scene on the pilot machine is degree 0, so the branch would ship untested against real data. The degree-1 fixture must therefore use **distinct per-channel values** so a transpose error cannot pass.

  Test both endpoints of opacity, a non-unit quaternion, an anisotropic rotated splat, and coefficient ordering. Read the resulting PLY through Spark's supported path during Task 5; these unit tests first verify the binary header and numeric rows directly.

- [ ] **Step 5: Run the focused tests and confirm failure.**

  Run: `.\.venv\Scripts\python.exe -m pytest tests/test_usd_ingest.py -q`
  Expected: FAIL — `nemy_web.usd_ingest` does not exist.

- [ ] **Step 6: Implement validation, indexing, and chunked conversion.**

  Use `numpy.lib.format.open_memmap` for normalized on-disk arrays. **Copy one USD attribute at a time so all source arrays are not duplicated in RAM at once.** Emit PLY rows in configurable chunks, initially 250,000 rows, and call a progress callback between chunks. Delete the temporary PLY and index directory on any exception. Do not catch and downgrade OpenUSD composition errors.

  **The measured memory budget for the acceptance scene.** For `SOL10_OUTDOOR_1.usd` (6,366,784 splats, 356,539,904 B of source arrays), the measured peaks on the development host were **733.0 MB** with all five arrays resident at once and **466.0 MB** streaming one attribute at a time. The streaming path must stay at or below **466 MB** for this scene. A run above **600 MB** peak RSS means more than one source array is held at once and has violated the one-attribute-at-a-time rule.

- [ ] **Step 7: Run a read-only compatibility probe on an existing scene.**

  Run validation only — no copy, no conversion — on:
  ```text
  C:\Users\JoshuaRetuta\Documents\USD FOLDER\SOL10_OUTDOOR_1.usd
  ```
  Expected evidence: `/SOL10_OUTDOOR_1` is detected, count is `6,366,784`, attributes are static, and its large world translation (`xformOp:translate` ≈ (579502.33, 6633706.91, 187.05)) is represented in the manifest transform rather than baked into float32 local positions. Record the command and result under `README.md` troubleshooting or a short dated note; **do not commit the asset**.

  Note for later: `SOL10 Outdoors.usd` is **not** a Gaussian scene — it is 42,352,092 `Points` with no `positions`/`scales`/`orientations`/SH arrays. The two `detached` scenes have 0 Gaussians and 0 points. `SOL10.usd` references an absent `SubUSDs/`, so it cannot be a bundle fixture either.

- [ ] **Step 8: Verify and commit.**

  Run `.\.venv\Scripts\python.exe -m pytest -q` — every command exits 0, and the suite must not regress the existing tests.

  Commit:
  ```powershell
  git add src/nemy_web/usd_ingest.py tests README.md
  git commit -m "Validate USD and preserve source identities"
  ```

---

## Task 5: Run Persistent Ingest Jobs and Publish Spark Media Atomically

**Status: not started.** **Target-PC task in part:** the real conversion needs a Rust toolchain this host does not have. Everything else is buildable and testable here with a fake converter.

**Files:**
- Create: `src/nemy_web/jobs.py`
- Create: `src/nemy_web/worker.py`
- Create: `tests/test_jobs.py`
- Create: `scripts/install-spark-build-lod.ps1`
- Modify: `src/nemy_web/uploads.py`
- Modify: `src/nemy_web/app.py` (add `app.include_router(jobs.router)` inside `create_pilot_app()`)
- Modify: `README.md` (create it)

**Interfaces:**
- Consumes: `db.transaction(db_path)`, `db.connect(db_path)`; `uploads.py`'s staged root and immutable source; `usd_ingest.validate_stage`, `build_source_index`, and the PLY writer; `Settings.build_lod` (an absolute, resolved path — Task 1 fixed that) and `Settings.job_timeout_seconds`.
- Produces: `jobs.router = APIRouter(prefix="/api/projects", tags=["jobs"])` with route paths `/{project_id}/jobs/{job_id}` and `/{project_id}/jobs/{job_id}/retry`. Include it in `create_pilot_app()`. Neither path collides with the projects or uploads routes.
- Produces: `python -m nemy_web.worker` — the one-worker loop. This satisfies the `nemy-worker` console script already registered in `pyproject.toml`, which currently points at a module that does not exist.
- Produces for Task 6: `published/{sourceRevisionId}/manifest.json` plus the `.RAD` files, and the `projects.manifest_relpath` column pointing at it.

- [ ] **Step 1: Write failing job tests.**

  Test idempotent enqueue, transactional claim, one running job at a time, progress updates, safe failure details, timeout, cancellation between phases, and startup recovery. A worker startup changes orphaned `running` ingest jobs back to `queued`, increments `attempt` only on the next claim, and cleans that job's unpublished temporary directory before retry.

  Use a **fake converter executable** that can succeed, fail, sleep, and write a known output. Assert the command arguments are a list with `shell=False` and that paths containing spaces work.

- [ ] **Step 2: Write failing atomic-publication tests.**

  Simulate failure after PLY creation, after `.RAD` creation, and before publication. **No `projects.manifest_relpath` or partial versioned publication may appear.** On success: fsync the output files, write the manifest into a sibling temporary directory, atomically rename it to `published/{sourceRevisionId}`, then update the project record in one DB transaction.

- [ ] **Step 3: Run the focused tests.**

  Run: `.\.venv\Scripts\python.exe -m pytest tests/test_jobs.py -q`
  Expected: FAIL — `nemy_web.jobs` does not exist.

- [ ] **Step 4: Implement the one-worker state machine.**

  `python -m nemy_web.worker` loops with a short bounded poll interval, claims one queued job through `BEGIN IMMEDIATE`, and handles `ingest` and `purge` only. The ingest phases are:

  ```text
  stage -> validate -> index -> write_ply -> build_lod -> verify -> publish
  ```

  Run `build-lod --quick --rad <temp/prim-NNN.ply>` from the binary named by `NEMY_BUILD_LOD`, with the unpublished job directory as the working directory. **Spark 2.3.1 has no output-path flag**; it deterministically writes `<temp/prim-NNN-lod.rad>`, which the worker verifies and renames during publication. Pass no user-controlled option strings. Capture bounded stdout/stderr, enforce `NEMY_JOB_TIMEOUT_SECONDS`, and report safe phase-specific errors. Preserve the immutable source on every failure.

  Keep this invocation pinned to the [Spark 2.3.1 CLI source](https://github.com/sparkjsdev/spark/blob/v2.3.1/rust/build-lod/src/main.rs#L368-L384).

  The `purge` job kind is enqueued by `projects.delete_project()` (Task 2) with `kind='purge'`, `status='queued'`, `phase='pending'`, `idempotency_key='delete-v{state_version}'`. The worker must claim and complete it; Task 7 does the bounded file removal.

- [ ] **Step 5: Pin and document Spark's converter.**

  `scripts/install-spark-build-lod.ps1` accepts an explicit install directory, checks out Spark tag `v2.3.1` into a temporary directory, runs Cargo for `rust/build-lod`, copies only the executable, prints its SHA-256, and removes the temporary checkout. Fail with a clear Rust prerequisite message when `cargo` is missing. **Never install Rust silently.**

  The checkout must be a full source clone of the `v2.3.1` tag. The `@sparkjsdev/spark@2.3.1` npm package ships only `dist/` — no `build-lod` executable and no `rust/` directory — and its `build-lod` script is `cargo run --manifest-path rust/build-lod/Cargo.toml --release --`. The GitHub release `v2.3.1` publishes **zero** assets, so there is no prebuilt binary to download. Building from source requires the Rust toolchain plus a C++ linker and the Spark crate's native dependencies.

  Record the expected Spark tag and the locally observed binary hash in `README.md`; set `NEMY_BUILD_LOD` to that file. **This script and the real conversion acceptance run are target-PC prerequisites** — this host has no Rust toolchain and no NVIDIA GPU.

- [ ] **Step 6: Verify generated media.**

  Verify a `.RAD` exists, is nonempty, and can be opened by a small Node/Spark compatibility smoke or by the Task 6 browser fixture. Compare decoded PLY fixture values and manifest bounds against the known USD fixture. Mark the job successful only after this check.

- [ ] **Step 7: Verify and commit.**

  Run all Python tests. Exercise worker restart with a fake converter.

  Commit:
  ```powershell
  git add src/nemy_web tests scripts README.md
  git commit -m "Add persistent Spark ingestion worker"
  ```

---

## Task 6: Protect Range Media and Display the Spark Scene

**Status: not started.** **Target-PC task in part:** the real viewer needs the Task 5 converter and a real scene.

**Files:**
- Create: `src/nemy_web/media.py`
- Create: `tests/test_media.py`
- Create: `web/src/viewer.ts`
- Create: `web/src/viewer.test.ts`
- Modify: `src/nemy_web/app.py` (add `app.include_router(media.router)` inside `create_pilot_app()`)
- Modify: `web/src/api.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: `projects.py`'s capability check; `db.connect`; the `projects.media_epoch` column; the published manifest and `.RAD` from Task 5; `Settings.media_session_seconds` (default 900).
- Produces: `media.router = APIRouter(tags=["media"])` — it carries **no** `/api/projects` prefix, because its two routes have different shapes: `POST /api/projects/{project_id}/media-session` (a project route, capability-authorized) and `GET /media/{project_id}/{path:path}` (a media route, cookie-authorized, and deliberately **not** under `/api/` so the browser's capability-header rule cannot reach it). Declare the project route with the full path `@router.post("/api/projects/{project_id}/media-session")` and the media route with `@router.get("/media/{project_id}/{path:path}")`. Include it in `create_pilot_app()`.
- Produces: an application secret persisted at `data/server-secret`, created once with owner-only permissions where the platform supports it.

- [ ] **Step 1: Write failing media-session tests.**

  Cover valid media session issuance, cookie flags, expiry, wrong project, tampering, key rotation, project deletion, traversal attempts, encoded separators, missing media, and expired `media_epoch`. Sign a compact cookie payload containing project ID, epoch, expiry, and a random session ID with the application secret.

  **The cookie must be bound to `media_epoch`.** Task 2's `rotate_key` and `delete_project` both increment `media_epoch`, so a cookie issued through the old link must fail immediately — that is the whole point of the counter.

- [ ] **Step 2: Write failing byte-range tests.**

  Verify complete GET, `bytes=0-99`, open-ended, suffix range, invalid/multiple ranges returning `416`, correct `Content-Length`/`Content-Range`, and streaming a large fake file without reading it all into memory. Always include `Accept-Ranges: bytes` and `Cache-Control: private, no-store`.

- [ ] **Step 3: Write failing viewer helper tests.**

  Test manifest schema rejection, column-major matrix construction, union bounds, camera framing, source-prim visibility state, and friendly loading/error text. A transform fixture must map a known USD point into the expected Three.js point.

- [ ] **Step 4: Run focused tests and confirm failure.**

  Run:
  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_media.py -q
  npm.cmd test -- --run web/src/viewer.test.ts
  ```
  Expected: FAIL — `nemy_web.media` and `web/src/viewer.ts` do not exist.

- [ ] **Step 5: Implement media sessions and streaming.**

  Authorize `POST /media-session` with the capability header. Set `HttpOnly`, `SameSite=Strict`, `Path=/media/{projectId}/`, `Max-Age=900`, and `Secure` only under HTTPS. Validate the current DB epoch for every media request. Resolve requested files beneath the active versioned published directory and reject any path that does not remain inside it.

  **Apply the `%2F` ruling here.** The capability header must never reach the media route. Reject it on any path whose *decoded* form escapes `/api/`, or compare the browser's check against the decoded server-side path. A crafted same-origin URL like `/api/..%2f..%2fmedia/x` decodes server-side to `/api/../../media/x` and would otherwise carry the header to a cookie-protected route.

  **Decode before checking containment.** A path containing `%2f`, `%5c`, or `..` must be rejected, not merely normalized away. Resolve the candidate path and require `Path.is_relative_to(published_root.resolve())` **after** decoding.

  Stream ranges in 1 MiB server reads using a generator that closes the file. Support exactly one range because Spark requires ordinary single-range reads; do not implement multipart ranges.

- [ ] **Step 6: Implement the viewer without a UI framework.**

  One Three.js renderer, perspective camera, OrbitControls, and one Spark `SplatMesh` per manifest prim. Request a media session first, use the same-origin `radUrl`, apply the manifest's transform, frame the union bounds, and render on animation frames only while controls, resize, or Spark loading require it. Dispose Spark meshes, materials, controls, and renderer when leaving the project.

  Show source prim checkboxes, current loaded/detail information exposed by Spark, job polling during ingestion, Retry Status, Rotate Link, Copy Link, and Delete Project. **Do not expose segmentation controls in build 1.** If Spark does not expose a stable percent, show `loading`, `settling`, or `ready` based on its documented state rather than inventing a percentage.

  The viewer imports Spark, which compiles WASM at module load — the CSP's `'wasm-unsafe-eval'` is what makes this work. Do not remove it. If Spark's runtime turns out to need a narrower allowance than `'wasm-unsafe-eval'`, that is a Task 6 finding to settle in the browser, not a guess.

- [ ] **Step 7: Perform the visual fixture check.**

  Open the generated two-splat fixture in the browser and compare against expected screenshots/data:
  - translated bounds match the manifest
  - anisotropic orientation is visibly correct
  - red/green colours and opacity ordering are correct
  - changing prim visibility works
  - reload with the secret link restores access and the view frames the scene

  If the Spark API differs from the pinned documentation, adapt only `viewer.ts`; do not leak Spark types into the API or source-index modules.

- [ ] **Step 8: Verify and commit.**

  Run all tests, typecheck, and production build.

  Commit:
  ```powershell
  git add src/nemy_web tests web/src
  git commit -m "Stream protected Gaussian scenes"
  ```

---

## Task 7: Complete Deletion, Recovery, and Hardware Acceptance

**Status: not started.** **Target-PC task in part:** the acceptance gates need the real converter, a GPU, and the large scene.

**Files:**
- Create: `scripts/run-pilot.ps1`
- Modify: `src/nemy_web/worker.py`
- Modify: `tests/test_jobs.py`
- Modify: `README.md`
- Modify: `.gitignore`
- Create: `docs/benchmarks/<date>-<machine>.md`

**Interfaces:**
- Consumes: the `purge` job kind enqueued by `projects.delete_project()`; `Settings.trash_dir`; the worker's job loop from Task 5.
- Produces: the operating guide in `README.md` and the benchmark record.

- [ ] **Step 1: Write failing purge and recovery tests.**

  A purge job must remove incoming chunks, staged source, immutable source, temporary conversion data, source indexes, media, and job artifacts, then delete or tombstone the remaining records according to foreign-key safety. Access is denied from the moment `deleted_at` is set — Task 2 already guarantees that, and Task 2's `delete_project` enqueues the purge job in the same transaction.

- [ ] **Step 2: Implement bounded purge and startup cleanup.**

  Purge by renaming the project directory to `trash/{projectId}-{jobId}` first, then delete it. Before rename or deletion, resolve and verify both source and destination remain below the configured `projects`/`trash` roots. Retry bounded transient failures through the job record. On startup, remove only unpublished temp directories associated with failed/canceled jobs and abandoned uploads older than a documented default of **seven days**. **Never age-delete completed projects.**

- [ ] **Step 3: Add the pilot launcher and operating guide.**

  `scripts/run-pilot.ps1` validates Python, the Node-built frontend, `pxr`, the configured data directory, the converter path, free disk space, and the loopback bind; then starts the worker and API as hidden child processes and prints `http://127.0.0.1:8767/`. It must preserve logs under `data/logs` with authorization values filtered. Stop both children on script exit.

  `README.md` must contain exact setup, converter prerequisite, environment values, startup, backup statement, source immutability, secret-link warning, recovery, update, and uninstall/delete instructions. State that **build 1 does not yet segment or export results**.

- [ ] **Step 4: Run the automated release gate.**

  ```powershell
  .\.venv\Scripts\python.exe -m pytest -q
  npm.cmd test -- --run
  npm.cmd run typecheck
  npm.cmd run build
  git diff --check
  ```
  Expected: every command exits 0. Review logs for an injected capability secret and an absolute staged path; **neither may appear**.

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

  Use `C:\Users\JoshuaRetuta\Documents\USD FOLDER\SOL10_OUTDOOR_1.usd` as the representative scene: a self-contained static Gaussian scene with **6,366,784 splats**. Record in a dated `docs/benchmarks/<date>-<machine>.md`:
  - CPU, RAM, GPU, VRAM, disk type, software versions, and converter hash
  - input bytes and splat count
  - peak worker resident memory and total ingest time
  - bytes for source, temporary PLY, source index, and published `.RAD`
  - initial view time, time until the view settles, browser peak memory, and frame time while orbiting
  - a sampled source-ID check against original USD
  - coordinate round-trip maximum error
  - visual parity results for geometry, transform, colour, scale, opacity, orientation, and bounds

  The gate passes only when the scene finishes without exhausting the target PC and the browser stays within a documented bounded Spark splat budget.

  **Measured baseline (development host, 2026-10-21, OpenUSD 26.8).**

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

  | Ingest pattern | Peak RSS | Note |
  |---|---|---|
  | All five arrays resident at once | 733.0 MB | 2.16× the 356,539,904 B of array data. |
  | One attribute at a time, freed before the next | 466.0 MB | Matches Task 4 Step 6's streaming requirement. |

  The streaming path must stay at or below **466 MB** for this scene. Above **600 MB** peak RSS means more than one source array is held at once and has violated the one-attribute-at-a-time rule.

  **Scaling note.** The original 50-million-splat target was dropped after a search found no scene above 6,366,784 Gaussian splats. `SOL10 Outdoors.usd` holds 42,352,092 points but is a `Points` prim with no `positions`/`scales`/`orientations`/SH arrays — **not** a Gaussian scene. Extrapolating the measured 2.16× amplification, a 50-million-splat scene with this array set would need roughly 2.8 GiB of source arrays and about 6.0 GiB peak RSS if all arrays were resident at once. Supporting that scale is a measured-claim decision for the target PC, not a current deliverable.

- [ ] **Step 7: Request code review and address only evidenced blockers.**

  Use `superpowers:requesting-code-review` with emphasis on the Review Focus above. Re-run the affected focused tests after every correction, then rerun the automated release gate once.

- [ ] **Step 8: Commit the completed foundation.**

  ```powershell
  git add .gitignore README.md scripts src tests web docs/benchmarks
  git commit -m "Complete local USD viewer foundation"
  ```

---

## Final Evidence Checklist

- [ ] The approved spec's build-1 acceptance cases each point to an automated test or recorded target-PC check.
- [ ] `git status --short` is clean.
- [ ] No source asset, capability secret, data directory, generated `.RAD`, PLY, SQLite database, or server secret is tracked by Git.
- [ ] The final response links the implementation commits, test output, fixture evidence, and large-scene benchmark.
- [ ] Remaining work is described as Build 2 segmentation/refinement and Build 3 save/metadata, each requiring its own approved spec before implementation.

---

## Open Design Risk (carried, not yet addressed)

The SAM3 service's `native_clients_only` middleware rejects any request carrying an `Origin` header with 403. The web app will need either a server-side proxy to SAM3 or a change to that middleware. This constrains Build 2 and does not affect Tasks 3–7. Recorded here so it is not lost.
