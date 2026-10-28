import { useState } from "react";
import type { CatalogAsset } from "./asset-library-client";

export interface AssetLibraryPickerProps {
  assets: readonly CatalogAsset[];
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onPreview: (asset: CatalogAsset) => void;
}

/** Presentation-only picker shared independently of the viewer's placement workflow. */
export function AssetLibraryPicker({ assets, selectedId, busy, onSelect, onPreview }: AssetLibraryPickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const names = new Set<string>();
  const unique = assets.filter(asset => {
    const key = asset.name.trim().toLowerCase() || asset.id;
    if (names.has(key)) return false;
    names.add(key); return true;
  });
  const matches = (query: string, group: string) => unique.filter(asset =>
    (!group || asset.category === group) && `${asset.name} ${asset.category}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const filter = (query: string, group: string) => {
    setSearch(query); setCategory(group);
    const visible = matches(query, group);
    if (!visible.some(asset => asset.id === selectedId)) onSelect(visible[0]?.id ?? "");
  };
  return <>
    <label className="asset-library-search">Search assets
      <input type="search" placeholder="Search by name or category" value={search} disabled={busy} onChange={event => filter(event.target.value, category)} />
    </label>
    <div className="asset-library-layout">
      <nav id="asset-library-categories" aria-label="Asset categories">
        {["", ...[...new Set(unique.map(asset => asset.category))].sort()].map(name =>
          <button key={name} type="button" aria-label={`Category ${name || "All assets"}`} aria-pressed={category === name} disabled={busy} onClick={() => filter(search, name)}>{name || "All assets"}</button>)}
      </nav>
      <div id="asset-library-cards" className="asset-library-cards" aria-label="Library assets">
        {matches(search, category).map(asset => <article key={asset.id} className="asset-library-card">
          <button type="button" className="asset-card-select" aria-label={`Select asset ${asset.name}`} aria-pressed={asset.id === selectedId} disabled={busy} onClick={() => onSelect(asset.id)}>
            <span className="asset-card-art"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Zm0 0 8 4 8-4M12 11v10" /></svg></span>
            <span className="asset-card-category">{asset.category}</span><strong>{asset.name}</strong>
          </button>
          <button type="button" className="asset-card-preview" title={`Preview ${asset.name}`} aria-label={`Preview ${asset.name}`} disabled={busy} onClick={() => onPreview(asset)}>↗</button>
        </article>)}
        {!matches(search, category).length && <p>No matching assets</p>}
      </div>
    </div>
  </>;
}
