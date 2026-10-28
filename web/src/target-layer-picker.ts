import type { SegmentGroup, SegmentLayer } from "./segments-model";
import { classificationIcon } from "./classification-icons";

/** Upward layer menu; the collection remains the owner of the active layer. */
export class TargetLayerPicker {
  private readonly root = document.querySelector<HTMLDivElement>("#segment-target-picker")!;
  private readonly button = document.querySelector<HTMLButtonElement>("#segment-target")!;
  private readonly label = document.querySelector<HTMLSpanElement>("#segment-target-label")!;
  private readonly options = document.querySelector<HTMLDivElement>("#segment-target-options")!;
  private readonly events = new AbortController();
  private shown = false;

  constructor(private readonly choose: (id: number) => void) {
    this.button.replaceChildren(classificationIcon("activeLayer"), this.label, classificationIcon("chevronUp"));
    const signal = this.events.signal;
    this.button.addEventListener("click", () => this.options.hidden ? this.open() : this.close(), { signal });
    this.button.addEventListener("keydown", event => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); this.open(); }
      if (event.key === "Escape") { event.stopPropagation(); this.close(); }
    }, { signal });
    this.options.addEventListener("keydown", event => {
      const options = [...this.options.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const index = options.findIndex(option => option === event.target);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
      if (event.key === "Tab") { this.close(); return; }
      const moves: Record<string, number> = { ArrowDown: (index + 1) % options.length, ArrowUp: (index - 1 + options.length) % options.length, Home: 0, End: options.length - 1 };
      const next = moves[event.key];
      if (next !== undefined) { event.preventDefault(); options[next]?.focus(); }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); options[index]?.click(); }
    }, { signal });
    document.addEventListener("pointerdown", event => {
      if (event.target instanceof Node && !this.root.contains(event.target)) this.close(false);
    }, { signal });
    document.addEventListener("scroll", event => {
      if (event.target instanceof Node && !this.options.contains(event.target)) this.close(false);
    }, { capture: true, signal });
    window.addEventListener("resize", () => this.close(false), { signal });
  }

  update(layers: readonly SegmentLayer[], groups: readonly SegmentGroup[], activeId: number | null): void {
    this.close(false);
    const active = layers.find(layer => layer.id === activeId);
    const parent = groups.find(group => group.id === active?.groupId);
    this.label.textContent = active ? `${parent ? `${parent.name} / ` : ""}${active.name}` : "Choose target layer…";
    this.button.disabled = !layers.length;
    this.options.replaceChildren();
    for (const group of [...groups, { id: null, name: "Root" }]) {
      const children = layers.filter(layer => layer.groupId === group.id);
      if (!children.length) continue;
      const section = document.createElement("div");
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", group.name);
      const title = document.createElement("div");
      title.className = "target-layer-group";
      title.textContent = group.name;
      section.append(title);
      for (const layer of children) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "target-layer-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(layer.id === activeId));
        option.setAttribute("aria-label", `Use target layer ${group.id === null ? "" : `${group.name} / `}${layer.name}`);
        const swatch = document.createElement("span");
        swatch.className = "target-layer-swatch";
        swatch.style.backgroundColor = layer.color;
        const name = document.createElement("span");
        name.textContent = layer.name;
        option.append(swatch, name);
        option.addEventListener("click", () => { this.close(); this.choose(layer.id); });
        section.append(option);
      }
      this.options.append(section);
    }
  }

  private open(): void {
    if (this.button.disabled) return;
    const bounds = this.button.getBoundingClientRect();
    this.options.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8))}px`;
    this.options.style.bottom = `${window.innerHeight - bounds.top + 8}px`;
    this.options.style.width = `${bounds.width}px`;
    this.options.style.maxHeight = `${Math.min(260, Math.max(48, bounds.top - 16))}px`;
    this.options.hidden = false;
    this.options.showPopover();
    this.shown = true;
    this.button.setAttribute("aria-expanded", "true");
    const options = [...this.options.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    (options.find(option => option.getAttribute("aria-selected") === "true") ?? options[0])?.focus();
  }

  close(focus = true): void {
    if (this.shown) { this.options.hidePopover(); this.shown = false; }
    this.options.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (focus) this.button.focus();
  }

  dispose(): void { this.close(false); this.events.abort(); }
}
