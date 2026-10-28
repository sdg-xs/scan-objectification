import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Frontend tests live next to the sources they cover.
    include: ["web/src/**/*.test.ts"],
    // The project-wide release gate runs the frontend suite from Task 1, before
    // the first frontend test file exists. A suite with no files is a pass; a
    // suite with a failing file still fails.
    passWithNoTests: true,
  },
});
