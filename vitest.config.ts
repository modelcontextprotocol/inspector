import { defineConfig } from "vitest/config";

/**
 * Root config: run only cli, shared, and web unit tests.
 * No root-level test discovery (so e2e, and core/build are not run).
 */
export default defineConfig({
  test: {
    projects: [
      "clients/cli/vitest.config.ts",
      "core/vitest.config.ts",
      "test-servers/vitest.config.ts",
      "clients/tui/vitest.config.ts",
      "clients/web/vitest.config.ts",
    ],
  },
});
