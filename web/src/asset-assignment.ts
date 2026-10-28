import { normalizedAsset } from "./asset-geometry";
import { libraryJson, loadAssetGeometry, parseCatalog } from "./asset-library-client";
import type { CatalogAsset } from "./asset-library-client";
import type { Segment } from "./segments-model";
import type { PlacedAssets } from "./placed-assets";

function control<T extends HTMLElement>(id: string): T { return document.querySelector<T>(`#${id}`)!; }
export class AssetAssignmentControls {
  private readonly dialog = control<HTMLDialogElement>("asset-assignment-dialog");
  private readonly choice = control<HTMLSelectElement>("asset-library-choice");
  private readonly apply = control<HTMLButtonElement>("asset-assignment-apply");
  private readonly correction = control<HTMLInputElement>("asset-rotation-correction");
  private readonly correct = control<HTMLButtonElement>("asset-correct-rotation");
  private readonly status = control<HTMLElement>("asset-assignment-status");
  private readonly events = new AbortController();
  private request: AbortController | undefined;
  private catalog: CatalogAsset[] = [];
  private scope: { segment: Segment; indices: Uint32Array }[] = [];
  private current: readonly Segment[] = [];
  private visible: (segment: Segment) => boolean = () => true;
  private busy = false;
  constructor(private readonly placed: PlacedAssets, private readonly changed: () => void) {
    const signal = this.events.signal;
    control("asset-assignment-close").addEventListener("click", () => this.close(), { signal });
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); }, { signal });
    this.dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); }, { signal });
    control("asset-library-retry").addEventListener("click", () => { void this.readCatalog(); }, { signal });
    control("asset-library-filter").addEventListener("input", () => this.filter(), { signal });
    control("asset-library-category").addEventListener("change", () => this.filter(), { signal });
    this.choice.addEventListener("change", () => this.buttons(), { signal });
    this.apply.addEventListener("click", () => { void this.assign(); }, { signal });
    this.correct.addEventListener("click", () => {
      try {
        this.validateScope();
        const correctionZ = this.angle();
        for (const { segment } of this.scope) if (segment.asset) segment.asset.correctionZ = correctionZ;
        this.changed();
        this.status.textContent = "Existing assets rotated around Z. Recorded detection angles are unchanged.";
      } catch (error) { this.error(error); }
    }, { signal });
  }
  sync(segments: readonly Segment[], visible: (segment: Segment) => boolean): void {
    this.current = segments; this.visible = visible;
    if (this.dialog.open && !this.validScope()) this.close();
    this.placed.sync(segments, visible);
  }
  async open(segments: readonly Segment[]): Promise<void> {
    this.close();
    this.scope = segments.map(segment => ({ segment, indices: segment.indices }));
    this.status.textContent = "";
    control("asset-assignment-scope").textContent = `${segments.length} element${segments.length === 1 ? "" : "s"}: ${segments.length === 1 ? segments[0]!.name : "one asset occurrence per element"}`;
    const poses = control("asset-pose-list"); poses.replaceChildren();
    for (const segment of segments) {
      const line = document.createElement("p"), pose = segment.pose;
      line.textContent = `${segment.name}: ${pose ? `XYZ ${pose.position.map(n => n.toFixed(3)).join(", ")} · Z ${(pose.z * 180 / Math.PI).toFixed(1)}°${pose.rotationReliable ? "" : " · uncertain heading (symmetric/round shape)"}` : "No recorded pose; capture and detect this element again."}${segment.asset ? ` · ${segment.asset.name}` : ""}`;
      poses.append(line);
    }
    const first = segments[0]?.asset;
    this.correction.value = String(first && segments.every(row => row.asset?.correctionZ === first.correctionZ) ? first.correctionZ * 180 / Math.PI : 0);
    control<HTMLSelectElement>("asset-source-up").value = first?.sourceUp ?? "y";
    control<HTMLSelectElement>("asset-unit-scale").value = String(first?.scale ?? 1);
    control<HTMLInputElement>("asset-library-filter").value = "";
    this.catalog = []; this.choice.replaceChildren();
    this.dialog.showModal(); this.buttons();
    await this.readCatalog();
  }
  private validScope(): boolean { return this.scope.length > 0 && this.scope.every(({ segment, indices }) => this.current.includes(segment) && segment.indices === indices); }
  private validateScope(): void {
    if (!this.validScope()) throw new Error("The element selection changed. Open Assign asset again.");
    if (this.scope.some(({ segment }) => !segment.pose)) throw new Error("Capture and detect again to record element positions and Z rotations.");
  }
  private angle(): number {
    const degrees = Number(this.correction.value);
    if (!this.correction.value.trim() || !Number.isFinite(degrees) || Math.abs(degrees) > 360) throw new Error("Enter a Z correction between -360° and 360°.");
    return degrees * Math.PI / 180;
  }
  private async readCatalog(): Promise<void> {
    this.request?.abort(); const request = this.request = new AbortController();
    this.busy = true; this.buttons(); this.status.textContent = "Loading asset library…";
    try {
      const catalog = parseCatalog(await libraryJson("/api/local/assets", request.signal));
      if (request.signal.aborted) return;
      this.catalog = catalog;
      const category = control<HTMLSelectElement>("asset-library-category");
      category.replaceChildren(new Option("All categories", ""));
      for (const name of [...new Set(catalog.map(row => row.category))].sort()) category.add(new Option(name, name));
      category.value = "";
      this.filter(); this.status.textContent = `${catalog.length} library assets. Choose an asset to load its geometry.`;
    } catch (error) { if (!request.signal.aborted) this.error(error); }
    finally { if (this.request === request) { this.busy = false; this.buttons(); } }
  }
  private filter(): void {
    const search = control<HTMLInputElement>("asset-library-filter").value.toLocaleLowerCase();
    const category = control<HTMLSelectElement>("asset-library-category").value;
    const previous = this.choice.value;
    const matches = this.catalog.filter(row => (!category || row.category === category) && `${row.name} ${row.category}`.toLocaleLowerCase().includes(search));
    this.choice.replaceChildren(...matches.map(row => new Option(`${row.name} · ${row.category}`, row.id)));
    this.choice.value = matches.some(row => row.id === previous) ? previous : matches[0]?.id ?? "";
    this.buttons();
  }
  private buttons(): void {
    for (const id of ["asset-library-choice", "asset-library-filter", "asset-library-category", "asset-source-up", "asset-unit-scale", "asset-rotation-correction"])
      control<HTMLInputElement | HTMLSelectElement>(id).disabled = this.busy;
    const sourceUp = control<HTMLSelectElement>("asset-source-up");
    const ifc = this.catalog.find(asset => asset.id === this.choice.value)?.geometryKind === "ifc";
    if (ifc) sourceUp.value = "y";
    sourceUp.disabled = this.busy || ifc;
    this.apply.disabled = this.busy || !this.choice.value || !this.scope.length || this.scope.some(({ segment }) => !segment.pose);
    this.correct.disabled = this.busy || !this.scope.some(({ segment }) => segment.asset);
    control<HTMLButtonElement>("asset-library-retry").disabled = this.busy;
  }
  private async assign(): Promise<void> {
    try { this.validateScope(); } catch (error) { this.error(error); return; }
    const asset = this.catalog.find(row => row.id === this.choice.value);
    if (!asset) return;
    let sourceUp: "y" | "z" = asset.geometryKind === "ifc" ? "y" : control<HTMLSelectElement>("asset-source-up").value === "z" ? "z" : "y";
    const scale = Number(control<HTMLSelectElement>("asset-unit-scale").value);
    let correctionZ: number;
    try { correctionZ = this.angle(); if (![1, 0.001, 0.01].includes(scale)) throw new Error("Choose an asset unit scale."); } catch (error) { this.error(error); return; }
    this.request?.abort(); const request = this.request = new AbortController();
    this.busy = true; this.buttons(); this.status.textContent = "Loading representative geometry…";
    try {
      if (!this.placed.has(asset.id, sourceUp)) {
        const loaded = await loadAssetGeometry(asset.id, request.signal);
        request.signal.throwIfAborted(); this.validateScope();
        asset.geometryKind = loaded.kind;
        if (loaded.kind === "ifc") sourceUp = loaded.up;
        this.placed.cache(asset.id, normalizedAsset(loaded.geometry, sourceUp), sourceUp);
      }
      request.signal.throwIfAborted(); this.validateScope();
      for (const { segment } of this.scope) segment.asset = { id: asset.id, name: asset.name, correctionZ, scale, sourceUp };
      this.changed(); this.placed.sync(this.current, this.visible);
      this.status.textContent = `Assigned ${asset.name} to ${this.scope.length} elements. Close to inspect the viewer; reopen to correct Z rotation.`;
    } catch (error) { if (!request.signal.aborted) this.error(error); }
    finally { if (this.request === request) { this.busy = false; this.buttons(); } }
  }
  private error(error: unknown): void { this.status.textContent = error instanceof Error ? error.message : "Asset assignment failed."; }
  close(): void { this.request?.abort(); this.request = undefined; this.busy = false; this.dialog.close(); this.scope = []; }
  reset(): void { this.close(); this.current = []; this.placed.clear(); }
  dispose(): void { this.reset(); this.events.abort(); }
}
