# AGENTS.md — USD Gaussian Splat Web Pilot

Instructions for an AI agent working in this repository. Read this before touching code.

## What this is

A **local, single-PC** web app for viewing USD Gaussian-splat scenes. One NVIDIA GPU PC runs
everything: the browser, the API, the worker, storage, and the Spark converter.

**Stack:** Python/FastAPI/SQLite + OpenUSD/NumPy backend, plain TypeScript + Three.js/Spark
frontend. No React, no ORM, no DI framework, no cloud, no accounts.

**Current scope (Build 1 of 3):** create a capability-link project → resumable upload → validate
the USD → convert to a streamable Spark `.RAD` → view it in a browser → rotate the link → delete
everything. **Segmentation and export are NOT in this build.** Do not add segmentation controls.

## Status: where the work actually is

| Task | State | Commit |
|---|---|---|
| 1. Bootstrap (config, DB, health, CSP, SPA shell) | **Done, review clean** | `7444a36` |
| 2. Capability projects (secret lifecycle, rotate, delete) | **Done, review clean** | `89f2c63` |
| 3. Resumable upload + safe bundle staging | **NOT STARTED** | — |
| 4. USD validation + source index + PLY | Not started | — |
| 5. Persistent ingest worker + atomic publication | Not started | — |
| 6. Protected Range media + Spark viewer | Not started | — |
| 7. Deletion, recovery, hardware acceptance | Not started | — |

**Start at Task 3.** The plan that governs it is
`docs/superpowers/plans/2026-10-22-usd-web-segmentation-continuation.md` — it supersedes the
original plan (`2026-10-20-usd-web-segmentation-foundation.md`) for Tasks 3–7.

Also read:
- `docs/superpowers/specs/2026-10-20-usd-web-segmentation-foundation-design.md` — the binding
  design spec. Where the plan and the spec disagree, **the spec wins**.
- `.superpowers/sdd/2026-10-20-usd-web-segmentation-foundation/progress.md` — the decision ledger.
  It records every ruling, every deferred minor, and every parked finding. It is gitignored
  scratch; treat it as the authoritative record of what was decided and why.
- `session-handoff.md` — the human-facing summary.

## Commands

Run from the repo root. These exact invocations matter:

```powershell
.\.venv\Scripts\python.exe -m pytest -q      # backend suite (43 tests currently)
.\.venv\Scripts\python.exe -m pytest tests/test_uploads.py -q
npm.cmd test -- --run                          # frontend suite (9 tests currently)
npm.cmd test -- --run web/src/api.test.ts
npm.cmd run typecheck
npm.cmd run build
```

**Never use bare `python` or bare `pytest`** — the system Python is 3.14 and the venv is 3.12.
**Never use `npm`** — the execution policy blocks `npm.ps1`. Use `npm.cmd`.

**Do not install `httpx2`.** The plan pins `httpx==0.28.1`; the resulting `StarletteDeprecationWarning`
is already suppressed by a narrow, message-scoped `filterwarnings` rule in `pyproject.toml`.
`httpx==0.28.1`'s `Client.delete()` has **no `json` parameter** — use
`client.request("DELETE", url, json=..., headers=...)`.

**Do not change dependency pins.** `pyproject.toml` and `package.json` versions are fixed by the
plan and the approved spec. `numpy==2.5.4`, `usd-core==26.8`, `fastapi==0.150.0`,
`uvicorn==0.54.0`; `three@0.186.1`, `@sparkjsdev/spark@2.3.1`, `hash-wasm@4.12.0`.

## The five rules that are easiest to break

These are not style preferences. Each one exists because something was measured or proven to
break.

### 1. The frontend is `app.router.default`, never a `Mount`

`app.mount("/", ...)` matches every path and shadows every route a later task registers. The
frontend is installed as the router's **default** handler, consulted only after every registered
route fails to match.

**New routers go in `create_pilot_app()`**, next to `projects.router` — *not* inside
`create_app()`. Task 1's reviewed tests require a bare `create_app()` to answer
`POST /api/projects` with 404 **and** require a route registered after `create_app()` returns to
win. A router included inside `create_app()` breaks the first. `main()` already calls
`create_pilot_app(settings)`.

### 2. The CSP must keep `'wasm-unsafe-eval'`

`script-src 'self' 'wasm-unsafe-eval'` — the token is **required**. `@sparkjsdev/spark` calls
`WebAssembly.compile()` at module top level, and `hash-wasm` compiles its SHA-256 kernel. This
was proven in a real browser against a real production bundle: without the token, hash-wasm
produces no digest and Spark's import poisons itself.

**Never add bare `'unsafe-eval'`** (neither dependency uses `eval` or `new Function`) **or
`'unsafe-inline'`** (the built app has no inline scripts).

### 3. The capability secret never enters a URL, a log, the DB plaintext, a media URL, or an error body

It travels only in the `Authorization: Bearer <secret>` header. The server stores only
`SHA-256(secret)`; comparison uses `hmac.compare_digest`. A fast hash is correct here **only
because the secret is 256 bits of `secrets.token_urlsafe(32)`** — a user-chosen password would
need a slow KDF. `auth.py` documents this.

**A missing or wrong secret returns 404, never 401/403** — the API must not be an existence
oracle. The capability check runs **before** the version check, so a wrong secret *and* a stale
version returns 404, not 409. A 409 would confirm the project exists.

### 4. Never trust a path, a filename, or an archive member

Filenames, archive members, USD asset paths, and project links are all untrusted input. Do not
interpolate user paths into a shell command. Use `Path.is_relative_to(root.resolve())` **after**
decoding, and reject absolute paths, `..` segments, drive letters, case-insensitive duplicates,
and (on Windows) reparse points.

### 5. The `%2F` smuggling path is real — do not reintroduce it

The browser's `apiFetch` attaches the capability header when the **browser-normalized** pathname
starts with `/api/`. Uvicorn unquotes `%2F` into a real separator. So
`/api/..%2f..%2fmedia/x` keeps `/api/` in the browser but decodes server-side to
`/api/../../media/x`.

Today this 404s because no `/media` route exists. It becomes live the moment Task 6 adds
`GET /media/{projectId}/{path}` — a crafted same-origin URL could carry the capability header to
a route that is supposed to be reachable only by the **media cookie**. The cookie is the intended
`/media` credential; the header is API-only.

**Task 6 must** reject the header on any path whose *decoded* form escapes `/api/`, or compare
against the decoded server-side path.

## Architecture

```
browser (three + spark)  ──same-origin──>  FastAPI (8767)  ──SQLite──>  one worker
                                                    │
                                                    └──> data/
                                                          nemy.db, projects/, logs/
```

- `src/nemy_web/app.py` — `create_app()` (frontend as router default) + `create_pilot_app()`
  (adds routers). Owns the CSP and the security headers.
- `src/nemy_web/config.py` — frozen `Settings` dataclass; `from_env(environ)` takes an injectable
  mapping so tests never depend on the shell.
- `src/nemy_web/db.py` — `connect()`, `transaction()` (guarded rollback), `initialize()`. The
  4-table schema (`projects`, `uploads`, `upload_chunks`, `jobs`) is **already created** — do not
  change it without a stated reason.
- `src/nemy_web/auth.py` — secret generation, hashing, constant-time comparison, header parsing.
- `src/nemy_web/projects.py` — project routes; the canonical capability check.
- `web/src/api.ts` — browser client: `readProjectLocation`, `readSecret`, `apiFetch`.

**Not yet written:** `uploads.py`, `usd_ingest.py`, `jobs.py`, `media.py`, `worker.py`,
`web/src/hash-worker.ts`, `web/src/viewer.ts`, `README.md`, `scripts/`.

## Environment

| Prerequisite | Required | On the development host |
|---|---|---|
| Python | `>=3.12,<3.13` | **3.12.10 installed** in `.venv` |
| Node.js | Vite 8 / Vitest 5 | v24.16.0 — use `npm.cmd` |
| `pxr` (OpenUSD) | `usd-core==26.8` | present |
| Rust toolchain | `cargo` + `rustc` | **MISSING** — `build-lod` must be built from source |
| NVIDIA GPU | CUDA-capable | **MISSING** — SAM3 and the real conversion are target-PC work |

**The Spark converter is not downloadable.** The `@sparkjsdev/spark@2.3.1` npm package ships only
`dist/` — no `build-lod` binary, no `rust/` source — and the GitHub release `v2.3.1` publishes
**zero assets**. It must be built from a full source clone of the `v2.3.1` tag. Task 5's
`scripts/install-spark-build-lod.ps1` does that and prints the binary's SHA-256.

**Port 8766 belongs to the existing local SAM3 mask service.** It must keep running. The API
uses **8767**. The two must never contend.

## The acceptance scene

`C:\Users\JoshuaRetuta\Documents\USD FOLDER\SOL10_OUTDOOR_1.usd` — 6,366,784 splats, 339,618,990
bytes. Read-only; **never commit or copy it into the repo**.

Measured on the development host (OpenUSD 26.8, 2026-10-21):

| | |
|---|---|
| Total source arrays | 356,539,904 B (0.332 GiB) |
| Peak RSS, all arrays resident | 733.0 MB |
| Peak RSS, one attribute at a time | **466.0 MB** ← the streaming budget |

**The streaming path must stay at or below 466 MB.** Above **600 MB** means more than one source
array is held at once and has violated Task 4's one-attribute-at-a-time rule.

Two traps:
- `SOL10 Outdoors.usd` is **not** a Gaussian scene — 42,352,092 `Points` with no
  `positions`/`scales`/`orientations`/SH arrays.
- `SOL10.usd` references an **absent** `SubUSDs/` directory, so it cannot be a bundle fixture.
  `tests/fixtures/make_bundle.py` builds a synthetic equivalent instead.

## Conventions

- **TDD.** Write the failing test, run it, capture the RED output, implement, capture GREEN.
  A test that cannot fail is not a test.
- **One short transaction.** Use `db.transaction()` (`BEGIN IMMEDIATE`). The version check and the
  mutation belong in the **same** transaction — a read outside it lets two concurrent requests
  both pass the check.
- **No `extractall()`.** Extract ZIP members one at a time with per-member streaming limits.
- **Keep it proportional.** Raw SQLite, filesystem storage, one worker, polling, vanilla
  TypeScript. No new abstraction layer, wrapper, or config option nobody asked for.
- **No secrets in test output.** A test that prints a real secret is a leak.
- **Commit message** style in this repo: `Add capability-link projects`,
  `Fix review findings in the Task 1 pilot skeleton`.

## Definition of done for a task

1. Failing tests written first; RED captured.
2. Implementation; GREEN captured.
3. The full gate passes: `pytest -q`, `npm.cmd test -- --run`, `npm.cmd run typecheck`,
   `npm.cmd run build` — all exit 0, **no regression** in the 43 existing backend tests.
4. Committed with `git add src/nemy_web tests web/src` and a one-line subject.
5. `git status` clean. Nothing under `data/` committed. `src/nemy_web.egg-info/` is gitignored.

## Blockers

**Nothing in Tasks 3–4 is blocked.** Task 5's *real* conversion, Task 6's visual fixture check,
and Task 7's benchmarks need the target GPU PC (Rust toolchain + NVIDIA GPU). Everything else is
buildable and testable on the development host, using a fake converter executable where the plan
calls for one.
