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

This milestone requires WebGL2 and loads files into browser memory. Server uploads, saved alignment, BIM properties, segmentation, USD import and streamed conversion remain future work. The backend currently supports private project links, rotation and deletion requests; processing and purge workers are not implemented.

Verified in Chrome with `BS17-IFC.ifc` (24.3 MB) and `BS17-PLY.ply` (325 MB; 4,778,721 splats), including production CSP. This is not a target-PC performance benchmark. Fragments' guarded optional WebGPU code emits build warnings about exports unavailable in the WebGL Three.js entry; the tested viewer uses WebGL.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build
```
