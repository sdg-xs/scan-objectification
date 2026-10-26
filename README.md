# Nemy BIM + Gaussian viewer

Open a local IFC building and Gaussian PLY scan together in Three.js. That Open Fragments imports IFC; Spark renders splats.

## Run

With Node.js 24 installed, run from the repository root:

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://127.0.0.1:5173/viewer.html and select your files with **Open IFC** and **Open Gaussian PLY**. Nothing is uploaded. Local sample files belong in gitignored `test_files/`.

Drag to orbit, right-drag to pan, and scroll to zoom. **Fit all** or **F** frames visible layers. Each layer has a visibility checkbox and its own frame button.

Layers start centered independently. Adjust the scan up axis, translation, rotation and uniform scale, then click **Apply**. **Reset** restores centered placement. Alignment is not saved; refreshing requires selecting the files again.

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
