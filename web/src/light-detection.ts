import { parseLightResult } from "./light-detection-model";

const names = { linear: "Linear fixtures", round: "Round lights", bulb: "Visible bulbs" };

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof type)) throw new Error(`Missing light-detection control: ${id}`);
  return value;
}

export class LightDetectionControls {
  private readonly button = element("find-lights", HTMLButtonElement);
  private readonly status = element("light-status", HTMLParagraphElement);
  private readonly dialog = element("light-results", HTMLDialogElement);
  private readonly image = element("light-result-image", HTMLImageElement);
  private readonly progress = element("light-result-status", HTMLParagraphElement);
  private readonly counts = element("light-counts", HTMLUListElement);
  private readonly events = new AbortController();
  private request: AbortController | undefined;
  private preview: string | undefined;
  private available = false;

  constructor(private readonly capture: () => HTMLCanvasElement) {
    const signal = this.events.signal;
    this.button.addEventListener("click", () => void this.detect(), { signal });
    element("close-light-results", HTMLButtonElement).addEventListener("click", () => this.dialog.close(), { signal });
    this.dialog.addEventListener("close", () => {
      if (this.request) {
        this.request.abort();
        this.request = undefined;
        this.status.textContent = "Detection canceled. Your live view is unchanged.";
      }
      this.button.disabled = !this.available;
      this.releasePreview();
      this.image.removeAttribute("src");
    }, { signal });
  }

  setAvailable(available: boolean): void {
    this.available = available;
    this.button.disabled = !available || Boolean(this.request);
  }

  private releasePreview(): void {
    if (this.preview) URL.revokeObjectURL(this.preview);
    this.preview = undefined;
  }

  private async detect(): Promise<void> {
    if (!this.available || this.request) return;
    const request = new AbortController();
    this.request = request;
    this.button.disabled = true;
    this.status.dataset.error = "false";
    this.counts.replaceChildren();
    this.progress.textContent = "Finding lights with local SAM 3.1… The first view takes longer to prepare.";
    this.status.textContent = "Finding lights in the captured view…";
    try {
      const frame = this.capture();
      this.dialog.showModal();
      const blob = await new Promise<Blob>((resolve, reject) => frame.toBlob(
        value => value ? resolve(value) : reject(new Error("The view could not be captured.")), "image/png",
      ));
      if (request.signal.aborted) return;
      if (blob.size > 8 * 1024 * 1024) throw new Error("The view is too large. Use a smaller browser window and try again.");
      this.releasePreview();
      this.preview = URL.createObjectURL(blob);
      this.image.src = this.preview;
      this.image.alt = "The captured view currently being checked for lights.";
      const response = await fetch("/api/local/lights", {
        method: "POST", headers: { "Content-Type": "image/png" }, body: blob, signal: request.signal,
      });
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new Error(response.status === 404
          ? "Light detection needs the updated local app. Restart the app and try again."
          : "Light detection returned an unreadable response. Please try again.");
      }
      if (!response.ok) {
        const detail = value !== null && typeof value === "object" && "detail" in value && typeof value.detail === "string"
          ? value.detail : "Light detection is unavailable. Please try again.";
        throw new Error(detail);
      }
      const result = parseLightResult(value, frame);
      if (request.signal.aborted || this.request !== request) return;
      this.image.src = `data:image/png;base64,${result.overlay_png}`;
      this.image.alt = "SAM 3.1 light masks and numbered boxes in the captured view.";
      this.releasePreview();
      for (const group of result.groups) {
        const item = document.createElement("li");
        item.className = `light-count light-${group.kind}`;
        item.textContent = `${names[group.kind]}: ${group.detections.length}`;
        this.counts.append(item);
      }
      const total = result.groups.reduce((sum, group) => sum + group.detections.length, 0);
      this.progress.textContent = total
        ? "Review the colored masks and numbered boxes. Categories may overlap."
        : "No lights matched. Try a closer view with the fixtures clearly visible.";
      this.status.textContent = result.groups.map(group => `${names[group.kind]}: ${group.detections.length}`).join(" · ");
    } catch (error) {
      if (request.signal.aborted || this.request !== request) return;
      const message = error instanceof Error ? error.message : "The view could not be checked. Please try again.";
      this.status.textContent = this.progress.textContent = message;
      this.status.dataset.error = "true";
    } finally {
      if (this.request === request) {
        this.request = undefined;
        this.button.disabled = !this.available;
      }
    }
  }

  dispose(): void {
    this.request?.abort();
    this.request = undefined;
    this.events.abort();
    this.dialog.close();
    this.releasePreview();
    this.image.removeAttribute("src");
  }
}
