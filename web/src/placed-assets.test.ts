import { expect, it } from "vitest";
import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { normalizedAsset, parseGeometry } from "./asset-geometry";
import { PlacedAssets } from "./placed-assets";
import type { Segment } from "./segments-model";

const payload = { meshes: [{ positions: [10, 20, 0, 14, 20, 0, 14, 21, 0, 10, 21, 0], normals: Array(12).fill(0), indices: [0, 1, 2, 0, 2, 3], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], color: [1,1,1,1] }] };
it("validates geometry and removes source translation before placement", () => {
  expect(() => parseGeometry({ meshes: [{ ...payload.meshes[0], indices: [999, 1, 2] }] })).toThrow();
  const asset = normalizedAsset(parseGeometry(payload), "z");
  const center = new Box3().setFromObject(asset).getCenter(new Vector3());
  expect(center.length()).toBeLessThan(1e-6);
});
it("places independent occurrences with only Z corrections and follows visibility/deletion", () => {
  const parent = new Group();
  const assets = new PlacedAssets(parent, []);
  assets.cache("a", normalizedAsset(parseGeometry(payload), "z"));
  const rows: Segment[] = [1, 2].map(id => ({ id, name: "Light", layerId: 5, visible: true, indices: new Uint32Array([id]),
    pose: { position: [id * 10, 2, 3], z: Math.PI / 2, rotationReliable: true }, asset: { id: "a", name: "Light", correctionZ: 0, scale: 1 } }));
  assets.sync(rows, () => true);
  expect(parent.children).toHaveLength(2);
  expect(parent.children[0]!.position.toArray()).toEqual([10, 2, 3]);
  rows[0]!.asset!.correctionZ = Math.PI / 4;
  assets.sync(rows, row => row.id === 2);
  expect(parent.children[0]!.rotation.z).toBeCloseTo(3 * Math.PI / 4);
  expect(parent.children[0]!.visible).toBe(false);
  expect(parent.children[1]!.rotation.z).toBeCloseTo(Math.PI / 2);
  assets.sync(rows.slice(1), () => true);
  expect(parent.children).toHaveLength(1);
  assets.clear();
  expect(parent.children).toHaveLength(0);
});

it("preserves small dimensions from georeferenced IFC placements", () => {
  const transform = [1,0,0,0,0,1,0,0,0,0,1,0,10000000,10000000,0,1];
  const geometry = parseGeometry({ meshes: [{ positions: [0,0,0, 0.1,0,0, 0,0.1,0], normals: [0,0,1,0,0,1,0,0,1], indices: [0,1,2], transform, color: [1,1,1,1] }] });
  const asset = normalizedAsset(geometry, "z");
  expect(new Box3().setFromObject(asset).getSize(new Vector3()).length()).toBeGreaterThan(0.1);
});

it("matches the library's Y-input to Z-display conversion exactly once", () => {
  const geometry = parseGeometry({ meshes: [{ positions: [0,0,0, 4,0,0, 4,2,0, 0,2,0, 0,0,1, 4,0,1, 4,2,1, 0,2,1], normals: Array(24).fill(0), indices: [0,1,2,0,2,3], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], color: [1,1,1,1] }] });
  const converted = new Box3().setFromObject(normalizedAsset(geometry, "y")).getSize(new Vector3());
  expect(converted.x).toBeCloseTo(4); expect(converted.y).toBeCloseTo(1); expect(converted.z).toBeCloseTo(2);
  const alreadyZ = new Box3().setFromObject(normalizedAsset(geometry, "z")).getSize(new Vector3());
  expect(alreadyZ.x).toBeCloseTo(4); expect(alreadyZ.y).toBeCloseTo(2); expect(alreadyZ.z).toBeCloseTo(1);
});

it("uses private material colors and linked highlights without modifying shared geometry", () => {
  const parent = new Group(), assets = new PlacedAssets(parent, []);
  assets.cache("a", normalizedAsset(parseGeometry(payload), "z"));
  const rows: Segment[] = [1,2].map(id => ({ id, name: "Light", visible: true, layerId: 7, indices: new Uint32Array([id]), pose: { position: [id,0,0], z: 0, rotationReliable: true }, asset: { id: "a", name: "Lamp", correctionZ: 0, scale: 1, color: id === 1 ? "#ff0000" : "#00ff00" } }));
  assets.sync(rows, () => true, { colorMode: "custom", layerColors: new Map([[7,"#0000ff"]]), highlighted: new Set([1]) });
  const first = parent.children[0]!.children[0], second = parent.children[1]!.children[0];
  if (!(first instanceof Mesh) || !(second instanceof Mesh) || !(first.material instanceof MeshStandardMaterial) || !(second.material instanceof MeshStandardMaterial)) throw new Error("Missing asset mesh");
  expect(first.geometry).toBe(second.geometry); expect(first.material).not.toBe(second.material);
  expect(first.material.color.getHexString()).toBe("ff0000"); expect(second.material.color.getHexString()).toBe("00ff00");
  expect(first.material.emissive.getHex()).not.toBe(0); expect(second.material.emissive.getHex()).toBe(0);
  assets.sync(rows, () => true, { colorMode: "layer", layerColors: new Map([[7,"#0000ff"]]), highlighted: new Set() });
  expect(first.material.color.getHexString()).toBe("0000ff"); expect(first.material.emissive.getHex()).toBe(0);
  assets.sync(rows, () => true);
  expect(first.material.color.getHexString()).toBe("ffffff"); expect(second.material.color.getHexString()).toBe("ffffff");
  assets.clear();
});
