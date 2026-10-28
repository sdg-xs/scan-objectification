import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { parseGeometry } from "./asset-geometry";
import type { AssetGeometry } from "./asset-geometry";

export interface CatalogAsset { id: string; name: string; category: string; geometryKind?: "mesh" | "ifc" }
export async function libraryJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(value && typeof value === "object" && "detail" in value && typeof value.detail === "string" ? value.detail : "The asset library request failed.");
  return value;
}
export function parseCatalog(value: unknown): CatalogAsset[] {
  if (!Array.isArray(value)) throw new Error("Invalid asset catalog.");
  return value.map((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string" || !("name" in row) || typeof row.name !== "string" || !("category" in row) || typeof row.category !== "string") throw new Error("Invalid asset catalog entry.");
    const kind = "geometryKind" in row ? row.geometryKind : undefined;
    if (kind !== undefined && kind !== null && kind !== "mesh" && kind !== "ifc") throw new Error("Invalid asset geometry kind.");
    return { id: row.id, name: row.name, category: row.category, geometryKind: kind ?? undefined };
  });
}
export async function loadAssetGeometry(id: string, signal: AbortSignal): Promise<{ geometry: AssetGeometry; up: "y" | "z"; kind: "mesh" | "ifc" }> {
  const base = `/api/local/assets/${encodeURIComponent(id)}`;
  const descriptor = await libraryJson(`${base}/geometry`, signal);
  if (!descriptor || typeof descriptor !== "object" || !("kind" in descriptor)) throw new Error("Invalid asset geometry reference.");
  if (descriptor.kind === "mesh" && "geometry" in descriptor) return { geometry: parseGeometry(descriptor.geometry), up: "y", kind: "mesh" };
  if (descriptor.kind !== "ifc" || !("occurrenceId" in descriptor) || typeof descriptor.occurrenceId !== "number" || !Number.isSafeInteger(descriptor.occurrenceId) || descriptor.occurrenceId <= 0 || !("fingerprint" in descriptor) || typeof descriptor.fingerprint !== "string") throw new Error("Invalid asset source reference.");
  const response = await fetch(`${base}/source?${new URLSearchParams({ fingerprint: descriptor.fingerprint })}`, { signal });
  if (!response.ok) throw new Error("The source IFC is unavailable or changed. Choose the asset again.");
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const geometry = await new Promise<AssetGeometry>((resolve, reject) => {
    const worker = new Worker(new URL("./asset-ifc-worker.ts", import.meta.url), { type: "module" });
    const finish = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new DOMException("Asset loading cancelled.", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error("The IFC geometry worker failed.")); };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      finish();
      const value = event.data;
      try {
        if (value && typeof value === "object" && "geometry" in value) resolve(parseGeometry(value.geometry));
        else throw new Error(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "Invalid IFC geometry result.");
      } catch (error) { reject(error); }
    };
    const absoluteWasm = new URL(wasmUrl, window.location.href).href;
    worker.postMessage({ bytes, occurrenceId: descriptor.occurrenceId, wasmPath: absoluteWasm.slice(0, absoluteWasm.lastIndexOf("/") + 1) }, [bytes]);
  });
  return { geometry, up: "y", kind: "ifc" };
}
