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

Classification actions use compact icon buttons. Pause the pointer over an icon for the browser's delayed tooltip. Eye icons control visibility, the target symbol chooses the target layer, and folder/layer-plus icons create groups/layers. Buttons and toggles retain accessible labels and keyboard focus indicators.

1. Use SAM's **Add & select checked matches**. Each match becomes a separate selected object under **Unclassified**.
2. Expand **New layer / group**. Create a group such as `Level 1`, then a layer such as `Ceiling` inside it. A newly created layer becomes the current **Target Layer**.
3. Choose a **Target Layer** from the list or its target icon, then use the **Classify** icon. Selected objects move into that layer under **Classified**, and the selection clears. Checking objects does not change the target layer.
4. Select existing objects using their row checkboxes. **Unclassify** returns them to Unclassified; **Clear selection** restores normal highlighting.
5. Use eye icons at root, group, layer or object level to control visibility. Unsegmented splats follow Unclassified visibility. The palette icon toggles layer-color tinting; turn it off to restore source colors.

Rename objects, layers and groups in the tree. Move a layer between groups using its group selector. Removing a layer unclassifies its objects; removing a group keeps its layers; removing an object returns its splats to unsegmented context. Each splat belongs to one object, and new segmentation takes ownership where results overlap. Records last for the loaded scan and follow alignment changes; reloading or replacing it clears them. Source files and Gaussian properties are unchanged. Saving/exporting classifications is future work. The previous manual asset controls are temporarily hidden; SAM occupies sidebar slot **02**.

This organization follows ReCap concepts, using our own implementation. See the [installed ReCap investigation](docs/research/2026-10-27-recap-classification.md) for static REA evidence, Autodesk documentation and limits.

## Detect and select elements with SAM 3.1

Start the Python API alongside Vite, or use the production viewer below. The local `.venv-sam31` runtime and checkpoint are installed on this PC, separately from the application environment.

1. Load a Gaussian PLY and aim at the elements you need. Hide BIM if it obscures the scan; the capture includes visible layers and respects the active section box.
2. Click **Open SAM workspace** to open the floating window on the right. Its context field is focused immediately. Enter a visual description such as `rectangular air vent`, `red pipe` or `ceiling light`. You can orbit, pan and zoom with the window open, then click **Capture & detect current view** below the field. SAM matches visible appearance; the field is not a conversational instruction box. Descriptions are limited to 240 characters.
3. Review the frozen image and numbered matches. Uncheck unwanted matches and click **Add & select checked matches**. Each match becomes a separate selected object under **Model Browser → Unclassified**. Choose a Target Layer there and Classify.
4. Adjust the live view and capture again to repeat. Each click captures a fresh frame; it does not run continuously as the camera moves. Selection uses the camera and section box saved with that capture. Changed scan placement or a changed selection requires a fresh capture. Applying checked matches closes the window so you can classify them in Model Browser.

Inference runs on this PC using the actual SAM 3.1 checkpoint. The API on port 8767 automatically starts its worker on loopback port 8768; port 8766 is unchanged. The worker reuses the loaded model between requests, clears image-specific state each time, and releases the model after **120 seconds of inactivity**, on failure or on graceful shutdown. The first request after release still needs a cold load. No external image service or browser credentials are used. Captures are limited to 1600 pixels on the longest edge and 50 detections per prompt. Closing the dialog cancels the browser's wait; an already running inference may finish before another request can begin.

The viewer stays live while you type context and review results. During capture/inference and mask projection, its animation loop pauses to reduce GPU contention. Capture renders the requested frame explicitly; completion, failure or closing restores the live view. The window reports loading, frame preparation, detection and result preparation, then shows measured stage durations and whether the model was reused. These are phase indicators, not an ETA. Splat-projection time appears in the sidebar after applying results.

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

Open http://127.0.0.1:8767/viewer.html. The existing project shell remains at `/`; port 8766 remains reserved for SAM3.

## Limits and verification

This milestone requires WebGL2 and loads files into browser memory. Server uploads, BIM properties, depth-resolved object extraction, USD import and streamed conversion remain future work. The backend currently supports private project links, rotation and deletion requests; processing and purge workers are not implemented.

Verified in Chrome with `BS17-IFC.ifc` (24.3 MB) and `BS17-PLY.ply` (325 MB; 4,778,721 splats), including production CSP. This is not a target-PC performance benchmark. Fragments' guarded optional WebGPU code emits build warnings about exports unavailable in the WebGL Three.js entry; the tested viewer uses WebGL.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build
```
