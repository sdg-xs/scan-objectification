## Recorded Z poses and library asset assignment — 2026-10-28

User approved automatic position/Z-only rotation estimation with later manual asset correction. Each SAM element now records its bounding center and dominant XY heading after source-up/centering, relative to scanGroup. Circular/symmetric selections are explicitly uncertain; angles are modulo 180°. Source-up changes recompute poses; later scan alignment carries instances through their common parent. Assign Asset cube-plus icons precede eyes on element/layer rows. A layer snapshots its current members and places one asset per element. The modal picker searches the existing library catalog/category list, exposes recorded poses, up-axis/unit options and Z correction. Update existing asset rotation affects the requested scope without overwriting detected headings.

New read-only /api/local/assets gateway proxies the separately owned local library service on 3001. It resolves explicit mesh/IFC geometry plus source-reference fallback, validates source fingerprint/membership, bounds transport, rejects cross-origin requests/redirects and never forwards capabilities. Browser IFC extraction runs in a terminable worker using existing web-ifc. Model normalization keeps dimensions, converts up axis, centers geometry and aligns its dominant horizontal direction with X before placement. Original scan remains intact. Shared templates avoid duplicate geometry; reassignment replaces occurrences, failed loads preserve prior assignments, stale source/indices abort work, visibility/section clipping and deletion lifecycles are synchronized. Records/placements remain session-only.

TDD RED captured for pose/gateway/Assign Asset scope and georeferenced precision regression. Review caught Float32 precision loss before centering; fixed by composing translation removal in doubles before storage. Actual IFC smoke found FlatMesh.delete missing despite typings; cleanup now checks runtime support. scripts/verify-library-asset.mjs reruns the real gateway/extractor/normalization check. Verified a catalog definition with 21 parts and 70,528 triangles, finite bounds ~1.371 × 1.110 × 1.336 m. Full gate: 76 backend +96 frontend tests, typecheck/build pass. Reviewer reports precision fix correct and no further important findings. Real browser placement/accuracy is unverified under the existing viewer-origin permission restriction.

Started existing asset.library production Node service on 127.0.0.1:3001 (exec session 6857), preserving its catalog/source files. Restarted viewer API on 8767, PID 39824 (session 27603), to register gateway. SAM ports 8766/8768 were not repurposed. Unrelated build-check.log preserved. No dependency changes.

## Delete element records while preserving geometry — 2026-10-28

User requested extending Delete to element rows while preserving associated mesh/splats. Reused SegmentCollection.remove(id), which removes only the session record. Click/Ctrl/Shift element selection clears the container delete target and enables the existing toolbar Delete icon. Confirmation explains that records/classification are removed, geometry is preserved and splats return to unsegmented context following Unclassified visibility. No contained-element destination is offered for this operation. Clicking a group/layer heading explicitly retargets Delete to that container with its original reassignment options. Successful removal clears highlight and repaints visibility/colors. New SAM results and source replacement invalidate pending deletion.

Three controller tests cover multi-element removal, Cancel, classified and Unclassified entries, preserved layer and other elements, re-detection of the same source indices, restoring container confirmation controls and stale-dialog cancellation. Two tests captured RED before implementation. Existing model tests already verify record removal restores context visibility. Independent review found no important issues. Full gate passes: 87 frontend tests, 71 backend tests, typecheck and production build (existing optional WebGPU/bundle warnings). HTTP 200 confirms the running API serves the updated confirmation markup. Real browser interaction remains unverified under the earlier origin permission denial. Unrelated build-check.log preserved.

## Element moves and row selection — 2026-10-28

Element checkboxes are removed. Click selects one row, Ctrl/Meta+click toggles individuals, Shift+click selects the inclusive visible range from the anchor; Ctrl/Meta+Shift adds a range. Collapsed, filtered-out and model-hidden objects are excluded from ranges. Rows highlight through data-selected and expose their selection state through aria-description. Neutral group semantics preserve editable name/eye controls; review caught and removed incompatible listbox/option roles. Enter/Space and arrow keys support keyboard selection; Escape clears selection. Eye controls remain independent.

Target Layer now offers Move between Classify and Unclassify. Move validates the whole selection before changing layer IDs, preserving element names, source IDs, visibility and numbering counters. It reveals the destination and clears selection afterward. Add Group/Add Layer exposes an assignment option when elements are selected, checked by default for Unclassified selections. A group with assignment creates a first layer. Naming confirmation then classifies into the new layer; cancelling naming preserves the newly created containers and leaves objects unchanged. Invalid first-layer names cannot create a partial group. New SAM results close stale creation dialogs.

TDD RED captured before implementation. Verification: 84 frontend tests, 71 backend tests, typecheck and production build pass (existing optional WebGPU/bundle warnings). Real viewer interaction remains unverified under the existing local-origin browser permission denial. Unrelated build-check.log is preserved.

# Session Handoff: USD Gaussian Splat Web Segmentation

## Confirmed capture-dimension loss — 2026-10-28

User supplied the diagnostic: mask 1600×721, capture undefined×undefined. This identifies the actual cause that the earlier decoder change did not address: `parseLightResult` returned `{ ...frame }` with a real HTMLCanvasElement. Canvas width/height are prototype accessors, omitted by object spread even though TypeScript treats the return as LightResult. Replaced spread with explicit width/height reads and documented why. Kept the validated raw bitmap decoder and independent Target Layer window unchanged.

New parser regression uses inherited 1600×721 getters and reproduced undefined dimensions before the fix. Updated the controller capture fixture to prototype getters instead of a plain object; it also reproduced the blocked selection before the fix and now projects the expected label pixels. This corrects the earlier test fixture blind spot. Independent review confirmed the fix with no findings. Full gate: 71 backend tests, 76 frontend tests, typecheck and build pass, with existing optional WebGPU/bundle warnings. Unrelated build-check.log preserved.

## Selection-mask decoder and independent Target Layer window — 2026-10-28

User reported “The selection mask does not match this view.” That message came from comparing HTMLImageElement.naturalWidth/naturalHeight against the capture during mask application. The API already validates each PNG's IHDR dimensions against the capture. Reproduced the rejection in a controller test where HTML image intrinsic dimensions differ from a valid 2×1 PNG; this is a synthetic reproduction, not proof of the exact cause in the denied user browser. New `selection-mask.ts` validates the PNG header/frame, decodes directly with createImageBitmap (no orientation/color conversion/premultiplication), checks bitmap pixel dimensions, reads an unscaled canvas mask and always closes the bitmap. Genuine mismatches still reject with actual/expected dimensions; no stretching fallback was added. Instance labels and stale/abort guards remain unchanged.

User also requested Target Layer as an independent window at bottom middle. Moved Target Layer/Classify/Unclassify outside Model Browser into a bottom-center floating panel. On compact viewports it docks right, section/Fit controls stack above, and the browser ends above that control area; a minimum viewport height keeps controls reachable. The picker still uses its measured top-layer drop-up. Choosing a target also opens a collapsed Model Browser so active layer/group highlighting is visible. Model and naming behavior are unchanged.

RED captured for the mask projection rejection and old picker containment. Focused tests now cover raw pixel projection, genuine PNG/frame mismatch, decoded mismatch, bitmap cleanup and independent picker/reveal behavior. Independent review found no confirmed important issues and explicitly notes the actual browser cause remains unproven. User must reload and run a fresh Capture & detect to verify their real scene; browser visual inspection remains restricted. Unrelated build-check.log preserved.

Full gate passed: 71 backend tests, 75 frontend tests, typecheck and production build, with existing optional WebGPU/bundle warnings. The running API serves the independent Target Layer markup with HTTP 200. No GPU/worker inference changes were required.

## Target Layer, named classification and direct startup — 2026-10-28

Resumed the pending bottom Target Layer UI. A small `TargetLayerPicker` module presents grouped layer choices upward in a native top-layer popover, with keyboard navigation, outside-click/scroll dismissal, Escape/Tab and resize handling. Its viewport-measured position/height avoids clipping by the full-height panel. Active choice synchronizes with inline layer markers, reveals the layer and highlights its parent group. Container selection for Delete remains separate.

Classify/Unclassify now sit below Target Layer. SAM accepted instances remain selected in Unclassified; element checkboxes permit later reselection. Classify opens one editable name field per selected element, defaulting to `Layer Name 01`, `Layer Name 02`, etc. Each layer tracks its next sequence number. Confirm validates the entire batch before changing names/membership and advancing the counter; Cancel/invalid input consume no numbers. Classified elements appear beneath their layer with a distinct mesh icon; Unclassify preserves names and source IDs. Naming is cancelled on source replacement or new SAM results. These remain source splat sets, not converted triangle meshes.

The user requested removing the initial hyperlink screen and showing “Model meets reality” at startup. Existing uncommitted changes to web/index.html already added a redirect and tests/test_entrypoint.py checked it; completed that work by removing the residual hyperlink and extending the test. The unrelated pre-existing build-check.log is preserved. No backend/SAM runtime change was made.

Verification: RED captured for missing picker/naming UI, atomic classification/default numbering and remaining startup hyperlink. All 71 backend and 70 frontend tests pass, plus typecheck and production build (existing optional WebGPU/bundle warnings). Controller tests cover target synchronization, Escape/outside dismissal, keyboard selection, top-layer geometry, editable naming/classification, Unclassify, cancellation, default-number continuation, invalid names and source replacement. Independent review found a clipping risk, fixed using the measured native popover, then reported no remaining important findings. Actual local browser visual interaction remains unverified under the earlier origin denial. API was not running after the overnight pause; restarted it at 127.0.0.1:8767 (PID 23400) for serving the build. Startup launches no SAM inference.

## Functional Model Browser creation/deletion — 2026-10-27

User requested making Add Group, Add Layer and Delete functional and testing them. Regressions reproduced: creation controls/fieldsets and Delete depended on a loaded mesh; new items could be hidden by a filter; first-source reset dropped any prepared hierarchy. Controls now work independently of a scan. Creation clears the filter, expands Root/the parent group, selects the created container and opens the browser. First scan attachment preserves prepared groups/layers/active ID and unique IDs; replacement still resets the hierarchy. Blank-name errors appear inside the creation dialog. Delete cancellation/confirmation works without a scan; a stale queued close event cannot clear an immediately reopened deletion prompt.

Eight new controller tests drive the real SegmentPanel event handlers against a small DOM boundary fixture, with renderer dependencies mocked and initial controls read from real viewer.html. They cover creation, filter visibility, active marker, cancellation, layer/group deletion, destination exclusion, first-scan attachment, invalid-name recovery and immediate dialog reopening. A new model test verifies preserved hierarchy/unique IDs. RED captured before fixes; frontend now has 60 passing tests. Independent review found no important correctness issues. These are automated controller tests, not real-browser interaction tests; prior local-origin browser denial still limits visual verification.

Full gate passed: 70 backend tests, 60 frontend tests, typecheck and production build. Existing optional WebGPU/bundle warnings remain.

## ReCap-style layer list below Filter — 2026-10-27

User requested replacing all visible content below Filter with Unclassified, then Root containing groups/layers. Target Layer, Classify/Unclassify/Clear controls, status/session notes and individual object rows are hidden from the current UI; model functionality and hidden operation bindings remain. Groups retain visibility; layer rows show name, color swatch, active-layer marker and visibility. Choosing active layer only updates the existing target ID and never assigns objects. Group reparent selector is retained hidden. Existing create/delete toolbar is unchanged. Root uses the existing classified visibility; Unclassified controls its original visibility. Filtering keeps both top rows and searches group/layer/object names.

User restored the open native ReCap window for reference. CUA read-only screenshot of ReCap Mesh Editor established the four-shape Unclassified icon, checked-shape classified root, stacked-sheet group, slanted surface layer, color swatch, framed active-layer symbol and eye order. These symbols were redrawn as local SVGs. No ReCap changes were made. The local web viewer remains visually unverified under its existing origin access denial.

User then requested the browser/list stay expanded down to the bottom even when empty. The open panel is anchored 70px from the viewport top and 58px above the bottom, leaving room for the footer. Toolbar/filter stay fixed while the bordered list fills remaining height and scrolls independently. The panel can still collapse. Section-box controls and Fit all now form a bottom-right stack, with section controls above Fit all and a 12px gap. The black viewport and theme remain.

On viewports at most 760px wide, reserve the bottom control area by ending the panel 230px above the bottom and scroll the panel body, so Section/Fit all remain reachable. Independent layout review identified the overlap before this compact rule was added. Verification: 70 backend tests, 51 frontend tests, typecheck and build pass. Existing optional WebGPU/bundle warnings remain. Final layout has not been visually inspected in the denied local viewer.

## Model Browser toolbar and reference theme — 2026-10-27

The user clarified that unsegmented-context functionality should be retained, only hidden. Restored `contextVisible`, its reset/binding and the context checkbox under a hidden label. Toolbar order is Add Group, Add Layer, Delete, then original/classification color toggle, using icons and tooltips. Creation uses dialogs. Click or keyboard-focus a group/layer heading to select the Delete target. Confirmation preserves objects and offers Unclassified or another surviving layer. Group deletion explicitly removes its layers; no destination inside the deletion is allowed. Legacy model removeGroup/removeLayer methods and object removal remain available. Target-layer and object selection behavior are retained.

Viewer colors/fonts follow the user's local `asset.library`: local Poppins weights 400–800, white panels, navy header and blue accents. Theme overrides contain no layout changes. User then requested a black model field; viewport background and renderer clear color are black. Browser visual inspection remains unavailable under the existing origin denial.

Verification: model tests captured RED before restoration/deletion implementation; full gate passes with 70 backend tests, 51 frontend tests, typecheck and production build. Existing optional WebGPU/bundle warnings remain. All five copied font files match the reference hashes, and the API serves Poppins with HTTP 200. Independent review found no important correctness issues.

## Floating SAM workspace — 2026-10-27

SAM now opens as a nonmodal floating window at the top-right of the model viewport. Context is focused immediately, with Capture & detect current view directly underneath. The viewer remains live for camera adjustments before capture and during result review. Each button click captures a fresh frame; there is no continuous inference. Rendering pauses only during inference/projection and resumes on completion, failure or close. Escape while focused inside the window closes it. Existing frozen-camera selection, source-revision guards and same-origin API/cloud boundary remain in place. Applying matches closes the window for classification in Model Browser. This supersedes the modal pause behavior described below.

Verification: captured four failing controller tests before implementation; all five controller tests now pass, covering nonmodal opening, focus, fresh captures, failure recovery, cancellation and empty context. Full gate: 70 backend tests, 47 frontend tests, typecheck and build pass, with existing optional WebGPU/bundle warnings. The running API serves the updated viewer HTML (HTTP 200, context and current-view action present). Independent review found no important correctness issues. Visual layout remains unverified because the local browser origin access is denied.

## Warm SAM runtime and cloud boundary — 2026-10-27

User approved caching the SAM model and pausing viewer rendering, and clarified that cloud processing will be used later. The worker now reuses one predictor, creates/clears frame state per request, unloads after 120 idle seconds, and clears the cache on failure or graceful shutdown. Idle timers are generation-guarded and serialized with inference. The upstream constructor's autocast is exited immediately; each request enters its own bfloat16/inference context so threadpool reuse is safe.

The viewer pauses its animation loop while the SAM modal is open, renders captures explicitly, and resumes on closing. A same-origin `/api/local/sam-status` gateway exposes busy/phase/model-loaded state without starting inference. Validated result timings distinguish model load, frame setup, detection, other processing and total; projection duration is shown after application. The browser has no worker URL or credentials. Future cloud transport, authentication and job handling remain server-side work; no cloud processing was added.

Verification: 70 backend, 42 frontend and 7 separate-runtime worker tests, typecheck and build pass. Independent review found no blocking issues. Three consecutive real API requests on a generated blank 512×512 image verified cold then warm reuse: end-to-end 43.834s, 0.545s and 0.581s; warm requests reported zero model-load time. This is a cache-path diagnostic, not a ceiling-scene accuracy or production-speedup benchmark. Actual idle unloading was also verified through the status API. Browser render/poll interaction remains unverified due the existing origin access denial. During this work the user created commit `1c4eec0` (`Test Commit`), containing most implementation changes; preserve it and commit only remaining updates.

## Model Browser, groups and classification layers — 2026-10-27

SAM moved to visible sidebar slot 02; the previous Asset section is temporarily hidden, and alignment is 03. The user supplied Autodesk's `select-and-classify-mesh-surfaces` tutorial as the UI reference. The top-left floating **Model Browser** adapts its Unclassified/Classified tree with groups containing layers, separate Target Layer, Classify/Unclassify, selection checkboxes, editable names, visibility controls, filter and optional layer-color tint. Each checked SAM instance enters Unclassified and is selected; the user explicitly assigns it to a target layer. Changing selection leaves the target unchanged. Root/group/layer/object visibility preserve child settings. Removing layers unclassifies their objects; removing groups keeps their layers; removing objects returns IDs to unsegmented context. Membership is exclusive: new objects take overlapping IDs. Scan replacement resets records/filter/resources; alignment preserves membership. Records remain session-only, with no export, mesh conversion or full depth-resolved extraction.

The user also requested compact icon controls with delayed hover tooltips. Classification, creation, target, visibility, context/color and removal controls use locally authored SVG icons with native browser-delayed `title` tooltips, accessible labels and keyboard focus states. No external icon library or copied Autodesk asset is used.

REA/Ghidra statically inspected the installed ReCap 27.0.1.242 classification DLL; details and evidence identity are in `docs/research/2026-10-27-recap-classification.md`. The permitted Autodesk tutorial tab's transcript and visible video image established the more specific mesh Model Browser reference. The viewer uses its own code and SAM, not Autodesk's classifier. Projection preserves instance labels in one pass and excludes IDs hidden by visibility controls. An independent Spark RGBA modifier handles visibility and optional tint alongside section masking/highlights. Tests: 68 backend and 41 frontend pass, plus typecheck/build; focused independent review found no blocking issues. Local viewer/GPU interaction remains unverified because its origin inspection is denied; external reference access did not bypass it. Unrelated staged files are preserved.

## SAM custom-object workspace — 2026-10-27

The user confirmed light detection works and requested arbitrary element context plus selection. **Open SAM workspace** now opens the dialog before inference, with a 240-character visual description, explicit Capture & detect, individual numbered match checkboxes and an explicit replace-selection action. The local API validates/echoes the prompt and returns individual binary PNG masks. Existing light defaults remain available to older API callers. Selection reuses stable source IDs and projects centers into chosen masks using frozen camera/section state, rejecting stale scan/selection state. Closing cancels pending publication. This selects through depth, so hidden splats can be included; use section clipping and manual refinement. No full 3D reconstruction or export.

A real custom-prompt API request for `rectangular air vent` completed using SAM 3.1 on the generated blank image, with the correct echoed prompt, custom group and valid overlay. No real-object accuracy claim follows from a blank-image test. Verification passed: 68 backend tests, 35 frontend tests, 5 separate-runtime worker tests, typecheck and production build. Browser visual inspection remains denied; the user will verify the workspace and scan alignment. Focused independent review found no blocking issues.

## SAM 3.1 current-view lights — 2026-10-27

The user explicitly authorized adding SAM detection to the existing viewer, superseding the original Build 1 segmentation exclusion for this feature. **Find lights in this view** captures the rendered scene directly, calls same-origin `/api/local/lights`, and shows a frozen annotated image plus counts for linear, round and bulb lights. Visible layers and clipping are respected; results do not select 3D splats. The separate `.venv-sam31` worker uses the actual local SAM 3.1 checkpoint, starts automatically on 8768 and leaves 8766 alone. Application pins and CSP are unchanged.

Verification: 60 backend tests, 32 frontend tests, 4 separate-runtime worker tests, 2 PLY-tool tests, typecheck and build passed. A real request through the API completed on a generated 512×512 blank image, returned model `sam3.1`, three zero-count groups and a valid overlay. Independent review found no blocking issues. Actual ceiling accuracy, captured orientation and dialog appearance remain unverified because the browser origin gate denied inspection; no alternate access bypass was used. The user can now test directly in the app after reloading, selecting models and re-aligning the view. Runtime setup, checkpoint, logs and smoke artifacts remain gitignored under `data/` and `.venv-sam31`.

## Latest milestone — 2026-10-27

Completed the pending section-box rotation work on `feat/bim-gaussian-viewer`. Rotate mode uses colored rings; face resizing follows local axes. IFC planes, Spark masking and Gaussian selection share the oriented box. Reset clears rotation. The production viewer loaded the actual BS17 IFC and aligned PLY in Chrome; a tilted cut selected 3,261,847 of 4,778,721 splats without a viewer error. All 43 backend, 28 frontend and 2 PLY-tool tests pass, plus typecheck and build. Disabling the rotation math caused both rotation tests to fail; restoring it returned the frontend suite to green. Existing Fragments optional WebGPU and bundle-size build warnings remain. Unrelated staged agent/worktree and research files are outside this change.

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
