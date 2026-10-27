import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FragmentsModels, IfcImporter } from "@thatopen/fragments";
import type { FragmentsModel } from "@thatopen/fragments";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { SectionBox } from "./section-box";
import { AssetSelection } from "./asset-selection";
import { SegmentPanel } from "./segments";
import { LightDetectionControls } from "./light-detection";
import { captureSize } from "./light-detection-model";
import {
  applyScanTransform,
  centerModel,
  frameBounds,
  validateModelHeader,
  setSourceUp,
  hasSavedPlyPlacement,
} from "./viewer-model";

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof type))
    throw new Error(`Missing viewer element: ${id}`);
  return value;
}

const viewport = element("viewport", HTMLElement);
const errorNotice = element("viewer-error", HTMLParagraphElement);
const fitAll = element("fit-all", HTMLButtonElement);
const ifcInput = element("ifc-file", HTMLInputElement);
const plyInput = element("ply-file", HTMLInputElement);
const ifcFit = element("ifc-fit", HTMLButtonElement);
const plyFit = element("ply-fit", HTMLButtonElement);
const scanControls = element("scan-controls", HTMLFieldSetElement);
const axis = element("scan-axis", HTMLSelectElement);
const form = element("transform-form", HTMLFormElement);

function showError(error: unknown): void {
  errorNotice.textContent =
    error instanceof Error ? error.message : "The model could not be loaded.";
  errorNotice.hidden = false;
}

function status(id: string, text: string, failed = false): void {
  const label = element(id, HTMLElement);
  label.textContent = text;
  label.dataset.error = String(failed);
}

async function start(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "3D view. Drag to orbit, right-drag to pan, scroll to zoom.",
  );
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(25, -25, 20);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const sky = new THREE.HemisphereLight(0xffffff, 0x6b8070, 2);
  sky.position.set(0, 0, 1);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(15, -10, 30);
  scene.add(sun);
  const grid = new THREE.GridHelper(200, 40, 0x425f4d, 0x253b30);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.02;
  scene.add(grid);
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const fragments = new FragmentsModels(fragmentsWorkerUrl);
  fragments.settings.autoCoordinate = false;
  const bimGroup = new THREE.Group();
  const scanGroup = new THREE.Group();
  scene.add(bimGroup, scanGroup);
  let bim: FragmentsModel | undefined;
  let splats: SplatMesh | undefined;
  let savedPlyPlacement = false;
  let bimBounds = new THREE.Box3();
  let scanBounds = new THREE.Box3();
  let disposed = false;
  const section = new SectionBox({
    scene,
    camera,
    canvas: renderer.domElement,
    orbit: controls,
    toolbar: element("section-tools", HTMLElement),
    bounds: sceneBounds,
    onChange: () => {
      void fragments.update().catch(showError);
    },
  });
  const selection = new AssetSelection({
    viewport, canvas: renderer.domElement, camera, orbit: controls, section, frame,
    error: showError,
    visibility: () => segments.visibility(),
    onSegments: (labels, prompt) => { selection.clear(); segments.add(labels, prompt); },
    isolateContext: () => {
      const bimVisible = bimGroup.visible;
      const scanVisible = scanGroup.visible;
      const gridVisible = grid.visible;
      const position = camera.position.clone();
      const target = controls.target.clone();
      const near = camera.near;
      const far = camera.far;
      const maxDistance = controls.maxDistance;
      const ifcVisible = element("ifc-visible", HTMLInputElement);
      const plyVisible = element("ply-visible", HTMLInputElement);
      bimGroup.visible = false;
      scanGroup.visible = true;
      grid.visible = false;
      ifcVisible.checked = false;
      plyVisible.checked = true;
      ifcVisible.disabled = plyVisible.disabled = true;
      return () => {
        bimGroup.visible = ifcVisible.checked = bimVisible;
        scanGroup.visible = plyVisible.checked = scanVisible;
        grid.visible = gridVisible;
        camera.position.copy(position);
        controls.target.copy(target);
        camera.near = near;
        camera.far = far;
        controls.maxDistance = maxDistance;
        camera.updateProjectionMatrix();
        controls.update();
        ifcVisible.disabled = plyVisible.disabled = false;
      };
    },
  });

  const segments = new SegmentPanel({ select: indices => selection.selectIndices(indices), clear: () => selection.clear(), error: showError });

  const lights = new LightDetectionControls(() => {
    if (!splats || !scanGroup.visible)
      throw new Error("Show the Gaussian scan before detecting objects.");
    segments.clearSelection();
    const select = selection.captureMaskSelection();
    const capture = document.createElement("canvas");
    const size = captureSize(renderer.domElement.width, renderer.domElement.height);
    capture.width = size.width;
    capture.height = size.height;
    const context = capture.getContext("2d");
    if (!context) throw new Error("The browser could not capture this view.");
    const previousPlanes = renderer.clippingPlanes;
    try {
      renderer.clippingPlanes = section.planes;
      // Copy in the same call as render: the WebGL drawing buffer is cleared
      // after presentation. The section gizmos use a separate overlay scene.
      renderer.render(scene, camera);
      context.drawImage(renderer.domElement, 0, 0, size.width, size.height);
    } finally {
      renderer.clippingPlanes = previousPlanes;
    }
    return { canvas: capture, select };
  }, paused => {
    if (!disposed) renderer.setAnimationLoop(paused ? null : renderFrame);
  });

  const resize = () => {
    const { width, height } = viewport.getBoundingClientRect();
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  controls.addEventListener("change", () => {
    void fragments.update().catch(showError);
  });
  function renderFrame(): void {
    controls.update();
    renderer.clippingPlanes = section.planes;
    renderer.render(scene, camera);
    section.render(renderer);
  }
  renderer.setAnimationLoop(renderFrame);

  function frame(box: THREE.Box3): void {
    try {
      const view = frameBounds(box, camera.fov, camera.aspect);
      controls.target.copy(view.target);
      camera.position
        .copy(view.target)
        .addScaledVector(
          new THREE.Vector3(1, -1, 0.7).normalize(),
          view.distance,
        );
      camera.near = view.near;
      camera.far = view.far;
      camera.updateProjectionMatrix();
      controls.maxDistance = view.far / 2;
      controls.update();
      void fragments.update(true).catch(showError);
    } catch (error) {
      showError(error);
    }
  }

  function worldScanBounds(): THREE.Box3 {
    scanGroup.updateMatrixWorld(true);
    return scanBounds.clone().applyMatrix4(scanGroup.matrixWorld);
  }

  function sceneBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    if (bim && bimGroup.visible) box.union(bimBounds);
    if (splats && scanGroup.visible) box.union(worldScanBounds());
    return box;
  }

  function frameScene(): void {
    const box = selection.getIsolatedBounds() ?? sceneBounds();
    if (!box.isEmpty()) frame(box);
  }

  function loaded(): void {
    const count = Number(Boolean(bim)) + Number(Boolean(splats));
    element("empty-state", HTMLElement).hidden = count > 0;
    status("scene-status", `${count} / 2 layers loaded · local session`);
    fitAll.disabled = count === 0;
    ifcFit.disabled = !bim;
    plyFit.disabled = !splats;
    scanControls.disabled = !splats;
    section.setAvailable(count > 0);
    lights.setAvailable(Boolean(splats));
    frameScene();
  }

  ifcInput.addEventListener("change", async () => {
    const file = ifcInput.files?.[0];
    if (!file) return;
    selection.clear();
    ifcInput.disabled = true;
    errorNotice.hidden = true;
    status("ifc-status", `${file.name} · reading IFC…`);
    let pending: FragmentsModel | undefined;
    const modelId = crypto.randomUUID();
    try {
      validateModelHeader("ifc", await file.slice(0, 4096).text());
      const importer = new IfcImporter();
      const absoluteWasm = new URL(wasmUrl, window.location.href).href;
      importer.wasm = {
        absolute: true,
        path: absoluteWasm.slice(0, absoluteWasm.lastIndexOf("/") + 1),
      };
      const bytes = await importer.process({
        bytes: new Uint8Array(await file.arrayBuffer()),
        progressCallback: (progress) =>
          status(
            "ifc-status",
            `${file.name} · converting ${Math.round(progress * 100)}%`,
          ),
      });
      if (disposed) return;
      status("ifc-status", `${file.name} · preparing geometry…`);
      pending = await fragments.load(bytes, {
        modelId,
        camera,
        clippingPlanes: section.planes,
      });
      if (pending.box.isEmpty())
        throw new Error("The IFC contains no supported geometry.");
      const loadedModel = pending;
      setSourceUp(loadedModel.object, "y");
      const bounds = centerModel(loadedModel.object, () => loadedModel.box);
      selection.clear();
      if (bim) {
        bimGroup.remove(bim.object);
        await fragments.disposeModel(bim.modelId);
      }
      bim = pending;
      bimBounds = bounds;
      bimGroup.add(bim.object);
      status(
        "ifc-status",
        `${file.name} · ${(file.size / 1e6).toFixed(1)} MB · loaded`,
      );
      loaded();
    } catch (error) {
      if (pending && pending !== bim) await fragments.disposeModel(modelId);
      status(
        "ifc-status",
        `Could not load ${file.name}. Choose an IFC to retry.`,
        true,
      );
      showError(error);
    } finally {
      ifcInput.disabled = false;
      ifcInput.value = "";
    }
  });

  function orientScan(): void {
    if (!splats) return;
    splats.position.set(0, 0, 0);
    setSourceUp(splats, axis.value === "z" ? "z" : "y");
    splats.updateMatrix();
    scanBounds = splats.getBoundingBox().clone().applyMatrix4(splats.matrix);
    if (!savedPlyPlacement) {
      const center = scanBounds.getCenter(new THREE.Vector3());
      splats.position.sub(center);
      scanBounds.translate(center.negate());
    }
    scanGroup.updateMatrixWorld(true);
  }

  plyInput.addEventListener("change", async () => {
    const file = plyInput.files?.[0];
    if (!file) return;
    selection.clear();
    plyInput.disabled = true;
    errorNotice.hidden = true;
    status("ply-status", `${file.name} · decoding Gaussian data…`);
    let pending: SplatMesh | undefined;
    try {
      const header = await file.slice(0, 65536).text();
      validateModelHeader("ply", header);
      const hasPlacement = hasSavedPlyPlacement(header);
      pending = new SplatMesh({
        stream: file.stream(),
        streamLength: file.size,
        fileName: file.name,
        extSplats: true,
        onProgress: (event) => {
          if (event.lengthComputable)
            status(
              "ply-status",
              `${file.name} · reading ${Math.round((event.loaded / event.total) * 100)}%`,
            );
        },
      });
      await pending.initialized;
      if (disposed) {
        pending.dispose();
        return;
      }
      if (pending.getBoundingBox().isEmpty())
        throw new Error("The PLY contains no splats.");
      if (splats) {
        selection.setScan(undefined);
        segments.setScan(undefined);
        scanGroup.remove(splats);
        splats.dispose();
      }
      splats = pending;
      savedPlyPlacement = hasPlacement;
      if (hasPlacement) axis.value = "z";
      axis.disabled = hasPlacement;
      scanGroup.add(splats);
      form.reset();
      orientScan();
      selection.setScan(splats);
      segments.setScan(splats);
      status(
        "ply-status",
        `${file.name} · ${splats.numSplats.toLocaleString()} splats · loaded`,
      );
      loaded();
    } catch (error) {
      if (pending && pending !== splats) pending.dispose();
      status(
        "ply-status",
        `Could not load ${file.name}. Choose a Gaussian PLY to retry.`,
        true,
      );
      showError(error);
    } finally {
      plyInput.disabled = false;
      plyInput.value = "";
    }
  });

  element("ifc-visible", HTMLInputElement).addEventListener(
    "change",
    (event) => {
      if (event.target instanceof HTMLInputElement)
        bimGroup.visible = event.target.checked;
    },
  );
  element("ply-visible", HTMLInputElement).addEventListener(
    "change",
    (event) => {
      if (event.target instanceof HTMLInputElement)
        scanGroup.visible = event.target.checked;
    },
  );
  fitAll.addEventListener("click", frameScene);
  ifcFit.addEventListener("click", () => frame(bimBounds));
  plyFit.addEventListener("click", () => frame(worldScanBounds()));
  axis.addEventListener("change", () => {
    selection.clear();
    orientScan();
    frame(worldScanBounds());
  });
  window.addEventListener("keydown", (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if (event.key.toLowerCase() === "f") frameScene();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(form);
    try {
      selection.clear();
      applyScanTransform(scanGroup, {
        x: Number(values.get("x")),
        y: Number(values.get("y")),
        z: Number(values.get("z")),
        rx: Number(values.get("rx")),
        ry: Number(values.get("ry")),
        rz: Number(values.get("rz")),
        scale: Number(values.get("scale")),
      });
      status(
        "alignment-status",
        "Scan placement updated. Changes last for this session.",
      );
    } catch (error) {
      showError(error);
    }
  });
  form.addEventListener("reset", () => {
    selection.clear();
    applyScanTransform(scanGroup, {
      x: 0,
      y: 0,
      z: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      scale: 1,
    });
    status("alignment-status", "Scan placement reset to the centered preview.");
  });
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    disposed = true;
    observer.disconnect();
    renderer.setAnimationLoop(null);
    selection.dispose();
    segments.dispose();
    lights.dispose();
    controls.dispose();
    section.dispose();
    splats?.dispose();
    spark.dispose();
    void fragments.dispose();
    grid.geometry.dispose();
    if (Array.isArray(grid.material))
      grid.material.forEach((material) => material.dispose());
    else grid.material.dispose();
    renderer.dispose();
  });
}

void start().catch((error: unknown) => {
  showError(error);
  ifcInput.disabled = true;
  plyInput.disabled = true;
});
