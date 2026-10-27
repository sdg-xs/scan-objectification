import { Box3, Matrix4, Vector3, Vector4 } from "three";
import type { OBB } from "three/addons/math/OBB.js";

export type SelectionOperation = "replace" | "add" | "remove";

/** Rectangle coordinates are normalized device coordinates; selection goes through depth. */
export async function selectAsset(options: {
  count: number;
  center: (index: number) => Vector3;
  world: Matrix4;
  previous: Uint8Array;
  operation: SelectionOperation;
  region?: Box3 | OBB;
  projection?: Matrix4;
  rectangle?: readonly [number, number, number, number];
  canceled?: () => boolean;
}): Promise<{ mask: Uint8Array; count: number; bounds: Box3 }> {
  const mask = new Uint8Array(options.count);
  const bounds = new Box3();
  const clip = new Vector4();
  let count = 0;
  for (let i = 0; i < options.count; i++) {
    if (i % 32768 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (options.canceled?.()) throw new Error("Selection canceled");
    }
    const point = options.center(i).applyMatrix4(options.world);
    let hit = !options.region || options.region.containsPoint(point);
    if (hit && options.projection && options.rectangle) {
      clip.set(point.x, point.y, point.z, 1).applyMatrix4(options.projection);
      const [left, bottom, right, top] = options.rectangle;
      hit = clip.w > 0 && clip.z >= -clip.w && clip.z <= clip.w &&
        clip.x >= left * clip.w && clip.x <= right * clip.w &&
        clip.y >= bottom * clip.w && clip.y <= top * clip.w;
    }
    const wasSelected = Boolean(options.previous[i]);
    const selected = options.operation === "replace" ? hit :
      options.operation === "add" ? wasSelected || hit : wasSelected && !hit;
    if (selected) {
      mask[i] = 1;
      count++;
      bounds.expandByPoint(point);
    }
  }
  return { mask, count, bounds };
}
