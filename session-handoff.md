# Session Handoff: USD Gaussian Splat Web Segmentation

## Latest milestone — 2026-10-26

The viewer now also has an interactive section box: enable it in the viewport, drag face grips in Resize mode or axis arrows in Move mode, and use Reset box to refit. Three.js controls/planes, Fragments culling and Spark box masking share one world-space box. Source files are unchanged. Playwright verified face cuts, movement, cancellation/navigation recovery and disabling; current gates pass with 43 backend, 21 frontend and 2 PLY-tool tests. The saved `test_files/BS17-PLY-aligned.ply` contains the earlier translation (17, 5.9, -3); it is gitignored.

The user changed the immediate priority to a local IFC + Gaussian PLY viewer. It is implemented on `feat/bim-gaussian-viewer` at `/viewer.html` using That Open Fragments, Three.js and Spark. See `README.md` and `docs/superpowers/plans/2026-10-26-local-bim-gaussian-viewer.md` for setup and verification. Both actual BS17 files rendered in Chrome under production CSP. Controls include orbit/pan/zoom, visibility, framing and manual scan alignment. Files and alignment are session-only; no backend upload or persistence was added. USD Tasks 3–7 below remain pending. Existing dependency pins are unchanged, new IFC dependencies have exact pins, and test files are gitignored.

Source session: [Reverse engineer Nemy asset metadata](https://chatgpt.com/s/cx_6ad7ed3544c081919cf54f6a1746f86f)

Date captured: 2026-10-21
Verified against the repository: 2026-10-21

## Purpose

This document captures the useful context from the shared ChatGPT session so it can be continued or handed to another AI.

## Original reverse-engineering task

The session began by reverse-engineering the local package:

`C:\Users\JoshuaRetuta\Documents\TRANSITION TO 3js\Source Code\nemy.asset_metadata_property-0.5.0`

The requested review covered architecture, entry points, components, execution flow, algorithms, hidden behavior, networking and storage, security, refactoring, Mermaid diagrams, and reimplementation pseudocode.

## Reverse-engineering findings

- The package is a Python extension for NVIDIA Omniverse Kit/Composer, backed by USD and NumPy.
- It adds asset metadata to selected USD prims and provides Gaussian-splat selection using box selection, viewport paint/erase, and text-guided image masks.
- The active AI path captures up to three viewport angles, sends images and prompts to a local SAM3 service, projects Gaussian centers into each camera, associates detections across views, and allows review/merge before extraction.
- Extracted selections are copied into new USD prims under `/World/Objectified`; the original geometry is not cropped in place.
- The active local service uses `127.0.0.1:8766`, `GET /health`, and `POST /segment`.
- The service accepts PNG image data, a prompt, and thresholds, then returns packed instance masks. SAM3 requires locally available model weights.
- The implementation uses stage-event subscriptions, USD change notices, UI callbacks, asyncio tasks, and next-frame updates. There is no gameplay loop.
- Important limits include three capture views, 50 detected instances per view, 1600-pixel capture resizing, 2048 pixels per side, 4 million pixels total input, and a 40 MiB response limit.
- The local service has no authentication. A later hosted version should add project-link protection and service authentication.

## Product direction selected during brainstorming

The target is a browser-based version of the workflow, initially focused on one pilot user running everything on one GPU PC.

The selected product flow is:

1. Open a browser on the GPU PC.
2. Load an existing USD Gaussian scene.
3. Segment objects with SAM3.
4. Refine selections manually across multiple views.
5. Save extracted USD objects and review state.
6. Download a self-contained USD package.

## Decisions and constraints

### First release

- Static USD Gaussian scenes first; animated scenes are unsupported initially.
- Match geometry, transforms, color, scale, and opacity; minor renderer differences are acceptable.
- Support USD uploads and require self-contained uploads with all dependencies included.
- Use three capture slots: A, B, and C.
- Keep the clear 50-detection-per-view limit; users can use smaller views and repeat segmentation.
- Support multiple views plus manual refinement for hidden surfaces.
- Include the current asset metadata fields and dropdowns for extracted objects.
- Allow stage-derived dropdown choices plus custom entries when needed.
- Save the latest revision only; no revision history for the pilot.
- Restore captures, prompts, masks, edits, groups, selections, cameras, and metadata when reopening a project.
- Jobs and uploads should continue on the GPU PC if the browser tab closes, with status available on reopening.
- Provide a self-contained downloaded USD package that works without the web app or original upload.

### Access model

- No sign-in for the pilot.
- One person uses the system at a time.
- The browser and services run on the same GPU PC.
- A hosted/no-sign-in version may later use an unguessable project link.
- Future multi-user support can be added after the pilot is stable.

### Scope boundaries

- Metadata editing applies to newly extracted objects, not the uploaded source prims.
- The source scene remains unchanged.
- Concurrent multi-user editing is out of scope for the pilot; revision checks can protect against accidental edits from two browser tabs.

## Proposed technical direction

The selected architecture direction was:

`Three.js / Spark + Python / OpenUSD + GPU SAM3`

Likely responsibilities:

- Three.js/Spark: browser rendering, large-scene viewing, selection overlays, camera controls, and interaction.
- Python/OpenUSD: USD validation, conversion, extraction, metadata, and downloadable package generation.
- GPU SAM3 service: image segmentation and packed mask generation.
- Browser UI: capture workflow, mask review, manual refinement, object grouping, metadata, save, and download.

For large scenes (millions of splats) or multi-gigabyte files, the implementation must use streaming, resumable upload/processing, compact source identities, and a GPU benchmark on the target machine.

## Approved specification and plan

The written foundation specification was approved after revision. The session reported these commits:

- Revised foundation spec: `f504b27`
- Approved design and implementation plan: `f721aa2`
- Earlier foundation-spec revision: `379ca61`

The implementation plan contains seven milestones covering project links, resumable uploads, USD validation, source identities, Spark conversion, Three.js viewing, protected streaming, recovery, deletion, and the representative-scene benchmark.

The session then selected **subagent-driven development** and began execution. The session's own final report described edits to `progress.md` and the implementation/design files.

**Correction (2026-10-21, verified in the repository):** implementation had not actually started. `progress.md` does not exist in the working tree, in any branch, in the stash, or in the reflog; `git fsck` finds no dangling objects. All 56 plan checkboxes are unchecked, and no `src/`, `web/`, `tests/`, or `pyproject.toml` exists. The repository contains only the two committed documents plus the gitignore. The starting point for the next AI is therefore **Task 1, Step 1**, not an in-progress milestone.

## Important files mentioned

- `docs/superpowers/specs/2026-10-20-usd-web-segmentation-foundation-design.md`
- `docs/superpowers/plans/2026-10-20-usd-web-segmentation-foundation.md`
- `extension.py`
- `crop_tool.py`
- `mask_views.py`
- `mask_multi.py`
- `mask_geometry.py`
- `mask_objects.py`
- `mask_correspondence.py`
- `mask_io.py`
- `mask_server.py`
- `sam3_service.py`

## Next action for another AI

**Start from the continuation plan, not Task 1.** Tasks 1 and 2 are complete, committed, and
reviewed clean. The work that remains is Tasks 3 through 7.

1. Read `docs/superpowers/plans/2026-10-22-usd-web-segmentation-continuation.md`. It supersedes
   the original plan for Tasks 3-7 and carries forward every decision Tasks 1 and 2 established.
2. Read the SDD ledger at
   `.superpowers/sdd/2026-10-20-usd-web-segmentation-foundation/progress.md`. It holds the
   pre-flight scan, every ruling, the per-task log, the deferred-minor list, and the parked
   findings. **Trust it over any recollection** — it is the only record of what was decided.
3. Resume at **Task 3** (resumable upload and safe bundle staging). It has not been started:
   its previous implementer was cancelled before writing any implementation.
4. Continue with the subagent-driven workflow, preserving the pilot constraints above. Do not
   expand to authentication, multi-user collaboration, animation, or revision history unless
   explicitly requested.

### The two things most likely to be got wrong

- **Route registration.** The frontend is `app.router.default`, never a `Mount`. New routers go in
  `create_pilot_app()` next to `projects.router` — *not* inside `create_app()`. A router included
  inside `create_app()` breaks Task 1's reviewed tests.
- **The CSP.** `script-src 'self' 'wasm-unsafe-eval'` is required; both pinned WASM dependencies
  break without it. This was proven in a real browser against a real production bundle.

## Corrections applied to the plan and spec (2026-10-21)

The handoff and the committed plan contained defects that were verified against the repository, the sample assets, and the host toolchain. These are now fixed in the documents:

- **Port collision.** `NEMY_PORT` defaulted to `8766`, the port the existing SAM3 mask service already binds. The API now uses `8767`; the SAM3 service is untouched.
- **Acceptance scene.** No scene above 50 million Gaussian splats exists on the pilot machine. The target is now the measured 6,366,784-splat `SOL10_OUTDOOR_1.usd`, with the measured memory baseline recorded in the plan and spec. The 50-million figure survives only as an explicitly unmeasured scaling note.
- **`.gitignore` leak.** `.env.*` also matched `.env.example`, so Task 1's commit step would have failed; `/data/` was not ignored at all, so the SQLite database and `data/server-secret` could have been committed. Both are fixed.
- **Prerequisites.** The plan now records that the development host has no Python 3.12, no Rust toolchain, and no NVIDIA GPU, that `npm` must be invoked as `npm.cmd`, and that the Spark npm package ships no `build-lod` binary while release `v2.3.1` publishes zero assets.
- **Bundle fixture.** `SOL10.usd` references a `SubUSDs/` directory that is absent from the pilot machine, so it cannot be used as a local-reference bundle fixture as-is.

## Session status at handoff

**Updated 2026-10-21 (evening).** Tasks 1 and 2 are complete, committed, and reviewed clean.

| Commit | What |
|---|---|
| `67871f5` | Correct foundation plan defects found during handoff review |
| `f328023` | Bootstrap local USD web pilot (Task 1) |
| `7444a36` | Fix review findings in the Task 1 pilot skeleton (Task 1 fix round 1/5) |
| `89f2c63` | Add capability-link projects (Task 2) |
| `2a86931` | Add continuation plan for foundation tasks 3-7 |

Task 1: 22 tests, review clean after one fix round (1 Critical + 3 Important + 4 Minor, all
addressed and independently re-verified). Task 2: 43 backend + 9 frontend tests, review clean on
the first pass (spec ✅, quality Approved).

Task 3 is **not started** — its implementer was cancelled before writing any implementation. Only
`tests/fixtures/make_bundle.py` survives, and it is committed.

The original plan's Task 1 Step 1 is superseded. The authoritative entry point for remaining work
is `docs/superpowers/plans/2026-10-22-usd-web-segmentation-continuation.md`.

**Blockers requiring the target GPU PC:** no Rust toolchain (so `build-lod` must be built from a
source checkout of Spark `v2.3.1`) and no NVIDIA GPU. Task 5's real conversion, Task 6's visual
fixture check, and Task 7's benchmarks are target-PC work; everything else is buildable here.
