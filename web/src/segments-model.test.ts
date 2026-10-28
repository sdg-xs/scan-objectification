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

it("names and classifies selected objects atomically without changing their source IDs", () => {
  const scene = new SegmentCollection();
  scene.reset(3);
  scene.add(new Uint8Array([1, 2, 0]), "light");
  const layer = scene.createLayer("Lighting");
  const [a, b] = scene.segments;
  scene.classifyNamed([{ id: a!.id, name: "Linear light" }, { id: b!.id, name: "Bulb" }], layer.id);
  expect(scene.segments.map(item => [item.name, item.layerId, [...item.indices]])).toEqual([
    ["Linear light", layer.id, [0]], ["Bulb", layer.id, [1]],
  ]);
  scene.unclassify([a!.id]);
  expect(a!.name).toBe("Linear light");
  expect(a!.layerId).toBeNull();
});

it("suggests a separate running Layer Name ## sequence and consumes numbers only on confirmation", () => {
  const scene = new SegmentCollection();
  scene.reset(3);
  scene.add(new Uint8Array([1, 2, 3]), "light");
  const a = scene.createLayer("Lighting");
  const b = scene.createLayer("Furniture");
  const ids = scene.segments.map(item => item.id);
  const names = scene.classificationNames(ids.slice(0, 2), a.id);
  expect(names.map(item => item.name)).toEqual(["Lighting 01", "Lighting 02"]);
  expect(scene.classificationNames(ids.slice(0, 2), a.id)).toEqual(names);
  scene.classifyNamed(names, a.id);
  expect(scene.classificationNames(ids.slice(2), a.id)[0]!.name).toBe("Lighting 03");
  expect(scene.classificationNames(ids.slice(2), b.id)[0]!.name).toBe("Furniture 01");
});

it("moves elements to another layer without renaming, renumbering or changing source indices", () => {
  const scene = new SegmentCollection();
  scene.reset(3);
  scene.add(new Uint8Array([1, 2, 0]), "light");
  const source = scene.createLayer("Lighting");
  const target = scene.createLayer("Fixtures");
  const [a, b] = scene.segments;
  scene.classifyNamed([{ id: a!.id, name: "Ceiling fixture" }, { id: b!.id, name: "Bulb" }], source.id);
  scene.move([a!.id], target.id);
  expect([a!.name, a!.layerId, [...a!.indices]]).toEqual(["Ceiling fixture", target.id, [0]]);
  expect(b!.layerId).toBe(source.id);
  expect(target.nextElementNumber).toBe(1);
  expect(() => scene.move([b!.id, 999], target.id)).toThrow();
  expect(b!.layerId).toBe(source.id);
});

it("rejects incomplete naming and stale classification targets without partial changes", () => {
  const scene = new SegmentCollection();
  scene.reset(2);
  scene.add(new Uint8Array([1, 2]), "light");
  const layer = scene.createLayer("Lighting");
  const [a, b] = scene.segments;
  expect(() => scene.classifyNamed([{ id: a!.id, name: "Good" }, { id: b!.id, name: " " }], layer.id)).toThrow();
  expect(() => scene.classifyNamed([{ id: a!.id, name: "Good" }, { id: 999, name: "Stale" }], layer.id)).toThrow();
  expect(() => scene.classifyNamed([{ id: a!.id, name: "Good" }], 999)).toThrow();
  expect(scene.segments.map(item => [item.name, item.layerId])).toEqual([["light 1", null], ["light 2", null]]);
});

it("preserves prepared groups and layers when attaching the first source", () => {
  const scene = new SegmentCollection();
  const group = scene.createGroup("MEP");
  const layer = scene.createLayer("Lighting", group.id);
  scene.targetLayerId = layer.id;
  scene.reset(3, true);
  scene.add(new Uint8Array([1, 0, 0]), "light");
  expect(scene.groups).toEqual([group]);
  expect(scene.layers).toEqual([layer]);
  expect(scene.targetLayerId).toBe(layer.id);
  expect(new Set([group.id, layer.id, scene.segments[0]!.id]).size).toBe(3);
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

it("deletes a layer while moving its objects to another layer", () => {
  const scene = new SegmentCollection();
  scene.reset(3);
  scene.add(new Uint8Array([1, 0, 0]), "light");
  const source = scene.createLayer("Old");
  const destination = scene.createLayer("Lighting");
  scene.targetLayerId = source.id;
  scene.classify(scene.segments.map(item => item.id));
  scene.deleteContainer("layer", source.id, destination.id);
  expect(scene.layers).toEqual([destination]);
  expect(scene.segments[0]!.layerId).toBe(destination.id);
  expect([...scene.segments[0]!.indices]).toEqual([0]);
  expect(scene.targetLayerId).toBeNull();
});

it("deletes a group and its layers while keeping all objects unassigned", () => {
  const scene = new SegmentCollection();
  scene.reset(2);
  scene.add(new Uint8Array([1, 2]), "light");
  const group = scene.createGroup("Old group");
  const a = scene.createLayer("A", group.id);
  const b = scene.createLayer("B", group.id);
  scene.targetLayerId = a.id;
  scene.classify([scene.segments[0]!.id]);
  scene.targetLayerId = b.id;
  scene.classify([scene.segments[1]!.id]);
  scene.deleteContainer("group", group.id, null);
  expect(scene.groups).toEqual([]);
  expect(scene.layers).toEqual([]);
  expect(scene.segments.map(item => item.layerId)).toEqual([null, null]);
  expect([...scene.visibility()]).toEqual([1, 1]);
});

it("rejects a destination inside a deleted group without changing anything", () => {
  const scene = new SegmentCollection();
  const group = scene.createGroup("Group");
  const layer = scene.createLayer("Layer", group.id);
  expect(() => scene.deleteContainer("group", group.id, layer.id)).toThrow();
  expect(scene.groups).toEqual([group]);
  expect(scene.layers).toEqual([layer]);
  expect(() => scene.deleteContainer("layer", layer.id, 999)).toThrow();
  expect(() => scene.deleteContainer("layer", 999, null)).toThrow();
});

it("moves every object from a deleted group and preserves unrelated layers", () => {
  const scene = new SegmentCollection();
  scene.reset(3);
  scene.add(new Uint8Array([1, 2, 3]), "fixture");
  const group = scene.createGroup("Old");
  const a = scene.createLayer("A", group.id);
  const b = scene.createLayer("B", group.id);
  const destination = scene.createLayer("Keep");
  for (const [index, layer] of [a, b, destination].entries()) {
    scene.targetLayerId = layer.id;
    scene.classify([scene.segments[index]!.id]);
  }
  scene.deleteContainer("group", group.id, destination.id);
  expect(scene.layers).toEqual([destination]);
  expect(scene.segments.map(item => item.layerId)).toEqual([destination.id, destination.id, destination.id]);
  expect(scene.targetLayerId).toBe(destination.id);
  expect(scene.segments.map(item => [...item.indices])).toEqual([[0], [1], [2]]);
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
