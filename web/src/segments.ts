import { dyno, readRgbaArray, SplatMesh } from "@sparkjsdev/spark";
import type { GsplatModifier, RgbaArray } from "@sparkjsdev/spark";
import { createSelectionTexture } from "./asset-selection";
import { SegmentCollection } from "./segments-model";
import type { Segment, SegmentGroup, SegmentLayer } from "./segments-model";
import { classificationButton, classificationIcon, classificationToggle } from "./classification-icons";
import type { ClassificationIcon } from "./classification-icons";

export class SegmentPanel {
  private readonly model = new SegmentCollection();
  private readonly list = document.querySelector<HTMLDivElement>("#segment-list")!;
  private readonly status = document.querySelector<HTMLParagraphElement>("#segment-status")!;
  private readonly target = document.querySelector<HTMLSelectElement>("#segment-target")!;
  private readonly colors = document.querySelector<HTMLInputElement>("#segment-colors")!;
  private readonly context = document.querySelector<HTMLInputElement>("#segment-context")!;
  private readonly createDialog = document.querySelector<HTMLDialogElement>("#segment-create-dialog")!;
  private readonly deleteDialog = document.querySelector<HTMLDialogElement>("#segment-delete-dialog")!;
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
        if (kind === "layer" && this.container?.kind === "group")
          document.querySelector<HTMLSelectElement>("#segment-new-layer-group")!.value = String(this.container.id);
        this.createDialog.showModal();
        document.querySelector<HTMLInputElement>(`#segment-${kind}-name`)!.focus();
      }, { signal });
    document.querySelector("#segment-create-cancel")!.addEventListener("click", () => this.createDialog.close(), { signal });
    document.querySelector("#segment-delete")!.addEventListener("click", () => this.confirmDelete(), { signal });
    document.querySelector("#segment-delete-cancel")!.addEventListener("click", () => this.deleteDialog.close(), { signal });
    this.deleteDialog.addEventListener("close", () => { this.deleting = undefined; }, { signal });
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
    this.target.addEventListener("change", () => { this.model.targetLayerId = this.target.value ? Number(this.target.value) : null; this.render(); }, { signal });
    document.querySelector<HTMLInputElement>("#segment-filter")!.addEventListener("input", event => {
      if (event.target instanceof HTMLInputElement) { this.filter = event.target.value.toLocaleLowerCase(); this.render(); }
    }, { signal });
    document.querySelector("#segment-clear-highlight")!.addEventListener("click", () => this.clearSelection(), { signal });
    document.querySelector("#segment-classify")!.addEventListener("click", () => {
      try { this.model.classify([...this.selected]); this.changed(); }
      catch (error) { actions.error(error); }
    }, { signal });
    document.querySelector("#segment-unclassify")!.addEventListener("click", () => { this.model.unclassify([...this.selected]); this.changed(); }, { signal });
    document.querySelector("#segment-group-form")!.addEventListener("submit", event => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("#segment-group-name")!;
      try { const group = this.model.createGroup(input.value); this.container = { kind: "group", id: group.id }; input.value = ""; this.createDialog.close(); this.render(); }
      catch (error) { actions.error(error); }
    }, { signal });
    document.querySelector("#segment-layer-form")!.addEventListener("submit", event => {
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>("#segment-layer-name")!;
      const group = document.querySelector<HTMLSelectElement>("#segment-new-layer-group")!;
      try {
        const layer = this.model.createLayer(input.value, group.value ? Number(group.value) : null);
        this.model.targetLayerId = layer.id;
        this.container = { kind: "layer", id: layer.id };
        input.value = "";
        this.createDialog.close();
        this.render();
      } catch (error) { actions.error(error); }
    }, { signal });
    this.render();
  }

  setScan(mesh: SplatMesh | undefined): void {
    this.createDialog.close();
    this.deleteDialog.close();
    this.container = undefined;
    this.release();
    this.mesh = mesh;
    this.model.reset(mesh?.numSplats ?? 0);
    this.selected.clear();
    this.expanded.clear();
    this.filter = "";
    document.querySelector<HTMLInputElement>("#segment-filter")!.value = "";
    this.colors.checked = false;
    this.context.checked = true;
    this.context.disabled = !mesh;
    this.colors.closest("label")!.title = "Original colors · switch to classification colors";
    this.colors.disabled = !mesh;
    for (const id of ["segment-add-group", "segment-add-layer"])
      document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = !mesh;
    for (const id of ["segment-group-tools", "segment-layer-tools"])
      document.querySelector<HTMLFieldSetElement>(`#${id}`)!.disabled = !mesh;
    this.render();
  }

  add(labels: Uint8Array, prompt: string): void {
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
      : `${added} SAM objects selected in Unclassified. Choose a target layer and Classify.`;
  }

  clearSelection(): void { this.selected.clear(); this.actions.clear(); this.render(); }

  visibility(): Uint8Array | undefined {
    return this.model.contextVisible && this.model.unclassifiedVisible && this.model.segments.every(segment => this.model.isVisible(segment))
      ? undefined : this.model.visibility();
  }

  private changed(): void { this.selected.clear(); this.actions.clear(); this.paint(); this.render(); }

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
    button.disabled = !this.mesh || !this.container;
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

  private name(value: string, label: string, change: (name: string) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "segment-name";
    input.value = value;
    input.maxLength = 80;
    input.setAttribute("aria-label", label);
    input.title = label;
    input.addEventListener("change", () => { input.value = input.value.trim() || value; change(input.value); this.refreshOptions(); });
    return input;
  }

  private row(segment: Segment): HTMLElement {
    const row = document.createElement("div");
    row.className = "segment-row";
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = this.selected.has(segment.id);
    select.disabled = !this.model.isVisible(segment);
    select.setAttribute("aria-label", `Select ${segment.name}`);
    select.title = `Select ${segment.name}`;
    select.addEventListener("change", () => {
      if (select.checked) this.selected.add(segment.id); else this.selected.delete(segment.id);
      this.highlight(); this.render();
    });
    const count = document.createElement("span");
    count.className = "segment-splats";
    count.textContent = segment.indices.length.toLocaleString();
    count.title = "Splats";
    row.append(select, this.name(segment.name, `Name of ${segment.name}`, name => this.model.update(segment.id, { name })), count,
      this.eye(segment.name, segment.visible, visible => this.model.update(segment.id, { visible })),
      this.button("remove", `Remove ${segment.name}; return its splats to unsegmented scan`, () => { this.model.remove(segment.id); this.changed(); }));
    return row;
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

  private matches(segment: Segment): boolean {
    const layer = this.model.layers.find(layer => layer.id === segment.layerId);
    const group = this.model.groups.find(group => group.id === layer?.groupId);
    return `${segment.name} ${layer?.name ?? "Unclassified"} ${group?.name ?? ""}`.toLocaleLowerCase().includes(this.filter);
  }

  private layer(layer: SegmentLayer): HTMLElement {
    const tree = this.tree("", `layer-${layer.id}`);
    const name = this.name(layer.name, `Layer name ${layer.name}`, value => { layer.name = value; });
    const color = document.createElement("input");
    color.type = "color";
    color.value = layer.color;
    color.setAttribute("aria-label", `Color of layer ${layer.name}`);
    color.title = `Change color of layer ${layer.name}`;
    color.addEventListener("input", () => { layer.color = color.value; this.paint(); });
    const target = this.button("target", `Set target layer ${layer.name}`, () => { this.model.targetLayerId = layer.id; this.render(); });
    target.setAttribute("aria-pressed", String(this.model.targetLayerId === layer.id));
    tree.heading.replaceChildren(color, name, target, this.eye(`layer ${layer.name}`, layer.visible, visible => { layer.visible = visible; }));
    this.chooseContainer(tree.heading, "layer", layer.id);
    const group = document.createElement("select");
    group.className = "segment-layer-group";
    group.setAttribute("aria-label", `Group of layer ${layer.name}`);
    group.title = `Move layer ${layer.name} to a group`;
    this.groupOptions(group);
    group.value = layer.groupId === null ? "" : String(layer.groupId);
    group.addEventListener("change", () => { layer.groupId = group.value ? Number(group.value) : null; this.changed(); });
    tree.element.append(group);
    for (const segment of this.model.segments)
      if (segment.layerId === layer.id && this.matches(segment)) tree.element.append(this.row(segment));
    return tree.element;
  }

  private group(group: SegmentGroup): HTMLElement {
    const tree = this.tree("", `group-${group.id}`);
    tree.heading.replaceChildren(classificationIcon("folder"), this.name(group.name, `Group name ${group.name}`, value => { group.name = value; }),
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
    this.target.replaceChildren(new Option("Choose target layer…", ""));
    for (const layer of this.model.layers) {
      const group = this.model.groups.find(group => group.id === layer.groupId);
      this.target.add(new Option(group ? `${group.name} / ${layer.name}` : layer.name, String(layer.id)));
    }
    this.target.value = this.model.targetLayerId === null ? "" : String(this.model.targetLayerId);
    this.target.disabled = !this.mesh || !this.model.layers.length;
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
    document.querySelector<HTMLButtonElement>("#segment-unclassify")!.disabled = !this.selected.size;
    const unclassified = this.tree("Unclassified", "unclassified");
    unclassified.heading.append(this.eye("Unclassified", this.model.unclassifiedVisible, value => { this.model.unclassifiedVisible = value; }));
    for (const segment of this.model.segments) if (segment.layerId === null && this.matches(segment)) unclassified.element.append(this.row(segment));
    const classified = this.tree("Classified", "classified");
    classified.heading.append(this.eye("Classified", this.model.classifiedVisible, value => { this.model.classifiedVisible = value; }));
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

  dispose(): void { this.createDialog.close(); this.deleteDialog.close(); this.events.abort(); this.release(); }
}
