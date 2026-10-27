# Current-view light detection implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, with a final independent review.

**Goal:** Let the viewer capture its current view and find lights locally with SAM 3.1.

**Architecture:** Same-origin FastAPI route forwards bounded PNG requests to an automatically started loopback inference worker. The worker runs in the separate existing SAM environment. A frozen in-app image presents masks and counts without implying 3D extraction.

**Tech stack:** Existing FastAPI, vanilla TypeScript, Three.js/Spark, Python stdlib transport; Torch/SAM/Pillow only in `.venv-sam31`.

**Spec:** `docs/superpowers/specs/2026-10-27-view-lights-design.md`

## Global constraints

- Preserve every current package pin, CSP token and existing project route.
- New router belongs only in `create_pilot_app()`.
- API 8767, SAM 3.1 worker 8768; leave 8766 alone.
- PNG maximum 1600 pixels per side, 8 MiB input, 16 MiB response, 50 instances per category.
- No external image transmission, credentials in the browser, model downloads during detection, source-model edits, or implied 3D isolation.

## Review focus

- Correct capture orientation, aspect and same-frame readback with `preserveDrawingBuffer` disabled.
- Failed/canceled requests, stale results and repeated requests restore usable controls.
- Arbitrary origins, malformed/truncated PNGs, oversized streams and malformed worker responses are rejected.
- Worker concurrency and failures release GPU resources and temporary captures.
- Vite proxy and production route both use the same-origin API without relaxing CSP.

## Task 1: Local API and worker

- [x] Write and run failing tests in `tests/test_lights.py` for a real local HTTP proxy, origin/body validation, unavailable worker and invalid responses.
- [x] Add `src/nemy_web/lights.py`, result schema, fixed loopback transport and bounded automatic worker startup. Include its router in `create_pilot_app()`.
- [x] Add `scripts/sam31_service.py`: injectable engine, decoded-image validation, serialized actual SAM 3.1 inference, combined mask/box PNG and cleanup. Handle the known upstream session-wrapper mismatch without modifying installed source.
- [x] Run API tests green and worker tests with `.venv-sam31`.

## Task 2: Capture and in-app results

- [x] Write and run failing tests in `web/src/light-detection-model.test.ts` for capture aspect/limits and validated same-frame response metadata.
- [x] Add `light-detection-model.ts` and `light-detection.ts`; integrate a button, frozen-view dialog, cancellation and counts into the current viewer design.
- [x] Render and copy the current WebGL frame synchronously before PNG encoding; preserve live scene/camera state and omit separately rendered section gizmos.
- [x] Run frontend tests, typecheck and build green.

## Task 3: Real integration and delivery

- [x] Run a real SAM 3.1 request through the app API with a generated diagnostic image; verify model identity, dimensions, result groups and annotated PNG.
- [x] Run backend/frontend suites, typecheck, build and PLY-tool tests. Obtain a focused independent review and fix important findings.
- [x] Update README/handoff with actual behavior, setup, reload requirement and any unverified visual accuracy.
- [x] Commit only this feature's files, preserving unrelated staged changes.

Verification limitation: browser-origin access was denied, so actual ceiling capture orientation, dialog appearance and real-light accuracy require user testing. The real model/API smoke used a generated blank image. Independent code review found no blocking issues.
