/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

// Aliases shared between the top-level resolve and the unit vitest project.
// Vitest projects don't inherit `resolve` from the parent, so the unit project
// redeclares them — keeping a single source here prevents the two from drifting
// (e.g. if a new core/* alias is added).
const sharedAliases = {
  '@inspector/core': path.resolve(dirname, '../../core'),
  '@modelcontextprotocol/inspector-test-server': path.resolve(dirname, '../../test-servers/src/index.ts'),
};
const sharedDedupe = ['react', 'react-dom'];

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react()],
  resolve: {
    // NOTE: the unit vitest project (below) overrides this — see comment there.
    alias: sharedAliases,
    // Source files in core/ import bare modules (react, @testing-library/react,
    // etc.) that only exist in clients/web/node_modules. Dedupe ensures Vite
    // resolves them from this package rather than walking up from core/'s
    // location (which has no node_modules of its own yet).
    dedupe: sharedDedupe,
  },
  server: {
    fs: {
      allow: [path.resolve(dirname, '../..')],
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/components/**/*.{ts,tsx}',
        'src/utils/**/*.{ts,tsx}',
        path.join(repoRoot, 'core/mcp/**/*.{ts,tsx}'),
        path.join(repoRoot, 'core/react/**/*.{ts,tsx}'),
      ],
      exclude: [
        '**/*.stories.{ts,tsx}',
        '**/*.test.{ts,tsx}',
        '**/*.fixtures.{ts,tsx}',
        '**/index.{ts,tsx}',
        'src/components/**/types.ts',
        // Pure-type modules: `interface`/`type` declarations only, no runtime
        // statements. Excluding them keeps the report clean (would otherwise
        // surface as misleading 0/0 rows).
        path.join(repoRoot, 'core/mcp/types.ts'),
        path.join(repoRoot, 'core/mcp/elicitationCreateMessage.ts'),
        path.join(repoRoot, 'core/mcp/samplingCreateMessage.ts'),
        path.join(repoRoot, 'core/mcp/sessionStorage.ts'),
        path.join(repoRoot, 'core/mcp/inspectorClientProtocol.ts'),
        // inspectorClientEventTarget.ts is types + a single empty-body class
        // (extends TypedEventTarget). v8/istanbul records 0 statements for it
        // today. TODO(#1243): drop this exclusion once the class gains real
        // behavior as the v1.5 InspectorClient port progresses.
        path.join(repoRoot, 'core/mcp/inspectorClientEventTarget.ts'),
        path.join(repoRoot, 'core/mcp/__tests__/**'),
        // v1.5-ported runtime files (#1302) whose v1.5 tests are excluded from
        // the unit project pending a node-env vitest setup. Tracked in #1307 —
        // drop each entry below as the corresponding test family comes online.
        path.join(repoRoot, 'core/mcp/inspectorClient.ts'),
        path.join(repoRoot, 'core/mcp/oauthManager.ts'),
        path.join(repoRoot, 'core/mcp/fetchTracking.ts'),
        path.join(repoRoot, 'core/mcp/messageTrackingTransport.ts'),
        path.join(repoRoot, 'core/mcp/config.ts'),
        path.join(repoRoot, 'core/mcp/node/**'),
        path.join(repoRoot, 'core/mcp/remote/**'),
        path.join(repoRoot, 'core/auth/**'),
        path.join(repoRoot, 'core/storage/**'),
        path.join(repoRoot, 'core/logging/**'),
        path.join(repoRoot, 'test-servers/**'),
      ],
      thresholds: {
        perFile: true,
        lines: 90,
        statements: 85,
        functions: 80,
        branches: 50,
      },
    },
    projects: [
      {
        extends: true,
        // Vitest projects don't inherit `resolve` from the parent, so we
        // redeclare the shared aliases here. The extra `react` alias is
        // required because we move the unit project root to repoRoot below
        // (so vitest's coverage transformer can reach core/), and the repo
        // root has no node_modules of its own — bare `react` imports from
        // core/react/*.ts would otherwise fail to resolve.
        resolve: {
          alias: [
            // sharedAliases first as exact-match entries
            ...Object.entries(sharedAliases).map(([find, replacement]) => ({ find, replacement })),
            { find: /^react$/, replacement: path.resolve(dirname, 'node_modules/react') },
            // v1.5 core/ modules (#1302) import these from clients/web/node_modules,
            // but the unit project runs from repoRoot (which has no node_modules of
            // its own). Use anchored regex `find` patterns so the package's own
            // `exports` field handles subpath resolution (otherwise a bare `hono`
            // string alias would rewrite `hono/streaming` to `<honoDir>/streaming`,
            // bypassing the exports map).
            { find: /^pino$/, replacement: path.resolve(dirname, 'node_modules/pino') },
            { find: /^pino\/browser\.js$/, replacement: path.resolve(dirname, 'node_modules/pino/browser.js') },
            { find: /^zustand$/, replacement: path.resolve(dirname, 'node_modules/zustand') },
            { find: /^zustand\/middleware$/, replacement: path.resolve(dirname, 'node_modules/zustand/middleware.js') },
            { find: /^zustand\/vanilla$/, replacement: path.resolve(dirname, 'node_modules/zustand/vanilla.js') },
            { find: /^hono$/, replacement: path.resolve(dirname, 'node_modules/hono/dist/index.js') },
            { find: /^hono\/streaming$/, replacement: path.resolve(dirname, 'node_modules/hono/dist/helper/streaming/index.js') },
            { find: /^@hono\/node-server$/, replacement: path.resolve(dirname, 'node_modules/@hono/node-server') },
            { find: /^atomically$/, replacement: path.resolve(dirname, 'node_modules/atomically') },
            { find: /^express$/, replacement: path.resolve(dirname, 'node_modules/express') },
            { find: /^yaml$/, replacement: path.resolve(dirname, 'node_modules/yaml') },
          ],
          dedupe: sharedDedupe,
        },
        test: {
          name: 'unit',
          environment: 'happy-dom',
          // Root the unit project at the repo root so vitest's coverage
          // transformer (which only processes files inside a project root)
          // can reach core/ modules. Without this, untested core/ files fall
          // back to raw-TS parsing in rolldown, which can't handle TS-only
          // syntax (e.g. `import type`) — silently dropping them and bypassing
          // the per-file gate.
          root: repoRoot,
          // No `globals: true` — every test file imports `describe`, `it`,
          // `expect`, `vi` explicitly from "vitest". This keeps the pattern
          // consistent and avoids relying on auto-cleanup tied to Vitest's
          // global lifecycle hooks; cleanup is invoked manually in setup.ts.
          include: ['clients/web/src/**/*.test.{ts,tsx}'],
          // These v1.5-ported tests need either a node-env vitest project
          // (they spawn real HTTP/stdio servers via test-servers/, run
          // end-to-end OAuth flows, or talk to fs/network) or substantial
          // happy-dom-friendly mocks. Tracked in #1307 — remove each entry
          // below as the corresponding test starts passing.
          exclude: [
            'clients/web/src/test/core/inspectorClient.test.ts',
            'clients/web/src/test/core/inspectorClient-oauth.test.ts',
            'clients/web/src/test/core/inspectorClient-oauth-e2e.test.ts',
            'clients/web/src/test/core/inspectorClient-oauth-fetchFn.test.ts',
            'clients/web/src/test/core/inspectorClient-oauth-remote-storage-e2e.test.ts',
            'clients/web/src/test/core/transport.test.ts',
            'clients/web/src/test/core/remote-transport.test.ts',
            'clients/web/src/test/core/remote-server-config.test.ts',
            'clients/web/src/test/core/storage-adapters.test.ts',
            'clients/web/src/test/core/auth/storage-node.test.ts',
            'clients/web/src/test/core/auth/oauth-callback-server.test.ts',
            // discovery.test.ts + state-machine.test.ts mock the SDK auth
            // module, but happy-dom + Vitest mock resolution drops the mock
            // (real fetch fires → CORS). Excluded pending mock rework.
            'clients/web/src/test/core/auth/discovery.test.ts',
            'clients/web/src/test/core/auth/state-machine.test.ts',
          ],
          setupFiles: [path.join(dirname, 'src/test/setup.ts')],
        },
      },
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
