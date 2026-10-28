import { estimateElementPose } from "./element-pose";
import { dyno, readRgbaArray, SplatMesh } from "@sparkjsdev/spark";
import type { GsplatModifier, RgbaArray } from "@sparkjsdev/spark";
import { createSelectionTexture } from "./asset-selection";
import { SegmentCollection } from "./segments-model";
import type { Segment, SegmentGroup, SegmentLayer } from "./segments-model";
import { classificationButton, classificationIcon, classificationToggle } from "./classification-icons";
import type { ClassificationIcon } from "./classification-icons";
import type { AssetPresentation } from "./placed-assets";
import { TargetLayerPicker } from "./target-layer-picker";

export class SegmentPanel {
  private readonly model = new SegmentCollection();
  private readonly list = document.querySelector<HTMLDivElement>("#segment-list")!;
  private readonly status = document.querySelector<HTMLParagraphElement>("#segment-status")!;
  private readonly target = new TargetLayerPicker(id => this.setActiveLayer(id));
  private readonly colors = document.querySelector<HTMLInputElement>("#segment-colors")!;
  private readonly scanVisible = document.querySelector<HTMLInputElement>("#segment-scan-visible")!;
  private readonly assetsVisible = document.querySelector<HTMLInputElement>("#segment-assets-visible")!;
  private readonly assetColorMode = document.querySelector<HTMLSelectElement>("#segment-asset-colors")!;
  private readonly context = document.querySelector<HTMLInputElement>("#segment-context")!;
  private readonly createDialog = document.querySelector<HTMLDialogElement>("#segment-create-dialog")!;
  private readonly deleteDialog = document.querySelector<HTMLDialogElement>("#segment-delete-dialog")!;
  private readonly nameDialog = document.querySelector<HTMLDialogElement>("#segment-name-dialog")!;
  private pendingClassification: { ids: number[]; layerId: number } | undefined;
  private container: { kind: "group" | "layer"; id: number } | undefined;
  private deleting: { kind: "group" | "layer"; id: number } | { kind: "elements"; ids: number[] } | { kind: "assets"; ids: number[] } | undefined;
  private readonly events = new AbortController();
  private readonly selected = new Set<number>();
  private readonly selectedAssets = new Set<number>();
  private assetAnchor: number | undefined;
  private selectionAnchor: number | undefined;
  private readonly expanded = new Map<string, boolean>();
  private filter = "";
  private mesh: SplatMesh | undefined;
  private rgba: RgbaArray | undefined;
  private modifier: GsplatModifier | undefined;

  constructor(private readonly actions: { select: (indices: Uint32Array) => void; clear: () => void; error: (error: unknown) => void; assignAssets?: (elements: readonly Segment[]) => void; syncAssets?: (elements: readonly Segment[], visible: (segment: Segment) => boolean, presentation?: AssetPresentation) => void; resetAssets?: () => void; scanVisibilityChanged?: (visible: boolean) => void }) {
    const signal = this.events.signal;
    for (const [id, icon, label] of [
      ["segment-classify", "classify", "Classify selected objects into the Target Layer"],
      ["segment-move", "move", "Move selected elements to the Target Layer; keep their names"],
      ["segment-unclassify", "unclassify", "Unclassify selected objects"],
      ["segment-clear-highlight", "clear", "Clear selection"],
      ["segment-add-group", "group", "Add Group"],
      ["segment-add-layer", "layer", "Add Layer"],
      ["segment-delete", "remove", "Delete selected elements, group or layer"],
    ] as const) classificationButton(document.querySelector<HTMLButtonElement>(`#${id}`)!, icon, label);
    for (const [id, text] of [["segment-classify", "Classify"], ["segment-move", "Move"], ["segment-unclassify", "Unclassify"]] as const) {
      const label = document.createElement("span");
      label.textContent = text;
      document.querySelector(`#${id}`)!.append(label);
    }
    classificationToggle(this.colors, "colors", "Display scan classification colors (off: original colors)");
    for (const [input, icon, name] of [[this.scanVisible, "unclassified", "Scan"], [this.assetsVisible, "classifiedMesh", "Assets"]] as const) {
      classificationToggle(input, icon, `Show ${name.toLowerCase()} (master visibility)`);
    }
    this.assetColorMode.value = "original";
    this.scanVisible.addEventListener("change", () => this.setScanVisibility(this.scanVisible.checked), { signal });
    this.assetsVisible.addEventListener("change", () => { this.model.assetsVisible = this.assetsVisible.checked; this.assetsChanged(); }, { signal });
    this.assetColorMode.addEventListener("change", () => this.assetsChanged(), { signal });
    classificationButton(document.querySelector<HTMLButtonElement>("#segment-assets-show")!, "eye", "Show selected assets");
    classificationButton(document.querySelector<HTMLButtonElement>("#segment-assets-hide")!, "eyeOff", "Hide selected assets");
    document.querySelector("#segment-assets-all")!.addEventListener("click", () => this.selectAllAssets(), { signal });
    for (const [id, visible] of [["segment-assets-show", true], ["segment-assets-hide", false]] as const)
      document.querySelector(`#${id}`)!.addEventListener("click", () => { for (const row of this.model.segments) if (row.asset && this.selectedAssets.has(row.id)) row.asset.visible = visible; this.assetsChanged(); }, { signal });
    document.querySelector<HTMLInputElement>("#segment-assets-color")!.addEventListener("input", event => {
      if (!(event.target instanceof HTMLInputElement)) return;
      for (const row of this.model.segments) if (row.asset && this.selectedAssets.has(row.id)) row.asset.color = event.target.value;
      this.assetsChanged("custom");
    }, { signal });
    this.context.addEventListener("change", () => { this.model.contextVisible = this.context.checked; this.changed(); }, { signal });
    this.colors.addEventListener("change", () => {
      this.colors.closest("label")!.title = this.colors.checked ? "Classification colors · switch to original colors" : "Original colors · switch to classification colors";
      this.paint();
    }, { signal });
    for (const kind of ["group", "layer"] as const)
      document.querySelector(`#segment-add-${kind}`)!.addEventListener("click", () => {
        document.querySelector<HTMLFormElement>("#segment-group-form")!.hidden = kind !== "group";
        document.querySelector<HTMLFormElement>("#segment-layer-form")!.hidden = kind !== "layer";
        document.querySelector("#segment-create-title")!.textContent = kind === "group" ? "Add Group" : "Add Layer";
        document.querySelector<HTMLElement>("#segment-create-error")!.hidden = true;
        this.configureCreationSelection(kind);
        if (kind === "layer" && this.container?.kind === "group")
          document.querySelector<HTMLSelectElement>("#segment-new-layer-group")!.value = String(this.container.id);
        this.createDialog.showModal();
        document.querySelector<HTMLInputElement>(`#segment-${kind}-name`)!.focus();
      }, { signal });
    document.querySelector("#segment-group-classify")!.addEventListener("change", () => this.updateFirstLayerField(), { signal });
    document.querySelector("#segment-create-cancel")!.addEventListener("click", () => this.createDialog.close(), { signal });
    document.querySelector("#segment-delete")!.addEventListener("click", () => this.confirmDelete(), { signal });
    document.querySelector("#segment-delete-cancel")!.addEventListener("click", () => this.deleteDialog.close(), { signal });
    this.deleteDialog.addEventListener("close", () => { if (!this.deleteDialog.open) this.deleting = undefined; }, { signal });
    document.querySelector("#segment-delete-form")!.addEventListener("submit", event => {
      event.preventDefault();
      if (!this.deleting) return;
      const destination = document.querySelector<HTMLSelectElement>("#segment-delete-destination")!.value;
      try {
        if (this.deleting.kind === "assets") {
          for (const row of this.model.segments) if (this.deleting.ids.includes(row.id)) delete row.asset;
        } else if (this.deleting.kind === "elements") {
          for (const id of this.deleting.ids) this.model.remove(id);
        } else this.model.deleteContainer(this.deleting.kind, this.deleting.id, destination ? Number(destination) : null);
        this.deleting = undefined;
        this.container = undefined;
        this.deleteDialog.close();
        this.changed();
      } catch (error) { actions.error(error); }
    }, { signal });
    document.querySelector<HTMLInputElement>("#segment-filter")!.addEventListener("input", event => {
      if (event.target instanceof HTMLInputElement) { this.filter = event.target.value.toLocaleLowerCase(); this.render(); }
    }, { signal });
    this.list.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.clearSelection(); }
    }, { signal });
    document.querySelector("#segment-clear-highlight")!.addEventListener("click", () => this.clearSelection(), { signal });
    document.querySelector("#segment-classify")!.addEventListener("click", () => this.beginClassification(), { signal });
    document.querySelector("#segment-move")!.addEventListener("click", () => {
      const layerId = this.model.targetLayerId;
      if (layerId === null) return;
      try {
        this.model.move([...this.selected], layerId);
        this.expanded.set(`layer-${layerId}`, true);
        this.setActiveLayer(layerId);
        this.changed();
      } catch (error) { actions.error(error); }
    }, { signal });
    document.querySelector("#segment-unclassify")!.addEventListener("click", () => {
      this.model.unclassify([...this.selected]);
      this.filter = "";
      document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
      this.expanded.set("unclassified", true);
      this.changed();
    }, { signal });
    document.querySelector("#segment-name-cancel")!.addEventListener("click", () => this.nameDialog.close(), { signal });
    this.nameDialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); }, { signal });
    this.nameDialog.addEventListener("close", () => { if (!this.nameDialog.open) this.pendingClassification = undefined; }, { signal });
    document.querySelector("#segment-name-form")!.addEventListener("submit", event => {
      event.preventDefault();
      const pending = this.pendingClassification;
      if (!pending) return;
      const names = [...document.querySelector("#segment-classify-names")!.querySelectorAll<HTMLInputElement>("input")];
      try {
        this.model.classifyNamed(pending.ids.map((id, index) => ({ id, name: names[index]?.value ?? "" })), pending.layerId);
        this.pendingClassification = undefined;
        this.nameDialog.close();
        this.expanded.set(`layer-${pending.layerId}`, true);
        this.setActiveLayer(pending.layerId);
        this.changed();
      } catch (error) {
        const message = document.querySelector<HTMLElement>("#segment-name-error")!;
        message.textContent = error instanceof Error ? error.message : "Could not classify these meshes.";
        message.hidden = false;
      }
    }, { signal });
    document.querySelector("#segment-group-form")!.addEventListener("submit", event => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("#segment-group-name")!;
      try {
        const include = document.querySelector<HTMLInputElement>("#segment-group-classify")!.checked && this.selected.size > 0;
        const layerName = document.querySelector<HTMLInputElement>("#segment-group-layer-name")!.value.trim();
        if (include && !layerName) throw new Error("Enter a first layer name.");
        const group = this.model.createGroup(input.value);
        if (include) this.model.targetLayerId = this.model.createLayer(layerName, group.id).id;
        this.revealContainer("group", group.id, group.id);
        input.value = "";
        this.createDialog.close();
        this.render();
        if (include) this.beginClassification();
      }
      catch (error) { this.creationError(error); }
    }, { signal });
    document.querySelector("#segment-layer-form")!.addEventListener("submit", event => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("#segment-layer-name")!;
      const group = document.querySelector<HTMLSelectElement>("#segment-new-layer-group")!;
      try {
        const layer = this.model.createLayer(input.value, group.value ? Number(group.value) : null);
        this.model.targetLayerId = layer.id;
        this.revealContainer("layer", layer.id, layer.groupId);
        input.value = "";
        this.createDialog.close();
        this.render();
        if (document.querySelector<HTMLInputElement>("#segment-layer-classify")!.checked && this.selected.size) this.beginClassification();
      } catch (error) { this.creationError(error); }
    }, { signal });
    this.render();
  }

  setScan(mesh: SplatMesh | undefined): void {
    this.actions.resetAssets?.();
    const preserveHierarchy = !this.mesh && Boolean(mesh);
    this.deleting = undefined;
    this.createDialog.close();
    this.deleteDialog.close();
    this.nameDialog.close();
    this.pendingClassification = undefined;
    this.target.close(false);
    this.container = undefined;
    this.release();
    this.mesh = mesh;
    this.model.reset(mesh?.numSplats ?? 0, preserveHierarchy);
    this.selected.clear(); this.selectedAssets.clear(); this.assetAnchor = undefined;
    this.selectionAnchor = undefined;
    this.expanded.clear();
    this.filter = "";
    document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
    this.scanVisible.checked = this.assetsVisible.checked = true;
    this.actions.scanVisibilityChanged?.(true);
    this.assetColorMode.value = "original";
    this.colors.checked = false;
    this.context.checked = true;
    this.context.disabled = !mesh;
    this.colors.closest("label")!.title = "Original colors · switch to classification colors";
    this.colors.disabled = !mesh;
    this.render();
  }

  add(labels: Uint8Array, prompt: string): void {
    this.deleting = undefined;
    this.deleteDialog.close();
    this.container = undefined;
    this.createDialog.close();
    this.nameDialog.close();
    this.pendingClassification = undefined;
    const previous = new Set(this.model.segments.map(segment => segment.id));
    const added = this.model.add(labels, prompt);
    if (added) {
      this.filter = "";
      document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
      this.expanded.set("unclassified", true);
      document.querySelector<HTMLDetailsElement>("#segments-panel")!.open = true;
    }
    this.selected.clear(); this.selectedAssets.clear(); this.assetAnchor = undefined;
    for (const segment of this.model.segments)
      if (!previous.has(segment.id) && this.model.isVisible(segment)) this.selected.add(segment.id);
    this.selectionAnchor = [...this.selected][0];
    this.recordPoses();
    this.paint();
    this.highlight();
    this.render();
    this.status.textContent = !added ? "No visible splat centers matched. Adjust the view or section box and retry."
      : !this.model.unclassifiedVisible ? `${added} objects added. Turn on Unclassified to select and review them.`
      : `${added} SAM objects selected in Unclassified.`;
  }

  recordPoses(): void {
    const mesh = this.mesh;
    if (!mesh?.extSplats) return;
    mesh.updateMatrix();
    for (const segment of this.model.segments)
      segment.pose = estimateElementPose(segment.indices.length, i => mesh.extSplats!.getSplat(segment.indices[i]!).center.applyMatrix4(mesh.matrix));
    this.assetsChanged();
  }

  get isScanVisible(): boolean { return this.model.scanVisible; }
  setScanVisibility(visible: boolean, options: { preserveSelection?: boolean } = {}): void {
    this.model.scanVisible = this.scanVisible.checked = visible;
    this.actions.scanVisibilityChanged?.(visible);
    if (options.preserveSelection) { this.paint(); this.render(); }
    else this.changed();
  }

  assetsChanged(mode?: AssetPresentation["colorMode"]): void { if (mode) this.assetColorMode.value = mode; this.render(); }

  clearSelection(): void { this.selected.clear(); this.selectedAssets.clear(); this.assetAnchor = undefined; this.selectionAnchor = undefined; this.actions.clear(); this.render(); }

  visibility(): Uint8Array | undefined {
    return this.model.scanVisible && this.model.contextVisible && this.model.unclassifiedVisible && this.model.segments.every(segment => this.model.isVisible(segment))
      ? undefined : this.model.visibility();
  }

  private changed(): void { this.selected.clear(); this.selectedAssets.clear(); this.assetAnchor = undefined; this.selectionAnchor = undefined; this.actions.clear(); this.paint(); this.render(); }

  private chooseRow(id: number, kind: "scan" | "asset", event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void {
    const segment = this.model.segments.find(item => item.id === id);
    if (!segment || (kind === "scan" ? !this.model.isVisible(segment) : !segment.asset)) return;
    const selected = kind === "scan" ? this.selected : this.selectedAssets;
    if (kind === "scan") { this.selectedAssets.clear(); this.assetAnchor = undefined; } else { this.selected.clear(); this.selectionAnchor = undefined; }
    const ordered = this.visibleRowIds(kind);
    const anchor = kind === "scan" ? this.selectionAnchor : this.assetAnchor;
    const first = anchor === undefined ? -1 : ordered.indexOf(anchor), last = ordered.indexOf(id);
    if (event.shiftKey && first >= 0 && last >= 0) {
      if (!event.ctrlKey && !event.metaKey) selected.clear();
      for (const item of ordered.slice(Math.min(first, last), Math.max(first, last) + 1)) selected.add(item);
    } else {
      if (event.ctrlKey || event.metaKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); }
      else { selected.clear(); selected.add(id); }
      if (kind === "scan") this.selectionAnchor = id; else this.assetAnchor = id;
    }
    this.container = undefined; this.highlight(); this.markSelection();
  }

  private visibleRowIds(kind: "scan" | "asset"): number[] {
    const selectable = new Set(this.model.segments.filter(segment => kind === "scan" ? this.model.isVisible(segment) : Boolean(segment.asset)).map(segment => segment.id));
    const key = kind === "scan" ? "objectId" : "assetId";
    return [...this.list.querySelectorAll<HTMLElement>(kind === "scan" ? "[data-object-id]" : "[data-asset-id]")]
      .filter(row => !row.closest("details:not([open])")).map(row => Number(row.dataset[key])).filter(id => selectable.has(id));
  }

  private selectAllAssets(): void {
    this.selected.clear(); this.selectionAnchor = undefined; this.selectedAssets.clear(); this.container = undefined;
    for (const row of this.model.segments) if (row.asset) this.selectedAssets.add(row.id);
    this.filter = ""; document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
    for (const key of ["root", "unclassified", ...this.model.groups.map(g => `group-${g.id}`), ...this.model.layers.map(l => `layer-${l.id}`)]) this.expanded.set(key, true);
    this.assetAnchor = [...this.selectedAssets][0]; this.highlight(); this.render();
  }

  private bindRowSelection(row: HTMLElement, id: number, kind: "scan" | "asset"): void {
    row.addEventListener("click", event => { if (event.ctrlKey || event.metaKey || event.shiftKey) event.preventDefault(); this.chooseRow(id, kind, event); });
    row.addEventListener("keydown", event => {
      if (event.target !== row) return;
      if (kind === "asset" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); this.selectAllAssets(); return; }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.chooseRow(id, kind, event); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const ids = this.visibleRowIds(kind), next = ids[ids.indexOf(id) + (event.key === "ArrowDown" ? 1 : -1)];
        if (next !== undefined) {
          if (!event.ctrlKey && !event.metaKey) this.chooseRow(next, kind, event);
          this.list.querySelector<HTMLElement>(`[data-${kind === "scan" ? "object" : "asset"}-id="${next}"]`)?.focus();
        }
      }
    });
  }

  private markSelection(): void {
    this.markContainer();
    for (const row of this.list.querySelectorAll<HTMLElement>("[data-object-id]")) {
      const selected = this.selected.has(Number(row.dataset.objectId));
      row.setAttribute("data-selected", String(selected));
      row.setAttribute("aria-description", `${selected ? "Selected" : "Not selected"}. Ctrl+click toggles selection; Shift+click selects a range.`);
    }
    for (const row of this.list.querySelectorAll<HTMLElement>("[data-object-id]")) row.setAttribute("data-linked", String(this.selectedAssets.has(Number(row.dataset.objectId))));
    for (const row of this.list.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      const id = Number(row.dataset.assetId), selected = this.selectedAssets.has(id);
      row.setAttribute("data-selected", String(selected)); row.setAttribute("data-linked", String(this.selected.has(id)));
      row.setAttribute("aria-description", `${selected ? "Selected" : "Not selected"}. Ctrl+click toggles; Shift+click selects an asset range.`);
    }
    document.querySelector("#segment-asset-selection-count")!.textContent = `${this.selectedAssets.size} assets selected`;
    for (const id of ["segment-assets-show", "segment-assets-hide", "segment-assets-color"]) document.querySelector<HTMLInputElement>(`#${id}`)!.disabled = !this.selectedAssets.size;
    const hasAssets = this.model.segments.some(row => row.asset);
    document.querySelector<HTMLButtonElement>("#segment-assets-all")!.disabled = !hasAssets;
    this.assetColorMode.disabled = this.assetsVisible.disabled = !hasAssets; this.scanVisible.disabled = !this.mesh;
    this.syncAssets();
    document.querySelector<HTMLButtonElement>("#segment-classify")!.disabled = !this.selected.size || this.model.targetLayerId === null;
    document.querySelector<HTMLButtonElement>("#segment-move")!.disabled = this.model.targetLayerId === null ||
      !this.model.segments.some(segment => this.selected.has(segment.id) && segment.layerId !== this.model.targetLayerId);
    document.querySelector<HTMLButtonElement>("#segment-unclassify")!.disabled = !this.model.segments.some(segment => this.selected.has(segment.id) && segment.layerId !== null);
  }

  private setActiveLayer(id: number): void {
    const layer = this.model.layers.find(layer => layer.id === id);
    if (!layer) return;
    this.model.targetLayerId = id;
    document.querySelector<HTMLDetailsElement>("#segments-panel")!.open = true;
    this.filter = "";
    document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
    this.expanded.set("root", true);
    if (layer.groupId !== null) this.expanded.set(`group-${layer.groupId}`, true);
    this.render();
    this.list.querySelector<HTMLElement>(`[data-container="layer-${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private beginClassification(): void {
    const layerId = this.model.targetLayerId;
    const ids = [...this.selected];
    if (layerId === null || !ids.length) return;
    const names = this.model.classificationNames(ids, layerId);
    const fields = document.querySelector<HTMLDivElement>("#segment-classify-names")!;
    fields.replaceChildren();
    names.forEach((object, index) => {
      const label = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = `Mesh ${index + 1}`;
      const input = document.createElement("input");
      input.type = "text";
      input.required = true;
      input.maxLength = 120;
      input.value = object.name;
      input.setAttribute("aria-label", `Name for mesh ${index + 1}`);
      label.append(caption, input);
      fields.append(label);
    });
    document.querySelector("#segment-name-destination")!.textContent = `Target layer: ${this.model.layers.find(layer => layer.id === layerId)!.name}`;
    document.querySelector<HTMLElement>("#segment-name-error")!.hidden = true;
    this.pendingClassification = { ids, layerId };
    this.nameDialog.showModal();
    fields.querySelector<HTMLInputElement>("input")?.focus();
  }

  private revealContainer(kind: "group" | "layer", id: number, groupId: number | null): void {
    this.container = { kind, id };
    this.filter = "";
    document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
    this.expanded.set("root", true);
    if (groupId !== null) this.expanded.set(`group-${groupId}`, true);
    document.querySelector<HTMLDetailsElement>("#segments-panel")!.open = true;
  }

  private creationError(error: unknown): void {
    const message = document.querySelector<HTMLElement>("#segment-create-error")!;
    message.textContent = error instanceof Error ? error.message : "Could not create this item.";
    message.hidden = false;
  }

  private configureCreationSelection(kind: "group" | "layer"): void {
    const include = document.querySelector<HTMLInputElement>(`#segment-${kind}-classify`)!;
    include.checked = this.model.segments.some(segment => this.selected.has(segment.id) && segment.layerId === null);
    document.querySelector<HTMLElement>(`#segment-${kind}-selection`)!.hidden = !this.selected.size;
    document.querySelector(`#segment-${kind}-selection-text`)!.textContent = `Classify ${this.selected.size} selected elements`;
    if (kind === "group") this.updateFirstLayerField();
  }

  private updateFirstLayerField(): void {
    const include = document.querySelector<HTMLInputElement>("#segment-group-classify")!.checked;
    document.querySelector<HTMLElement>("#segment-group-layer-field")!.hidden = !include;
    const input = document.querySelector<HTMLInputElement>("#segment-group-layer-name")!;
    input.disabled = !include;
    input.required = include;
  }

  private chooseContainer(heading: HTMLElement, kind: "group" | "layer", id: number): void {
    const key = `${kind}-${id}`;
    heading.dataset.container = key;
    heading.addEventListener("click", () => {
      this.container = { kind, id };
      this.markContainer();
    });
    heading.addEventListener("focusin", () => {
      this.container = { kind, id };
      this.markContainer();
    });
  }

  private markContainer(): void {
    const key = this.container ? `${this.container.kind}-${this.container.id}` : "";
    for (const heading of this.list.querySelectorAll<HTMLElement>("[data-container]"))
      heading.classList.toggle("segment-container-selected", heading.dataset.container === key);
    const button = document.querySelector<HTMLButtonElement>("#segment-delete")!;
    button.disabled = !this.container && !this.selected.size && !this.selectedAssets.size;
    const item = this.container && (this.container.kind === "group" ? this.model.groups : this.model.layers).find(item => item.id === this.container?.id);
    button.title = item ? `Delete ${this.container!.kind} ${item.name}` : this.selectedAssets.size ? `Remove ${this.selectedAssets.size} selected asset assignments; preserve scan` : this.selected.size ? `Remove ${this.selected.size} selected elements from the list; preserve geometry` : "Select elements, a group or a layer to delete";
    button.setAttribute("aria-label", button.title);
  }

  private confirmDelete(): void {
    const container = this.container;
    const assignment = document.querySelector<HTMLElement>("#segment-delete-assignment")!;
    assignment.hidden = !container;
    if (!container) {
      if (this.selectedAssets.size) {
        this.deleting = { kind: "assets", ids: [...this.selectedAssets] };
        document.querySelector("#segment-delete-title")!.textContent = `Remove ${this.selectedAssets.size} asset assignments?`;
        document.querySelector("#segment-delete-description")!.textContent = "Only assigned assets are removed. The scan elements, classification and source geometry are preserved.";
        this.deleteDialog.showModal(); document.querySelector<HTMLButtonElement>("#segment-delete-confirm")!.focus(); return;
      }
      if (!this.selected.size) return;
      this.deleting = { kind: "elements", ids: [...this.selected] };
      document.querySelector("#segment-delete-title")!.textContent = `Remove ${this.selected.size} elements from the list?`;
      document.querySelector("#segment-delete-description")!.textContent = "Only element records and their classification are removed. The scan geometry is preserved and returns to the unsegmented context, following Unclassified visibility.";
      this.deleteDialog.showModal();
      document.querySelector<HTMLButtonElement>("#segment-delete-confirm")!.focus();
      return;
    }
    const item = (container.kind === "group" ? this.model.groups : this.model.layers).find(item => item.id === container.id);
    if (!item) return;
    const layers = this.model.layers.filter(layer => container.kind === "group" ? layer.groupId === container.id : layer.id === container.id);
    const ids = new Set(layers.map(layer => layer.id));
    const count = this.model.segments.filter(segment => segment.layerId !== null && ids.has(segment.layerId)).length;
    const destination = document.querySelector<HTMLSelectElement>("#segment-delete-destination")!;
    destination.replaceChildren(new Option("Unassign to Unclassified", ""));
    for (const layer of this.model.layers) if (!ids.has(layer.id)) {
      const group = this.model.groups.find(group => group.id === layer.groupId);
      destination.add(new Option(`Assign to ${group ? `${group.name} / ` : ""}${layer.name}`, String(layer.id)));
    }
    document.querySelector("#segment-delete-title")!.textContent = `Delete ${container.kind} “${item.name}”?`;
    document.querySelector("#segment-delete-description")!.textContent = `${count} objects will be preserved. ${container.kind === "group" ? `This also removes ${layers.length} layers in this group. ` : ""}Choose where the contained elements should go.`;
    this.deleting = container;
    this.deleteDialog.showModal();
    destination.focus();
  }

  private highlight(): void {
    const items = this.model.segments.filter(segment => this.selected.has(segment.id) || this.selectedAssets.has(segment.id));
    if (!items.length) { this.actions.clear(); return; }
    const indices = new Uint32Array(items.reduce((count, segment) => count + segment.indices.length, 0));
    let offset = 0;
    for (const segment of items) { indices.set(segment.indices, offset); offset += segment.indices.length; }
    this.actions.select(indices);
  }

  private assignButton(elements: () => readonly Segment[], label: string): HTMLButtonElement {
    const button = this.button("assignAsset", label, () => this.actions.assignAssets?.(elements()));
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
    button.disabled = !elements().length;
    return button;
  }

  private button(icon: ClassificationIcon, label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    classificationButton(button, icon, label);
    button.addEventListener("click", action);
    return button;
  }

  private eye(name: string, checked: boolean, change: (visible: boolean) => void, asset = false): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "segment-visible classification-toggle classification-visibility";
    label.title = `${checked ? "Hide" : "Show"} ${name}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.setAttribute("aria-label", `Show ${name}`);
    input.addEventListener("change", () => { change(input.checked); if (asset) this.assetsChanged(); else this.changed(); });
    const visible = classificationIcon("eye");
    visible.classList.add("icon-visible");
    const hidden = classificationIcon("eyeOff");
    hidden.classList.add("icon-hidden");
    label.append(input, visible, hidden);
    return label;
  }

  private name(value: string, label: string, change: (name: string) => void, maxLength = 80): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "segment-name";
    input.value = value;
    input.maxLength = maxLength;
    input.setAttribute("aria-label", label);
    input.title = label;
    input.addEventListener("change", () => { input.value = input.value.trim() || value; change(input.value); this.refreshOptions(); });
    return input;
  }

  private tree(title: string, key: string): { element: HTMLDetailsElement; heading: HTMLElement } {
    const element = document.createElement("details");
    element.className = "segment-tree";
    element.open = this.expanded.get(key) ?? true;
    element.addEventListener("toggle", () => this.expanded.set(key, element.open));
    const heading = document.createElement("summary");
    const text = document.createElement("span");
    text.textContent = title;
    heading.append(text);
    element.append(heading);
    return { element, heading };
  }

  private objectRow(segment: Segment): HTMLElement {
    const row = document.createElement("div");
    row.className = "segment-object-row";
    row.dataset.classified = String(segment.layerId !== null);
    row.dataset.objectId = String(segment.id);
    row.tabIndex = 0;
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `Select mesh ${segment.name}`);
    row.setAttribute("aria-disabled", String(!this.model.isVisible(segment)));
    row.title = "Click to select · Ctrl+click to add/remove · Shift+click for a range";
    this.bindRowSelection(row, segment.id, "scan");
    const icon = classificationIcon(segment.layerId === null ? "mesh" : "classifiedMesh");
    icon.classList.add("segment-mesh-icon");
    const visibility = this.eye(`mesh ${segment.name}`, segment.visible, visible => this.model.update(segment.id, { visible }));
    visibility.addEventListener("click", event => event.stopPropagation());
    row.append(icon,
      this.name(segment.name, `Mesh name ${segment.name}`, name => this.model.update(segment.id, { name }), 120),
      this.assignButton(() => [segment], `Assign asset to element ${segment.name}`), visibility);
    const element = document.createElement("div"); element.className = "segment-element"; element.append(row);
    if (segment.asset) element.append(this.assetRow(segment));
    return element;
  }

  private assetRow(segment: Segment): HTMLElement {
    const asset = segment.asset!;
    const row = document.createElement("div"); row.className = "segment-asset-row"; row.dataset.assetId = String(segment.id);
    row.tabIndex = 0; row.setAttribute("role", "group"); row.setAttribute("aria-label", `Select asset for ${segment.name}`);
    row.title = "Ctrl+click to add/remove · Shift+click for an asset range";
    this.bindRowSelection(row, segment.id, "asset");
    const name = document.createElement("span"); name.className = "segment-asset-name"; name.textContent = asset.name;
    name.setAttribute("aria-label", `Asset name for ${segment.name}`);
    const eye = this.eye(`asset for ${segment.name}`, asset.visible !== false, visible => { asset.visible = visible; }, true);
    eye.addEventListener("click", event => event.stopPropagation());
    row.append(classificationIcon("mesh"), name, eye); return row;
  }

  private matches(segment: Segment): boolean {
    const layer = this.model.layers.find(layer => layer.id === segment.layerId);
    const group = this.model.groups.find(group => group.id === layer?.groupId);
    return `${segment.name} ${segment.asset?.name ?? ""} ${layer?.name ?? "Unclassified"} ${group?.name ?? ""}`.toLocaleLowerCase().includes(this.filter);
  }

  private layer(layer: SegmentLayer): HTMLElement {
    const tree = this.tree("", `layer-${layer.id}`);
    const row = tree.heading;
    row.className = "segment-layer-row";
    row.classList.toggle("segment-active-layer", layer.id === this.model.targetLayerId);
    const name = this.name(layer.name, `Layer name ${layer.name}`, value => { layer.name = value; });
    const color = document.createElement("input");
    color.type = "color";
    color.value = layer.color;
    color.setAttribute("aria-label", `Scan color of layer ${layer.name}`);
    color.title = `Change scan color of layer ${layer.name}`;
    color.addEventListener("input", () => { layer.color = color.value; this.colors.checked = true; this.colors.dispatchEvent(new Event("change")); });
    const assetColor = document.createElement("input"); assetColor.type = "color"; assetColor.value = layer.assetColor ?? layer.color;
    assetColor.setAttribute("aria-label", `Asset color of layer ${layer.name}`); assetColor.title = `Change asset color of layer ${layer.name}`;
    assetColor.addEventListener("input", () => { layer.assetColor = assetColor.value; this.assetColorMode.value = "layer"; this.syncAssets(); });
    const scanEye = this.eye(`scans in layer ${layer.name}`, layer.scanVisible !== false, visible => { layer.scanVisible = visible; });
    const assetEye = this.eye(`assets in layer ${layer.name}`, layer.assetsVisible !== false, visible => { layer.assetsVisible = visible; }, true);
    classificationToggle(scanEye.querySelector<HTMLInputElement>("input")!, "unclassified", `Show scans in layer ${layer.name}`);
    classificationToggle(assetEye.querySelector<HTMLInputElement>("input")!, "classifiedMesh", `Show assets in layer ${layer.name}`);
    const target = this.button("activeLayer", `Set active layer ${layer.name}`, () => this.setActiveLayer(layer.id));
    target.setAttribute("aria-pressed", String(this.model.targetLayerId === layer.id));
    row.replaceChildren(classificationIcon("layerItem"), name, target, scanEye, color, assetEye, assetColor,
      this.assignButton(() => this.model.segments.filter(segment => segment.layerId === layer.id), `Assign asset to layer ${layer.name}`));
    this.chooseContainer(row, "layer", layer.id);
    const group = document.createElement("select");
    group.className = "segment-layer-group";
    group.hidden = true;
    group.setAttribute("aria-label", `Group of layer ${layer.name}`);
    group.title = `Move layer ${layer.name} to a group`;
    this.groupOptions(group);
    group.value = layer.groupId === null ? "" : String(layer.groupId);
    group.addEventListener("change", () => { layer.groupId = group.value ? Number(group.value) : null; this.changed(); });
    tree.element.append(group);
    for (const segment of this.model.segments)
      if (segment.layerId === layer.id && this.matches(segment)) tree.element.append(this.objectRow(segment));
    return tree.element;
  }

  private group(group: SegmentGroup): HTMLElement {
    const tree = this.tree("", `group-${group.id}`);
    tree.heading.classList.toggle("segment-active-group", this.model.layers.some(layer => layer.id === this.model.targetLayerId && layer.groupId === group.id));
    tree.heading.replaceChildren(classificationIcon("layerGroup"), this.name(group.name, `Group name ${group.name}`, value => { group.name = value; }),
      this.eye(`group ${group.name}`, group.visible, visible => { group.visible = visible; }));
    this.chooseContainer(tree.heading, "group", group.id);
    for (const layer of this.model.layers) if (layer.groupId === group.id && this.matchesLayer(layer)) tree.element.append(this.layer(layer));
    return tree.element;
  }

  private groupOptions(select: HTMLSelectElement): void {
    select.replaceChildren(new Option("No group", ""));
    for (const group of this.model.groups) select.add(new Option(group.name, String(group.id)));
  }

  private refreshOptions(): void {
    this.target.update(this.model.layers, this.model.groups, this.model.targetLayerId);
    const group = document.querySelector<HTMLSelectElement>("#segment-new-layer-group")!;
    const previous = group.value;
    this.groupOptions(group);
    group.value = this.model.groups.some(item => String(item.id) === previous) ? previous : "";
  }

  private matchesLayer(layer: SegmentLayer): boolean {
    const group = this.model.groups.find(group => group.id === layer.groupId);
    return `${layer.name} ${group?.name ?? ""}`.toLocaleLowerCase().includes(this.filter) ||
      this.model.segments.some(segment => segment.layerId === layer.id && this.matches(segment));
  }

  private render(): void {
    let pruned = false;
    for (const id of this.selectedAssets) if (!this.model.segments.some(row => row.id === id && row.asset)) { this.selectedAssets.delete(id); pruned = true; }
    if (pruned) { if (!this.selectedAssets.size) this.assetAnchor = undefined; this.highlight(); }
    this.refreshOptions();
    this.list.replaceChildren();
    document.querySelector("#segment-count")!.textContent = String(this.model.segments.length);
    this.status.textContent = `${this.selected.size} selected · ${this.model.layers.length} layers. Use SAM to segment and select elements.`;
    const unclassified = this.tree("Unclassified", "unclassified");
    unclassified.heading.className = "segment-layer-row segment-unclassified";
    const name = document.createElement("span");
    name.className = "segment-list-name";
    name.textContent = "Unclassified";
    unclassified.heading.replaceChildren(classificationIcon("unclassified"), name,
      this.eye("Unclassified", this.model.unclassifiedVisible, value => { this.model.unclassifiedVisible = value; }));
    for (const segment of this.model.segments)
      if (segment.layerId === null && this.matches(segment)) unclassified.element.append(this.objectRow(segment));
    const classified = this.tree("Root", "root");
    const rootName = classified.heading.firstElementChild!;
    classified.heading.replaceChildren(classificationIcon("classifiedRoot"), rootName,
      this.eye("Root", this.model.classifiedVisible, value => { this.model.classifiedVisible = value; }));
    for (const group of this.model.groups)
      if (group.name.toLocaleLowerCase().includes(this.filter) || this.model.layers.some(layer => layer.groupId === group.id && this.matchesLayer(layer))) classified.element.append(this.group(group));
    for (const layer of this.model.layers) if (layer.groupId === null && this.matchesLayer(layer)) classified.element.append(this.layer(layer));
    this.list.append(unclassified.element, classified.element);
    this.markSelection();
  }

  private syncAssets(): void {
    const colorMode = this.assetColorMode.value === "layer" || this.assetColorMode.value === "custom" ? this.assetColorMode.value : "original";
    this.actions.syncAssets?.(this.model.segments, segment => this.model.isAssetVisible(segment), { colorMode, layerColors: new Map(this.model.layers.map(layer => [layer.id, layer.assetColor ?? layer.color])), highlighted: new Set([...this.selected, ...this.selectedAssets]) });
  }

  private paint(): void {
    this.syncAssets();
    if (!this.mesh) return;
    this.mesh.visible = this.model.scanVisible;
    if (!this.model.scanVisible) { this.release(); return; }
    const visible = this.visibility();
    if (!visible && (!this.colors.checked || !this.model.segments.some(segment => segment.layerId !== null))) { this.release(); return; }
    if (!this.rgba) {
      const rgba = createSelectionTexture(this.mesh.numSplats);
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
    array.fill(255);
    if (visible) for (let i = 0; i < visible.length; i++) array[i * 4 + 3] = visible[i] ? 255 : 0;
    if (this.colors.checked) {
      for (const segment of this.model.segments) {
        const layer = this.model.layers.find(layer => layer.id === segment.layerId);
        if (!layer) continue;
        const color = [1, 3, 5].map(offset => Number.parseInt(layer.color.slice(offset, offset + 2), 16));
        for (const index of segment.indices) {
          array[index * 4] = color[0]!;
          array[index * 4 + 1] = color[1]!;
          array[index * 4 + 2] = color[2]!;
        }
      }
    }
    this.rgba.needsUpdate = true;
    this.mesh.updateVersion();
  }

  private release(): void {
    if (this.mesh && this.modifier) {
      this.mesh.objectModifiers = this.mesh.objectModifiers?.filter(item => item !== this.modifier);
      this.mesh.generatorDirty = true;
      this.mesh.updateVersion();
    }
    this.rgba?.dispose();
    this.rgba = undefined;
    this.modifier = undefined;
  }

  dispose(): void { this.createDialog.close(); this.deleteDialog.close(); this.nameDialog.close(); this.pendingClassification = undefined; this.target.dispose(); this.events.abort(); this.release(); }
}
