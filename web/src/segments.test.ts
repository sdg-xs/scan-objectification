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
  constructor(readonly tag = "div") { super(); }
  classList = {
    add: (name: string) => { this.className += ` ${name}`; },
    toggle: (name: string, on: boolean) => {
      this.className = this.className.split(" ").filter(value => value && value !== name).concat(on ? [name] : []).join(" ");
    },
  };
  append(...children: Control[]): void { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children: Control[]): void { this.children = []; this.append(...children); }
  add(child: Control): void { this.append(child); }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  get firstElementChild(): Control | undefined { return this.children[0]; }
  closest(): Control | undefined { return this.parent; }
  focus(): void { this.focused = true; this.fire("focusin"); }
  showModal(): void { this.open = true; }
  close(): void {
    if (!this.open) return;
    this.open = false;
    queueMicrotask(() => this.dispatchEvent(new Event("close")));
  }
  fire(type: string): void {
    if (type === "click" && this.disabled) return;
    const event = new Event(type, { cancelable: true });
    for (let item: Control | undefined = this; item; item = item.parent) item.dispatchEvent(event);
  }
  querySelectorAll(selector: string): Control[] {
    return this.children.flatMap(child => [
      ...(selector === "[data-container]" && child.dataset.container ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

function workspace() {
  const html = readFileSync(new URL("../viewer.html", import.meta.url), "utf8");
  const controls = new Map<string, Control>();
  for (const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const item = new Control(match[1]);
    item.disabled = /\bdisabled\b/.test(match[2]!);
    item.checked = /\bchecked\b/.test(match[2]!);
    controls.set(match[3]!, item);
  }
  const get = (id: string): Control => {
    const item = controls.get(id);
    if (!item) throw new Error(`Missing fixture control ${id}`);
    return item;
  };
  const label = new Control("label");
  label.append(get("segment-colors"));
  vi.stubGlobal("document", {
    querySelector: (selector: string) => get(selector.slice(1)),
    createElement: (tag: string) => new Control(tag),
    createElementNS: (_namespace: string, tag: string) => new Control(tag),
  });
  vi.stubGlobal("HTMLInputElement", Control);
  vi.stubGlobal("Option", class extends Control {
    constructor(text: string, value: string) { super("option"); this.textContent = text; this.value = value; }
  });
  const errors = vi.fn();
  const panel = new SegmentPanel({ select: vi.fn(), clear: vi.fn(), error: errors });
  const descendants = (node: Control): Control[] => node.children.flatMap(child => [child, ...descendants(child)]);
  const named = (label: string): Control => {
    const item = descendants(get("segment-list")).find(item => item.attributes.get("aria-label") === label);
    if (!item) throw new Error(`Missing rendered control ${label}`);
    return item;
  };
  const create = (kind: "group" | "layer", name: string): void => {
    get(`segment-add-${kind}`).fire("click");
    get(`segment-${kind}-name`).value = name;
    get(`segment-${kind}-form`).fire("submit");
  };
  return { get, panel, named, create, errors };
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
