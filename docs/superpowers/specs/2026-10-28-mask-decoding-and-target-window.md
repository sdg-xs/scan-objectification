# Mask pixels and independent Target Layer window

The user reported the selection-mask/view mismatch message and requested Target Layer as a separate floating window at the viewer's bottom center.

The existing error compares HTML image intrinsic dimensions to the capture. The API already checks mask PNG IHDR sizes. Reproduce a valid PNG whose mocked HTML image size differs, then decode raw PNG bytes with createImageBitmap instead. Validate both encoded and decoded dimensions against the saved capture. Read unscaled pixel data, preserve instance labels, close bitmap resources and retain cancellation/source-revision guards. Report genuine mismatches with dimensions; do not resize masks to conceal a mismatch. The precise user-browser cause is not established by the synthetic reproduction.

Move Target Layer/Classify/Unclassify outside Model Browser into a bottom-center card. Retain theme, state, naming, active highlighting and upward popover. Opening a target reveals a collapsed browser. On compact viewports dock the card right and reserve vertical space for section/Fit controls above it so panels do not overlap.

Use controller regression tests for raw-pixel projection and picker ownership; decoder tests for real size mismatches/resource cleanup. Run full gates and focused independent review. Existing local-origin denial limits real-scene/browser verification. Preserve unrelated files and the working SAM runtime.

## Confirmed cause from user diagnostics

The follow-up reported a valid 1600×721 mask but undefined capture dimensions. `parseLightResult` spread the HTMLCanvasElement frame, omitting its inherited width/height accessors. Read those properties explicitly. Add a parser test with prototype getters and use the same prototype shape in the controller fixture. Both tests must reproduce the undefined dimensions/blocked projection before the fix, then pass after it. This supersedes the earlier unconfirmed HTML-image-dimension explanation; raw PNG validation remains useful and is retained.
