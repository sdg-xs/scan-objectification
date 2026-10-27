# SAM workspace implementation

1. Extend gateway/worker validation and tests for bounded custom prompts, echoed identity and individual masks.
2. Add projected screen-mask selection to the existing stable splat-ID loop; freeze camera/section/scan identity and reject stale work.
3. Extend the native dialog with prompt/run, numbered match checkboxes and explicit apply; preserve cancellation and current-view capture.
4. Run backend/frontend/typecheck/build, separate-runtime worker checks and an actual custom-prompt API smoke. Obtain focused review, document limitations and commit only feature files.

Completed: RED captured for custom-prompt gateway/worker tests and mask projection; GREEN is 68 backend, 35 frontend and 5 worker tests. Typecheck and production build passed. Actual custom-prompt SAM 3.1 API request completed on a generated blank image. Independent review found no blocking issues. Real-scene visual alignment and arbitrary-object accuracy remain user verification because browser inspection is denied.
