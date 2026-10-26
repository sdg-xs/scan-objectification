import { describe, expect, it } from "vitest";
import { Box3, Group, Vector3 } from "three";
import {
  applyScanTransform,
  centerModel,
  frameBounds,
  validateModelHeader,
} from "./viewer-model";

describe("camera framing", () => {
  it("fits a tall model in a narrow viewport without clipping", () => {
    const box = new Box3(new Vector3(10, 20, 30), new Vector3(30, 120, 50));
    const frame = frameBounds(box, 50, 0.5);
    expect(frame.target.toArray()).toEqual([20, 70, 40]);
    const radius = box.getSize(new Vector3()).length() / 2;
    const horizontalHalfFov = Math.atan(Math.tan((25 * Math.PI) / 180) * 0.5);
    expect(frame.distance * Math.sin(horizontalHalfFov)).toBeGreaterThan(
      radius,
    );
    expect(frame.far).toBeGreaterThan(frame.distance + radius);
    expect(frame.near).toBeGreaterThan(0);
  });

  it("does not move the camera for empty or non-finite bounds", () => {
    expect(() => frameBounds(new Box3(), 50, 1)).toThrow();
    expect(() =>
      frameBounds(new Box3(new Vector3(), new Vector3(Infinity, 1, 1)), 50, 1),
    ).toThrow();
  });

  it("handles a single point", () => {
    const frame = frameBounds(new Box3(new Vector3(), new Vector3()), 50, 1);
    expect(Number.isFinite(frame.distance)).toBe(true);
    expect(frame.distance).toBeGreaterThan(0);
  });
});

describe("manual scan alignment", () => {
  it("applies repeatable translation, degree rotations and uniform scale", () => {
    const scan = new Group();
    const transform = { x: 2, y: 3, z: 4, rx: 0, ry: 90, rz: 0, scale: 2 };
    applyScanTransform(scan, transform);
    applyScanTransform(scan, transform);
    const point = new Vector3(1, 0, 0).applyMatrix4(scan.matrixWorld);
    expect(point.x).toBeCloseTo(2);
    expect(point.y).toBeCloseTo(3);
    expect(point.z).toBeCloseTo(2);
  });

  it("rejects invalid transforms before changing the scan", () => {
    const scan = new Group();
    expect(() =>
      applyScanTransform(scan, {
        x: NaN,
        y: 0,
        z: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        scale: 1,
      }),
    ).toThrow();
    expect(() =>
      applyScanTransform(scan, {
        x: 0,
        y: 0,
        z: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        scale: 0,
      }),
    ).toThrow();
    expect(scan.position.toArray()).toEqual([0, 0, 0]);
  });
});

it("centers replacement IFC geometry even with a stale automatic origin offset", () => {
  const model = new Group();
  model.position.set(100000, 0, 200000);
  const localBounds = new Box3(
    new Vector3(10, 20, 30),
    new Vector3(30, 40, 50),
  );
  const bounds = centerModel(model, () =>
    localBounds.clone().applyMatrix4(model.matrixWorld),
  );
  expect(bounds.getCenter(new Vector3()).toArray()).toEqual([0, 0, 0]);
  expect(
    localBounds
      .clone()
      .applyMatrix4(model.matrixWorld)
      .getCenter(new Vector3())
      .toArray(),
  ).toEqual([0, 0, 0]);
});

it("rejects malformed local files before invoking binary decoders", () => {
  expect(() => validateModelHeader("ply", "invalid ply data")).toThrow();
  expect(() => validateModelHeader("ifc", "invalid ifc data")).toThrow();
  expect(() =>
    validateModelHeader("ply", "ply\nformat binary_little_endian 1.0\n"),
  ).toThrow();
  expect(() =>
    validateModelHeader(
      "ply",
      "ply\nformat binary_little_endian 1.0\nelement vertex 1\nend_header\n",
    ),
  ).not.toThrow();
  expect(() =>
    validateModelHeader("ifc", "\uFEFF ISO-10303-21;\nHEADER;"),
  ).not.toThrow();
});
