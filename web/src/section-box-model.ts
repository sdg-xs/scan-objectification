import { Box3, Plane, Vector3 } from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";

export function finishSectionMove(
  gizmo: TransformControls,
  orbit: { enabled: boolean },
  previous: boolean | undefined,
): void {
  if (gizmo.dragging) gizmo.pointerUp(null);
  if (previous !== undefined) orbit.enabled = previous;
}

export type BoxAxis = "x" | "y" | "z";

export function updateSectionPlanes(box: Box3, planes: Plane[]): Plane[] {
  if (box.isEmpty()) throw new Error("Cannot section an empty scene.");
  while (planes.length < 6) planes.push(new Plane());
  planes.length = 6;
  planes[0].set(new Vector3(1, 0, 0), -box.min.x);
  planes[1].set(new Vector3(-1, 0, 0), box.max.x);
  planes[2].set(new Vector3(0, 1, 0), -box.min.y);
  planes[3].set(new Vector3(0, -1, 0), box.max.y);
  planes[4].set(new Vector3(0, 0, 1), -box.min.z);
  planes[5].set(new Vector3(0, 0, -1), box.max.z);
  return planes;
}

export function resizeSectionFace(
  box: Box3,
  axis: BoxAxis,
  side: -1 | 1,
  delta: number,
  minimum: number,
): Box3 {
  const resized = box.clone();
  if (side === 1)
    resized.max[axis] = Math.max(
      box.min[axis] + minimum,
      box.max[axis] + delta,
    );
  else
    resized.min[axis] = Math.min(
      box.max[axis] - minimum,
      box.min[axis] + delta,
    );
  return resized;
}
