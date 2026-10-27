# Warm SAM worker implementation

1. Capture RED tests for model reuse/idle eviction and same-origin status; implement cache lifecycle and request-local autocast.
2. Add validated phase/timing schemas and status gateway; pause/resume rendering with the dialog and show live phases/results.
3. Run worker and full app checks; review cancellation, eviction races, GPU cleanup and the future cloud boundary.
4. Restart the updated services when the old worker is idle, verify consecutive actual model requests and record measured stages. Update docs and commit only feature files.

Completed: RED captured for cache/idle behavior and status route. GREEN: 70 backend, 42 frontend, 7 separate-runtime worker tests, typecheck and build. Independent review found no blocking issues. Real generated-image requests confirmed cold then warm model reuse, and a subsequent status check confirmed idle unloading. Diagnostic evidence is in `data/sam31/warm-integration-results.json` and `idle-release-check.log`; these are ignored runtime artifacts, not an actual-ceiling benchmark. Browser visual verification remains denied. The user committed most implementation changes in `1c4eec0` while work was ongoing; preserve that commit and add only remaining tests/docs/log setup changes.
