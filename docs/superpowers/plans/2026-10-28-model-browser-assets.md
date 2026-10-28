# Model Browser asset rows implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, followed by independent review.

**Goal:** Show assigned assets below source elements with independent visibility/color/settings and bulk controls.

**Architecture:** SegmentCollection owns independent scan/asset visibility gates and asset membership presentation. SegmentPanel renders asset child rows and exclusive scan/asset row selection. PlacedAssets uses shared geometry plus private per-instance materials for colors/highlights, preserving original material colors. Existing assignment window supplies Z correction, color and removal settings.

**Tech Stack:** Existing vanilla TypeScript/Three.js and native controls; no new dependencies.

## User-approved layout and behavior

Top toolbar order: Add Group, Add Layer, Delete, Scan visibility, Asset visibility, existing scan layer-color toggle. Widen panel moderately. Under each element, indent its asset name with color swatch and own eye; clicking name opens settings, modifier clicks select rows. Ctrl/Shift operates within scan rows or asset rows; switching kind starts that selection kind. Group/layer/root eyes gate both; scan-element eye and scan master never hide assigned assets. Asset master preserves individual settings. Select all assets reveals their tree rows, bulk custom color/Show/Hide apply only to selected asset assignments. Asset color modes are Original, By layer and Custom. Linked selection highlights source splats and assigned occurrences. Delete selected asset rows removes assignments only; source-element deletion retains its existing confirmation and original geometry behavior.

## Tasks

- [x] RED/GREEN model and renderer checks for visibility separation, shared geometry/private materials, colors/restoration, highlights and cleanup.
- [x] Add master controls, asset color/bulk toolbar and settings fields. RED/GREEN controller checks for child rows/order, independent eyes, asset Ctrl/Shift/all, bulk presentation, filter and deletion.
- [x] Wire presentation to renderer and assignment settings, preserve asset visibility/colors on reassignment. Reset new state on source replacement, guard async scopes.
- [x] Run full gates and lazy-IFC no-reload test, independently review, update handoff/README and commit.

## Constraints and review focus

Preserve source splats and geometry, Z-only placement, IFC automatic up axis, Vite web-ifc preoptimization and current theme. Avoid editing the external library. Hidden assets must remain selectable for Show operations. Collapsed rows are excluded from Shift ranges. Removing instances disposes only private materials, not shared geometry/templates. Original-color mode restores imported colors. Browser visual checks remain contingent on an available connection; do not bypass prior access restrictions.
