# Functional Model Browser actions

Allow group/layer creation and selected-container deletion before a Gaussian scan loads. These operations manage hierarchy and do not require GPU/source data. Keep color rendering dependent on a scan. Preserve a hierarchy prepared before the first source attaches; replacing an existing source still resets it. Preserve unique IDs and active-layer state on first attachment.

On creation, clear the filter, expand Root and the parent group, select the item and close the dialog. Keep invalid-name feedback within the creation dialog. Deletion retains its current unassign/reassign confirmation and object-preservation semantics; cancellation must not mutate state, including when the dialog is reopened before a queued close event is delivered.

Reproduce disabled controls, hidden creation results and first-attachment loss with failing tests. Exercise real SegmentPanel event handlers using the actual HTML's initial control attributes and a minimal DOM fixture; mock only the GPU boundary. Validate deletion/cancellation/destination options and name recovery as well as the model's preserved hierarchy/IDs. Run the full repository gate and independent review. Browser visual testing remains unavailable under the existing local-origin denial.
