import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { SplatEdit, SplatEditSdf, SplatEditSdfType } from "@sparkjsdev/spark";
import {
  resizeSectionFace,
  updateSectionPlanes,
  finishSectionMove,
} from "./section-box-model";
import type { BoxAxis } from "./section-box-model";

interface FaceHandle {
  axis: BoxAxis;
  side: -1 | 1;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

export class SectionBox {
  readonly planes: THREE.Plane[] = [];
  private readonly box = new THREE.Box3();
  private readonly overlay = new THREE.Scene();
  private readonly anchor = new THREE.Group();
  private readonly wire: THREE.LineSegments<
    THREE.EdgesGeometry,
    THREE.LineBasicMaterial
  >;
  private readonly handles: FaceHandle[] = [];
  private readonly gizmo: TransformControls;
  private readonly edit = new SplatEdit({ name: "Section box" });
  private readonly shape = new SplatEditSdf({
    type: SplatEditSdfType.BOX,
    invert: true,
    opacity: 0,
  });
  private readonly events = new AbortController();
  private readonly enabledInput: HTMLInputElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly resizeButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private enabled = false;
  private resizing = true;
  private minimum = 0.1;
  private moveOrbitEnabled: boolean | undefined;
  private drag:
    | {
        id: number;
        face: FaceHandle;
        start: THREE.Vector2;
        box: THREE.Box3;
        pixelAxis: THREE.Vector2;
        worldPerPixel: number;
        orbitEnabled: boolean;
      }
    | undefined;

  constructor(
    private readonly options: {
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      canvas: HTMLCanvasElement;
      orbit: { enabled: boolean };
      toolbar: HTMLElement;
      bounds: () => THREE.Box3;
      onChange: () => void;
    },
  ) {
    const { scene, camera, canvas, toolbar } = options;
    const enabled = toolbar.querySelector<HTMLInputElement>("#section-enabled");
    const move = toolbar.querySelector<HTMLButtonElement>("#section-move");
    const resize = toolbar.querySelector<HTMLButtonElement>("#section-resize");
    const reset = toolbar.querySelector<HTMLButtonElement>("#section-reset");
    const hint = toolbar.querySelector<HTMLElement>("#section-hint");
    if (!enabled || !move || !resize || !reset || !hint)
      throw new Error("Missing section-box controls.");
    this.enabledInput = enabled;
    this.moveButton = move;
    this.resizeButton = resize;
    this.resetButton = reset;
    this.hint = hint;
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube),
      new THREE.LineBasicMaterial({
        color: 0xe5f5a1,
        transparent: true,
        opacity: 0.85,
      }),
    );
    cube.dispose();
    this.anchor.add(this.wire);
    this.overlay.add(this.anchor);
    this.overlay.background = null;
    for (const axis of ["x", "y", "z"] as const) {
      for (const side of [-1, 1] as const) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({
            color: axis === "x" ? 0xff7878 : axis === "y" ? 0x95e296 : 0x78b8ff,
          }),
        );
        this.handles.push({ axis, side, mesh });
        this.anchor.add(mesh);
      }
    }
    this.edit.add(this.shape);
    this.gizmo = new TransformControls(camera, canvas);
    this.gizmo.setMode("translate");
    this.gizmo.setSpace("world");
    this.gizmo.setSize(0.85);
    this.overlay.add(this.gizmo.getHelper());
    this.gizmo.addEventListener("dragging-changed", (event) => {
      if (event.value) {
        this.moveOrbitEnabled = options.orbit.enabled;
        options.orbit.enabled = false;
      } else if (this.moveOrbitEnabled !== undefined) {
        options.orbit.enabled = this.moveOrbitEnabled;
        this.moveOrbitEnabled = undefined;
      }
    });
    this.gizmo.addEventListener("objectChange", () => {
      const half = this.box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      this.box.set(
        this.anchor.position.clone().sub(half),
        this.anchor.position.clone().add(half),
      );
      this.changed();
    });
    const signal = this.events.signal;
    enabled.addEventListener(
      "change",
      () => {
        this.finishDrag();
        this.enabled = enabled.checked;
        if (this.enabled && this.box.isEmpty()) this.reset();
        if (this.box.isEmpty()) {
          this.enabled = false;
          enabled.checked = false;
        }
        if (this.enabled) scene.add(this.edit);
        else {
          scene.remove(this.edit);
          this.planes.length = 0;
        }
        this.changed();
        this.updateMode();
      },
      { signal },
    );
    move.addEventListener(
      "click",
      () => {
        this.finishDrag();
        this.resizing = false;
        this.updateMode();
      },
      { signal },
    );
    resize.addEventListener(
      "click",
      () => {
        this.finishDrag();
        this.resizing = true;
        this.updateMode();
      },
      { signal },
    );
    reset.addEventListener("click", () => this.reset(), { signal });
    canvas.addEventListener("pointerdown", this.pointerDown, {
      capture: true,
      signal,
    });
    canvas.addEventListener("pointermove", this.pointerMove, {
      capture: true,
      signal,
    });
    canvas.addEventListener("pointerup", this.pointerUp, {
      capture: true,
      signal,
    });
    canvas.addEventListener("pointercancel", () => this.finishDrag(), {
      capture: true,
      signal,
    });
    canvas.addEventListener("lostpointercapture", () => this.finishDrag(), {
      signal,
    });
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && this.drag) {
          this.box.copy(this.drag.box);
          this.changed();
          this.finishDrag();
        }
      },
      { signal },
    );
    this.updateMode();
  }

  setAvailable(available: boolean): void {
    this.enabledInput.disabled = !available;
  }

  private reset(): void {
    const bounds = this.options.bounds();
    if (bounds.isEmpty()) return;
    const length = bounds.getSize(new THREE.Vector3()).length();
    this.minimum = Math.max(0.01, length * 0.0001);
    this.box.copy(bounds).expandByScalar(Math.max(0.1, length * 0.02));
    this.changed();
  }

  private changed(): void {
    if (!this.box.isEmpty()) {
      const center = this.box.getCenter(new THREE.Vector3());
      const size = this.box.getSize(new THREE.Vector3());
      this.anchor.position.copy(center);
      this.wire.scale.copy(size);
      this.shape.position.copy(center);
      this.shape.scale.copy(size).multiplyScalar(0.5);
      for (const face of this.handles) {
        face.mesh.position.set(0, 0, 0);
        face.mesh.position[face.axis] = (face.side * size[face.axis]) / 2;
      }
      if (this.enabled) updateSectionPlanes(this.box, this.planes);
    }
    this.options.onChange();
  }

  private updateMode(): void {
    this.anchor.visible = this.enabled;
    this.moveButton.disabled =
      this.resizeButton.disabled =
      this.resetButton.disabled =
        !this.enabled;
    this.moveButton.setAttribute("aria-pressed", String(!this.resizing));
    this.resizeButton.setAttribute("aria-pressed", String(this.resizing));
    for (const face of this.handles)
      face.mesh.visible = this.enabled && this.resizing;
    if (this.enabled && !this.resizing) this.gizmo.attach(this.anchor);
    else this.gizmo.detach();
    this.gizmo.enabled = this.enabled && !this.resizing;
    this.hint.textContent = !this.enabled
      ? "Clip both layers with one box."
      : this.resizing
        ? "Drag a colored face handle to cut. Esc cancels a drag."
        : "Drag the arrows to move the box.";
  }

  private pointerDown = (event: PointerEvent): void => {
    if (!this.enabled || !this.resizing || event.button !== 0 || this.drag)
      return;
    const { canvas, camera, orbit } = this.options;
    const rect = canvas.getBoundingClientRect();
    this.anchor.updateMatrixWorld(true);
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = this.raycaster.intersectObjects(
      this.handles.map((face) => face.mesh),
      false,
    )[0];
    const face = hit && this.handles.find((face) => face.mesh === hit.object);
    if (!face) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const world = face.mesh.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3();
    direction[face.axis] = 1;
    const projected = world.clone().project(camera);
    const endpoint = world.clone().add(direction).project(camera);
    this.drag = {
      id: event.pointerId,
      face,
      start: new THREE.Vector2(event.clientX, event.clientY),
      box: this.box.clone(),
      pixelAxis: new THREE.Vector2(
        ((endpoint.x - projected.x) * rect.width) / 2,
        (-(endpoint.y - projected.y) * rect.height) / 2,
      ),
      worldPerPixel:
        (2 *
          camera.position.distanceTo(world) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
        rect.height,
      orbitEnabled: orbit.enabled,
    };
    orbit.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const { face, start, box, pixelAxis, worldPerPixel } = this.drag;
    const pixels = new THREE.Vector2(event.clientX, event.clientY).sub(start);
    const delta =
      pixelAxis.lengthSq() > 0.25
        ? pixels.dot(pixelAxis) / pixelAxis.lengthSq()
        : -pixels.y * worldPerPixel;
    this.box.copy(
      resizeSectionFace(box, face.axis, face.side, delta, this.minimum),
    );
    this.changed();
  };

  private pointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    event.stopImmediatePropagation();
    this.finishDrag();
  };

  private finishDrag(): void {
    finishSectionMove(this.gizmo, this.options.orbit, this.moveOrbitEnabled);
    this.moveOrbitEnabled = undefined;
    if (!this.drag) return;
    const { canvas, orbit } = this.options;
    const drag = this.drag;
    this.drag = undefined;
    orbit.enabled = drag.orbitEnabled;
    if (canvas.hasPointerCapture(drag.id))
      canvas.releasePointerCapture(drag.id);
    canvas.style.cursor = "";
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) return;
    const { camera, canvas } = this.options;
    const height = Math.max(1, canvas.clientHeight);
    for (const face of this.handles) {
      const distance = camera.position.distanceTo(
        face.mesh.getWorldPosition(new THREE.Vector3()),
      );
      face.mesh.scale.setScalar(
        (2 *
          distance *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
          7) /
          height,
      );
    }
    renderer.clippingPlanes = [];
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.overlay, camera);
    renderer.autoClear = true;
  }

  dispose(): void {
    this.finishDrag();
    this.events.abort();
    this.gizmo.dispose();
    this.options.scene.remove(this.edit);
    this.wire.geometry.dispose();
    this.wire.material.dispose();
    for (const face of this.handles) {
      face.mesh.geometry.dispose();
      face.mesh.material.dispose();
    }
  }
}
