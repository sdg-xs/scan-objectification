import { expect, it } from "vitest";
import { Vector3 } from "three";
import { estimateElementPose } from "./element-pose";

it("records center and only Z heading for a translated sloping line", () => {
  const angle = Math.PI / 3;
  const points = [-2, -1, 0, 1, 2].map(t => new Vector3(10 + t * Math.cos(angle), 20 + t * Math.sin(angle), 3));
  const pose = estimateElementPose(points.length, i => points[i]!);
  expect(pose.position).toEqual([10, 20, 3]);
  expect(pose.z).toBeCloseTo(angle);
  expect(pose.rotationReliable).toBe(true);
});
it("marks symmetric and single-point rotations as uncertain", () => {
  const points = [new Vector3(1, 0, 2), new Vector3(-1, 0, 2), new Vector3(0, 1, 2), new Vector3(0, -1, 2)];
  expect(estimateElementPose(4, i => points[i]!)).toMatchObject({ z: 0, rotationReliable: false });
  expect(estimateElementPose(1, () => points[0]!)).toMatchObject({ position: [1, 0, 2], z: 0, rotationReliable: false });
  expect(() => estimateElementPose(0, () => new Vector3())).toThrow();
});
