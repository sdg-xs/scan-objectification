import * as THREE from "three";
import { dyno, readRgbaArray, RgbaArray, SplatMesh } from "@sparkjsdev/spark";
import type { GsplatModifier } from "@sparkjsdev/spark";
import { selectAsset } from "./asset-selection-model";
import type { SelectionOperation } from "./asset-selection-model";
import type { ScreenMask } from "./asset-selection-model";
import type { SectionBox } from "./section-box";

export function createSelectionTexture(count: number): RgbaArray {
  const texture = new RgbaArray();
  texture.ensureCapacity(count);
  texture.count = count;
  return texture;
}

export class AssetSelection {
  private readonly tools = document.querySelector<HTMLFieldSetElement>("#asset-tools")!;
  private readonly draw = document.querySelector<HTMLButtonElement>("#asset-draw")!;
  private readonly isolate = document.querySelector<HTMLButtonElement>("#asset-isolate")!;
  private readonly label = document.querySelector<HTMLElement>("#asset-status")!;
  private readonly operation = document.querySelector<HTMLSelectElement>("#asset-operation")!;
  private readonly marquee = document.createElement("div");
  private readonly events = new AbortController();
  private mask: Uint8Array = new Uint8Array(0);
  private rgba: RgbaArray | undefined;
  private modifier: GsplatModifier | undefined;
  private mesh: SplatMesh | undefined;
  private bounds = new THREE.Box3();
  private count = 0;
  private revision = 0;
  private drawing = false;
  private busy = false;
  private restore: (() => void) | undefined;
  private drag: { id: number; x: number; y: number; orbit: boolean } | undefined;

  constructor(private readonly options: {
    viewport: HTMLElement;
    canvas: HTMLCanvasElement;
    camera: THREE.PerspectiveCamera;
    orbit: { enabled: boolean };
    section: SectionBox;
    frame: (bounds: THREE.Box3) => void;
    isolateContext: () => () => void;
    error: (error: unknown) => void;
  }) {
    this.marquee.className = "asset-marquee";
    this.marquee.hidden = true;
    options.viewport.append(this.marquee);
    const signal = this.events.signal;
    this.draw.addEventListener("click", () => this.setDrawing(!this.drawing), { signal });
    document.querySelector("#asset-clear")!.addEventListener("click", () => this.clear(), { signal });
    document.querySelector("#asset-section")!.addEventListener("click", () => {
      if (!options.section.getBounds()) {
        this.label.textContent = "Enable and adjust the section box first.";
        return;
      }
      void this.select();
    }, { signal });
    this.isolate.addEventListener("click", () => {
      if (this.restore) this.showContext();
      else if (this.count) {
        this.setDrawing(false);
        const sectionEnabled = Boolean(options.section.getBounds());
        options.section.setEnabled(false);
        options.section.setAvailable(false);
        const restoreContext = options.isolateContext();
        this.restore = () => {
          restoreContext();
          options.section.setAvailable(true);
          options.section.setEnabled(sectionEnabled);
        };
        this.isolate.textContent = "Show context";
        this.draw.disabled = true;
        document.querySelector<HTMLButtonElement>("#asset-section")!.disabled = true;
        options.frame(this.bounds);
      }
      this.paint();
    }, { signal });
    options.viewport.addEventListener("pointerdown", this.pointerDown, { capture: true, signal });
    options.viewport.addEventListener("pointermove", this.pointerMove, { capture: true, signal });
    options.viewport.addEventListener("pointerup", this.pointerUp, { capture: true, signal });
    options.canvas.addEventListener("pointercancel", () => this.cancelDrag(), { signal });
    options.canvas.addEventListener("lostpointercapture", () => this.cancelDrag(), { signal });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.cancelDrag();
        this.setDrawing(false);
        if (this.busy) {
          this.revision++;
          this.busy = false;
          this.tools.disabled = !this.mesh;
          this.label.textContent = "Selection canceled. Previous selection kept.";
        }
      }
    }, { signal });
  }

  setScan(mesh: SplatMesh | undefined): void {
    this.clear();
    this.mesh = mesh;
    this.mask = new Uint8Array(mesh?.numSplats ?? 0);
    this.tools.disabled = !mesh;
    this.label.textContent = mesh ? "Draw a box or select the section region." : "Load a scan to select an asset.";
  }

  getIsolatedBounds(): THREE.Box3 | undefined {
    return this.restore ? this.bounds.clone() : undefined;
  }

  clear(): void {
    this.revision++;
    this.busy = false;
    this.tools.disabled = !this.mesh;
    this.setDrawing(false);
    this.showContext();
    if (this.mesh && this.modifier) {
      this.mesh.objectModifiers = this.mesh.objectModifiers?.filter((item) => item !== this.modifier);
      this.mesh.generatorDirty = true;
      this.mesh.updateVersion();
    }
    this.rgba?.dispose();
    this.rgba = undefined;
    this.modifier = undefined;
    this.mask.fill(0);
    this.count = 0;
    this.isolate.disabled = true;
    this.label.textContent = "Selection cleared. Full scene restored.";
  }

  private showContext(): void {
    this.restore?.();
    this.restore = undefined;
    this.draw.disabled = false;
    document.querySelector<HTMLButtonElement>("#asset-section")!.disabled = false;
    this.isolate.textContent = "Isolate asset";
  }

  private setDrawing(value: boolean): void {
    this.cancelDrag();
    this.drawing = value;
    this.draw.setAttribute("aria-pressed", String(value));
    this.options.canvas.classList.toggle("asset-drawing", value);
    if (value) this.label.textContent = "Drag a box over the asset. Esc cancels. Selection includes depth.";
    else if (!this.busy) this.describeSelection();
  }

  private cancelDrag(): void {
    const drag = this.drag;
    this.drag = undefined;
    this.marquee.hidden = true;
    if (drag) {
      this.options.orbit.enabled = drag.orbit;
      if (this.options.canvas.hasPointerCapture(drag.id)) this.options.canvas.releasePointerCapture(drag.id);
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    if (!this.drawing || this.busy || event.button !== 0 || event.target !== this.options.canvas || this.drag) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, orbit: this.options.orbit.enabled };
    this.options.orbit.enabled = false;
    this.options.canvas.setPointerCapture(event.pointerId);
    this.pointerMove(event);
  };

  private pointerMove = (event: PointerEvent): void => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    event.stopImmediatePropagation();
    const rect = this.options.viewport.getBoundingClientRect();
    Object.assign(this.marquee.style, {
      left: `${Math.min(this.drag.x, event.clientX) - rect.left}px`,
      top: `${Math.min(this.drag.y, event.clientY) - rect.top}px`,
      width: `${Math.abs(event.clientX - this.drag.x)}px`,
      height: `${Math.abs(event.clientY - this.drag.y)}px`,
    });
    this.marquee.hidden = false;
  };

  private pointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    event.stopImmediatePropagation();
    const rect = this.options.canvas.getBoundingClientRect();
    this.cancelDrag();
    this.setDrawing(false);
    if (Math.abs(event.clientX - drag.x) < 3 || Math.abs(event.clientY - drag.y) < 3) return;
    const x = (value: number) => (value - rect.left) / rect.width * 2 - 1;
    const y = (value: number) => 1 - (value - rect.top) / rect.height * 2;
    void this.select([x(Math.min(drag.x, event.clientX)), y(Math.max(drag.y, event.clientY)), x(Math.max(drag.x, event.clientX)), y(Math.min(drag.y, event.clientY))]);
  };

  captureMaskSelection(): (mask: ScreenMask, signal?: AbortSignal) => Promise<void> {
    if (!this.mesh || this.restore || this.busy) throw new Error("Show context and finish the current selection before detection.");
    const mesh = this.mesh;
    mesh.updateWorldMatrix(true, false);
    this.options.camera.updateMatrixWorld();
    const world = mesh.matrixWorld.clone();
    const projection = new THREE.Matrix4().multiplyMatrices(this.options.camera.projectionMatrix, this.options.camera.matrixWorldInverse);
    const region = this.options.section.getBounds()?.clone();
    const revision = this.revision;
    return async (mask, signal) => {
      mesh.updateWorldMatrix(true, false);
      if (this.mesh !== mesh || this.revision !== revision || !mesh.matrixWorld.equals(world))
        throw new Error("The scan or selection changed. Capture a new view before selecting.");
      await this.select(undefined, { mask, projection, region, signal });
    };
  }

  private async select(rectangle?: readonly [number, number, number, number], captured?: { mask: ScreenMask; projection: THREE.Matrix4; region?: ReturnType<SectionBox["getBounds"]>; signal?: AbortSignal }): Promise<void> {
    const mesh = this.mesh;
    const source = mesh?.extSplats;
    if (!mesh || !source || this.busy || this.restore) return;
    const revision = ++this.revision;
    const value = this.operation.value;
    const operation: SelectionOperation = captured ? "replace" : value === "add" || value === "remove" ? value : "replace";
    this.busy = true;
    this.tools.disabled = true;
    this.label.textContent = "Selecting splats… Esc cancels.";
    mesh.updateWorldMatrix(true, false);
    this.options.camera.updateMatrixWorld();
    try {
      const result = await selectAsset({
        count: mesh.numSplats, center: (i) => source.getSplat(i).center,
        world: mesh.matrixWorld.clone(), previous: this.mask, operation,
        region: captured ? captured.region : this.options.section.getBounds(), rectangle,
        screenMask: captured?.mask,
        projection: captured?.projection ?? new THREE.Matrix4().multiplyMatrices(this.options.camera.projectionMatrix, this.options.camera.matrixWorldInverse),
        canceled: () => revision !== this.revision || Boolean(captured?.signal?.aborted),
      });
      if (captured?.signal?.aborted) throw new Error("Selection canceled");
      if (revision !== this.revision) {
        if (captured) throw new Error("Selection canceled");
        return;
      }
      this.mask = result.mask;
      this.bounds = result.bounds;
      this.count = result.count;
      this.isolate.disabled = !this.count;
      this.paint();
    } catch (error) {
      if (captured) throw error;
      if (revision === this.revision) this.options.error(error);
    } finally {
      if (revision === this.revision) {
        this.busy = false;
        this.tools.disabled = false;
      }
    }
  }

  private paint(): void {
    if (!this.mesh) return;
    if (!this.rgba) {
      const rgba = createSelectionTexture(this.mask.length);
      this.rgba = rgba;
      this.modifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
        if (!gsplat) throw new Error("Missing splat input");
        const split = dyno.splitGsplat(gsplat).outputs;
        return { gsplat: dyno.combineGsplat({ gsplat, rgba: dyno.mul(split.rgba, readRgbaArray(rgba.dyno, split.index)) }) };
      });
      this.mesh.objectModifiers = [...(this.mesh.objectModifiers ?? []), this.modifier];
      this.mesh.generatorDirty = true;
    }
    const array = this.rgba.array;
    if (!array) return;
    const isolated = Boolean(this.restore);
    for (let i = 0; i < this.mask.length; i++) {
      const selected = Boolean(this.mask[i]);
      const offset = i * 4;
      array[offset] = selected && !isolated ? 110 : 255;
      array[offset + 1] = 255;
      array[offset + 2] = selected && !isolated ? 180 : 255;
      array[offset + 3] = selected || !this.count ? 255 : isolated ? 0 : 35;
    }
    this.rgba.needsUpdate = true;
    this.mesh.updateVersion();
    this.describeSelection();
  }

  private describeSelection(): void {
    this.label.textContent = this.count ? `${this.count.toLocaleString()} splats selected · ${this.restore ? "isolated asset" : "green preview"}` : "No splats selected. Adjust the box and try again.";
  }

  dispose(): void {
    this.clear();
    this.events.abort();
    this.marquee.remove();
  }
}
