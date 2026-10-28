export type LightKind = "linear" | "round" | "bulb" | "custom";
export interface LightDetection { score: number; box: [number, number, number, number]; mask_png?: string }
export interface LightGroup { kind: LightKind; detections: LightDetection[] }
export interface LightResult {
  model: "sam3.1";
  width: number;
  height: number;
  groups: LightGroup[];
  overlay_png: string;
  prompt?: string;
  timings?: SamTimings;
}
export interface SamTimings { reused_model: boolean; model_load_ms: number; image_setup_ms: number; detection_ms: number; other_ms: number; total_ms: number }
export type SamPhase = "idle" | "loading_model" | "preparing_image" | "detecting" | "encoding";

export function parseSamStatus(value: unknown): { phase: SamPhase; busy: boolean; model_loaded: boolean; status: string } {
  if (!record(value) || value.model !== "sam3.1" || !["ready", "unavailable", "offline"].includes(String(value.status)) ||
      !["idle", "loading_model", "preparing_image", "detecting", "encoding"].includes(String(value.phase)) ||
      typeof value.busy !== "boolean" || typeof value.model_loaded !== "boolean") throw new Error("Invalid SAM status.");
  const phase = value.phase;
  if (phase !== "idle" && phase !== "loading_model" && phase !== "preparing_image" && phase !== "detecting" && phase !== "encoding") throw new Error("Invalid SAM phase.");
  return { phase, busy: value.busy, model_loaded: value.model_loaded, status: String(value.status) };
}

function parseTimings(value: unknown): SamTimings {
  if (!record(value) || typeof value.reused_model !== "boolean") throw new Error("Invalid SAM timings.");
  const duration = (name: string): number => {
    const item = value[name];
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0 || item > 86400000) throw new Error("Invalid SAM duration.");
    return item;
  };
  return { reused_model: value.reused_model, model_load_ms: duration("model_load_ms"), image_setup_ms: duration("image_setup_ms"), detection_ms: duration("detection_ms"), other_ms: duration("other_ms"), total_ms: duration("total_ms") };
}

export function captureSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new Error("The viewport has no usable image.");
  const scale = Math.min(1, 1600 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseDetection(value: unknown): LightDetection {
  if (!record(value) || !unit(value.score) || !Array.isArray(value.box) || value.box.length !== 4)
    throw new Error("SAM 3.1 returned an invalid detection.");
  const [x, y, width, height] = value.box;
  if (!unit(x) || !unit(y) || !unit(width) || !unit(height) || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001)
    throw new Error("SAM 3.1 returned a box outside the captured view.");
  if (value.mask_png !== undefined && (typeof value.mask_png !== "string" || value.mask_png.length > 16 * 1024 * 1024 || !value.mask_png.startsWith("iVBORw0KGgo") || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.mask_png)))
    throw new Error("SAM 3.1 returned an invalid selection mask.");
  return { score: value.score, box: [x, y, width, height], ...(typeof value.mask_png === "string" ? { mask_png: value.mask_png } : {}) };
}

export function parseLightResult(value: unknown, frame: { width: number; height: number }, prompt?: string): LightResult {
  if (!record(value) || value.model !== "sam3.1" || value.width !== frame.width || value.height !== frame.height ||
      value.prompt !== prompt || !Array.isArray(value.groups) || value.groups.length !== (prompt ? 1 : 3) || typeof value.overlay_png !== "string" ||
      value.overlay_png.length > 16 * 1024 * 1024 || !value.overlay_png.startsWith("iVBORw0KGgo") ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.overlay_png))
    throw new Error("SAM 3.1 returned an invalid result for this captured view.");
  const kinds: LightKind[] = prompt ? ["custom"] : ["linear", "round", "bulb"];
  const rawGroups = value.groups;
  const groups = kinds.map((kind, index): LightGroup => {
    const group: unknown = rawGroups[index];
    if (!record(group) || group.kind !== kind || !Array.isArray(group.detections) || group.detections.length > 50)
      throw new Error("SAM 3.1 returned invalid light categories.");
    const detections = group.detections.map(parseDetection);
    if (prompt && detections.some(detection => !detection.mask_png))
      throw new Error("SAM 3.1 did not return selection masks. Restart the updated local worker.");
    return { kind, detections };
  });
  // Canvas dimensions are inherited accessors, so object spread would omit them.
  return { model: "sam3.1", width: frame.width, height: frame.height, groups, overlay_png: value.overlay_png, ...(prompt ? { prompt } : {}), ...(value.timings !== undefined ? { timings: parseTimings(value.timings) } : {}) };
}
