# Interactive section box

The user requested one directly manipulated box that sections both IFC and Gaussian layers, without numeric inputs. Keep the existing Z-up viewer and fixed dependency versions.

Use Three.js TransformControls for whole-box translation and six independently draggable, color-coded face grips for resizing. Clamp faces to a minimum thickness. Pause OrbitControls during manipulation, restore its previous state on completion/cancellation, and let Escape cancel a face resize. Provide enable, Move, Resize and Reset box controls in the viewport.

One world-space Box3 drives six inward-facing Three.js clipping planes, shared with Fragments' native clipping-plane/culling API, and an inverted Spark BOX SDF that hides outside splat centers. Render handles in an unclipped overlay so they remain interactive. Disabled sectioning restores both layers. Source arrays/files and saved scan placement remain unchanged. Cuts do not create mesh caps; splat footprints can overlap the boundary.

Library choice: That Open Clipper manages individual BIM planes and would require the Components stack, which this viewer does not use. Three.js already supplies movement controls and mesh clipping; Spark supplies its native box mask. Synchronize their existing facilities instead of adding another UI framework or a clipping package.

References: https://docs.thatopen.com/Tutorials/Components/Core/Clipper , https://threejs.org/docs/pages/TransformControls.html , https://sparkjs.dev/docs/splat-editing/

Verification: unit checks for six-plane inclusion/exclusion, independent face movement/minimum thickness, and canceled movement/navigation restoration. Independent source review found the Move cancellation case, now fixed. Real BS17 IFC and aligned 4,778,721-splat PLY rendered together under production CSP; inspected live cuts, visible handles and Move/Resize/Reset modes. No backend functionality was added.

Final gates: 43 backend tests, 21 frontend tests, 2 PLY-tool tests, typecheck and production build pass. In an isolated Playwright session, real mouse drags lowered a box face through the IFC, moved the whole box, canceled movement, and verified camera orbit still worked after disabling sectioning. No runtime errors were reported. Browser scripts and screenshots remain in gitignored `output/playwright/`.
