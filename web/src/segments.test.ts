import { Group } from "three";
import { AssetAssignmentControls } from "./asset-assignment";
import { PlacedAssets } from "./placed-assets";
import type { Segment } from "./segments-model";
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
  closest(selector: string): Control | null {
    for (let item: Control | undefined = this; item; item = item.parent) if (item.matches(selector)) return item;
    return null;
  }
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
  fire(type: string, key?: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}): void {
    if (type === "click" && this.disabled) return;
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.defineProperty(event, "target", { value: this });
    if (key) Object.defineProperty(event, "key", { value: key });
    for (const [name, value] of Object.entries(modifiers)) Object.defineProperty(event, name, { value });
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
    if (selector === "details:not([open])") return this.tag === "details" && !this.open;
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
    item.value = item.getAttribute("value") ?? "";
    item.disabled = /\bdisabled\b/.test(match[2]!);
    item.checked = /\bchecked\b/.test(match[2]!);
    item.hidden = /\bhidden\b/.test(match[2]!);
    item.open = /\bopen\b/.test(match[2]!);
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
  const assignAssets = vi.fn();
  const panel = new SegmentPanel({ select: vi.fn(), clear: vi.fn(), error: errors, assignAssets });
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
  return { get, panel, named, create, errors, documentNode, assignAssets };
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
  app.named("Select mesh Linear fixture").fire("click");
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

it("moves a checked element to the chosen target without opening naming", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "light");
  app.get("segment-classify").fire("click");
  app.get("segment-name-form").fire("submit");
  app.named("Select mesh Lighting 01").fire("click");
  expect(app.get("segment-move").disabled).toBe(true);
  app.create("layer", "Fixtures");
  expect(app.get("segment-move").disabled).toBe(false);
  app.get("segment-move").fire("click");
  expect(app.get("segment-name-dialog").open).toBe(false);
  const destination = app.named("Layer name Fixtures").parent?.parent;
  expect(destination?.contains(app.named("Mesh name Lighting 01"))).toBe(true);
  app.panel.dispose();
});

it("creates a layer for selected Unclassified elements and offers numbered naming", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "light");
  app.get("segment-add-layer").fire("click");
  expect(app.get("segment-layer-classify").checked).toBe(true);
  app.get("segment-layer-name").value = "Lighting";
  app.get("segment-layer-form").fire("submit");
  expect(app.get("segment-name-dialog").open).toBe(true);
  expect(app.named("Name for mesh 1", "segment-classify-names").value).toBe("Lighting 01");
  app.get("segment-name-form").fire("submit");
  expect(app.named("Layer name Lighting").parent?.parent?.contains(app.named("Mesh name Lighting 01"))).toBe(true);
  app.panel.dispose();
});

it("creates a group and first layer for selected Unclassified elements", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "light");
  app.get("segment-add-group").fire("click");
  expect(app.get("segment-group-classify").checked).toBe(true);
  app.get("segment-group-name").value = "Electrical";
  app.get("segment-group-layer-name").value = "Lighting";
  app.get("segment-group-form").fire("submit");
  expect(app.get("segment-name-dialog").open).toBe(true);
  app.get("segment-name-form").fire("submit");
  const group = app.named("Group name Electrical").parent?.parent;
  expect(group?.contains(app.named("Layer name Lighting"))).toBe(true);
  expect(group?.contains(app.named("Mesh name Lighting 01"))).toBe(true);
  app.panel.dispose();
});

it("selects rows with click, Control-click and Shift-click instead of selection checkboxes", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 4 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1, 2, 3, 4]), "part");
  const row = (index: number): Control => app.named(`Select mesh part ${index}`);
  expect(row(1).children[0]!.tag).toBe("svg");
  row(1).fire("click");
  expect([1, 2, 3, 4].map(index => row(index).getAttribute("data-selected"))).toEqual(["true", "false", "false", "false"]);
  row(3).fire("click", undefined, { ctrlKey: true });
  expect([1, 2, 3, 4].map(index => row(index).getAttribute("data-selected"))).toEqual(["true", "false", "true", "false"]);
  row(3).fire("click", undefined, { ctrlKey: true });
  expect(row(3).getAttribute("data-selected")).toBe("false");
  row(1).fire("click");
  row(4).fire("click", undefined, { shiftKey: true });
  expect([1, 2, 3, 4].map(index => row(index).getAttribute("data-selected"))).toEqual(["true", "true", "true", "true"]);
  app.panel.dispose();
});

it("keeps selected elements Unclassified when creation assignment is unchecked", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "part");
  app.get("segment-add-layer").fire("click");
  app.get("segment-layer-classify").checked = false;
  app.get("segment-layer-name").value = "Later";
  app.get("segment-layer-form").fire("submit");
  expect(app.get("segment-name-dialog").open).toBe(false);
  expect(app.named("Mesh name part 1").parent?.dataset.classified).toBe("false");
  app.panel.dispose();
});

it("validates the first layer before creating a group for selected elements", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "part");
  app.get("segment-add-group").fire("click");
  app.get("segment-group-name").value = "Electrical";
  app.get("segment-group-layer-name").value = " ";
  app.get("segment-group-form").fire("submit");
  expect(app.get("segment-create-dialog").open).toBe(true);
  expect(() => app.named("Group name Electrical")).toThrow();
  expect(app.get("segment-create-error").textContent).toBe("Enter a first layer name.");
  app.panel.dispose();
});

it("Shift range selection skips elements inside collapsed layers", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 5 } as Parameters<SegmentPanel["setScan"]>[0]);
  for (const [name, labels] of [
    ["A", [1, 2, 0, 0, 0]], ["B", [0, 0, 1, 2, 0]], ["C", [0, 0, 0, 0, 1]],
  ] as const) {
    app.create("layer", name);
    app.panel.add(new Uint8Array(labels), "part");
    app.get("segment-classify").fire("click");
    app.get("segment-name-form").fire("submit");
  }
  app.named("Layer name B").parent!.parent!.open = false;
  app.named("Select mesh A 01").fire("click");
  app.named("Select mesh C 01").fire("click", undefined, { shiftKey: true });
  for (const name of ["A 01", "A 02", "C 01"]) expect(app.named(`Select mesh ${name}`).getAttribute("data-selected")).toBe("true");
  for (const name of ["B 01", "B 02"]) expect(app.named(`Select mesh ${name}`).getAttribute("data-selected")).toBe("false");
  app.get("segment-list").fire("keydown", "Escape");
  expect(app.named("Select mesh A 01").getAttribute("data-selected")).toBe("false");
  app.panel.dispose();
});

it("removes selected element records after confirmation while preserving the source scan", async () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 3 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1, 2, 3]), "light");
  app.get("segment-classify").fire("click");
  app.get("segment-name-form").fire("submit");
  app.named("Select mesh Lighting 01").fire("click");
  app.named("Select mesh Lighting 03").fire("click", undefined, { ctrlKey: true });
  expect(app.get("segment-delete").disabled).toBe(false);
  app.get("segment-delete").fire("click");
  expect(app.get("segment-delete-title").textContent).toContain("2 elements");
  expect(app.get("segment-delete-description").textContent).toContain("geometry is preserved");
  expect(app.get("segment-delete-assignment").hidden).toBe(true);
  app.get("segment-delete-cancel").fire("click");
  await Promise.resolve();
  expect(app.named("Mesh name Lighting 01").value).toBe("Lighting 01");
  app.get("segment-delete").fire("click");
  app.get("segment-delete-form").fire("submit");
  expect(() => app.named("Mesh name Lighting 01")).toThrow();
  expect(() => app.named("Mesh name Lighting 03")).toThrow();
  expect(app.named("Mesh name Lighting 02").value).toBe("Lighting 02");
  expect(app.named("Layer name Lighting").value).toBe("Lighting");
  app.named("Layer name Lighting").focus();
  app.get("segment-delete").fire("click");
  expect(app.get("segment-delete-assignment").hidden).toBe(false);
  app.get("segment-delete-cancel").fire("click");
  expect(app.panel.visibility()).toBeUndefined();
  // Source indices remain available for subsequent detection.
  app.panel.add(new Uint8Array([1, 0, 1]), "detected again");
  expect(app.named("Mesh name detected again 1").value).toBe("detected again 1");
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("removes Unclassified records and cancels pending element deletion on new SAM results", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 2 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1, 0]), "old");
  app.get("segment-delete").fire("click");
  expect(app.get("segment-delete-dialog").open).toBe(true);
  app.panel.add(new Uint8Array([0, 1]), "new");
  expect(app.get("segment-delete-dialog").open).toBe(false);
  app.get("segment-delete-form").fire("submit");
  expect(app.named("Mesh name old 1").value).toBe("old 1");
  app.get("segment-delete").fire("click");
  app.get("segment-delete-form").fire("submit");
  expect(() => app.named("Mesh name new 1")).toThrow();
  expect(app.named("Mesh name old 1").value).toBe("old 1");
  app.panel.dispose();
});

it("discards pending element deletion when the source is replaced", () => {
  const app = workspace();
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1]), "old");
  app.get("segment-delete").fire("click");
  app.panel.setScan({ numSplats: 1 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.get("segment-delete-form").fire("submit");
  expect(app.get("segment-delete-dialog").open).toBe(false);
  expect(app.errors).not.toHaveBeenCalled();
  app.panel.dispose();
});

it("assigns at element and layer scope with icons before each eye", () => {
  const app = workspace();
  app.create("layer", "Lighting");
  app.panel.setScan({ numSplats: 2 } as Parameters<SegmentPanel["setScan"]>[0]);
  app.panel.add(new Uint8Array([1, 2]), "light");
  app.get("segment-classify").fire("click");
  app.get("segment-name-form").fire("submit");
  const button = app.named("Assign asset to element Lighting 01");
  expect(button.parent?.children.at(-2)).toBe(button);
  button.fire("click");
  expect(app.assignAssets.mock.lastCall?.[0].map((row: { name: string }) => row.name)).toEqual(["Lighting 01"]);
  const layer = app.named("Assign asset to layer Lighting");
  expect(layer.parent?.children.at(-2)).toBe(layer);
  layer.fire("click");
  expect(app.assignAssets.mock.lastCall?.[0]).toHaveLength(2);
  app.panel.dispose();
});

it("assigns one library geometry to every scoped element and corrects only the requested occurrence", async () => {
  const app = workspace();
  const parent = new Group(), placed = new PlacedAssets(parent, []);
  const geometry = { meshes: [{ positions: [0,0,0, 2,0,0, 2,1,0], normals: [0,0,1, 0,0,1, 0,0,1], indices: [0,1,2], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], color: [1,1,1,1] }] };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith("/geometry") ? { kind: "mesh", geometry } : [{ id: "asset-a", name: "Linear light", category: "Lighting" }]))));
  const rows: Segment[] = [1,2].map(id => ({ id, name: `Light ${id}`, layerId: 9, indices: new Uint32Array([id]), visible: true,
    pose: { position: [id, 2, 3], z: Math.PI / 4, rotationReliable: true } }));
  const controls = new AssetAssignmentControls(placed, () => controls.sync(rows, () => true));
  controls.sync(rows, () => true);
  await controls.open(rows);
  app.get("asset-source-up").value = "z";
  app.get("asset-unit-scale").value = "1";
  app.get("asset-assignment-apply").fire("click");
  await vi.waitFor(() => expect(parent.children).toHaveLength(2));
  expect(rows.map(row => row.asset?.id)).toEqual(["asset-a", "asset-a"]);
  expect(parent.children[0]!.position.toArray()).toEqual([1,2,3]);
  app.get("asset-assignment-apply").fire("click");
  await vi.waitFor(() => expect(app.get("asset-assignment-apply").disabled).toBe(false));
  expect(parent.children).toHaveLength(2);
  await controls.open(rows.slice(0,1));
  app.get("asset-rotation-correction").value = "30";
  app.get("asset-correct-rotation").fire("click");
  expect(rows[0]!.asset!.correctionZ).toBeCloseTo(Math.PI / 6);
  expect(rows[1]!.asset!.correctionZ).toBe(0);
  expect(rows[0]!.pose!.z).toBeCloseTo(Math.PI / 4);
  controls.dispose(); app.panel.dispose();
});

it("keeps existing assignments on geometry failure and rejects stale element loads", async () => {
  const app = workspace(), placed = new PlacedAssets(new Group(), []);
  const rows: Segment[] = [{ id: 1, name: "Light", layerId: null, indices: new Uint32Array([0]), visible: true,
    pose: { position: [0,0,0], z: 0, rotationReliable: false }, asset: { id: "old", name: "Original", correctionZ: 0, scale: 1 } }];
  const controls = new AssetAssignmentControls(placed, () => {});
  controls.sync(rows, () => true);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/geometry") ? new Response(JSON.stringify({ detail: "Missing geometry" }), { status: 404 }) : new Response(JSON.stringify([{ id: "new", name: "New", category: "Lighting" }]))));
  await controls.open(rows);
  app.get("asset-unit-scale").value = "1";
  app.get("asset-assignment-apply").fire("click");
  await vi.waitFor(() => expect(app.get("asset-assignment-status").textContent).toContain("Missing geometry"));
  expect(rows[0]!.asset!.id).toBe("old");
  rows[0]!.indices = new Uint32Array([1]);
  controls.sync(rows, () => true);
  expect(app.get("asset-assignment-dialog").open).toBe(false);
  controls.dispose(); app.panel.dispose();
});

it("discards a geometry response arriving after its source scope is cleared", async () => {
  const app = workspace(), parent = new Group(), placed = new PlacedAssets(parent, []);
  const rows: Segment[] = [{ id: 1, name: "Light", layerId: null, indices: new Uint32Array([0]), visible: true,
    pose: { position: [0,0,0], z: 0, rotationReliable: false } }];
  let respond: ((response: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/geometry")
    ? await new Promise<Response>(resolve => { respond = resolve; })
    : new Response(JSON.stringify([{ id: "new", name: "New", category: "Lighting" }]))));
  const controls = new AssetAssignmentControls(placed, () => {});
  controls.sync(rows, () => true);
  await controls.open(rows);
  app.get("asset-unit-scale").value = "1";
  app.get("asset-assignment-apply").fire("click");
  await vi.waitFor(() => expect(respond).toBeDefined());
  controls.reset();
  respond!(new Response(JSON.stringify({ kind: "mesh", geometry: { meshes: [{ positions: [0,0,0,1,0,0,0,1,0], normals: [0,0,1,0,0,1,0,0,1], indices: [0,1,2], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], color: [1,1,1,1] }] } })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(rows[0]!.asset).toBeUndefined();
  expect(parent.children).toHaveLength(0);
  controls.dispose(); app.panel.dispose();
});
