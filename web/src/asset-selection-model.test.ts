import { expect, it } from "vitest";
import { Box3, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { selectAsset } from "./asset-selection-model";

const points = [new Vector3(0, 0, -5), new Vector3(3, 0, -5), new Vector3(0, 0, 5)];
const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.updateMatrixWorld();
const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
const base = { count: 3, center: (i: number) => points[i]!.clone(), world: new Matrix4() };

it("selects source IDs inside the screen box, rejecting points behind the camera", async () => {
  const result = await selectAsset({ ...base, previous: new Uint8Array(3), operation: "replace", projection, rectangle: [-0.2, -0.2, 0.2, 0.2] });
  expect([...result.mask]).toEqual([1, 0, 0]);
  expect(result.count).toBe(1);
  expect(result.bounds.containsPoint(points[0]!)).toBe(true);
});

it("intersects screen selection with the world section after scan alignment", async () => {
  const region = new Box3(new Vector3(9, -1, -6), new Vector3(11, 1, -4));
  const result = await selectAsset({ ...base, world: new Matrix4().makeTranslation(10, 0, 0), previous: new Uint8Array(3), operation: "replace", region });
  expect([...result.mask]).toEqual([1, 0, 0]);
  expect(result.bounds.min.x).toBe(10);
});

it("adds and removes stable IDs while retaining selections outside the new region", async () => {
  const region = new Box3(new Vector3(2, -1, -6), new Vector3(4, 1, -4));
  const added = await selectAsset({ ...base, previous: new Uint8Array([1, 0, 0]), operation: "add", region });
  expect([...added.mask]).toEqual([1, 1, 0]);
  const removed = await selectAsset({ ...base, previous: added.mask, operation: "remove", region });
  expect([...removed.mask]).toEqual([1, 0, 0]);
  expect([...added.mask]).toEqual([1, 1, 0]);
});

it("cancels without publishing a partial selection", async () => {
  await expect(selectAsset({ ...base, previous: new Uint8Array(3), operation: "replace", canceled: () => true })).rejects.toThrow("canceled");
});
