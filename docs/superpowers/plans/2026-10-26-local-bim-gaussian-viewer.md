# Local BIM and Gaussian Viewer Implementation Plan

**Goal:** Open local IFC and Gaussian PLY together in one navigable scene.

**Spec:** `docs/superpowers/specs/2026-10-26-local-bim-gaussian-viewer-design.md`

1. Add meaningful failing tests for bounds-based camera framing and scan transforms. Run RED, implement helpers, run GREEN.
2. Add a separate viewer entry, local IFC WASM and Fragments worker assets, and direct Spark PLY loading. Keep existing project routes and dependency pins.
3. Add independent layer status, visibility, fit controls, scan axis and manual transform controls, and disposal on replacement.
4. Run frontend tests, typecheck and production build. Restore Python 3.12 environment if available and run existing backend tests.
5. Drive the production viewer with the actual local samples, inspect console/network and screenshot, exercise visibility and transforms, and fix failures.
6. Review the change and commit the milestone. Record any incomplete hardware checks honestly.

## Verification — 2026-10-26

Steps 1–5 complete. Tests were observed RED then GREEN. Gates: 43 backend tests, 16 frontend tests, typecheck and production build pass.

Chrome rendered both actual BS17 sample files in Vite and production FastAPI under the unchanged CSP. Checked visibility, framing, scan axis, translation/rotation/scale and reset, cached-page preservation, malformed files and retry availability. Browser scripts and screenshots are in gitignored `output/playwright/`.

Independent review prompted fixes for IFC replacement coordinate offsets and back/forward caching cleanup. Browser checks also caught and fixed the scale field's step mismatch and malformed-file decoder hangs. Spark receives a local file stream because production CSP blocks fetching a blob URL.

Ruling: the user's viewer-first milestone supersedes the USD implementation order for this scope. Original Tasks 3–7 remain pending. Existing dependency pins remain unchanged; added IFC dependencies and type declarations use exact versions. Files and manual alignment are session-only. No automatic registration or performance acceptance is claimed. Upstream optional WebGPU build warnings are documented in README.
