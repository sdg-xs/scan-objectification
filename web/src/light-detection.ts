import { parseLightResult, parseSamStatus } from "./light-detection-model";
import type { LightDetection } from "./light-detection-model";
import type { ScreenMask } from "./asset-selection-model";

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) throw new Error(`Missing SAM control: ${id}`);
  return value;
}

export class LightDetectionControls {
  private readonly button = element("find-lights", HTMLButtonElement);
  private readonly status = element("light-status", HTMLParagraphElement);
  private readonly dialog = element("light-results", HTMLDialogElement);
  private readonly image = element("light-result-image", HTMLImageElement);
  private readonly progress = element("light-result-status", HTMLParagraphElement);
  private readonly timing = element("sam-timing", HTMLParagraphElement);
  private readonly counts = element("light-counts", HTMLUListElement);
  private readonly matches = element("sam-matches", HTMLDivElement);
  private readonly prompt = element("sam-prompt", HTMLInputElement);
  private readonly run = element("sam-run", HTMLButtonElement);
  private readonly apply = element("sam-select", HTMLButtonElement);
  private readonly events = new AbortController();
  private request: AbortController | undefined;
  private preview: string | undefined;
  private available = false;
  private pollTimer: number | undefined;
  private result: { detections: LightDetection[]; width: number; height: number; prompt: string; select: (mask: ScreenMask, prompt: string, signal?: AbortSignal) => Promise<void> } | undefined;

  constructor(private readonly capture: () => { canvas: HTMLCanvasElement; select: (mask: ScreenMask, prompt: string, signal?: AbortSignal) => Promise<void> }, private readonly pauseViewer: (paused: boolean) => void) {
    const signal = this.events.signal;
    this.button.addEventListener("click", () => {
      if (!this.dialog.open) this.dialog.show();
      this.prompt.focus();
    }, { signal });
    element("sam-form", HTMLFormElement).addEventListener("submit", event => { event.preventDefault(); void this.detect(); }, { signal });
    this.apply.addEventListener("click", () => void this.select(), { signal });
    this.matches.addEventListener("change", () => this.updateApply(), { signal });
    element("close-light-results", HTMLButtonElement).addEventListener("click", () => this.dialog.close(), { signal });
    this.dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.dialog.close(); }
    }, { signal });
    this.dialog.addEventListener("close", () => {
      this.request?.abort();
      this.request = undefined;
      this.stopPolling();
      this.pauseViewer(false);
      this.resetResults();
      this.setBusy(false);
    }, { signal });
    this.progress.textContent = "Describe an element and capture the current view to begin.";
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.button.disabled = !available;
    this.run.disabled = !available || Boolean(this.request);
  }

  private setBusy(busy: boolean): void {
    this.run.disabled = busy || !this.available;
    this.prompt.disabled = busy;
    this.apply.disabled = busy || !this.result;
    for (const checkbox of this.matches.querySelectorAll<HTMLInputElement>("input"))
      checkbox.disabled = busy || !this.result?.detections[Number(checkbox.value)]?.mask_png;
  }

  private updateApply(): void {
    this.apply.disabled = Boolean(this.request) || !this.result || !this.matches.querySelector("input:checked");
  }

  private resetResults(): void {
    this.result = undefined;
    this.counts.replaceChildren();
    this.matches.replaceChildren();
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = undefined;
    this.image.removeAttribute("src");
    this.timing.textContent = "";
    this.apply.disabled = true;
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async pollStatus(request: AbortController, started: number): Promise<void> {
    if (request.signal.aborted || this.request !== request) return;
    try {
      const response = await fetch("/api/local/sam-status", { signal: request.signal, cache: "no-store" });
      const status = parseSamStatus(await response.json());
      if (request.signal.aborted || this.request !== request) return;
      const text = status.status !== "ready" ? "Connecting to SAM 3.1…" : {
        idle: status.model_loaded ? "Model ready. Waiting for results…" : "Preparing SAM 3.1…",
        loading_model: "Loading SAM 3.1 model…",
        preparing_image: "Preparing the captured image…",
        detecting: "Detecting objects…",
        encoding: "Preparing masks and results…",
      }[status.phase];
      this.progress.textContent = `${text} ${Math.floor((performance.now() - started) / 1000)}s · viewer paused`;
    } catch { /* A status failure must not cancel the detection request. */ }
    if (!request.signal.aborted && this.request === request)
      this.pollTimer = window.setTimeout(() => void this.pollStatus(request, started), 1000);
  }

  private async detect(): Promise<void> {
    if (!this.available || this.request) return;
    const prompt = this.prompt.value.trim();
    if (!prompt) { this.prompt.focus(); return; }
    const request = new AbortController();
    this.request = request;
    this.resetResults();
    this.setBusy(true);
    this.status.dataset.error = "false";
    this.progress.textContent = `Finding “${prompt}” with local SAM 3.1…`;
    this.status.textContent = "SAM is processing the captured view…";
    try {
      this.pauseViewer(true);
      const { canvas, select } = this.capture();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error("The view could not be captured.")), "image/png",
      ));
      if (request.signal.aborted) return;
      if (blob.size > 8 * 1024 * 1024) throw new Error("The view is too large. Use a smaller browser window and try again.");
      this.preview = URL.createObjectURL(blob);
      this.image.src = this.preview;
      void this.pollStatus(request, performance.now());
      const response = await fetch("/api/local/lights", {
        method: "POST", headers: { "Content-Type": "image/png", "X-SAM-Prompt": encodeURIComponent(prompt) }, body: blob, signal: request.signal,
      });
      let value: unknown;
      try { value = await response.json(); }
      catch { throw new Error("SAM returned an unreadable response. Restart the updated local API and try again."); }
      if (!response.ok) {
        throw new Error(value !== null && typeof value === "object" && "detail" in value && typeof value.detail === "string"
          ? value.detail : "Detection is unavailable. Please try again.");
      }
      const result = parseLightResult(value, canvas, prompt);
      if (request.signal.aborted || this.request !== request) return;
      this.stopPolling();
      if (result.timings) {
        const t = result.timings;
        this.timing.textContent = `${t.reused_model ? "Reused loaded model" : "Cold model load"} · Load ${(t.model_load_ms / 1000).toFixed(1)}s · Frame ${(t.image_setup_ms / 1000).toFixed(1)}s · Detect ${(t.detection_ms / 1000).toFixed(1)}s · Other ${(t.other_ms / 1000).toFixed(1)}s · Total ${(t.total_ms / 1000).toFixed(1)}s`;
      }
      this.image.src = `data:image/png;base64,${result.overlay_png}`;
      this.image.alt = `SAM 3.1 detections for ${prompt} in the captured view.`;
      const detections = result.groups.flatMap(group => group.detections);
      this.result = { detections, width: result.width, height: result.height, prompt, select };
      const count = document.createElement("li");
      count.textContent = `${detections.length} matches · ${prompt}`;
      this.counts.append(count);
      detections.forEach((detection, index) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = String(index);
        checkbox.checked = Boolean(detection.mask_png);
        checkbox.disabled = !detection.mask_png;
        label.append(checkbox, `Match ${index + 1} · ${Math.round(detection.score * 100)}%`);
        this.matches.append(label);
      });
      this.progress.textContent = detections.length
        ? "Check matches to segment and select. Then choose a Target Layer in Model Browser to classify them."
        : "No matches. Try a closer view or a shorter visual description.";
      this.status.textContent = `${detections.length} matches for “${prompt}”.`;
    } catch (error) {
      if (request.signal.aborted || this.request !== request) return;
      this.report(error);
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.stopPolling();
        this.pauseViewer(false);
        this.setBusy(false);
        this.updateApply();
      }
    }
  }

  private async select(): Promise<void> {
    const result = this.result;
    if (!result || this.request) return;
    const request = new AbortController();
    this.request = request;
    this.setBusy(true);
    this.progress.textContent = "Projecting checked masks into the scan…";
    try {
      this.pauseViewer(true);
      const pixels = new Uint8Array(result.width * result.height);
      for (const checkbox of this.matches.querySelectorAll<HTMLInputElement>("input:checked")) {
        const mask = result.detections[Number(checkbox.value)]?.mask_png;
        if (!mask) continue;
        const image = new Image();
        image.src = `data:image/png;base64,${mask}`;
        await image.decode();
        if (request.signal.aborted) return;
        if (image.naturalWidth !== result.width || image.naturalHeight !== result.height) throw new Error("The selection mask does not match this view.");
        const canvas = document.createElement("canvas");
        canvas.width = result.width;
        canvas.height = result.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The browser could not read the selection mask.");
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, result.width, result.height).data;
        for (let i = 0; i < pixels.length; i++) if (rgba[i * 4]! > 127) pixels[i] = Number(checkbox.value) + 1;
      }
      if (request.signal.aborted) return;
      const projectionStarted = performance.now();
      await result.select({ width: result.width, height: result.height, pixels }, result.prompt, request.signal);
      if (request.signal.aborted) return;
      this.status.textContent = `Segmentation projected in ${((performance.now() - projectionStarted) / 1000).toFixed(1)}s. Classify the selected objects in Model Browser.`;
      this.dialog.close();
    } catch (error) {
      if (!request.signal.aborted) this.report(error);
    } finally {
      if (this.request === request) { this.request = undefined; this.pauseViewer(false); this.setBusy(false); this.updateApply(); }
    }
  }

  private report(error: unknown): void {
    this.status.textContent = this.progress.textContent = error instanceof Error ? error.message : "SAM could not complete this action.";
    this.status.dataset.error = "true";
  }

  dispose(): void {
    this.request?.abort();
    this.request = undefined;
    this.stopPolling();
    this.pauseViewer(false);
    this.events.abort();
    this.dialog.close();
    this.resetResults();
  }
}
