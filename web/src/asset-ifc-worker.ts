import { IfcAPI } from "web-ifc";
import { readIfcAssetGeometry } from "./ifc-asset-geometry";

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; occurrenceId: number; wasmPath: string }>) => {
  const api = new IfcAPI();
  let model: number | undefined;
  try {
    api.SetWasmPath(event.data.wasmPath, true);
    await api.Init();
    model = api.OpenModel(new Uint8Array(event.data.bytes), { COORDINATE_TO_ORIGIN: false });
    if (model < 0 || !api.GetLineType(model, event.data.occurrenceId)) throw new Error("The representative IFC occurrence is unavailable.");
    const result = readIfcAssetGeometry(api, model, event.data.occurrenceId);
    self.postMessage({ geometry: result });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Unable to read IFC geometry." }); }
  finally { if (model !== undefined && model >= 0) api.CloseModel(model); api.Dispose(); }
};
