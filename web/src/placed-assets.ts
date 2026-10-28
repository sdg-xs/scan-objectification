import { Color, Group, Mesh, MeshStandardMaterial } from "three";
import type { Material, Plane } from "three";
import type { Segment } from "./segments-model";
import { disposeAsset } from "./asset-geometry";

export interface AssetPresentation {
  colorMode: "original" | "layer" | "custom";
  layerColors?: ReadonlyMap<number, string>;
  highlighted?: ReadonlySet<number>;
}
interface PlacedInstance {
  assetId: string; object: Group; owned: Material[];
  colors: { material: MeshStandardMaterial; original: Color; emissive: Color; intensity: number }[];
}

export class PlacedAssets {
  private readonly templates = new Map<string, Group>();
  private readonly instances = new Map<number, PlacedInstance>();
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
  sync(segments: readonly Segment[], visible: (segment: Segment) => boolean, presentation?: AssetPresentation): void {
    const wanted = new Set(segments.filter(row => row.asset && row.pose).map(row => row.id));
    for (const [id, instance] of this.instances) if (!wanted.has(id)) { this.remove(instance); this.instances.delete(id); }
    for (const segment of segments) {
      if (!segment.asset || !segment.pose) continue;
      const key = `${segment.asset.id}:${segment.asset.sourceUp ?? "y"}`;
      const template = this.templates.get(key);
      if (!template) continue;
      let instance = this.instances.get(segment.id);
      if (instance?.assetId !== key) {
        if (instance) this.remove(instance);
        instance = this.instantiate(key, template);
        this.instances.set(segment.id, instance); this.parent.add(instance.object);
      }
      instance.object.position.fromArray(segment.pose.position);
      instance.object.rotation.set(0, 0, segment.pose.z + segment.asset.correctionZ);
      instance.object.scale.setScalar(segment.asset.scale);
      instance.object.visible = visible(segment);
      const color = presentation?.colorMode === "custom" ? segment.asset.color : presentation?.colorMode === "layer" && segment.layerId !== null ? presentation.layerColors?.get(segment.layerId) : undefined;
      for (const record of instance.colors) {
        if (color) record.material.color.set(color); else record.material.color.copy(record.original);
        record.material.emissive.copy(record.emissive);
        record.material.emissiveIntensity = record.intensity;
        if (presentation?.highlighted?.has(segment.id)) { record.material.emissive.set("#246fe1"); record.material.emissiveIntensity = 0.35; }
      }
    }
  }
  private instantiate(assetId: string, template: Group): PlacedInstance {
    const instance: PlacedInstance = { assetId, object: template.clone(true), owned: [], colors: [] };
    const copy = (material: Material): Material => {
      const cloned = material.clone(); cloned.clippingPlanes = this.planes; instance.owned.push(cloned);
      if (cloned instanceof MeshStandardMaterial) instance.colors.push({ material: cloned, original: cloned.color.clone(), emissive: cloned.emissive.clone(), intensity: cloned.emissiveIntensity });
      return cloned;
    };
    instance.object.traverse(node => { if (node instanceof Mesh) node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material); });
    return instance;
  }
  private remove(instance: PlacedInstance): void { instance.object.removeFromParent(); instance.owned.forEach(material => material.dispose()); }
  clear(): void {
    for (const instance of this.instances.values()) this.remove(instance);
    this.instances.clear();
    for (const geometry of this.templates.values()) disposeAsset(geometry);
    this.templates.clear();
  }
}
