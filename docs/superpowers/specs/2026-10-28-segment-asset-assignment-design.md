# Element pose recording and library asset assignment

Status: user approved estimated rotation on 2026-10-28, restricted to Z-axis rotation with subsequent manual asset correction.

## Requested workflow

Record a position and rotation for each segmented element. Add an Assign Asset icon immediately before the visibility toggle on layer and element rows, using the existing icon/tooltip design. A layer assignment places one occurrence of the chosen asset for every element currently in the layer. An element assignment places one occurrence for that element. Retain source scan geometry.

## Existing evidence

The asset.library project is a separate React/Express app. CONTEXT.md defines reusable asset definitions separately from occurrences. CatalogLibrary entries have stable IDs, names, categories, source references and optional geometryReference. GET /api/catalog-library returns definitions; GET /api/geometry/:id returns saved mesh arrays, colors and part transforms. IFC-backed definitions require resolving the representative occurrence from source models. The current InsertAssetDialog is explicitly a test flow and does not insert geometry.

Its active .local-data catalog contains 1,572 definitions: three explicit IFC geometry references, no explicit saved-mesh references, and 1,569 entries without explicit geometryReference. The latter may resolve through sourceReferences, as useDefinitionPreview does; do not present them as geometry-ready without checking those sources. The library preview centers geometry only for camera presentation; this is not an authored placement anchor.

The current viewer uses Three.js and already has source-splat index sets per element. It stores no element object pose. Scan alignment is a parent transform. Individual splat rotations are not an object-level pose. Existing classifications are session-only and source replacement resets them.

## Proposed integration

Reuse the catalog and geometry contracts through a read-only same-origin backend adapter. Resolve definition geometry using the same explicit-mesh, explicit-IFC and source-reference paths as the asset library. Keep credentials/addresses server-side and preserve the viewer CSP. Do not import the library React application into this vanilla TypeScript viewer or modify its catalog while assigning occurrences.

Store pose and asset assignment as element metadata in scan-local coordinates, deriving world coordinates through the current scan alignment so assets move with the scan. Keep position, Z-axis angle, pose origin/quality and any manual corrections distinct from source splat transforms. Validate pose is finite before placement. In the first increment, these records share the existing session-only lifecycle; persistent project saving needs an explicit extension.

The assignment window shows scope and element count, a searchable/category-filtered asset list, recorded-pose preview and Z rotation/unit/up-axis controls. Use a consistent asset-local placement anchor; remove the representative IFC occurrence's original building placement before applying the recorded element pose. Preserve internal part transforms, model units and intended asset dimensions. Do not silently stretch geometry to the detected bounds. Units/axes/pivot must be explicit where the source has no reliable metadata.

Apply a layer operation to a snapshot of its current elements after validating all poses and loading geometry. Prepare instances before replacing any prior assignments so a failed load leaves existing placements intact. Reassignment replaces an element's previous asset occurrence instead of duplicating it. Layer assignment is an operation over its present members, not a template for future detections. Element overrides can subsequently differ from their layer peers.

Original scan geometry remains intact. Assigned instances follow element/layer/group visibility. Removing an element record also removes its assigned occurrence; removing a container reassigns or unclassifies its elements and preserves their recorded poses and asset assignments. Source replacement releases instances and cached resources. Asynchronous work must be cancelled or rejected when the source/element set changes.

## Approved rotation recording

User selected Option A, Z only: estimate the bounding center and dominant XY direction from selected splat centers, then allow manual Z correction of the assigned asset. Shape symmetry, incomplete segmentation and the 180-degree direction ambiguity must be visible; round bulbs cannot supply a unique heading. An estimate must not be presented as SAM-measured pose.

Option B: record the center automatically and require manual object rotation. This avoids presenting a speculative heading but needs an edit for each distinct orientation.

## Verification targets

Use synthetic translated/rotated shapes to test pose coordinates, scan-alignment changes and ambiguous shape handling. Test asset pivot/unit transforms independently of the renderer. Controller tests should prove layer-to-many and element-to-one placement, reassign without duplication, stale-source cancellation, visibility and record-deletion behavior. Backend adapter tests must cover explicit mesh/IFC/source-reference resolution, missing geometry and bounded path-safe reads. Complete the normal backend/frontend/typecheck/build gate. Live viewport verification remains subject to the existing browser-origin permission restriction.
