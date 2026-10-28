import { mountAssetLibraryPicker } from "./asset-library-picker-root";
import { normalizedAsset } from "./asset-geometry";
import { libraryJson, loadAssetGeometry, parseCatalog } from "./asset-library-client";
import type { CatalogAsset } from "./asset-library-client";
import type { Segment } from "./segments-model";
import type { AssetPresentation, PlacedAssets } from "./placed-assets";

function control<T extends HTMLElement>(id: string): T { return document.querySelector<T>(`#${id}`)!; }
export class AssetAssignmentControls {
  private readonly dialog = control<HTMLDialogElement>("asset-assignment-dialog");
  private readonly apply = control<HTMLButtonElement>("asset-assignment-apply");
  private readonly status = control<HTMLElement>("asset-assignment-status");
  private readonly events = new AbortController();
  private request: AbortController | undefined;
  private previewRequest: AbortController | undefined;
  private disposePreview: (() => void) | undefined;
  private previewAsset: CatalogAsset | undefined;
  private selectedId = "";
  private session = 0;
  private readonly picker = mountAssetLibraryPicker(control("asset-library-picker"));
  private catalog: CatalogAsset[] = [];
  private scope: { segment: Segment; indices: Uint32Array }[] = [];
  private current: readonly Segment[] = [];
  private visible: (segment: Segment) => boolean = () => true;
  private busy = false;
  private presentation: AssetPresentation | undefined;
  constructor(private readonly placed: PlacedAssets, private readonly changed: (mode?: AssetPresentation["colorMode"]) => void) {
    const signal = this.events.signal;
    control("asset-assignment-close").addEventListener("click", () => this.close(), { signal });
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); }, { signal });
    this.dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); }, { signal });
    control("asset-library-retry").addEventListener("click", () => { void this.readCatalog(); }, { signal });
    this.apply.addEventListener("click", () => { void this.assign(); }, { signal });
    control("asset-preview-close").addEventListener("click", () => this.closePreview(), { signal });
    control("asset-preview-dialog").addEventListener("cancel", event => { event.preventDefault(); this.closePreview(); }, { signal });
    control("asset-preview-dialog").addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); }, { signal });
    control("asset-preview-assign").addEventListener("click", () => {
      if (!this.previewAsset) return;
      this.selectedId = this.previewAsset.id;
      this.closePreview(); this.buttons(); void this.assign();
    }, { signal });
  }
  sync(segments: readonly Segment[], visible: (segment: Segment) => boolean, presentation?: AssetPresentation): void {
    this.presentation = presentation;
    this.current = segments; this.visible = visible;
    if (this.dialog.open && !this.validScope()) this.close();
    this.placed.sync(segments, visible, presentation);
  }
  async open(segments: readonly Segment[]): Promise<void> {
    this.close();
    this.scope = segments.map(segment => ({ segment, indices: segment.indices }));
    this.status.textContent = "";
    control("asset-assignment-scope").textContent = `${segments.length} element${segments.length === 1 ? "" : "s"}: ${segments.length === 1 ? segments[0]!.name : "one asset occurrence per element"}`;
    this.catalog = []; this.selectedId = ""; this.session++;
    this.dialog.showModal(); this.buttons();
    await this.readCatalog();
  }
  private validScope(): boolean { return this.scope.length > 0 && this.scope.every(({ segment, indices }) => this.current.includes(segment) && segment.indices === indices); }
  private validateScope(): void {
    if (!this.validScope()) throw new Error("The element selection changed. Open Assign asset again.");
    if (this.scope.some(({ segment }) => !segment.pose)) throw new Error("Capture and detect again to record element positions and Z rotations.");
  }
  private async readCatalog(): Promise<void> {
    this.request?.abort(); const request = this.request = new AbortController();
    this.busy = true; this.buttons(); this.status.textContent = "Loading asset library…";
    try {
      const catalog = parseCatalog(await libraryJson("/api/local/assets", request.signal));
      if (request.signal.aborted) return;
      const names = new Set<string>();
      this.catalog = catalog.filter(asset => {
        const key = asset.name.trim().toLowerCase() || asset.id;
        if (names.has(key)) return false;
        names.add(key); return true;
      });
      this.selectedId = this.catalog[0]?.id ?? "";
      this.buttons(); this.status.textContent = `${this.catalog.length} assets`;
    } catch (error) { if (!request.signal.aborted) this.error(error); }
    finally { if (this.request === request) { this.busy = false; this.buttons(); } }
  }
  private buttons(): void {
    this.picker.render({ assets: this.catalog, selectedId: this.selectedId, busy: this.busy,
      onSelect: id => { this.selectedId = id; this.buttons(); },
      onPreview: asset => { void this.preview(asset); },
    }, this.session);
    this.apply.disabled = this.busy || !this.selectedId || !this.scope.length || this.scope.some(({ segment }) => !segment.pose);
    control<HTMLButtonElement>("asset-preview-assign").disabled = this.busy || !this.previewAsset || this.scope.some(({ segment }) => !segment.pose);
    control<HTMLButtonElement>("asset-library-retry").disabled = this.busy;
  }
  private async preview(asset: CatalogAsset): Promise<void> {
    this.closePreview(); const request = this.previewRequest = new AbortController();
    this.previewAsset = asset; this.buttons();
    control("asset-preview-title").textContent = asset.name;
    control("asset-preview-status").textContent = "Loading preview…";
    control<HTMLDialogElement>("asset-preview-dialog").showModal();
    try {
      const [{ geometry, up }, { showAssetPreview }] = await Promise.all([
        loadAssetGeometry(asset.id, request.signal), import("./asset-preview")
      ]);
      request.signal.throwIfAborted();
      this.disposePreview = showAssetPreview(control("asset-preview-viewport"), normalizedAsset(geometry, up));
      control("asset-preview-status").textContent = "Drag to orbit · Scroll to zoom";
    } catch (error) { if (!request.signal.aborted) control("asset-preview-status").textContent = error instanceof Error ? error.message : "Preview unavailable."; }
  }
  private closePreview(): void {
    this.previewRequest?.abort(); this.previewRequest = undefined; this.previewAsset = undefined;
    this.disposePreview?.(); this.disposePreview = undefined;
    control("asset-preview-viewport").replaceChildren();
    control<HTMLDialogElement>("asset-preview-dialog").close();
  }
  private async assign(): Promise<void> {
    try { this.validateScope(); } catch (error) { this.error(error); return; }
    const asset = this.catalog.find(row => row.id === this.selectedId);
    if (!asset) return;
    let sourceUp: "y" | "z" = "y";
    this.request?.abort(); const request = this.request = new AbortController();
    this.busy = true; this.buttons(); this.status.textContent = "Loading representative geometry…";
    try {
      if (!this.placed.has(asset.id, sourceUp)) {
        const loaded = await loadAssetGeometry(asset.id, request.signal);
        request.signal.throwIfAborted(); this.validateScope();
        asset.geometryKind = loaded.kind; sourceUp = loaded.up;
        this.placed.cache(asset.id, normalizedAsset(loaded.geometry, sourceUp), sourceUp);
      }
      request.signal.throwIfAborted(); this.validateScope();
      for (const { segment } of this.scope) segment.asset = { visible: segment.asset?.visible, color: segment.asset?.color, id: asset.id, name: asset.name, correctionZ: segment.asset?.correctionZ ?? 0, scale: segment.asset?.scale ?? 1, sourceUp };
      this.changed(); this.placed.sync(this.current, this.visible, this.presentation);
      this.status.textContent = `Assigned ${asset.name} to ${this.scope.length} elements. Close to inspect the viewer.`;
    } catch (error) { if (!request.signal.aborted) this.error(error); }
    finally { if (this.request === request) { this.busy = false; this.buttons(); } }
  }
  private error(error: unknown): void { this.status.textContent = error instanceof Error ? error.message : "Asset assignment failed."; }
  close(): void { this.closePreview(); this.request?.abort(); this.request = undefined; this.busy = false; this.dialog.close(); this.scope = []; }
  reset(): void { this.close(); this.current = []; this.placed.clear(); }
  dispose(): void { this.reset(); this.events.abort(); this.picker.dispose(); }
}
