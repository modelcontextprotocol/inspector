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
const repoRoot = path.resolve(dirname, "../..");

export default defineConfig({
  resolve: projectResolve,
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["__tests__/helpers/mock-open-url.ts", NO_RETRY_SETUP],
    // OAuth tokens/client secrets are split into the selected secret store by
    // the file persistence backend the CLI shares with the web server. Pin the
    // in-memory store so stored-auth tests never probe or write the real OS
    // keychain on a dev machine.
    env: { MCP_INSPECTOR_SECRET_STORE: "memory" },
    // Shared budgets (#2323). `testTimeout` was already 15000 here by hand;
    // the hook and teardown budgets were Vitest's defaults until now.
    ...TIMEOUTS,
    // The in-process runner (__tests__/helpers/cli-runner.ts) patches
    // process.std{out,err}.write to capture CLI output. Test files run in
    // separate forked processes (and tests within a file run sequentially), so
    // those global patches never overlap. `forks` is vitest's default, but pin
    // it explicitly so the capture isolation can't regress to a shared-thread
    // pool. See #1484.
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // `core/cli/` is the node-only surface this client shares with mcpdo
      // (#2461). It moved out of `src/` but these suites are still what
      // exercise it, so it stays gated here; web's `core/*` whitelist
      // deliberately omits it, since no web test reaches it. It sits outside
      // this project's root, hence `allowExternal`.
      include: ["src/**/*.ts", path.join(repoRoot, "core/cli/**/*.ts")],
      allowExternal: true,
      exclude: [
        // Binary bootstrap: shebang + `isMain` guard + `runCli()`/`process.exit`
        // wiring that only runs when launched as the real binary. Exercised by
        // the out-of-process layer (__tests__/e2e.test.ts + scripts/smoke-cli.mjs),
        // which spawns build/index.js and so can't be measured under in-process
        // coverage. Mirrors web's `**/index.{ts,tsx}` exclusion.
        "src/index.ts",
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
