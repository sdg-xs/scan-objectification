import { Box3, Vector3 } from "three";

export interface ElementPose { position: [number, number, number]; z: number; rotationReliable: boolean }

/** Bounding center and dominant XY direction, modulo 180 degrees. */
export function estimateElementPose(count: number, point: (index: number) => Vector3): ElementPose {
  if (!count) throw new Error("This element has no source points.");
  const bounds = new Box3();
  let meanX = 0, meanY = 0, xx = 0, xy = 0, yy = 0;
  for (let i = 0; i < count; i++) {
    const p = point(i);
    if (![p.x, p.y, p.z].every(Number.isFinite)) throw new Error("Element coordinates are invalid.");
    bounds.expandByPoint(p);
    const dx = p.x - meanX, dy = p.y - meanY;
    meanX += dx / (i + 1); meanY += dy / (i + 1);
    xx += dx * (p.x - meanX); xy += dx * (p.y - meanY); yy += dy * (p.y - meanY);
  }
  const contrast = Math.hypot(xx - yy, 2 * xy);
  const rotationReliable = xx + yy > 1e-12 && contrast / (xx + yy) > 0.2;
  const center = bounds.getCenter(new Vector3());
  return { position: [center.x, center.y, center.z], z: rotationReliable ? Math.atan2(2 * xy, xx - yy) / 2 : 0, rotationReliable };
}
