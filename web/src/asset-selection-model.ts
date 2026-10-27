import { Box3, Matrix4, Vector3, Vector4 } from "three";
import type { OBB } from "three/addons/math/OBB.js";

export type SelectionOperation = "replace" | "add" | "remove";
export interface ScreenMask { width: number; height: number; pixels: Uint8Array }

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
  screenMask?: ScreenMask;
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
    if (hit && options.projection && options.screenMask) {
      clip.set(point.x, point.y, point.z, 1).applyMatrix4(options.projection);
      const { width, height, pixels } = options.screenMask;
      const x = Math.floor((clip.x / clip.w + 1) * 0.5 * width);
      const y = Math.floor((1 - clip.y / clip.w) * 0.5 * height);
      hit = clip.w > 0 && clip.z >= -clip.w && clip.z <= clip.w && x >= 0 && y >= 0 && x < width && y < height && Boolean(pixels[y * width + x]);
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
