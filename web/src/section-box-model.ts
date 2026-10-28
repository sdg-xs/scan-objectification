import { Box3, Plane, Vector3, Matrix3, Matrix4, Quaternion } from "three";
import { OBB } from "three/addons/math/OBB.js";
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

export function sectionRegion(box: Box3, rotation: Quaternion): OBB {
  return new OBB(
    box.getCenter(new Vector3()),
    box.getSize(new Vector3()).multiplyScalar(0.5),
    new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation)),
  );
}

export function updateSectionPlanes(
  box: Box3, planes: Plane[], rotation = new Quaternion(),
): Plane[] {
  if (box.isEmpty()) throw new Error("Cannot section an empty scene.");
  while (planes.length < 6) planes.push(new Plane());
  planes.length = 6;
  planes[0].set(new Vector3(1, 0, 0), -box.min.x);
  planes[1].set(new Vector3(-1, 0, 0), box.max.x);
  planes[2].set(new Vector3(0, 1, 0), -box.min.y);
  planes[3].set(new Vector3(0, -1, 0), box.max.y);
  planes[4].set(new Vector3(0, 0, 1), -box.min.z);
  planes[5].set(new Vector3(0, 0, -1), box.max.z);
  const center = box.getCenter(new Vector3());
  const transform = new Matrix4().makeRotationFromQuaternion(rotation);
  transform.setPosition(center.clone().sub(center.clone().applyQuaternion(rotation)));
  for (const plane of planes) plane.applyMatrix4(transform);
  return planes;
}

export function resizeSectionFace(
  box: Box3,
  axis: BoxAxis,
  side: -1 | 1,
  delta: number,
  minimum: number,
  rotation = new Quaternion(),
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
  const center = box.getCenter(new Vector3());
  const shift = resized.getCenter(new Vector3()).sub(center);
  return resized.translate(shift.clone().applyQuaternion(rotation).sub(shift));
}
