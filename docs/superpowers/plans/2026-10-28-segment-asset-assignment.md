# Segment asset assignment implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record element center and Z heading, assign catalog geometry per layer/element and allow later Z corrections without altering scan geometry.

**Architecture:** Read-only same-origin gateway to the existing localhost asset-library API. Load its representative mesh/IFC geometry on demand, normalize to a centered Z-up dominant-X basis and render shared Three.js geometry as occurrences under the scan alignment group. Element metadata stores scan-local pose and assignment/correction.

**Tech Stack:** Existing Python/FastAPI, vanilla TypeScript, Three.js, web-ifc; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-28-segment-asset-assignment-design.md

## Constraints

Preserve source geometry, dependency pins, same-origin CSP and existing container/element deletion behavior. Session-only metadata matches current classification lifecycle. Rotation detection and correction are Z only; no silent scaling. Existing library source service remains owner of catalog/files.

## Tasks

- [x] Add failing pose tests for translated/rotated linear points and symmetric shapes. Implement center/bounds and XY covariance heading/confidence in element-pose.ts; store recorded metadata after SAM segmentation and overlap changes.
- [x] Add failing backend tests for bounded catalog resolution, explicit mesh and IFC/source-reference fallback, missing geometry and source revision checks. Implement asset_library.py under create_pilot_app with read-only fixed loopback service endpoints.
- [x] Test geometry validation, centered dominant-X normalization, per-element placement/correction and instance lifecycle. Implement asset-geometry.ts, IFC worker and placed-assets.ts using existing Three/web-ifc dependencies.
- [x] Add Assign Asset icons immediately before layer/element eyes. Implement searchable assignment/correction dialog, batch snapshot/stale-source guards, visibility synchronization and deletion cleanup. Add controller tests for callback scopes and panel operations.
- [x] Run full gates, independently review, update handoff/README, serve build and commit scoped changes. Do not bypass the viewer browser access denial.

## Review focus

Round shapes have ambiguous heading; normalize deterministic modulo-180 angles and label uncertainty. Source IFC original building placement must not move an occurrence to a remote location. Reject stale async loads and dispose temporary geometry. Preserve previous placements on failed assignment. Unclassified, group/layer/element visibility and overlap updates must also update placed geometry.

## Results and implementation rulings

Implemented session-only poses and assignments. The asset picker uses a native searchable/category-filtered list and pose preview; standalone catalog rendering was not copied into this vanilla viewer. The library’s existing service remains a separate read-only data source on 3001. It was started for integration verification.

Review reproduced small geometry collapsing at georeferenced IFC coordinates. The regression failed first; normalization now removes original building translation in double precision before Float32 conversion. Real IFC smoke testing also found FlatMesh.delete absent despite installed typings; cleanup now checks actual handle support. Shared extraction is used by both browser worker and the rerunnable smoke script.

Full gate: 76 backend +96 frontend tests, typecheck/build passed. A real catalog asset resolved through the gateway and extracted 21 parts/70,528 triangles with finite centered bounds (~1.371 × 1.110 × 1.336 m). No real viewer/scene visual test was performed because the earlier origin permission restriction remains.
