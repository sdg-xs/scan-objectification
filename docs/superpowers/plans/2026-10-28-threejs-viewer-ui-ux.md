# Three.js BIM and Gaussian Viewer UI/UX Plan

## Purpose

Shape the existing Three.js viewer into a clear scan-to-BIM workspace. A user should be able to open a building model and Gaussian scan, understand their relative placement, inspect or isolate areas, create segments, classify those segments, place library assets, and export an IFC containing those asset instances at the locations identified from the scan.

This plan defines the user experience for the current local-file viewer and its segmentation, asset-placement, and IFC export workflow.

## Product principles

- Keep the 3D scene as the primary work surface; navigation and object controls support it.
- Show the next useful action at each stage, while allowing users to revisit earlier work.
- Make source scan, IFC model, segment records, and placed assets visibly distinct.
- Treat alignment as explicit user work. Show that independently centered inputs are not registered.
- Keep operations reversible where possible and explain whether an action changes source geometry, segment metadata, or only visibility.
- Preserve the original source IFC; export a separate IFC with assigned asset occurrences inserted.
- Convert detected/viewer-space poses back into the source IFC's coordinate frame using the recorded transforms, units, and orientation.
- Show real loading and processing state, including progress, duration when available, cancel/retry actions, and actionable errors.
- Use ReCap as a reference for staged scan preparation, a navigable hierarchy, visibility controls, and classification. Adapt the interaction to the current viewer instead of recreating ReCap screens.

## Reference workflow

Autodesk's ReCap learning materials describe a flow of creating a project, importing scan files, registering when needed, indexing, then launching the point-cloud project. ReCap also organizes point-cloud work through navigation, regions, and classifications. These ideas inform the viewer's orientation and progressive workflow cues; they do not imply that this viewer supports scan registration or ReCap project formats.

References:

- [Create a point cloud from scan data in ReCap Pro](https://www.autodesk.com/learn/ondemand/curated/recap-pro-quick-start-guide/4TUYjh7OqBeFvnsBLvjybf)
- [Autodesk ReCap Auto-Registration help](https://help.autodesk.com/view/RECAP/ENU/?contextId=scan_register_auto)
- [Autodesk Support: ReCap's role in scan-to-BIM workflows](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Role-of-Autodesk-ReCap-in-scan-to-BIM-workflows.html)
- [That Open web-ifc API](https://thatopen.github.io/engine_web-ifc/docs/classes/web-ifc.IfcAPI.html) (model creation and saving APIs)
- [That Open IfcPropertiesManager tutorial](https://thatopen.github.io/engine_past-docs/3.0.x/Tutorials/Components/Core/IfcPropertiesManager/) (saving a modified IFC)
- [NVIDIA CAD Converter documentation](https://docs.omniverse.nvidia.com/kit/docs/omni.kit.converter.cad/latest/Overview.html) (IFC as an input format for conversion to USD)
- [README: current Model Browser and assignment workflow](../../../README.md)

## Proposed user journey

1. **Open the source files.** Start with clear Open IFC and Open Gaussian PLY actions. Show accepted formats, selected file names, load status, and retryable errors. Keep each layer independently loadable and replaceable.
2. **Orient the scene.** Explain the Z-up convention and independent initial centering. Provide visible layer status, visibility, Fit, and manual alignment controls. State plainly that this is not automatic registration.
3. **Inspect and isolate.** Keep the viewport central. Use the Model Browser for Unclassified, Root, groups, layers, elements, and assigned assets. Make visibility, selection, active layer, and section-box effects legible and independently controllable.
4. **Detect and refine.** Present SAM capture/detection as a focused work mode or contextual panel. Make the selected view, capture, request progress, and result count visible. Support retry/cancel and preserve the user's viewport context when the task closes or fails.
5. **Classify results.** Guide users from Unclassified selections to a target layer, naming, and confirmation. Keep classification separate from source geometry. Make moving, unclassifying, and deleting records understandable and reversible where practical.
6. **Place and review assets.** Let the user assign one asset to a selected element or a layer's current elements. Display detected pose and uncertainty before apply. Provide independent asset visibility/color and clear correction controls; show that the original scan remains intact.
7. **Review and export IFC.** Show the source building, alignment state, assigned asset count, and any missing geometry or placement data. Let the user export a separate IFC that preserves the building and adds assigned asset occurrences. Confirm file name and destination, report export progress and completion, and make the generated file downloadable. Never imply that session state has been saved until the IFC export succeeds.

## Screen and interaction structure

- **Viewport:** primary area for the combined IFC/Gaussian scene, camera controls, hover/selection feedback, and contextual status.
- **Source controls:** persistent, compact IFC and scan cards with load state, visibility, fit, and alignment entry points.
- **Model Browser:** collapsible hierarchy with search/filter, Unclassified, Root, groups, layers, elements, and assigned asset children. Keep its toolbar and filter available while the list scrolls.
- **Task tools:** SAM and asset assignment controls open near the viewport and retain context. Avoid turning the application into a sequence of disconnected pages.
- **Target Layer:** visible and synchronized with the selected layer in the Model Browser. Show the selected destination at the point of classification.
- **Section box and framing:** keep viewport navigation controls grouped and reachable without overlapping hierarchy or task panels at small window sizes.
- **Feedback:** use consistent status language for loading, ready, running, completed, canceled, and failed. Errors name the affected file/task and provide a next action without exposing local paths unnecessarily.
- **IFC export:** provide a final review/export action with a clear summary of which assigned assets will be written and where they will be placed. Fail with specific recovery guidance when the source model, placement transform, or required asset geometry is unavailable.

## Priorities

### P0 — Make the existing flow legible

- Establish a consistent visual order: open sources → align → inspect → segment → classify → assign assets → review.
- Add lightweight progress/status cues without blocking direct access to the viewer.
- Clarify selection scope before bulk actions and show affected item counts.
- Clarify the difference between hiding source scans, hiding assigned assets, removing an assignment, and deleting a segment record.

### P1 — Reduce context loss

- Preserve camera, selection, and panel context through successful and failed SAM/asset operations where safe.
- Keep long lists and task controls usable in narrow or short windows.
- Improve empty states for no source, no segments, no target layer, and no asset selection.
- Provide keyboard focus and accessible labels for icon-only controls, tree rows, and visibility toggles.

### P2 — Improve review and handoff

- Add a review summary for source/alignment/segmentation/classification/asset state and export readiness.
- Identify session-only work and unsaved changes accurately; only successful IFC export produces a durable deliverable.
- Keep saved viewer sessions and revision history outside this plan unless separately requested.

## Acceptance criteria for a later UI implementation

- A first-time user can load both supported local files and identify which source is still loading, ready, or failed.
- A user can tell that manual alignment is not registration and can reset or adjust it without changing source files.
- A user can move from SAM results to classification and asset placement while retaining scene context.
- Visibility and deletion controls clearly identify whether they affect source geometry, segment records, or asset instances.
- Every asynchronous operation provides a visible running state and a meaningful completion, cancellation, or recovery state.
- IFC output is a separate file, retains the source building context, and contains one correctly placed IFC occurrence for each included asset assignment.
- Reopening the exported IFC in an IFC viewer shows the assigned assets at their corresponding scan-identified locations within the declared coordinate tolerance.
- The complete workflow remains usable at the documented compact viewport sizes and with keyboard navigation.

## Export decisions to confirm during implementation

- **IFC spatial type:** use an appropriate class supplied by the asset definition when available; otherwise use a documented generic building element proxy and preserve the asset name/library identifier as properties.
- **Transform chain:** retain the mapping from scan-local pose through viewer alignment into the source IFC coordinate system, including unit scaling and axis conversion. Export only after this mapping is validated.
- **Output scope:** default to a copy of the loaded building IFC with asset occurrences added. Keep the original file untouched. An asset-only IFC can be considered later if downstream use requires it.
- **Asset geometry:** use IFC geometry from the selected library asset when available. If its source is another format, prepare it as IFC-compatible geometry before export; show unsupported definitions before the user starts export.
- **Writer integration:** use the compatible That Open/web-ifc IFC write/export API available to the project. Confirm exact package/API behavior against the pinned installed version before implementation; test the result by reopening the produced IFC.

## Design boundary

This is a UX direction and prioritization plan, not a request to redesign the viewer architecture. Before implementation, use the existing viewer with representative IFC/PLY data to validate stage labels, panel arrangement, export wording, and state language. Keep changes incremental and tied to observed user friction.
