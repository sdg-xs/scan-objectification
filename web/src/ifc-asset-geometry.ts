import type { IfcAPI } from "web-ifc";
import type { AssetGeometry, GeometryPiece } from "./asset-geometry";

/** Same representative occurrence extraction used by the library preview. */
export function readIfcAssetGeometry(api: IfcAPI, model: number, occurrenceId: number): AssetGeometry {
    const flat = api.GetFlatMesh(model, occurrenceId);
    const meshes: GeometryPiece[] = [];
    try {
      for (let i = 0; i < flat.geometries.size(); i++) {
        const placed = flat.geometries.get(i);
        const geometry = api.GetGeometry(model, placed.geometryExpressID);
        try {
          const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          const indices = Array.from(api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()));
          if (!indices.length) continue;
          const positions: number[] = [], normals: number[] = [];
          for (let j = 0; j < vertices.length; j += 6) { positions.push(vertices[j]!, vertices[j + 1]!, vertices[j + 2]!); normals.push(vertices[j + 3]!, vertices[j + 4]!, vertices[j + 5]!); }
          meshes.push({ positions, normals, indices, transform: Array.from(placed.flatTransformation), color: [placed.color.x, placed.color.y, placed.color.z, placed.color.w] });
        } finally { geometry.delete(); }
      }
    } finally {
      const vector: unknown = flat.geometries;
      if (vector && typeof vector === "object" && "delete" in vector && typeof vector.delete === "function") vector.delete();
      if (typeof flat.delete === "function") flat.delete();
    }
    return { meshes };
}
