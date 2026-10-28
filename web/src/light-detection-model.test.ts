import { expect, it } from "vitest";
import { captureSize, parseLightResult, parseSamStatus } from "./light-detection-model";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const result = () => ({ model: "sam3.1", width: 1, height: 1, overlay_png: png, groups: ["linear", "round", "bulb"].map(kind => {
  const detections: { score: number; box: number[] }[] = [];
  return { kind, detections };
}) });

it("preserves capture dimensions inherited from a browser canvas prototype", () => {
  class CanvasFrame {
    get width(): number { return 1600; }
    get height(): number { return 721; }
  }
  const frame = new CanvasFrame();
  expect(Object.keys(frame)).toEqual([]);
  const parsed = parseLightResult({ ...result(), width: 1600, height: 721 }, frame);
  expect([parsed.width, parsed.height]).toEqual([1600, 721]);
});

it("accepts warm-model timing data and rejects invalid durations", () => {
  const timings = { reused_model: true, model_load_ms: 0, image_setup_ms: 1, detection_ms: 2, other_ms: 1, total_ms: 4 };
  expect(parseLightResult({ ...result(), timings }, { width: 1, height: 1 }).timings).toEqual(timings);
  expect(() => parseLightResult({ ...result(), timings: { ...timings, detection_ms: NaN } }, { width: 1, height: 1 })).toThrow();
  expect(parseSamStatus({ model: "sam3.1", status: "ready", phase: "detecting", busy: true, model_loaded: true }).busy).toBe(true);
  expect(() => parseSamStatus({ phase: "done" })).toThrow();
});

it("accepts custom objects and masks only for the requested prompt", () => {
  const value = { ...result(), prompt: "red pipe", groups: [{ kind: "custom", detections: [{ score: 0.9, box: [0, 0, 1, 1], mask_png: png }] }] };
  expect(parseLightResult(value, { width: 1, height: 1 }, "red pipe").groups[0]!.detections[0]!.mask_png).toBe(png);
  expect(() => parseLightResult(value, { width: 1, height: 1 }, "air vent")).toThrow();
  expect(() => parseLightResult({ ...value, groups: [{ kind: "custom", detections: [{ score: 0.9, box: [0, 0, 1, 1] }] }] }, { width: 1, height: 1 }, "red pipe")).toThrow();
  expect(() => parseLightResult({ ...value, groups: [{ kind: "custom", detections: [{ score: 0.9, box: [0, 0, 1, 1], mask_png: "https://example.com/mask" }] }] }, { width: 1, height: 1 }, "red pipe")).toThrow();
});

it("bounds the captured frame without stretching either landscape or portrait", () => {
  expect(captureSize(3000, 1500)).toEqual({ width: 1600, height: 800 });
  expect(captureSize(900, 2700)).toEqual({ width: 533, height: 1600 });
  expect(captureSize(640, 480)).toEqual({ width: 640, height: 480 });
  expect(() => captureSize(0, 1)).toThrow();
});

it("accepts zero matches and keeps all three light categories distinct", () => {
  const parsed = parseLightResult(result(), { width: 1, height: 1 });
  expect(parsed.groups.map(group => group.kind)).toEqual(["linear", "round", "bulb"]);
  expect(parsed.groups.map(group => group.detections.length)).toEqual([0, 0, 0]);
});

it("rejects results for a different frame or model", () => {
  expect(() => parseLightResult({ ...result(), width: 2 }, { width: 1, height: 1 })).toThrow();
  expect(() => parseLightResult({ ...result(), model: "sam3" }, { width: 1, height: 1 })).toThrow();
  expect(() => parseLightResult({ ...result(), overlay_png: "https://example.com/image" }, { width: 1, height: 1 })).toThrow();
});

it("rejects invalid confidence, boxes and duplicate categories", () => {
  for (const detection of [
    { score: NaN, box: [0, 0, 1, 1] },
    { score: 0.8, box: [0.8, 0, 0.8, 1] },
    { score: 1.1, box: [0, 0, 1, 1] },
  ]) {
    const value = result();
    value.groups[0] = { kind: "linear", detections: [detection] };
    expect(() => parseLightResult(value, { width: 1, height: 1 })).toThrow();
  }
  const duplicate = result();
  duplicate.groups[1]!.kind = "linear";
  expect(() => parseLightResult(duplicate, { width: 1, height: 1 })).toThrow();
});
