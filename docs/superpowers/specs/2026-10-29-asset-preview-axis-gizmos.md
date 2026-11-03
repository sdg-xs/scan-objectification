# Asset preview import and orientation indicators

Keep both display spaces Z-up. The existing library IFC extraction supplies Y-up coordinates, so retain the single import conversion shared with the library preview. Do not introduce a global or fixture-specific roll correction. Already-Z-up input remains unchanged by the up-axis conversion.

Show Three.js ViewHelper axes at the top right of the main scene and asset geometry preview. These are orientation indicators that follow the camera. Draw them after the scene with clipping disabled and without clearing scene color; restore renderer state afterwards. Dispose their resources with the owning view. SAM capture renders exclude them.

Expose the existing preview assignment action as Import asset in a sticky preview footer. Enable it only after geometry has loaded and the preview has been created. Preserve the existing assignment, cancellation and source-selection checks.
