# Floating SAM workspace

The user requested context immediately upon opening SAM, a capture/detect button below it, and capture from the current camera. Implement this within the existing viewer as a nonmodal floating window on the right, preserving the Model Browser on the left.

The context input receives focus on opening. The camera remains live while the window is open. Each explicit Capture & detect current view action renders and copies the camera frame at click time, then runs the existing same-origin SAM request. Inference is not continuous. Pause rendering only during inference and selection projection; resume on success, failure, cancellation and disposal. Preserve request-identity guards so an older cancelled operation cannot change a newer operation's state. Keep captured camera/source state for projection and the existing stale-source checks. Applying checked matches closes the window for classification.

Use the existing native dialog with nonmodal show(), scoped Escape handling and viewport-relative CSS. Keep the existing context length, backend, dependencies and cloud boundary. Verify opening without pausing, click-time capture, repeat capture, failure recovery and cancellation with controller tests, then run the repository gate. Browser visual inspection remains unavailable under the existing origin access denial.
