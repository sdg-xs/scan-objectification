# Model Browser layer list

Replace visible content below Filter with a fixed Unclassified row, then an expandable Root containing groups and layers. Keep the toolbar, white/blue theme, fonts and black viewport. Groups expand/collapse and have visibility toggles. Layers are single rows with inline names, color swatches, active-layer markers and eyes. Group/layer selection remains independent of active layer for deletion. Keep existing create/delete dialogs.

The user explicitly defers selected-mesh assignment. Hide Target Layer, Classify/Unclassify/Clear, per-object rows and instructional/footer text in this area. Retain model functionality and hidden operation bindings; SAM results remain unclassified. Setting active layer updates only target ID, with no classification side effect.

Read-only inspection of the user's restored ReCap Mesh Editor confirms category and row symbols. Draw local SVG equivalents: four shapes for Unclassified, checked shapes for Root, stacked sheets for groups, slanted surfaces for layers, and a framed surface for active layer. Preserve tooltips, accessible labels, keyboard-focusable controls, filtering, root/group/layer visibility and delete-container behavior.

The user's follow-up expands the open panel/list toward the bottom even with no items. Anchor the open panel above the viewer footer; keep toolbar/filter fixed and scroll only the list. Preserve collapse. Move section controls to a lower-right column above Fit all, leaving a consistent gap between controls and footer.

Implement by adjusting existing HTML/renderers/styles rather than introducing dependencies or new classification logic. Run current tests, typecheck/build and independent review. The denied local browser origin limits visual verification; native reference inspection does not bypass it.
