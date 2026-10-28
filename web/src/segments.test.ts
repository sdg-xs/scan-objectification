import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { SegmentPanel } from "./segments";

vi.mock("@sparkjsdev/spark", () => ({ dyno: {}, readRgbaArray: vi.fn(), SplatMesh: class {} }));
vi.mock("./asset-selection", () => ({ createSelectionTexture: vi.fn() }));

// Minimal DOM boundary for exercising real panel event handlers, not a second panel implementation.
class Control extends EventTarget {
  children: Control[] = [];
  parent: Control | undefined;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  value = "";
  textContent = "";
  className = "";
  title = "";
  disabled = false;
  hidden = false;
  checked = false;
  open = false;
  focused = false;
  popoverOpen = false;
  style: Record<string, string> = {};
  constructor(readonly tag = "div") { super(); }
  classList = {
    contains: (name: string) => this.className.split(" ").includes(name),
    add: (name: string) => { this.className += ` ${name}`; },
    toggle: (name: string, on: boolean) => {
      this.className = this.className.split(" ").filter(value => value && value !== name).concat(on ? [name] : []).join(" ");
    },
  };
  append(...children: Control[]): void { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children: Control[]): void { for (const child of this.children) child.parent = undefined; this.children = []; this.append(...children); }
  add(child: Control): void { this.append(child); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  get firstElementChild(): Control | undefined { return this.children[0]; }
  closest(): Control | undefined { return this.parent; }
  focus(): void { this.focused = true; this.fire("focusin"); }
  showModal(): void { this.open = true; }
  showPopover(): void { this.popoverOpen = true; }
  hidePopover(): void { this.popoverOpen = false; }
  getBoundingClientRect(): { left: number; top: number; width: number } { return { left: 24, top: 300, width: 300 }; }
  scrollIntoView(): void {}
  contains(node: Control): boolean { return this === node || this.children.some(child => child.contains(node)); }
  click(): void { this.fire("click"); }
  close(): void {
    if (!this.open) return;
    this.open = false;
    queueMicrotask(() => this.dispatchEvent(new Event("close")));
  }
  fire(type: string, key?: string): void {
    if (type === "click" && this.disabled) return;
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.defineProperty(event, "target", { value: this });
    if (key) Object.defineProperty(event, "key", { value: key });
    const path: Control[] = [];
    for (let item: Control | undefined = this; item; item = item.parent) path.push(item);
    for (const item of path) { item.dispatchEvent(event); if (event.cancelBubble) break; }
  }
  querySelectorAll(selector: string): Control[] {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): Control | null { return this.querySelectorAll(selector)[0] ?? null; }
  private matches(selector: string): boolean {
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) {
      const key = attribute[1]!;
      const value = key.startsWith("data-") ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] : this.attributes.get(key);
      return value !== undefined && (attribute[2] === undefined || value === attribute[2]);
    }
    return selector.startsWith(".") ? this.classList.contains(selector.slice(1)) : this.tag === selector;
  }
}

function workspace() {
  const html = readFileSync(new URL("../viewer.html", import.meta.url), "utf8");
  const controls = new Map<string, Control>();
  const documentNode = new Control("document");
  const stack = [documentNode];
  const voidTags = new Set(["input", "img", "meta", "link", "br", "hr"]);
  for (const match of html.matchAll(/<\/?([\w-]+)\b([^>]*)>/g)) {
    if (match[0].startsWith("</")) { stack.pop(); continue; }
    const item = new Control(match[1]);
    for (const attribute of match[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) item.setAttribute(attribute[1]!, attribute[2]!);
    item.className = item.getAttribute("class") ?? "";
    item.disabled = /\bdisabled\b/.test(match[2]!);
    item.checked = /\bchecked\b/.test(match[2]!);
    item.hidden = /\bhidden\b/.test(match[2]!);
    stack.at(-1)!.append(item);
    const id = item.getAttribute("id");
    if (id) controls.set(id, item);
    if (!voidTags.has(match[1]!) && !match[2]!.endsWith("/")) stack.push(item);
  }
  const get = (id: string): Control => {
    const item = controls.get(id);
    if (!item) throw new Error(`Missing fixture control ${id}`);
    return item;
  };
  vi.stubGlobal("document", Object.assign(documentNode, {
    querySelector: (selector: string) => get(selector.slice(1)),
    createElement: (tag: string) => new Control(tag),
    createElementNS: (_namespace: string, tag: string) => new Control(tag),
  }));
  for (const type of ["HTMLInputElement", "HTMLButtonElement", "HTMLElement", "Node"]) vi.stubGlobal(type, Control);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { innerWidth: 1000, innerHeight: 800 }));
  vi.stubGlobal("Option", class extends Control {
    constructor(text: string, value: string) { super("option"); this.textContent = text; this.value = value; }
  });
  const errors = vi.fn();
  const panel = new SegmentPanel({ select: vi.fn(), clear: vi.fn(), error: errors });
  const descendants = (node: Control): Control[] => node.children.flatMap(child => [child, ...descendants(child)]);
  const named = (label: string, root = "segment-list"): Control => {
    const item = descendants(get(root)).find(item => item.attributes.get("aria-label") === label);
    if (!item) throw new Error(`Missing rendered control ${label}`);
    return item;
  };
  const create = (kind: "group" | "layer", name: string): void => {
    get(`segment-add-${kind}`).fire("click");
    get(`segment-${kind}-name`).value = name;
    get(`segment-${kind}-form`).fire("submit");
  };
  return { get, panel, named, create, errors, documentNode };
}

afterEach(() => { vi.unstubAllGlobals(); });

it("allows groups and layers to be created before a scan is loaded", () => {
  const app = workspace();
  expect(app.get("segment-add-group").disabled).toBe(false);
  expect(app.get("segment-add-layer").disabled).toBe(false);
  expect(app.get("segment-group-tools").disabled).toBe(false);
  expect(app.get("segment-layer-tools").disabled).toBe(false);
  app.create("group", "Electrical");
  expect(app.named("Group name Electrical").value).toBe("Electrical");
  expect(app.get("segment-delete").disabled).toBe(false);
  app.create("layer", "Lighting");
  expect(app.named("Layer name Lighting").value).toBe("Lighting");
  expect(app.get("segment-create-dialog").open).toBe(false);
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("reveals newly created items when the filter hides them", () => {
  const app = workspace();
  app.get("segment-filter").value = "unrelated";
  app.get("segment-filter").fire("input");
  app.create("group", "MEP");
  expect(app.get("segment-filter").value).toBe("");
  expect(app.named("Group name MEP").value).toBe("MEP");
  app.create("layer", "Pipes");
  expect(app.named("Layer name Pipes").value).toBe("Pipes");
  expect(app.named("Set active layer Pipes").attributes.get("aria-pressed")).toBe("true");
  app.panel.dispose();
});

it("supports cancelling and confirming deletion without a scan", async () => {
  const app = workspace();
  app.create("group", "MEP");
  app.create("layer", "Lighting");
  app.get("segment-delete").fire("click");
  expect(app.get("segment-delete-dialog").open).toBe(true);
  app.get("segment-delete-cancel").fire("click");
  await Promise.resolve();
  expect(app.named("Layer name Lighting").value).toBe("Lighting");
  app.get("segment-delete").fire("click");
  app.get("segment-delete-form").fire("submit");
  expect(() => app.named("Layer name Lighting")).toThrow();
  expect(app.named("Group name MEP").value).toBe("MEP");
  expect(app.get("segment-delete").disabled).toBe(true);
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("keeps a prepared hierarchy when the first scan attaches", () => {
  const app = workspace();
  app.create("group", "MEP");
  app.create("layer", "Lighting");
  // GPU-backed fields are not touched when attaching a scan to an empty hierarchy.
  const mesh = { numSplats: 2 } as Parameters<SegmentPanel["setScan"]>[0];
  app.panel.setScan(mesh);
  expect(app.named("Group name MEP").value).toBe("MEP");
  expect(app.named("Layer name Lighting").value).toBe("Lighting");
  app.panel.setScan(undefined);
  expect(() => app.named("Group name MEP")).toThrow();
  expect(app.get("segment-add-group").disabled).toBe(false);
  app.panel.dispose();
});

it("deletes a selected group and its layers after confirmation", () => {
  const app = workspace();
  app.create("group", "MEP");
  app.create("layer", "Lighting");
  app.named("Group name MEP").focus();
  app.get("segment-delete").fire("click");
  expect(app.get("segment-delete-description").textContent).toContain("removes 1 layers");
  expect(app.get("segment-delete-destination").children.map(item => item.textContent)).toEqual(["Unassign to Unclassified"]);
  app.get("segment-delete-form").fire("submit");
  expect(() => app.named("Group name MEP")).toThrow();
  expect(() => app.named("Layer name Lighting")).toThrow();
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("offers only surviving destination layers when deleting a group", () => {
  const app = workspace();
  app.create("group", "Old");
  app.create("layer", "Lighting");
  app.create("group", "Keep");
  app.create("layer", "Fixtures");
  app.named("Group name Old").focus();
  app.get("segment-delete").fire("click");
  const destination = app.get("segment-delete-destination");
  expect(destination.children.map(item => item.textContent)).toEqual(["Unassign to Unclassified", "Assign to Keep / Fixtures"]);
  destination.value = destination.children[1]!.value;
  app.get("segment-delete-form").fire("submit");
  expect(() => app.named("Layer name Lighting")).toThrow();
  expect(app.named("Layer name Fixtures").value).toBe("Fixtures");
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("reports blank names inside the creation dialog and allows correction", () => {
  const app = workspace();
  app.create("group", "   ");
  expect(app.get("segment-create-dialog").open).toBe(true);
  expect(app.get("segment-create-error").hidden).toBe(false);
  expect(app.get("segment-create-error").textContent).toBe("Enter a group name.");
  app.get("segment-group-name").value = "MEP";
  app.get("segment-group-form").fire("submit");
  expect(app.named("Group name MEP").value).toBe("MEP");
  expect(app.get("segment-create-dialog").open).toBe(false);
  app.panel.dispose();
});

it("ignores an old close event after deletion is cancelled and immediately reopened", async () => {
  const app = workspace();
  app.create("group", "MEP");
  app.get("segment-delete").fire("click");
  app.get("segment-delete-cancel").fire("click");
  app.get("segment-delete").fire("click");
  await Promise.resolve();
  app.get("segment-delete-form").fire("submit");
  expect(() => app.named("Group name MEP")).toThrow();
  app.panel.dispose();
});

it("opens the bottom target picker and reflects its choice in the layer and parent group", () => {
  const app = workspace();
  app.create("group", "Electrical");
  app.create("layer", "Lighting");
  app.create("group", "Architecture");
  app.create("layer", "Ceiling");
  app.get("segment-target").fire("click");
  expect(app.get("segment-target-options").hidden).toBe(false);
  app.named("Use target layer Electrical / Lighting", "segment-target-options").fire("click");
  expect(app.get("segment-target-options").hidden).toBe(true);
  expect(app.get("segment-target-label").textContent).toBe("Electrical / Lighting");
  expect(app.named("Set active layer Lighting").attributes.get("aria-pressed")).toBe("true");
  expect(app.named("Group name Electrical").parent?.classList.contains("segment-active-group")).toBe(true);
  expect(app.named("Layer name Lighting").parent?.classList.contains("segment-active-layer")).toBe(true);
  app.panel.dispose();
});

it("keeps target controls outside Model Browser and reveals it when a target is chosen", () => {
  const app = workspace();
  expect(app.get("segments-panel").contains(app.get("segment-target-picker"))).toBe(false);
  app.create("layer", "Lighting");
  app.get("segments-panel").open = false;
  app.get("segment-target").fire("click");
  app.named("Use target layer Lighting", "segment-target-options").fire("click");
  expect(app.get("segments-panel").open).toBe(true);
  app.panel.dispose();
});

it("dismisses target choices on Escape and outside click", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.get("segment-target").fire("click");
  app.get("segment-target-options").fire("keydown", "Escape");
  expect(app.get("segment-target-options").hidden).toBe(true);
  app.get("segment-target").fire("click");
  app.documentNode.fire("pointerdown");
  expect(app.get("segment-target-options").hidden).toBe(true);
  app.panel.dispose();
});

it("prompts for names, classifies under the target layer and unclassifies checked meshes", () => {
  const app = workspace();
  app.create("group", "Electrical");
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 3 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1, 2, 0]), "light");
  app.get("segment-classify").fire("click");
  expect(app.get("segment-name-dialog").open).toBe(true);
  expect(app.named("Name for mesh 1", "segment-classify-names").value).toBe("Lighting 01");
  expect(app.named("Name for mesh 2", "segment-classify-names").value).toBe("Lighting 02");
  app.named("Name for mesh 1", "segment-classify-names").value = "Linear fixture";
  app.named("Name for mesh 2", "segment-classify-names").value = "Bulb";
  app.get("segment-name-form").fire("submit");
  expect(app.get("segment-name-dialog").open).toBe(false);
  expect(app.named("Mesh name Linear fixture").parent?.dataset.classified).toBe("true");
  expect(app.named("Mesh name Bulb").parent?.dataset.classified).toBe("true");
  const checkbox = app.named("Select mesh Linear fixture");
  checkbox.checked = true;
  checkbox.fire("change");
  app.get("segment-unclassify").fire("click");
  expect(app.named("Mesh name Linear fixture").parent?.dataset.classified).toBe("false");
  expect(app.named("Mesh name Bulb").parent?.dataset.classified).toBe("true");
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("cancelling the naming prompt leaves selected meshes unclassified", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "light");
  app.get("segment-classify").fire("click");
  app.get("segment-name-cancel").fire("click");
  expect(app.named("Mesh name light 1").parent?.dataset.classified).toBe("false");
  app.panel.dispose();
});

it("navigates target choices by keyboard and opens outside panel clipping", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.create("layer", "Furniture");
  app.get("segment-target").getBoundingClientRect = () => ({ left: 24, top: 120, width: 300 });
  app.get("segment-target").fire("keydown", "ArrowUp");
  const popup = app.get("segment-target-options");
  expect(popup.getAttribute("popover")).toBe("manual");
  expect(popup.popoverOpen).toBe(true);
  expect(popup.style.maxHeight).toBe("104px");
  expect(popup.style.bottom).toBe("688px");
  const lighting = app.named("Use target layer Lighting", "segment-target-options");
  lighting.fire("keydown", "Enter");
  expect(app.get("segment-target-label").textContent).toBe("Lighting");
  expect(popup.popoverOpen).toBe(false);
  app.panel.dispose();
});

it("continues numbered defaults for later SAM selections", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 2 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1, 0]), "light");
  app.get("segment-classify").fire("click");
  app.get("segment-name-form").fire("submit");
  expect(app.named("Mesh name Lighting 01").parent?.dataset.classified).toBe("true");
  app.panel.add(new Uint8Array([0, 1]), "light");
  app.get("segment-classify").fire("click");
  expect(app.named("Name for mesh 1", "segment-classify-names").value).toBe("Lighting 02");
  app.panel.dispose();
});

it("rejects blank names without consuming numbers and cancels naming on a new source", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "light");
  app.get("segment-classify").fire("click");
  app.named("Name for mesh 1", "segment-classify-names").value = " ";
  app.get("segment-name-form").fire("submit");
  expect(app.get("segment-name-error").hidden).toBe(false);
  expect(app.named("Mesh name light 1").parent?.dataset.classified).toBe("false");
  app.get("segment-name-cancel").fire("click");
  app.get("segment-classify").fire("click");
  expect(app.named("Name for mesh 1", "segment-classify-names").value).toBe("Lighting 01");
  app.panel.setScan(undefined);
  expect(app.get("segment-name-dialog").open).toBe(false);
  app.get("segment-name-form").fire("submit");
  expect(app.get("segment-target-label").textContent).toBe("Choose target layer…");
  app.panel.dispose();
});
