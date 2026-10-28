// Read-only smoke check of the real gateway, IFC extractor and normalization without a browser.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { Box3, Vector3 } from "three";
const assetId = process.argv[2];
if (!assetId) throw new Error("Usage: node scripts/verify-library-asset.mjs ASSET_ID");
const require = createRequire(import.meta.url);
const { IfcAPI } = require("web-ifc");
const cacheDir = await mkdtemp(join(tmpdir(), "nemy-asset-check-"));
const server = await createServer({ cacheDir, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom" });
const api = new IfcAPI();
let model;
try {
  const base = `http://127.0.0.1:8767/api/local/assets/${encodeURIComponent(assetId)}`;
  const descriptorResponse = await fetch(`${base}/geometry`);
  if (!descriptorResponse.ok) throw new Error(`Geometry gateway returned ${descriptorResponse.status}`);
  const descriptor = await descriptorResponse.json();
  let geometry;
  if (descriptor.kind === "ifc") {
    const response = await fetch(`${base}/source?${new URLSearchParams({ fingerprint: descriptor.fingerprint })}`);
    if (!response.ok) throw new Error(`Source gateway returned ${response.status}`);
    api.SetWasmPath(dirname(require.resolve("web-ifc")).replaceAll("\\", "/") + "/", true);
    await api.Init();
    model = api.OpenModel(new Uint8Array(await response.arrayBuffer()), { COORDINATE_TO_ORIGIN: false });
    const { readIfcAssetGeometry } = await server.ssrLoadModule("/src/ifc-asset-geometry.ts");
    geometry = readIfcAssetGeometry(api, model, descriptor.occurrenceId);
  } else geometry = descriptor.geometry;
  const { parseGeometry, normalizedAsset, disposeAsset } = await server.ssrLoadModule("/src/asset-geometry.ts");
  const normalized = normalizedAsset(parseGeometry(geometry), "y");
  const bounds = new Box3().setFromObject(normalized);
  const size = bounds.getSize(new Vector3());
  if (bounds.isEmpty() || !size.toArray().every(Number.isFinite) || !size.length()) throw new Error("Geometry bounds are invalid");
  console.log(JSON.stringify({ assetId, meshes: geometry.meshes.length, triangles: geometry.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0), sizeMetres: size.toArray() }));
  disposeAsset(normalized);
} finally {
  if (model !== undefined) { api.CloseModel(model); api.Dispose(); }
  await server.close();
  assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir()));
  await rm(cacheDir, { recursive: true, force: true });
}
