import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { PerspectiveCamera } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  resizeSectionFace,
  updateSectionPlanes,
  finishSectionMove,
} from "./section-box-model";

it("ends a canceled movement and restores the camera's previous navigation state", () => {
  const gizmo = new TransformControls(new PerspectiveCamera());
  const orbit = { enabled: false };
  gizmo.dragging = true;
  finishSectionMove(gizmo, orbit, true);
  expect(gizmo.dragging).toBe(false);
  expect(orbit.enabled).toBe(true);
  gizmo.dragging = true;
  finishSectionMove(gizmo, orbit, false);
  expect(gizmo.dragging).toBe(false);
  expect(orbit.enabled).toBe(false);
});

describe("section box", () => {
  it("keeps inside points and clips all six outside regions", () => {
    const box = new Box3(new Vector3(-2, -3, -4), new Vector3(2, 3, 4));
    const planes = updateSectionPlanes(box, []);
    expect(planes).toHaveLength(6);
    expect(
      planes.every((plane) => plane.distanceToPoint(new Vector3()) >= 0),
    ).toBe(true);
    for (const point of [
      [-3, 0, 0],
      [3, 0, 0],
      [0, -4, 0],
      [0, 4, 0],
      [0, 0, -5],
      [0, 0, 5],
    ]) {
      expect(
        planes.some(
          (plane) => plane.distanceToPoint(new Vector3(...point)) < 0,
        ),
      ).toBe(true);
    }
    expect(
      updateSectionPlanes(box.translate(new Vector3(10, 0, 0)), planes),
    ).toBe(planes);
    expect(
      planes.every(
        (plane) => plane.distanceToPoint(new Vector3(10, 0, 0)) >= 0,
      ),
    ).toBe(true);
  });

  it("moves one face while preserving the opposite face and minimum thickness", () => {
    const original = new Box3(new Vector3(-2, -3, -4), new Vector3(2, 3, 4));
    const box = resizeSectionFace(original, "z", 1, -20, 0.1);
    expect(box.min.toArray()).toEqual([-2, -3, -4]);
    expect(box.max.z).toBeCloseTo(-3.9);
    expect(original.max.z).toBe(4);
    expect(resizeSectionFace(original, "x", -1, 1, 0.1).min.x).toBe(-1);
  });
});
