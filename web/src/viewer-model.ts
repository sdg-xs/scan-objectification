import { Box3, MathUtils, Object3D, Vector3 } from "three";

export interface ScanTransform {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
}

export function setSourceUp(object: Object3D, sourceUp: "y" | "z"): void {
  object.rotation.set(sourceUp === "y" ? Math.PI / 2 : 0, 0, 0);
}

export function validateModelHeader(kind: "ifc" | "ply", header: string): void {
  const valid =
    kind === "ifc"
      ? header.trimStart().startsWith("ISO-10303-21;")
      : /^ply\r?\nformat (binary_little_endian|binary_big_endian|ascii) 1\.0\r?\n/.test(
          header,
        ) && /\r?\nend_header\r?\n/.test(header);
  if (!valid) {
    throw new Error(
      kind === "ifc"
        ? "Choose a valid IFC STEP file (.ifc)."
        : "Choose a valid PLY file with a complete header within the first 64 KiB.",
    );
  }
}

export function centerModel(object: Object3D, readBounds: () => Box3): Box3 {
  object.position.set(0, 0, 0);
  object.updateMatrixWorld(true);
  const bounds = readBounds();
  if (
    bounds.isEmpty() ||
    ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
  ) {
    throw new Error("The model has no finite geometry.");
  }
  const offset = bounds.getCenter(new Vector3()).negate();
  object.position.copy(offset);
  object.updateMatrixWorld(true);
  return bounds.clone().translate(offset);
}

export function applyScanTransform(
  object: Object3D,
  value: ScanTransform,
): void {
  if (!Object.values(value).every(Number.isFinite) || value.scale <= 0) {
    throw new Error("Use finite values and a scale greater than zero.");
  }
  object.position.set(value.x, value.y, value.z);
  object.rotation.set(
    MathUtils.degToRad(value.rx),
    MathUtils.degToRad(value.ry),
    MathUtils.degToRad(value.rz),
  );
  object.scale.setScalar(value.scale);
  object.updateMatrixWorld(true);
}

export function frameBounds(box: Box3, verticalFov: number, aspect: number) {
  if (
    box.isEmpty() ||
    ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
  ) {
    throw new Error("The model has no finite bounds to frame.");
  }
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
  const halfFov = MathUtils.degToRad(verticalFov) / 2;
  const limitingAngle = Math.min(
    halfFov,
    Math.atan(Math.tan(halfFov) * aspect),
  );
  const distance = (radius / Math.sin(limitingAngle)) * 1.15;
  return {
    target: box.getCenter(new Vector3()),
    distance,
    near: Math.max(0.01, radius / 10000),
    far: Math.max(1000, distance + radius * 10),
  };
}
