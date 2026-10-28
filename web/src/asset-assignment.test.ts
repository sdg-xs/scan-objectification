// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { Group } from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetAssignmentControls } from "./asset-assignment";
import { PlacedAssets } from "./placed-assets";
import type { Segment } from "./segments-model";
import { showAssetPreview } from "./asset-preview";
import * as libraryClient from "./asset-library-client";

vi.mock("./asset-preview", () => ({ showAssetPreview: vi.fn(() => vi.fn()) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const geometry = { meshes: [{ positions: [0,0,0, 2,0,0, 2,1,0], normals: [0,0,1, 0,0,1, 0,0,1], indices: [0,1,2], transform: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1], color: [1,1,1,1] }] };
const catalog = [
  { id: "lamp", name: "Linear light", category: "Lighting" },
  { id: "duplicate", name: " linear LIGHT ", category: "Lighting" },
  { id: "chair", name: "Chair", category: "Furniture" },
];
let controls: AssetAssignmentControls;
let parent: Group;
let rows: Segment[];
function get<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Missing control ${id}`);
  return element;
}
function named(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(row => row.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Missing button ${label}`);
  return button;
}
async function click(button: HTMLElement) { await act(async () => button.click()); }
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = readFileSync("web/viewer.html", "utf8");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.open = false; } });
  parent = new Group();
  rows = [1,2].map(id => ({ id, name: `Light ${id}`, layerId: 9, indices: new Uint32Array([id]), visible: true,
    pose: { position: [id,2,3], z: Math.PI / 4, rotationReliable: true } }));
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith("/geometry") ? { kind: "mesh", geometry } : catalog))));
  controls = new AssetAssignmentControls(new PlacedAssets(parent, []), () => controls.sync(rows, () => true));
  controls.sync(rows, () => true);
});
afterEach(async () => { await act(async () => controls.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders React cards, deduplicates library names and filters by category/search", async () => {
  await act(() => controls.open(rows));
  expect(get("asset-library-cards").children).toHaveLength(2);
  for (const id of ["asset-pose-list", "asset-rotation-correction", "asset-correct-rotation", "asset-settings-color", "asset-unit-scale", "asset-source-up"])
    expect(document.getElementById(id)).toBeNull();
  await click(named("Category Furniture"));
  expect(get("asset-library-cards").children).toHaveLength(1);
  expect(named("Select asset Chair").getAttribute("aria-pressed")).toBe("true");
  await click(named("Category All assets"));
  const search = get("asset-library-picker").querySelector<HTMLInputElement>('[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "linear");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(get("asset-library-cards").children).toHaveLength(1);
  expect(named("Preview Linear light")).toBeDefined();
});

it("assigns at recorded positions and preserves each element's existing correction, scale and color", async () => {
  rows[0]!.asset = { id: "old", name: "Old", correctionZ: 0.2, scale: 0.001, color: "#00ff00" };
  await act(() => controls.open(rows));
  await click(get("asset-assignment-apply"));
  expect(parent.children).toHaveLength(2);
  expect(rows[0]!.asset).toMatchObject({ id: "lamp", correctionZ: 0.2, scale: 0.001, color: "#00ff00" });
  expect(rows[1]!.asset).toMatchObject({ id: "lamp", correctionZ: 0, scale: 1 });
  expect(parent.children[0]!.position.toArray()).toEqual([1,2,3]);
  expect(parent.children[0]!.rotation.z).toBeCloseTo(Math.PI / 4 + 0.2);
  expect(rows[0]!.pose!.z).toBe(Math.PI / 4);
  await click(get("asset-assignment-apply"));
  expect(parent.children).toHaveLength(2);
});

it("previews geometry without assigning and assigns the previewed asset from the popup", async () => {
  await act(() => controls.open(rows));
  await click(named("Preview Chair"));
  await vi.waitFor(() => expect(showAssetPreview).toHaveBeenCalled());
  expect(get<HTMLDialogElement>("asset-preview-dialog").open).toBe(true);
  expect(get("asset-preview-title").textContent).toBe("Chair");
  expect(rows.every(row => !row.asset)).toBe(true);
  await click(get("asset-preview-assign"));
  expect(get<HTMLDialogElement>("asset-preview-dialog").open).toBe(false);
  expect(rows.map(row => row.asset?.id)).toEqual(["chair", "chair"]);
});

it("keeps assignments on geometry failure and closes when the source membership changes", async () => {
  rows[0]!.asset = { id: "old", name: "Old", correctionZ: 0, scale: 1 };
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/geometry")
    ? new Response(JSON.stringify({ detail: "Missing geometry" }), { status: 404 }) : new Response(JSON.stringify(catalog))));
  await act(() => controls.open(rows)); await click(get("asset-assignment-apply"));
  expect(get("asset-assignment-status").textContent).toContain("Missing geometry");
  expect(rows[0]!.asset.id).toBe("old");
  rows[0]!.indices = new Uint32Array([9]);
  await act(async () => controls.sync(rows, () => true));
  expect(get<HTMLDialogElement>("asset-assignment-dialog").open).toBe(false);
});

it("discards late geometry responses after reset", async () => {
  let respond: ((value: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/geometry")
    ? await new Promise<Response>(resolve => { respond = resolve; }) : new Response(JSON.stringify(catalog))));
  await act(() => controls.open(rows)); await click(get("asset-assignment-apply"));
  expect(respond).toBeDefined();
  await act(async () => { controls.reset(); respond!(new Response(JSON.stringify({ kind: "mesh", geometry }))); });
  expect(rows.every(row => !row.asset)).toBe(true);
  expect(parent.children).toHaveLength(0);
});

it.each(["ifc", undefined] as const)("uses geometry-reported axes with catalog kind %s", async geometryKind => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ id: "lamp", name: "Linear", category: "Lighting", geometryKind }]))));
  vi.spyOn(libraryClient, "loadAssetGeometry").mockResolvedValue({ geometry, up: "y", kind: "ifc" });
  await act(() => controls.open(rows)); await click(get("asset-assignment-apply"));
  expect(rows[0]!.asset?.sourceUp).toBe("y");
  expect(parent.children[0]!.rotation.x).toBe(0);
  expect(parent.children[0]!.rotation.y).toBe(0);
  expect(parent.children[0]!.rotation.z).toBeCloseTo(Math.PI / 4);
});

it("cancels closed previews and ignores geometry that arrives afterwards", async () => {
  let respond: ((value: Response) => void) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => path.endsWith("/geometry")
    ? await new Promise<Response>(resolve => { respond = resolve; }) : new Response(JSON.stringify(catalog))));
  await act(() => controls.open(rows)); await click(named("Preview Chair"));
  expect(respond).toBeDefined();
  await click(get("asset-preview-close"));
  await act(async () => respond!(new Response(JSON.stringify({ kind: "mesh", geometry }))));
  expect(showAssetPreview).not.toHaveBeenCalled();
  expect(get<HTMLDialogElement>("asset-preview-dialog").open).toBe(false);
  expect(rows.every(row => !row.asset)).toBe(true);
});
