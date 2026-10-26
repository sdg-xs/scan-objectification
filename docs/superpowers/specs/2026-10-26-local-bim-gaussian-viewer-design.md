# Local BIM and Gaussian viewer

The first milestone is a browser viewer that opens a local IFC and Gaussian PLY in one Three.js scene. This scope comes from the conversation on 2026-10-26 and supersedes the USD-first implementation order for this milestone only.

Use That Open Fragments' IFC importer, Spark for splats, and Three.js OrbitControls. Load files through browser file inputs; do not upload them or expose the test directory through the server. Keep the existing project shell at `/`, and add `/viewer.html`. All workers and WASM are served locally. Add the required IFC dependencies with exact versions; keep every existing dependency pin unchanged.

The viewer provides independent file status, visibility toggles, fit-all and per-layer framing, scan up-axis selection, and manual scan translation, rotation and uniform scale. Center each model independently for an initial comparison; explicitly say this does not establish survey alignment. Do not infer registration from filenames or discard source files. PLY metadata confirms the sample is a 4,778,721-splat Gaussian scene, with Z-up survey offsets in comments.

Approaches considered: direct local loading is appropriate for this milestone; server conversion and saved projects add unnecessary prerequisites. Using only web-ifc would bypass the agreed That Open pipeline. Fragments' importer can be used directly with Three.js without the full Components UI framework.

No backend upload, persistence, segmentation, selection/property tools, USD conversion or automatic registration in this milestone. Errors must be visible and allow retry. Replacing a model must release its old resources. Keep test assets untracked.

Verify navigation, both actual sample files, layer toggles, framing, manual transforms, malformed-file recovery and production asset loading. Large-file memory and frame rate remain hardware-dependent; do not claim streaming or target-PC acceptance.
