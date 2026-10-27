import { afterEach, expect, it, vi } from "vitest";
import { LightDetectionControls } from "./light-detection";

// Small DOM boundary fixture: exercise the real controller without a browser dependency.
class Control extends EventTarget {
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
  replaceChildren(): void {}
  removeAttribute(): void {}
  append(): void {}
  querySelectorAll(): Control[] { return []; }
  querySelector(): null { return null; }
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
  vi.stubGlobal("document", { getElementById: get, createElement: () => new Control() });
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
