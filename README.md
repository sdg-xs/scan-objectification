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

## Manual asset isolation

Load a Gaussian PLY, then use **Isolate an asset** in the sidebar:

1. Choose **Replace**, **Add**, or **Remove**, click **Draw box**, and drag over the scan. Green splats preview the selection; other splats are dimmed.
2. Boxes select splat centers through depth. For a tight 3D region, enable and adjust the interactive **Section box**, then click **Select section**. A drawn box also respects the active section region.
3. Click **Isolate asset** to hide other splats and the BIM. Orbit to inspect; **Show context** restores the previous layer visibility, section and camera view. **Clear** discards the selection.

Escape cancels a box drag or an in-progress selection. Replacing a model or changing scan placement clears the selection. Selection is temporary and does not edit the PLY. Original Gaussian properties, including directional color, remain intact.

This is manual isolation. Saved selections and asset export remain future work.

## Detect and select elements with SAM 3.1

Start the Python API alongside Vite, or use the production viewer below. The local `.venv-sam31` runtime and checkpoint are installed on this PC, separately from the application environment.

1. Load a Gaussian PLY and aim at the elements you need. Hide BIM if it obscures the scan; the capture includes visible layers and respects the active section box.
2. Click **Open SAM workspace**. Enter a visual description such as `rectangular air vent`, `red pipe` or `ceiling light`, then click **Capture & detect**. SAM matches visible appearance; the field is not a conversational instruction box. Descriptions are limited to 240 characters.
3. Review the frozen image and numbered matches. Uncheck unwanted matches and click **Replace scan selection with checked matches** to preview them in green. Use **Isolate asset** or the existing manual add/remove tools to refine the result. Selection remains temporary.
4. Close the window to adjust the view and repeat. Each run captures the current view; selection uses the camera and section box saved with that capture. Changed scan placement or a changed selection requires a fresh capture.

Inference runs on this PC using the actual SAM 3.1 checkpoint. The API on port 8767 automatically starts its worker on loopback port 8768; port 8766 is unchanged. The worker releases model state after each request. No external image service or browser credentials are used. Captures are limited to 1600 pixels on the longest edge and 50 detections per prompt. Closing the dialog cancels the browser's wait; an already running inference may finish before another request can begin.

Selection projects splat centers into the chosen image masks through depth, so hidden splats behind an object can also be selected. Limit depth with the section box and refine manually. This does not reconstruct a complete 3D object or export an asset. The real API/model path passed a generated-image smoke test; arbitrary-object accuracy and visual alignment still need user verification. Reload after updating the app, then select the files and re-align the view. Restart the API and its worker when their code changes. Worker diagnostics are in `data/logs/sam31-service.log`.

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
