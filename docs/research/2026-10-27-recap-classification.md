# Installed ReCap classification investigation

User-authorized static inspection of `C:\Program Files\Autodesk\Autodesk ReCap` on 2026-10-27. `ReCap.exe` file/product version is **27.0.1.242** (PowerShell file metadata). No application files were modified or Autodesk code incorporated into the viewer.

## REA evidence

REA opened `AdskRcClassification.dll`, a native x86-64 PE library with SHA-256 `f018fce16184fa78bd760b3e9a442a2bb5e2c38cb6755da869978c5e47eecc9f`. Ghidra 12.1.4 completed default analysis; REA's string search for `class|region|group|visible|visibility` returned retained evidence ID `ev_ecb203529c7d28828a1f92e45973d29e2ae1193c46894fcaee013f25c1f4f371`. The full evidence bundle is gitignored at `data/sam31/recap-classification-evidence.json`.

Observed symbols/strings include `ClassificationFilter`, `updateClassifications`, `removeLidarClassifications`, extraction option helpers and automatic ground-classification progress/error strings. These establish shipped classification/filter/update machinery; they do not establish the navigator's visual layout or a complete automatic-classification algorithm. No native runtime/UI session or decompiled algorithm was used. The evidence covers Ghidra-defined strings; packed/undefined strings and missing original PDB information limit completeness.

## Primary documentation and implementation decision

[Autodesk: Differences between classifications and scan regions](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Differences-between-classifications-and-scan-regions-in-ReCap-Pro.html) describes regions as visibility-controlled point sets and classifications as semantic categories, with non-overlapping membership. [Autodesk: Manually classify points](https://www.autodesk.com/learn/ondemand/tutorial/manually-classify-points-in-a-project) documents editable classes and converting regions to classifications. These sources support organization semantics; the installed DLL evidence alone does not prove those UI interactions.

The user subsequently provided the more specific [Select and classify mesh surfaces](https://www.autodesk.com/learn/ondemand/tutorial/select-and-classify-mesh-surfaces) reference. Its existing Edge tab was inspected through the permitted browser API: the accessible transcript and visible video image showed a left-side Model Browser, Unclassified/Classified roots, groups containing layers, visibility controls, layer swatches and a Target Layer independent of selection. The local viewer's previously denied origin was not accessed through another route.

For this Gaussian viewer, each accepted SAM instance becomes a named set of source splat IDs under Unclassified. The user selects objects, chooses a Target Layer and explicitly Classifies them. Layers belong to optional groups; Unclassify returns objects to the unclassified branch. Root/group/layer/object visibility combines without changing child preferences, with a separate unsegmented-context switch. Layer-color tinting is optional. New segmentation takes ownership of overlapping IDs. Removing a layer unclassifies its objects; removing a group retains its layers.

This adapts ReCap's organization concepts with the viewer's own code and SAM inference. It does not call Autodesk's classifier, copy its algorithm, import/export RCP/RCS classifications or reproduce all ReCap features. Records are temporary for the loaded scan, preserved across alignment changes and cleared when the scan is replaced/reloaded. Single-view projection still goes through depth; section clipping is necessary for tight 3D membership.
