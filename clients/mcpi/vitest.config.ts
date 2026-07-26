import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { vitestSharedPaths } from "../../vitest.shared.mts";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const { projectResolve } = vitestSharedPaths(dirname);
const cliSrc = path.resolve(dirname, "../cli/src");

const baseAliases = Array.isArray(projectResolve.alias)
  ? projectResolve.alias
  : [];

export default defineConfig({
  resolve: {
    ...projectResolve,
    alias: [...baseAliases, { find: "@inspector/cli", replacement: cliSrc }],
  },
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 15000,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/mcp-bin.ts",
        "src/daemon/run.ts",
        "src/daemon/ipc-glue.ts",
        "src/daemon/stream-client.ts",
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
