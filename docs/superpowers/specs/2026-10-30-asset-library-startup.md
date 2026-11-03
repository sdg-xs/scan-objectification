# Start the asset library from Assign asset

Opening Assign asset already requests the catalog through the local API. That request now ensures the separate library production server is running before reading the catalog. Reuse an existing service, serialize concurrent startup requests, launch Node without a console in the library's own working directory, and wait at most 30 seconds for readiness. Keep the library alive independently of the viewer because its own UI may be in use.

The known Desktop installation is the default; NEMY_ASSET_LIBRARY_DIR overrides it. Do not install dependencies, build the separate project, or modify catalog/source data. Log startup output locally and return retryable errors for missing prerequisites, startup failures, or timeouts. Retain local-origin checks before starting a process and preserve frontend cancellation and stale-selection guards.

Verify reuse, startup, failed-start retry, timeout without duplicate launch, concurrent requests, local-only access, and the real catalog request with the library initially stopped. Run backend and frontend gates.
