import { expect, it } from "vitest";
import { captureSize, parseLightResult } from "./light-detection-model";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const result = () => ({ model: "sam3.1", width: 1, height: 1, overlay_png: png, groups: ["linear", "round", "bulb"].map(kind => {
  const detections: { score: number; box: number[] }[] = [];
  return { kind, detections };
}) });

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
