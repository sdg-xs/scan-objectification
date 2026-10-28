# Model Browser classification implementation

1. Inspect the installed ReCap classification module with REA; retain evidence and distinguish static observations from official UI documentation.
2. Write failing tests for the segment collection and per-instance source-ID projection, then implement exclusive membership and combined visibility.
3. Adapt the provided ReCap mesh tutorial's floating Model Browser: Unclassified/Classified roots, groups containing layers, Target Layer, Classify/Unclassify, selection, visibility and optional color tint. SAM adds/selects individual objects; reset resources on scan replacement.
4. Hide asset slot 02, move SAM to 02, renumber alignment, update instructions and run tests/typecheck/build plus independent review. Commit only feature files; preserve unrelated staged work.

Completed implementation and verification: RED captured for per-instance projection and hierarchy/classification behavior; GREEN is 68 backend and 41 frontend tests, typecheck and production build. Focused reviews of the hierarchy, lifecycle and final icon/accessibility additions found no blocking issues. Icon controls use native delayed-hover tooltips. Static REA evidence is retained locally; the supplied external tutorial's transcript and visible UI were inspected through its permitted browser tab. Local viewer/GPU visual interaction remains unverified because its origin access is denied. Feature files are committed separately from unrelated staged work.
