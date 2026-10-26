import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FragmentsModels, IfcImporter } from "@thatopen/fragments";
import type { FragmentsModel } from "@thatopen/fragments";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import {
  applyScanTransform,
  centerModel,
  frameBounds,
  validateModelHeader,
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
  renderer.setClearColor(0x101918);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "3D view. Drag to orbit, right-drag to pan, scroll to zoom.",
  );
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
  camera.position.set(25, 20, 25);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8070, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(15, 30, 10);
  scene.add(sun);
  const grid = new THREE.GridHelper(200, 40, 0x425f4d, 0x253b30);
  grid.position.y = -0.02;
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
  let bimBounds = new THREE.Box3();
  let scanBounds = new THREE.Box3();
  let disposed = false;

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
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function frame(box: THREE.Box3): void {
    try {
      const view = frameBounds(box, camera.fov, camera.aspect);
      controls.target.copy(view.target);
      camera.position
        .copy(view.target)
        .addScaledVector(
          new THREE.Vector3(1, 0.7, 1).normalize(),
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

  function frameScene(): void {
    const box = new THREE.Box3();
    if (bim && bimGroup.visible) box.union(bimBounds);
    if (splats && scanGroup.visible) box.union(worldScanBounds());
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
    frameScene();
  }

  ifcInput.addEventListener("change", async () => {
    const file = ifcInput.files?.[0];
    if (!file) return;
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
      pending = await fragments.load(bytes, { modelId, camera });
      if (pending.box.isEmpty())
        throw new Error("The IFC contains no supported geometry.");
      const loadedModel = pending;
      const bounds = centerModel(loadedModel.object, () => loadedModel.box);
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
    splats.rotation.set(axis.value === "z" ? -Math.PI / 2 : 0, 0, 0);
    splats.updateMatrix();
    scanBounds = splats.getBoundingBox().clone().applyMatrix4(splats.matrix);
    const center = scanBounds.getCenter(new THREE.Vector3());
    splats.position.sub(center);
    scanBounds.translate(center.negate());
    scanGroup.updateMatrixWorld(true);
  }

  plyInput.addEventListener("change", async () => {
    const file = plyInput.files?.[0];
    if (!file) return;
    plyInput.disabled = true;
    errorNotice.hidden = true;
    status("ply-status", `${file.name} · decoding Gaussian data…`);
    let pending: SplatMesh | undefined;
    try {
      validateModelHeader("ply", await file.slice(0, 65536).text());
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
        scanGroup.remove(splats);
        splats.dispose();
      }
      splats = pending;
      scanGroup.add(splats);
      form.reset();
      orientScan();
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
    controls.dispose();
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
