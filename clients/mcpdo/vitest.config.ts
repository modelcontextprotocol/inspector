import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import {
  NO_RETRY_SETUP,
  TIMEOUTS,
  vitestSharedPaths,
} from "../../vitest.shared.mts";

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
    setupFiles: [NO_RETRY_SETUP],
    // OAuth tokens/client secrets are split into the selected secret store by
    // the shared file persistence backend. Pin the in-memory store so
    // stored-auth tests (and spawned daemons, which inherit process.env)
    // never probe or write the real OS keychain on a dev machine.
    env: { MCP_INSPECTOR_SECRET_STORE: "memory" },
    // Shared budgets (#2323).
    ...TIMEOUTS,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      // Process entry points only: argv/env wiring plus a top-level call into
      // covered modules. Exercised by spawning real processes (daemon spawn in
      // tests, smoke), which v8 coverage can't observe from the parent.
      exclude: ["src/mcp-bin.ts", "src/daemon/run.ts"],
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
