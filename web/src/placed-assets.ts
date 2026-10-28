import { Group, Mesh } from "three";
import type { Plane } from "three";
import type { Segment } from "./segments-model";
import { disposeAsset } from "./asset-geometry";

export class PlacedAssets {
  private readonly templates = new Map<string, Group>();
  private readonly instances = new Map<number, { assetId: string; object: Group }>();
  constructor(private readonly parent: Group, private readonly planes: Plane[]) {}
  has(id: string, up = "y"): boolean { return this.templates.has(`${id}:${up}`); }
  cache(id: string, geometry: Group, up = "y"): void {
    id = `${id}:${up}`;
    if (this.templates.has(id)) { disposeAsset(geometry); return; }
    geometry.traverse(node => { if (node instanceof Mesh) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) { material.clippingPlanes = this.planes; material.clipShadows = true; }
    } });
    this.templates.set(id, geometry);
  }
  sync(segments: readonly Segment[], visible: (segment: Segment) => boolean): void {
    const wanted = new Set(segments.filter(row => row.asset && row.pose).map(row => row.id));
    for (const [id, instance] of this.instances) if (!wanted.has(id)) { instance.object.removeFromParent(); this.instances.delete(id); }
    for (const segment of segments) {
      if (!segment.asset || !segment.pose) continue;
      const key = `${segment.asset.id}:${segment.asset.sourceUp ?? "y"}`;
      const template = this.templates.get(key);
      if (!template) continue;
      let instance = this.instances.get(segment.id);
      if (instance?.assetId !== key) {
        instance?.object.removeFromParent();
        instance = { assetId: key, object: template.clone(true) };
        this.instances.set(segment.id, instance); this.parent.add(instance.object);
      }
      instance.object.position.fromArray(segment.pose.position);
      instance.object.rotation.set(0, 0, segment.pose.z + segment.asset.correctionZ);
      instance.object.scale.setScalar(segment.asset.scale);
      instance.object.visible = visible(segment);
    }
  }
  clear(): void {
    for (const instance of this.instances.values()) instance.object.removeFromParent();
    this.instances.clear();
    for (const geometry of this.templates.values()) disposeAsset(geometry);
    this.templates.clear();
  }
}
