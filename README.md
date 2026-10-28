# Nemy BIM + Gaussian viewer

Open a local IFC building and Gaussian PLY scan together in Three.js. That Open Fragments imports IFC; Spark renders splats.

## Run

With Node.js 24 installed, run from the repository root:

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:5173/viewer.html and select your files with **Open IFC** and **Open Gaussian PLY**. Nothing is uploaded. Local sample files belong in gitignored `test_files/`.

The viewer uses **Z up**, with the ground grid in the XY plane. Imported IFC geometry is converted from the importer's Y-up coordinates; Z-up PLY scans retain their native orientation.

Drag to orbit, right-drag to pan, and scroll to zoom. **Fit all** or **F** frames visible layers. Each layer has a visibility checkbox and its own frame button.

Layers start centered independently. Adjust the scan up axis, translation, rotation and uniform scale, then click **Apply**. **Reset** restores centered placement. Alignment is not saved; refreshing requires selecting the files again.

## Interactive section box

Enable **Section box** in the lower-left corner of the viewport. In **Resize** mode, drag a colored face handle to move that side of the box. In **Move** mode, drag the axis arrows to move the whole box. In **Rotate** mode, drag the colored rings to tilt or turn the box. Face handles follow the rotated axes. **Reset box** clears rotation and fits the box around the visible layers; switching it off restores the complete view. Escape cancels a resize, move, or rotation.

The same oriented box clips the IFC and Gaussian layers and limits asset selection. These are temporary visual cuts and do not modify or export source files. Mesh cuts have open surfaces; Gaussian masking works on splat centers, so splat footprints can soften the boundary. No numeric section-box inputs or additional dependencies are used.

## Model Browser: groups and classification layers

The collapsible **Model Browser** floats at the viewer's top left. It adapts the left-side hierarchy in Autodesk's [Select and classify mesh surfaces](https://www.autodesk.com/learn/ondemand/tutorial/select-and-classify-mesh-surfaces) tutorial to 3DGS elements. SAM supplies segmentation and selection; this panel manages their classification.

When open, the panel extends down toward the footer even with an empty list. Its toolbar and Filter remain fixed while list content scrolls. Section-box controls sit at the lower right above Fit all, leaving the left side for Model Browser.

Controls use compact icons with delayed hover tooltips and accessible labels. Below Filter, the list starts with **Unclassified**, then **Root**, containing groups and layers. The symbols follow the user's open ReCap Model Browser: four shapes for Unclassified, checked shapes for Root, stacked sheets for groups, and a slanted surface for layers.

1. Use the toolbar to **Add Group** or **Add Layer**, even before loading a scan. Select a group first to create a layer inside it, or choose a group in the creation dialog. Creation clears the filter and expands the item's parent so the result is visible. A hierarchy prepared before the first scan is retained when it loads; replacing a loaded scan resets it.
2. Groups have an eye toggle. Each layer row has a color swatch, **Set active layer** marker and eye toggle, in that order after its name. A separate **Target Layer** window floats at the bottom center of the viewer. Its selector opens upward and offers the same layers organized by group. Choosing either control synchronizes the target and highlights/reveals its layer and parent group without moving objects. Compact viewports dock this window to the right and stack the section controls above it to avoid overlap.
3. Use SAM's **Add & select checked matches** to segment/select objects in Unclassified. Choose Target Layer, then **Classify** at the bottom. The naming dialog proposes `Layer Name 01`, `Layer Name 02`, and so on, with an independent running sequence per layer. Edit names if needed and confirm. Elements appear under **Root → Group → Layer → Element** with a classified-mesh icon. Cancel leaves names and membership unchanged and consumes no sequence numbers. Click an element row to select it, Ctrl+click to add or remove individual elements, or Shift+click to select the visible range from the anchor row. Selected rows are highlighted without checkboxes. Use **Unclassify** to return selected elements to Unclassified while preserving names.
4. To move existing elements, select their rows, choose a destination in **Target Layer**, then click **Move**. Names and source splat membership are preserved. With Unclassified elements selected, **Add Group** or **Add Layer** offers to classify that selection; a new group also creates a first layer. Confirm or edit the proposed numbered names. Turn off the assignment option to create only the container.
5. Use Root, group and layer eyes to control classified visibility. Unsegmented splats follow Unclassified visibility; their separate context toggle is retained but hidden. The toolbar contains Add Group, Add Layer, Delete and, at the end, the original/classification color toggle.

To remove element records, select rows with click/Ctrl/Shift, then use the toolbar **Delete** icon and confirm. This removes the selected entries and classification while preserving all source geometry; their splats return to the unsegmented context and follow Unclassified visibility. Click a group/layer heading to target its container for deletion instead.

Rename layers and groups inline. Click or focus a group/layer row to select it, then use the toolbar Delete icon. Its confirmation offers to unassign contained objects to Unclassified or assign them to another surviving layer. Deleting a group also removes its layers; the dialog states this before confirmation. Cancel leaves everything unchanged. Each splat belongs to one object, and new segmentation takes ownership where results overlap. Records last for the loaded scan and follow alignment changes; reloading or replacing it clears them. Source files and Gaussian properties are unchanged. Saving/exporting classifications is future work. The previous manual asset controls are temporarily hidden; SAM occupies sidebar slot **02**.

### Assign library assets to segmented elements

After SAM adds elements, the viewer records each selection’s bounding center and dominant horizontal direction. Rotation is **Z only**, modulo 180°. Round/symmetric shapes have no reliable heading and are labelled uncertain. Coordinates are stored in the scan’s aligned local frame so asset occurrences follow later scan placement changes. Source-up changes recompute recorded poses. These records and assignments currently last for the loaded scan session.

1. Click **Assign asset** (cube-plus icon immediately before the eye) on an element row or layer row. A layer targets all its current elements; an element targets only itself.
2. Search the existing asset-library catalog by name/category and choose the reusable definition. Expand Recorded element poses to inspect coordinates and detected Z angles. Geometry is resolved on demand from saved mesh data or a representative IFC/source reference.
3. Leave Asset up axis at Y for normal library/IFC geometry; choose Z for a Z-up uploaded mesh. Library IFC geometry is already in metres; use 1:1. For imported meshes authored in millimetres/centimetres, choose the matching unit scale. Geometry is centered and its dominant horizontal direction becomes the asset’s X direction; it is never stretched to the detection bounds.
4. Choose **Assign asset**. Each target gets one occurrence at its own recorded pose. Assignment replaces its prior asset, preserves the original scan, and follows group/layer/element visibility and the section box.
5. Reopen the element’s Assign asset window, enter **Z rotation correction**, and choose **Update existing asset rotation**. This changes only the asset offset, keeping the detected angle. At layer level, the correction applies to existing assigned assets throughout that layer. Use 180° to reverse a linear asset’s direction.

The read-only gateway uses the existing local library service at `http://127.0.0.1:3001`; it does not modify its catalog. Start its production service with `node.exe dist-server/server/index.js` from the asset.library folder. The assignment window offers Reload library after a connection error. Definitions whose source geometry is unavailable report that error without replacing prior placements. Changing scan/source selection cancels stale loads. Removing an element record removes its assigned occurrence while retaining the original splats; deleting a group/layer preserves assignments on the moved/unclassified elements.

Read-only integration smoke check, with both services running:

```powershell
node.exe scripts/verify-library-asset.mjs ASSET_ID
```

This checks the real geometry gateway, shared IFC extractor and normalized bounds without opening a browser. Automated checks do not establish visual placement accuracy in a user scene.

The viewer adopts the local `asset.library` reference's Poppins fonts, navy header, white panels and blue controls, with a black 3D viewport. Fonts are bundled locally. Theme rules change colors and font families without changing layout dimensions.

This organization follows ReCap concepts, using our own implementation. See the [installed ReCap investigation](docs/research/2026-10-27-recap-classification.md) for static REA evidence, Autodesk documentation and limits.

## Detect and select elements with SAM 3.1

Start the Python API alongside Vite, or use the production viewer below. The local `.venv-sam31` runtime and checkpoint are installed on this PC, separately from the application environment.

1. Load a Gaussian PLY and aim at the elements you need. Hide BIM if it obscures the scan; the capture includes visible layers and respects the active section box.
2. Click **Open SAM workspace** to open the floating window on the right. Its context field is focused immediately. Enter a visual description such as `rectangular air vent`, `red pipe` or `ceiling light`. You can orbit, pan and zoom with the window open, then click **Capture & detect current view** below the field. SAM matches visible appearance; the field is not a conversational instruction box. Descriptions are limited to 240 characters.
3. Review the frozen image and numbered matches. Uncheck unwanted matches and click **Add & select checked matches**. Each match becomes a separate selected object in Unclassified. Choose a layer in the independent Target Layer window, click Classify, and confirm or edit the numbered default names.
4. Adjust the live view and capture again to repeat. Each click captures a fresh frame; it does not run continuously as the camera moves. Selection uses the camera and section box saved with that capture. Changed scan placement or a changed selection requires a fresh capture. Applying checked matches closes the window.

Inference runs on this PC using the actual SAM 3.1 checkpoint. The API on port 8767 automatically starts its worker on loopback port 8768; port 8766 is unchanged. The worker reuses the loaded model between requests, clears image-specific state each time, and releases the model after **120 seconds of inactivity**, on failure or on graceful shutdown. The first request after release still needs a cold load. No external image service or browser credentials are used. Captures are limited to 1600 pixels on the longest edge and 50 detections per prompt. Closing the dialog cancels the browser's wait; an already running inference may finish before another request can begin.

The viewer stays live while you type context and review results. During capture/inference and mask projection, its animation loop pauses to reduce GPU contention. Capture renders the requested frame explicitly; completion, failure or closing restores the live view. The window reports loading, frame preparation, detection and result preparation, then shows measured stage durations and whether the model was reused. These are phase indicators, not an ETA. Splat-projection time appears in the sidebar after applying results.

Selection decodes mask PNGs into raw pixel bitmaps rather than relying on HTML image dimensions. Encoded and decoded mask sizes must match the saved capture; masks are never stretched to fit a different frame. A genuine mismatch reports both sizes and requests a fresh capture.

Opening the application root redirects immediately to the “Model meets reality” BIM/Gaussian viewer. The intermediate hyperlink screen is removed.

Cloud processing is planned for later. The browser continues to use only the app's same-origin API for inference and status; a future cloud transport and its credentials belong behind that API. This change does not send captures to a cloud service.

Selection projects splat centers into the chosen image masks through depth, so splats behind an object can also be included. Splats hidden by object/group visibility are excluded. Limit depth with the section box. This does not reconstruct a complete 3D object or export an asset. The real API/model path passed a generated-image smoke test; arbitrary-object accuracy and visual alignment still need user verification. Reload after updating the app, then select the files and re-align the view. Restart the API and its worker when their code changes. Worker diagnostics are in `data/logs/sam31-service.log`.

## Saved scan placement

`test_files/BS17-PLY-aligned.ply` contains the manually aligned scan with translation X 17, Y 5.9, Z -3 baked into its positions. Rotation was zero and scale was one. The original PLY is unchanged. The viewer recognizes the saved Z-up placement and does not center it again; load this copy with alignment controls at zero.

Coordinates in this copy are relative to the viewer's centered IFC, not the original survey origin. Obsolete survey-offset comments are removed. The private placement comment only tells this viewer to preserve coordinates; other PLY tools can read the baked coordinates normally.

The translation-only helper streams standard binary little-endian PLY with float32 vertex properties:

```powershell
node scripts/save-aligned-ply.mjs test_files/BS17-PLY.ply test_files/BS17-PLY-aligned.ply 17 5.9 -3
node --test scripts/save-aligned-ply.test.mjs
```

It refuses to overwrite an existing output. This helper does not bake rotation, scaling, or a source-up-axis conversion.

## Production

With Python 3.12 and backend dependencies installed in `.venv`:

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe -m nemy_web.app
```

Open http://127.0.0.1:8767/ to go directly to the viewer, or use `/viewer.html`. Port 8766 remains reserved for SAM3.

## Limits and verification

This milestone requires WebGL2 and loads files into browser memory. Server uploads, BIM properties, depth-resolved object extraction, USD import and streamed conversion remain future work. The backend currently supports private project links, rotation and deletion requests; processing and purge workers are not implemented.

Verified in Chrome with `BS17-IFC.ifc` (24.3 MB) and `BS17-PLY.ply` (325 MB; 4,778,721 splats), including production CSP. This is not a target-PC performance benchmark. Fragments' guarded optional WebGPU code emits build warnings about exports unavailable in the WebGL Three.js entry; the tested viewer uses WebGL.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build
```
