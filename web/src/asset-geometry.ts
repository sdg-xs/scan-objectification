import { Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { estimateElementPose } from "./element-pose";

export interface GeometryPiece { positions: number[]; normals: number[]; indices: number[]; transform: number[]; color: number[] }
export interface AssetGeometry { meshes: GeometryPiece[] }
function numbers(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every(n => typeof n === "number" && Number.isFinite(n))) throw new Error("Invalid asset geometry numbers.");
  return value;
}
export function parseGeometry(value: unknown): AssetGeometry {
  if (!value || typeof value !== "object" || !("meshes" in value) || !Array.isArray(value.meshes) || !value.meshes.length || value.meshes.length > 10000)
    throw new Error("This asset has no supported geometry.");
  return { meshes: value.meshes.map((piece: unknown) => {
    if (!piece || typeof piece !== "object" || !("positions" in piece) || !("normals" in piece) || !("indices" in piece) || !("transform" in piece) || !("color" in piece)) throw new Error("Invalid asset mesh.");
    const positions = numbers(piece.positions), normals = numbers(piece.normals), indices = numbers(piece.indices), transform = numbers(piece.transform), color = numbers(piece.color);
    if (positions.length < 9 || positions.length % 3 || normals.length !== positions.length || !indices.length || indices.length % 3 || indices.some(n => !Number.isInteger(n) || n < 0 || n >= positions.length / 3) || transform.length !== 16 || color.length !== 4 || color.some(n => n < 0 || n > 1)) throw new Error("Invalid asset mesh dimensions.");
    return { positions, normals, indices, transform, color };
  }) };
}

/** Retain dimensions; remove the representative occurrence's building translation and XY heading. */
export function normalizedAsset(geometry: AssetGeometry, up: "y" | "z"): Group {
  const group = new Group();
  const rotation = new Matrix4().makeRotationX(up === "y" ? Math.PI / 2 : 0);
  const pieces = geometry.meshes.map(piece => ({ piece, matrix: new Matrix4().fromArray(piece.transform).premultiply(rotation) }));
  const bounds = new Box3(), samples: Vector3[] = [], point = new Vector3();
  for (const { piece, matrix } of pieces) {
    const step = Math.max(1, Math.ceil(piece.positions.length / 3 / 20000));
    for (let i = 0; i < piece.positions.length; i += 3) {
      point.fromArray(piece.positions, i).applyMatrix4(matrix);
      if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error("Invalid asset placement matrix.");
      bounds.expandByPoint(point);
      if (i / 3 % step === 0) samples.push(point.clone());
    }
  }
  const center = bounds.getCenter(new Vector3());
  const pose = estimateElementPose(samples.length, i => samples[i]!);
  const normalize = new Matrix4().makeRotationZ(-pose.z).multiply(new Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  try {
    for (const { piece, matrix } of pieces) {
      const transform = normalize.clone().multiply(matrix);
      const positions = new Float32Array(piece.positions.length);
      for (let i = 0; i < piece.positions.length; i += 3) {
        point.fromArray(piece.positions, i).applyMatrix4(transform);
        positions.set([point.x, point.y, point.z], i);
      }
      const buffer = new BufferGeometry();
      buffer.setAttribute("position", new BufferAttribute(positions, 3));
      buffer.setAttribute("normal", new BufferAttribute(new Float32Array(piece.normals), 3).applyNormalMatrix(new Matrix3().getNormalMatrix(transform)));
      buffer.setIndex(piece.indices);
      const color = new Color().setRGB(piece.color[0]!, piece.color[1]!, piece.color[2]!);
      const material = new MeshStandardMaterial({ color, opacity: piece.color[3]!, transparent: piece.color[3]! < 1, side: DoubleSide, roughness: 0.72 });
      group.add(new Mesh(buffer, material));
    }
    return group;
  } catch (error) { disposeAsset(group); throw error; }
}
export function disposeAsset(group: Group): void {
  group.traverse(node => { if (node instanceof Mesh) { node.geometry.dispose(); const materials = Array.isArray(node.material) ? node.material : [node.material]; materials.forEach(material => material.dispose()); } });
}
