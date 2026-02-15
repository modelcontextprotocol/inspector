import { defineConfig } from "vitest/config";

/**
 * Root config: run only cli, shared, and web unit tests.
 * No root-level test discovery (so e2e, and core/build are not run).
 */
export default defineConfig({
  test: {
    projects: [
      "cli/vitest.config.ts",
      "core/vitest.config.ts",
      "tui/vitest.config.ts",
      "web/vitest.config.ts",
    ],
  },
});
