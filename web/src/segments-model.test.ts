import { expect, it } from "vitest";
import { SegmentCollection } from "./segments-model";

it("keeps SAM instances unclassified until explicitly moved to a target layer", () => {
  const scene = new SegmentCollection();
  scene.reset(6);
  scene.add(new Uint8Array([1, 1, 0, 2, 2, 0]), "ceiling light");
  expect(scene.segments.map(segment => [...segment.indices])).toEqual([[0, 1], [3, 4]]);
  const group = scene.createGroup("Level 1");
  const layer = scene.createLayer("Lighting", group.id);
  expect(scene.segments.map(segment => segment.layerId)).toEqual([null, null]);
  scene.targetLayerId = layer.id;
  scene.classify([scene.segments[0]!.id]);
  scene.update(scene.segments[0]!.id, { name: "Light A" });
  expect(scene.segments[0]).toMatchObject({ name: "Light A", layerId: layer.id });
  expect(scene.segments[1]!.layerId).toBeNull();
});

it("combines group and individual visibility without losing child states", () => {
  const scene = new SegmentCollection();
  scene.reset(4);
  scene.add(new Uint8Array([1, 2, 0, 0]), "pipe");
  const group = scene.createGroup("MEP");
  const layer = scene.createLayer("Pipes", group.id);
  scene.targetLayerId = layer.id;
  scene.classify(scene.segments.map(segment => segment.id));
  scene.update(scene.segments[0]!.id, { visible: false });
  group.visible = false;
  expect([...scene.visibility()]).toEqual([0, 0, 1, 1]);
  group.visible = true;
  expect([...scene.visibility()]).toEqual([0, 1, 1, 1]);
  layer.visible = false;
  expect([...scene.visibility()]).toEqual([0, 0, 1, 1]);
  layer.visible = true;
  scene.contextVisible = false;
  expect([...scene.visibility()]).toEqual([0, 1, 0, 0]);
});

it("assigns overlapping splats only to the newest segment and restores context on removal", () => {
  const scene = new SegmentCollection();
  scene.reset(4);
  scene.add(new Uint8Array([1, 1, 0, 0]), "old");
  scene.add(new Uint8Array([0, 1, 1, 0]), "new");
  expect(scene.segments.map(segment => [...segment.indices])).toEqual([[0], [1, 2]]);
  scene.update(scene.segments[1]!.id, { visible: false });
  expect([...scene.visibility()]).toEqual([1, 0, 0, 1]);
  scene.remove(scene.segments[1]!.id);
  expect([...scene.visibility()]).toEqual([1, 1, 1, 1]);
  scene.reset(2);
  expect(scene.segments).toEqual([]);
  expect(scene.groups).toEqual([]);
});

it("ungrouping preserves objects and restores their individual visibility", () => {
  const scene = new SegmentCollection();
  scene.reset(2);
  scene.add(new Uint8Array([1, 0]), "light");
  const group = scene.createGroup("Ceiling");
  const layer = scene.createLayer("Lighting", group.id);
  scene.targetLayerId = layer.id;
  scene.classify([scene.segments[0]!.id]);
  group.visible = false;
  scene.removeGroup(group.id);
  expect(layer.groupId).toBeNull();
  expect(scene.segments[0]!.layerId).toBe(layer.id);
  expect([...scene.visibility()]).toEqual([1, 1]);
  expect(() => scene.add(new Uint8Array(3), "wrong scan")).toThrow("different scan");
});

it("returns objects to Unclassified when a layer is removed and keeps target independent", () => {
  const scene = new SegmentCollection();
  scene.reset(3);
  scene.add(new Uint8Array([1, 2, 0]), "object");
  const ceiling = scene.createLayer("Ceiling");
  const floor = scene.createLayer("Floor");
  scene.targetLayerId = ceiling.id;
  scene.classify([scene.segments[0]!.id]);
  scene.targetLayerId = floor.id;
  scene.unclassify([scene.segments[0]!.id]);
  expect(scene.targetLayerId).toBe(floor.id);
  scene.classify([scene.segments[1]!.id]);
  scene.removeLayer(floor.id);
  expect(scene.segments.map(segment => segment.layerId)).toEqual([null, null]);
  expect(scene.targetLayerId).toBeNull();
  scene.unclassifiedVisible = false;
  expect([...scene.visibility()]).toEqual([0, 0, 0]);
});
