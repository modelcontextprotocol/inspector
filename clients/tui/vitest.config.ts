import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { vitestSharedPaths } from "../../vitest.shared.mts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const { projectResolve } = vitestSharedPaths(dirname);

export default defineConfig({
  resolve: projectResolve,
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // The entire React surface — App.tsx, every Ink component, and the
      // useSelectableList hook — is under the gate via ink-testing-library
      // renderer tests (#1501): components mount through the ink-scroll-view /
      // ink-form passthrough doubles in __tests__/helpers/, App.tsx mounts
      // against a controllable mock of the @inspector/core surface, and
      // keypresses are driven through stdin. No React-surface exclusions
      // remain; all new logic under src/ is automatically held to the gate.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Pure re-export + type alias of core's server resolver (no runtime
        // statements of its own — the logic is measured in core via the web
        // suite). tui-servers.test.ts still exercises it behaviorally; it's
        // excluded here only so it doesn't surface as a misleading 0/0 row.
        "src/tui-servers.ts",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
