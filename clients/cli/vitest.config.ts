import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { vitestSharedPaths } from '../../vitest.shared.mts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const { projectResolve } = vitestSharedPaths(dirname);

export default defineConfig({
  resolve: projectResolve,
  test: {
    globals: false,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 15000,
    // The in-process runner (__tests__/helpers/cli-runner.ts) patches
    // process.std{out,err}.write to capture CLI output. Test files run in
    // separate forked processes (and tests within a file run sequentially), so
    // those global patches never overlap. `forks` is vitest's default, but pin
    // it explicitly so the capture isolation can't regress to a shared-thread
    // pool. See #1484.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        // Binary bootstrap: shebang + `isMain` guard + `runCli()`/`process.exit`
        // wiring that only runs when launched as the real binary. Exercised by
        // the out-of-process layer (__tests__/e2e.test.ts + scripts/smoke-cli.mjs),
        // which spawns build/index.js and so can't be measured under in-process
        // coverage. Mirrors web's `**/index.{ts,tsx}` exclusion.
        'src/index.ts',
        // Session CLI + daemon process bootstraps (same rationale as index.ts):
        // shebang / isMain / process.exit / signal wiring only runs out-of-process.
        'src/mcp-bin.ts',
        'src/daemon/run.ts',
        // Unix-socket accept / stream client: behavioral coverage lives in
        // __tests__/daemon-stream.test.ts (ok/data/end, errors, timeout, abort,
        // stale socket, startStream). Remaining branch matrix is connect/error/
        // half-close races that are not stably ≥90 under v8 — keep out of the
        // per-file gate rather than papering over with broad ignores.
        'src/daemon/ipc-glue.ts',
        'src/daemon/stream-client.ts',
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
