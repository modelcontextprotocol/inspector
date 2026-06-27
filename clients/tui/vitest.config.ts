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
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // INTERIM SCOPE (#1484). The TUI's UI is ~16 Ink/React components plus a
      // 1878-line App.tsx that need an Ink renderer (ink-testing-library) to
      // exercise — a large, separate effort tracked in its own follow-up issue.
      // For now the gate covers the feasibly-unit-testable, non-React logic:
      // server resolution (tui-servers.ts), the file logger (logger.ts), the
      // tab metadata (components/tabsConfig.ts), and the form/URL helpers
      // (utils/*). New non-React logic added under src/ is automatically held
      // to the gate; the React surface is explicitly excluded below until the
      // component-coverage follow-up (#1501) lands.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Pure re-export + type alias of core's server resolver (no runtime
        // statements of its own — the logic is measured in core via the web
        // suite). tui-servers.test.ts still exercises it behaviorally; it's
        // excluded here only so it doesn't surface as a misleading 0/0 row.
        "src/tui-servers.ts",
        "src/App.tsx",
        // Ink components still awaiting renderer-based tests (#1501). Entries
        // are removed from this list as each component reaches the gate; the
        // sibling tabsConfig.ts (plain data, no JSX) is already in scope.
        "src/components/AuthTab.tsx",
        "src/components/DetailsModal.tsx",
        "src/components/HistoryTab.tsx",
        "src/components/InfoTab.tsx",
        "src/components/NotificationsTab.tsx",
        "src/components/PromptTestModal.tsx",
        "src/components/PromptsTab.tsx",
        "src/components/RequestsTab.tsx",
        "src/components/ResourceTestModal.tsx",
        "src/components/ResourcesTab.tsx",
        "src/components/ToolTestModal.tsx",
        "src/components/ToolsTab.tsx",
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
