import { dyno, readRgbaArray, SplatMesh } from "@sparkjsdev/spark";
import type { GsplatModifier, RgbaArray } from "@sparkjsdev/spark";
import { createSelectionTexture } from "./asset-selection";
import { SegmentCollection } from "./segments-model";
import type { Segment, SegmentGroup, SegmentLayer } from "./segments-model";
import { classificationButton, classificationIcon, classificationToggle } from "./classification-icons";
import type { ClassificationIcon } from "./classification-icons";
import { TargetLayerPicker } from "./target-layer-picker";

export class SegmentPanel {
  private readonly model = new SegmentCollection();
  private readonly list = document.querySelector<HTMLDivElement>("#segment-list")!;
  private readonly status = document.querySelector<HTMLParagraphElement>("#segment-status")!;
  private readonly target = new TargetLayerPicker(id => this.setActiveLayer(id));
  private readonly colors = document.querySelector<HTMLInputElement>("#segment-colors")!;
  private readonly context = document.querySelector<HTMLInputElement>("#segment-context")!;
  private readonly createDialog = document.querySelector<HTMLDialogElement>("#segment-create-dialog")!;
  private readonly deleteDialog = document.querySelector<HTMLDialogElement>("#segment-delete-dialog")!;
  private readonly nameDialog = document.querySelector<HTMLDialogElement>("#segment-name-dialog")!;
  private pendingClassification: { ids: number[]; layerId: number } | undefined;
  private container: { kind: "group" | "layer"; id: number } | undefined;
  private deleting: { kind: "group" | "layer"; id: number } | undefined;
  private readonly events = new AbortController();
  private readonly selected = new Set<number>();
  private readonly expanded = new Map<string, boolean>();
  private filter = "";
  private mesh: SplatMesh | undefined;
  private rgba: RgbaArray | undefined;
  private modifier: GsplatModifier | undefined;

  constructor(private readonly actions: { select: (indices: Uint32Array) => void; clear: () => void; error: (error: unknown) => void }) {
    const signal = this.events.signal;
    for (const [id, icon, label] of [
      ["segment-classify", "classify", "Classify selected objects into the Target Layer"],
      ["segment-unclassify", "unclassify", "Unclassify selected objects"],
      ["segment-clear-highlight", "clear", "Clear selection"],
      ["segment-add-group", "group", "Add Group"],
      ["segment-add-layer", "layer", "Add Layer"],
      ["segment-delete", "remove", "Delete selected group or layer"],
    ] as const) classificationButton(document.querySelector<HTMLButtonElement>(`#${id}`)!, icon, label);
    for (const [id, text] of [["segment-classify", "Classify"], ["segment-unclassify", "Unclassify"]] as const) {
      const label = document.createElement("span");
      label.textContent = text;
      document.querySelector(`#${id}`)!.append(label);
    }
    classificationToggle(this.colors, "colors", "Display classification colors (off: original colors)");
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
        if (kind === "layer" && this.container?.kind === "group")
          document.querySelector<HTMLSelectElement>("#segment-new-layer-group")!.value = String(this.container.id);
        this.createDialog.showModal();
        document.querySelector<HTMLInputElement>(`#segment-${kind}-name`)!.focus();
      }, { signal });
    document.querySelector("#segment-create-cancel")!.addEventListener("click", () => this.createDialog.close(), { signal });
    document.querySelector("#segment-delete")!.addEventListener("click", () => this.confirmDelete(), { signal });
    document.querySelector("#segment-delete-cancel")!.addEventListener("click", () => this.deleteDialog.close(), { signal });
    this.deleteDialog.addEventListener("close", () => { if (!this.deleteDialog.open) this.deleting = undefined; }, { signal });
    document.querySelector("#segment-delete-form")!.addEventListener("submit", event => {
      event.preventDefault();
      if (!this.deleting) return;
      const destination = document.querySelector<HTMLSelectElement>("#segment-delete-destination")!.value;
      try {
        this.model.deleteContainer(this.deleting.kind, this.deleting.id, destination ? Number(destination) : null);
        this.container = undefined;
        this.deleteDialog.close();
        this.changed();
      } catch (error) { actions.error(error); }
    }, { signal });
    document.querySelector<HTMLInputElement>("#segment-filter")!.addEventListener("input", event => {
      if (event.target instanceof HTMLInputElement) { this.filter = event.target.value.toLocaleLowerCase(); this.render(); }
    }, { signal });
    document.querySelector("#segment-clear-highlight")!.addEventListener("click", () => this.clearSelection(), { signal });
    document.querySelector("#segment-classify")!.addEventListener("click", () => this.beginClassification(), { signal });
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
        const group = this.model.createGroup(input.value);
        this.revealContainer("group", group.id, group.id);
        input.value = "";
        this.createDialog.close();
        this.render();
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
      } catch (error) { this.creationError(error); }
    }, { signal });
    this.render();
  }

  setScan(mesh: SplatMesh | undefined): void {
    const preserveHierarchy = !this.mesh && Boolean(mesh);
    this.createDialog.close();
    this.deleteDialog.close();
    this.nameDialog.close();
    this.pendingClassification = undefined;
    this.target.close(false);
    this.container = undefined;
    this.release();
    this.mesh = mesh;
    this.model.reset(mesh?.numSplats ?? 0, preserveHierarchy);
    this.selected.clear();
    this.expanded.clear();
    this.filter = "";
    document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
    this.colors.checked = false;
    this.context.checked = true;
    this.context.disabled = !mesh;
    this.colors.closest("label")!.title = "Original colors · switch to classification colors";
    this.colors.disabled = !mesh;
    this.render();
  }

  add(labels: Uint8Array, prompt: string): void {
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
    this.selected.clear();
    for (const segment of this.model.segments)
      if (!previous.has(segment.id) && this.model.isVisible(segment)) this.selected.add(segment.id);
    this.paint();
    this.highlight();
    this.render();
    this.status.textContent = !added ? "No visible splat centers matched. Adjust the view or section box and retry."
      : !this.model.unclassifiedVisible ? `${added} objects added. Turn on Unclassified to select and review them.`
      : `${added} SAM objects selected in Unclassified.`;
  }

  clearSelection(): void { this.selected.clear(); this.actions.clear(); this.render(); }

  visibility(): Uint8Array | undefined {
    return this.model.contextVisible && this.model.unclassifiedVisible && this.model.segments.every(segment => this.model.isVisible(segment))
      ? undefined : this.model.visibility();
  }

  private changed(): void { this.selected.clear(); this.actions.clear(); this.paint(); this.render(); }

  private setActiveLayer(id: number): void {
    const layer = this.model.layers.find(layer => layer.id === id);
    if (!layer) return;
    this.model.targetLayerId = id;
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
    button.disabled = !this.container;
    const item = this.container && (this.container.kind === "group" ? this.model.groups : this.model.layers).find(item => item.id === this.container?.id);
    button.title = item ? `Delete ${this.container!.kind} ${item.name}` : "Select a group or layer to delete";
    button.setAttribute("aria-label", button.title);
  }

  private confirmDelete(): void {
    const container = this.container;
    if (!container) return;
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
    const items = this.model.segments.filter(segment => this.selected.has(segment.id));
    if (!items.length) { this.actions.clear(); return; }
    const indices = new Uint32Array(items.reduce((count, segment) => count + segment.indices.length, 0));
    let offset = 0;
    for (const segment of items) { indices.set(segment.indices, offset); offset += segment.indices.length; }
    this.actions.select(indices);
  }

  private button(icon: ClassificationIcon, label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    classificationButton(button, icon, label);
    button.addEventListener("click", action);
    return button;
  }

  private eye(name: string, checked: boolean, change: (visible: boolean) => void): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "segment-visible classification-toggle classification-visibility";
    label.title = `${checked ? "Hide" : "Show"} ${name}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.setAttribute("aria-label", `Show ${name}`);
    input.addEventListener("change", () => { change(input.checked); this.changed(); });
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
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = this.selected.has(segment.id);
    select.disabled = !this.model.isVisible(segment);
    select.setAttribute("aria-label", `Select mesh ${segment.name}`);
    select.addEventListener("change", () => {
      if (select.checked) this.selected.add(segment.id); else this.selected.delete(segment.id);
      this.highlight();
      this.render();
    });
    const icon = classificationIcon(segment.layerId === null ? "mesh" : "classifiedMesh");
    icon.classList.add("segment-mesh-icon");
    row.append(select, icon,
      this.name(segment.name, `Mesh name ${segment.name}`, name => this.model.update(segment.id, { name }), 120),
      this.eye(`mesh ${segment.name}`, segment.visible, visible => this.model.update(segment.id, { visible })));
    return row;
  }

  private matches(segment: Segment): boolean {
    const layer = this.model.layers.find(layer => layer.id === segment.layerId);
    const group = this.model.groups.find(group => group.id === layer?.groupId);
    return `${segment.name} ${layer?.name ?? "Unclassified"} ${group?.name ?? ""}`.toLocaleLowerCase().includes(this.filter);
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
    color.setAttribute("aria-label", `Color of layer ${layer.name}`);
    color.title = `Change color of layer ${layer.name}`;
    color.addEventListener("input", () => { layer.color = color.value; this.paint(); });
    const target = this.button("activeLayer", `Set active layer ${layer.name}`, () => this.setActiveLayer(layer.id));
    target.setAttribute("aria-pressed", String(this.model.targetLayerId === layer.id));
    row.replaceChildren(classificationIcon("layerItem"), name, color, target, this.eye(`layer ${layer.name}`, layer.visible, visible => { layer.visible = visible; }));
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
    this.refreshOptions();
    this.list.replaceChildren();
    document.querySelector("#segment-count")!.textContent = String(this.model.segments.length);
    this.status.textContent = `${this.selected.size} selected · ${this.model.layers.length} layers. Use SAM to segment and select elements.`;
    document.querySelector<HTMLButtonElement>("#segment-classify")!.disabled = !this.selected.size || this.model.targetLayerId === null;
    document.querySelector<HTMLButtonElement>("#segment-unclassify")!.disabled = !this.model.segments.some(segment => this.selected.has(segment.id) && segment.layerId !== null);
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
    this.markContainer();
  }

  private paint(): void {
    if (!this.mesh) return;
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
