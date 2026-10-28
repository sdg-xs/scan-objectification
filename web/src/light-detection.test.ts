import { afterEach, expect, it, vi } from "vitest";
import { LightDetectionControls } from "./light-detection";

// Small DOM boundary fixture: exercise the real controller without a browser dependency.
class Control extends EventTarget {
  children: Control[] = [];
  checked = false;
  type = "";
  width = 0;
  height = 0;
  constructor(readonly tag = "div") { super(); }
  textContent = "";
  value = "ceiling light";
  disabled = false;
  open = false;
  focused = false;
  dataset = {};
  show = vi.fn(() => { this.open = true; });
  showModal = vi.fn(() => { this.open = true; });
  close(): void { this.open = false; this.dispatchEvent(new Event("close")); }
  focus(): void { this.focused = true; }
  replaceChildren(): void { this.children = []; }
  removeAttribute(): void {}
  append(...children: (Control | string)[]): void { this.children.push(...children.filter((child): child is Control => child instanceof Control)); }
  querySelectorAll(selector: string): Control[] {
    return this.children.flatMap(child => [
      ...(child.tag === "input" && (selector !== "input:checked" || child.checked) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): Control | null { return this.querySelectorAll(selector)[0] ?? null; }
  getContext(): { drawImage: () => void; getImageData: () => { data: Uint8ClampedArray } } {
    return { drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]) }) };
  }
}

function workspace() {
  const controls = new Map<string, Control>();
  const get = (id: string): Control => {
    let control = controls.get(id);
    if (!control) { control = new Control(); controls.set(id, control); }
    return control;
  };
  for (const name of ["HTMLButtonElement", "HTMLParagraphElement", "HTMLDialogElement", "HTMLImageElement", "HTMLUListElement", "HTMLDivElement", "HTMLInputElement", "HTMLFormElement"])
    vi.stubGlobal(name, Control);
  vi.stubGlobal("document", { getElementById: get, createElement: (tag: string) => new Control(tag) });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const capture = vi.fn(() => ({
    canvas: { width: 1, height: 1, toBlob: (callback: BlobCallback) => callback(new Blob(["frame"])) },
    select: async () => {},
  }));
  // The fixture implements only the browser boundary touched by these scenarios.
  const pause = vi.fn();
  const controller = new LightDetectionControls(capture as unknown as ConstructorParameters<typeof LightDetectionControls>[0], pause);
  controller.setAvailable(true);
  return { get, capture, pause, controller, submit: () => get("sam-form").dispatchEvent(new Event("submit", { cancelable: true })) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("opens a nonmodal workspace with context focused and the live viewer running", () => {
  const app = workspace();
  app.get("find-lights").dispatchEvent(new Event("click"));
  expect(app.get("light-results").show).toHaveBeenCalledOnce();
  expect(app.get("light-results").showModal).not.toHaveBeenCalled();
  expect(app.get("sam-prompt").focused).toBe(true);
  expect(app.capture).not.toHaveBeenCalled();
  expect(app.pause).not.toHaveBeenCalled();
  app.controller.dispose();
});

it("captures only on submit and resumes rendering after a capture failure", async () => {
  const app = workspace();
  app.capture.mockImplementation(() => { throw new Error("No visible scan"); });
  app.submit();
  await vi.waitFor(() => expect(app.get("light-result-status").textContent).toBe("No visible scan"));
  expect(app.capture).toHaveBeenCalledOnce();
  expect(app.pause.mock.calls).toEqual([[true], [false]]);
  expect(app.get("sam-run").disabled).toBe(false);
  app.controller.dispose();
});

it("resumes rendering after detection and captures a fresh frame on the next run", async () => {
  const app = workspace();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("sam-status")
    ? { model: "sam3.1", status: "ready", phase: "idle", busy: false, model_loaded: true }
    : { model: "sam3.1", width: 1, height: 1, prompt: "ceiling light", overlay_png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", groups: [{ kind: "custom", detections: [] }] } })));
  app.submit();
  await vi.waitFor(() => expect(app.get("sam-run").disabled).toBe(false));
  expect(app.pause.mock.calls).toEqual([[true], [false]]);
  expect(app.get("light-result-status").textContent).toContain("No matches");
  app.submit();
  await vi.waitFor(() => expect(app.capture).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(app.get("sam-run").disabled).toBe(false));
  expect(app.pause.mock.calls).toEqual([[true], [false], [true], [false]]);
  app.controller.dispose();
});

it("closing cancels in-flight detection and resumes the viewer", async () => {
  const app = workspace();
  const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  app.submit();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  app.get("close-light-results").dispatchEvent(new Event("click"));
  expect(fetcher.mock.calls.every(([, options]) => options.signal?.aborted)).toBe(true);
  expect(app.pause.mock.calls).toEqual([[true], [false]]);
  expect(app.get("sam-run").disabled).toBe(false);
  app.controller.dispose();
});

it("leaves the view live when context is empty", () => {
  const app = workspace();
  app.get("sam-prompt").value = "   ";
  app.submit();
  expect(app.capture).not.toHaveBeenCalled();
  expect(app.pause).not.toHaveBeenCalled();
  expect(app.get("sam-prompt").focused).toBe(true);
  app.controller.dispose();
});

it("preserves inherited canvas dimensions through detection and mask projection", async () => {
  const app = workspace();
  const select = vi.fn(async () => {});
  const close = vi.fn();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAAAAADRSSBWAAAAC0lEQVR4nGP4zwAAAgEBADK6K5IAAAAASUVORK5CYII=";
  class CanvasFrame {
    get width(): number { return 2; }
    get height(): number { return 1; }
    toBlob(callback: BlobCallback): void { callback(new Blob(["frame"])); }
  }
  app.capture.mockReturnValue({ canvas: new CanvasFrame(), select });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close })));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith("sam-status")
    ? { model: "sam3.1", status: "ready", phase: "idle", busy: false, model_loaded: true }
    : { model: "sam3.1", width: 2, height: 1, prompt: "ceiling light", overlay_png: png,
      groups: [{ kind: "custom", detections: [{ score: 0.9, box: [0, 0, 1, 1], mask_png: png }] }] } })));
  app.submit();
  await vi.waitFor(() => expect(app.get("sam-select").disabled).toBe(false));
  app.get("sam-select").dispatchEvent(new Event("click"));
  await vi.waitFor(() => expect(select).toHaveBeenCalledWith(
    { width: 2, height: 1, pixels: new Uint8Array([1, 0]) }, "ceiling light", expect.any(AbortSignal),
  ));
  expect(close).toHaveBeenCalledOnce();
  expect(app.pause).toHaveBeenLastCalledWith(false);
  app.controller.dispose();
});
