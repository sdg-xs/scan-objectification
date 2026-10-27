# Model Browser controls and viewer theme

The user clarified that scan-context functionality must remain available internally; only its control should be hidden. Restore its model state, reset behavior and UI binding behind a hidden label.

Arrange the Model Browser toolbar as Add Group, Add Layer, Delete, then the original/classification color toggle. Retain icon controls and delayed native tooltips. Creation opens the existing name/group forms in a dialog. Click or keyboard-focus a group/layer heading to choose the deletion target; show its selected state independently of selected objects and the classification target layer.

Delete opens a confirmation containing the name, object count and destination selector. Default to Unclassified; list only surviving destination layers. Deleting a group removes its contained layers as disclosed in the prompt. Preserve source objects and IDs, assigning them to the destination before removing containers. Validate the whole destination before mutation. Cancel does not mutate the model. Keep existing group/layer removal methods and individual object removal functionality.

Adopt colors and font families from the user's local `asset.library/src/styles.css` and `design-system-fonts.css`: Poppins, navy header, white surfaces and blue accents. Bundle the reference's five Poppins weights locally. Keep theme overrides in a separate stylesheet with no layout declarations. The user's later direction sets the 3D viewport and renderer clear color to black. Existing layout remains, apart from the explicitly requested toolbar/dialog cleanup.

Implementation sequence: capture failing model tests; restore context and add validated container deletion; wire toolbar/selection/dialogs; apply palette and local fonts; run frontend/backend gates and independent review. Local-origin browser inspection remains denied, so do not claim visual verification.
