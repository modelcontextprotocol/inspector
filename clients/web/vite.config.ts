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

// Aliases shared between the top-level resolve and the vitest projects.
// Vitest projects don't inherit `resolve` from the parent, so the unit and
// integration projects redeclare them — keeping a single source here prevents
// them from drifting (e.g. if a new core/* alias is added).
const sharedAliases = {
  '@inspector/core': path.resolve(dirname, '../../core'),
  // Point at the BUILT test-servers entry, not src/, so that any test which
  // calls `getTestMcpServerPath()` (via `fileURLToPath(import.meta.url)`)
  // resolves to a `.js` path Node can spawn directly as a subprocess. The
  // integration tests build test-servers via `npm run test:integration`
  // (or `npm run test-servers:build`) before running.
  '@modelcontextprotocol/inspector-test-server': path.resolve(dirname, '../../test-servers/build/index.js'),
};
const sharedDedupe = [
  'react',
  'react-dom',
  // The SDK is installed under both clients/web/node_modules and the repo
  // root's node_modules (hoisted by npm). Without dedupe, source files in
  // core/ (no local node_modules) resolve to the root copy while test files
  // resolve to the clients/web copy — splitting class identity and breaking
  // vi.mock() / instanceof checks (see #1307).
  '@modelcontextprotocol/sdk',
];

// Bare-module aliases needed when running tests from repoRoot (which has no
// node_modules of its own). Shared between the unit and integration projects.
// Use anchored regex `find` patterns so each package's own `exports` field
// handles subpath resolution.
const nodeModulesAliases = [
  { find: /^react$/, replacement: path.resolve(dirname, 'node_modules/react') },
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
  // Pin the SDK auth subpath so test and source resolve to the exact same
  // module ID. Without this, the source's `import` from core/auth/*.ts and
  // the test's `vi.mock(...)` can resolve through different cache keys in
  // Vitest's transformer pipeline — the mock then fails to intercept the
  // source-side import (see #1307).
  { find: /^@modelcontextprotocol\/sdk\/client\/auth\.js$/, replacement: path.resolve(dirname, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js') },
];

// Project resolve config shared between the unit and integration projects.
// sharedAliases come first as exact-match entries, then the bare-module
// regex aliases that node-style imports from core/ rely on.
const projectResolve = {
  alias: [
    ...Object.entries(sharedAliases).map(([find, replacement]) => ({ find, replacement })),
    ...nodeModulesAliases,
  ],
  dedupe: sharedDedupe,
};

// v1.5-ported integration tests that need a node-env vitest project — they
// spawn real HTTP/stdio servers via test-servers/, run end-to-end OAuth flows,
// talk to fs/network, or mock `@modelcontextprotocol/sdk/client/auth.js` (the
// SDK auth mock identity is lost under happy-dom + Vitest 4, but works under
// node env). Tracked in #1307.
const integrationTests = [
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
  'clients/web/src/test/core/auth/discovery.test.ts',
  'clients/web/src/test/core/auth/state-machine.test.ts',
];

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
        path.join(repoRoot, 'core/auth/**/*.{ts,tsx}'),
        path.join(repoRoot, 'core/storage/**/*.{ts,tsx}'),
        path.join(repoRoot, 'core/logging/**/*.{ts,tsx}'),
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
        path.join(repoRoot, 'core/mcp/remote/types.ts'),
        // .d.ts files are declaration-only.
        path.join(repoRoot, '**/*.d.ts'),
        // inspectorClientEventTarget.ts is types + a single empty-body class
        // (extends TypedEventTarget). v8/istanbul records 0 statements for it
        // today. TODO(#1243): drop this exclusion once the class gains real
        // behavior as the v1.5 InspectorClient port progresses.
        path.join(repoRoot, 'core/mcp/inspectorClientEventTarget.ts'),
        path.join(repoRoot, 'core/mcp/__tests__/**'),
        // test-servers/ is test infrastructure (composable MCP servers and
        // fixtures), not application code — its build output also lives at
        // test-servers/build/, which we don't want to measure either.
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
        // Vitest projects don't inherit `resolve` from the parent. The unit
        // project runs from repoRoot (so vitest's coverage transformer can
        // reach core/), but repoRoot has no node_modules of its own — the
        // shared regex aliases redirect bare `react`/`pino`/etc. imports
        // from core/ back into clients/web/node_modules.
        resolve: projectResolve,
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
          // Integration tests run in the integration project below (node env).
          exclude: integrationTests,
          setupFiles: [path.join(dirname, 'src/test/setup.ts')],
        },
      },
      {
        extends: true,
        // See note on the unit project: integration tests also run from
        // repoRoot and import core/ modules, so they need the same alias
        // setup. The shared bare-module aliases keep `pino`, `hono`, etc.
        // resolving against clients/web/node_modules.
        resolve: projectResolve,
        test: {
          name: 'integration',
          environment: 'node',
          // Same reason as the unit project: rooted at repoRoot so vitest
          // can transform core/ modules and run tests against the source.
          root: repoRoot,
          include: integrationTests,
          // Integration tests spawn real HTTP/stdio servers via test-servers/,
          // bind sockets, run e2e OAuth flows, and exercise filesystem-backed
          // storage. 30s matches the v1.5 core/vitest.config.ts.
          testTimeout: 30000,
          hookTimeout: 30000,
          // Inline the MCP SDK so vi.mock("@modelcontextprotocol/sdk/...")
          // hooks the same transformed copy that source files import.
          // Externalized node_modules are loaded via Node's loader and bypass
          // Vitest's mock system. The explicit alias above pins the auth.js
          // subpath to one canonical ID; inlining ensures the transformer
          // pipeline owns the module rather than the Node loader.
          server: {
            deps: {
              inline: [/@modelcontextprotocol\/sdk/],
            },
          },
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
