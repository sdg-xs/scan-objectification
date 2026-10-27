export interface Segment {
  id: number;
  name: string;
  layerId: number | null;
  visible: boolean;
  indices: Uint32Array;
}
export interface SegmentGroup { id: number; name: string; visible: boolean }
export interface SegmentLayer { id: number; name: string; groupId: number | null; visible: boolean; color: string }

/** Session-only source IDs. A splat belongs to at most one segment. */
export class SegmentCollection {
  segments: Segment[] = [];
  groups: SegmentGroup[] = [];
  layers: SegmentLayer[] = [];
  targetLayerId: number | null = null;
  classifiedVisible = true;
  unclassifiedVisible = true;
  private count = 0;
  private nextId = 1;

  reset(count: number): void {
    this.count = count;
    this.segments = [];
    this.groups = [];
    this.layers = [];
    this.targetLayerId = null;
    this.classifiedVisible = this.unclassifiedVisible = true;
    this.nextId = 1;
  }

  add(labels: Uint8Array, description: string): number {
    if (labels.length !== this.count) throw new Error("The segmentation belongs to a different scan.");
    const counts = new Uint32Array(256);
    for (const label of labels) counts[label]++;
    const indices = new Map<number, Uint32Array>();
    const offsets = new Uint32Array(256);
    for (let label = 1; label < counts.length; label++)
      if (counts[label]) indices.set(label, new Uint32Array(counts[label]!));
    if (!indices.size) return 0;
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]!;
      if (label) indices.get(label)![offsets[label]++] = i;
    }
    for (const segment of this.segments) segment.indices = segment.indices.filter(index => !labels[index]);
    this.segments = this.segments.filter(segment => segment.indices.length);
    for (const [label, ids] of indices) this.segments.push({
      id: this.nextId++, name: `${description.slice(0, 110)} ${label}`,
      layerId: null, visible: true, indices: ids,
    });
    return indices.size;
  }

  createGroup(name: string): SegmentGroup {
    name = name.trim().slice(0, 80);
    if (!name) throw new Error("Enter a group name.");
    const existing = this.groups.find(group => group.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing;
    const group = { id: this.nextId++, name, visible: true };
    this.groups.push(group);
    return group;
  }

  createLayer(name: string, groupId: number | null = null): SegmentLayer {
    name = name.trim().slice(0, 80);
    if (!name) throw new Error("Enter a layer name.");
    if (groupId !== null && !this.groups.some(group => group.id === groupId)) throw new Error("Choose an existing group.");
    const existing = this.layers.find(layer => layer.groupId === groupId && layer.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing;
    const palette = ["#69b8ee", "#b590e2", "#83c97d", "#e7bd68", "#e689a9"];
    const layer = { id: this.nextId++, name, groupId, visible: true, color: palette[this.layers.length % palette.length]! };
    this.layers.push(layer);
    return layer;
  }

  classify(ids: readonly number[]): void {
    if (!this.layers.some(layer => layer.id === this.targetLayerId)) throw new Error("Choose a target layer first.");
    const selected = new Set(ids);
    for (const segment of this.segments) if (selected.has(segment.id)) segment.layerId = this.targetLayerId;
  }

  unclassify(ids: readonly number[]): void {
    const selected = new Set(ids);
    for (const segment of this.segments) if (selected.has(segment.id)) segment.layerId = null;
  }

  update(id: number, patch: Partial<Pick<Segment, "name" | "visible">>): void {
    const segment = this.segments.find(item => item.id === id);
    if (!segment) throw new Error("This segment no longer exists.");
    Object.assign(segment, patch);
    segment.name = segment.name.trim().slice(0, 120) || "Unnamed segment";
  }

  remove(id: number): void { this.segments = this.segments.filter(segment => segment.id !== id); }

  removeLayer(id: number): void {
    this.layers = this.layers.filter(layer => layer.id !== id);
    for (const segment of this.segments) if (segment.layerId === id) segment.layerId = null;
    if (this.targetLayerId === id) this.targetLayerId = null;
  }

  removeGroup(id: number): void {
    this.groups = this.groups.filter(group => group.id !== id);
    for (const layer of this.layers) if (layer.groupId === id) layer.groupId = null;
  }

  isVisible(segment: Segment): boolean {
    if (!segment.visible) return false;
    if (segment.layerId === null) return this.unclassifiedVisible;
    const layer = this.layers.find(layer => layer.id === segment.layerId);
    return Boolean(this.classifiedVisible && layer?.visible && !this.groups.some(group => group.id === layer.groupId && !group.visible));
  }

  visibility(): Uint8Array {
    const visible = new Uint8Array(this.count).fill(Number(this.unclassifiedVisible));
    for (const segment of this.segments) {
      const value = Number(this.isVisible(segment));
      for (const index of segment.indices) visible[index] = value;
    }
    return visible;
  }
}
