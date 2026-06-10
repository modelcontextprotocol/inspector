/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { honoMiddlewarePlugin } from './server/vite-hono-plugin';
import { getViteBaseConfig } from './server/vite-base-config';
import { buildWebServerConfigFromEnv } from './server/web-server-config';
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
  { find: /^chokidar$/, replacement: path.resolve(dirname, 'node_modules/chokidar') },
  { find: /^@napi-rs\/keyring$/, replacement: path.resolve(dirname, 'node_modules/@napi-rs/keyring') },
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

// Integration tests live under clients/web/src/test/integration/ and run in
// the node-env vitest project below. The folder is the manifest: anything
// inside it is integration (node env, 30s timeout, real servers); anything
// outside is a unit test (happy-dom). This prevents the silent
// misclassification trap where a file's environment depended on whether
// someone remembered to add it to an enumeration (#1314).
//
// Match `{ts,tsx}` to mirror the unit project's include below — otherwise a
// stray `.test.tsx` placed inside this folder would slip past the integration
// include AND fail to be excluded from unit, silently landing under happy-dom.
const integrationGlob = 'clients/web/src/test/integration/**/*.test.{ts,tsx}';

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  // `honoMiddlewarePlugin` is gated by `apply: 'serve'` so it only attaches
  // during `vite dev` / `vite preview` — vitest projects share this config
  // but never invoke `configureServer`, so the plugin stays inert there.
  plugins: [react(), honoMiddlewarePlugin(buildWebServerConfigFromEnv())],
  // Shared optimizeDeps exclusions so node-only packages
  // (`@modelcontextprotocol/sdk/client/stdio.js`, `cross-spawn`, `which`)
  // consumed by the dev backend aren't scanned for browser pre-bundling.
  // Browser code reaches the node-side stack via the Hono plugin only.
  ...getViteBaseConfig(),
  build: {
    rollupOptions: {
      // Loading vite.config.ts pulls `core/mcp/remote/node/server.ts` (via the
      // Hono plugin) into Rollup's module cache. That chain reaches
      // `core/storage/store-io.ts`, which imports node-only `atomically`. The
      // module never lands in the browser bundle (it's unreachable from
      // `index.html`), but Rollup's scanner still warns about the unresolved
      // import. Silence it here so the build log stays clean.
      onwarn(warning, defaultHandler) {
        if (
          warning.code === 'UNRESOLVED_IMPORT' &&
          typeof warning.message === 'string' &&
          warning.message.includes("'atomically'") &&
          warning.message.includes('store-io.ts')
        ) {
          return;
        }
        // Same story for `chokidar`: the mcp.json file watcher in
        // `core/mcp/remote/node/server.ts` is reachable only through the dev
        // backend, never from the browser bundle. Rollup still scans the
        // import statement and warns when it can't resolve it.
        if (
          warning.code === 'UNRESOLVED_IMPORT' &&
          typeof warning.message === 'string' &&
          warning.message.includes("'chokidar'") &&
          warning.message.includes('server.ts')
        ) {
          return;
        }
        // `@napi-rs/keyring` is the native-binding keychain backend
        // consumed by `core/auth/node/secret-store.ts` from the Hono
        // `/api/servers` handlers. Same reasoning as the entries above:
        // unreachable from the browser bundle, so the unresolved-import
        // warning is noise.
        if (
          warning.code === 'UNRESOLVED_IMPORT' &&
          typeof warning.message === 'string' &&
          warning.message.includes("'@napi-rs/keyring'") &&
          warning.message.includes('secret-store.ts')
        ) {
          return;
        }
        defaultHandler(warning);
      },
    },
  },
  resolve: {
    // NOTE: the unit vitest project (below) overrides this — see comment there.
    //
    // Once App.tsx started consuming the full hook + state-manager surface
    // (#1244), the browser dep graph reached bare-module subpaths in core/
    // that Rolldown couldn't resolve against `core/`'s parent (it has no
    // node_modules of its own). Promote the same bare-module aliases the
    // vitest projects use so `vite dev` / `vite build` can resolve them
    // from `clients/web/node_modules`.
    alias: [
      ...Object.entries(sharedAliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      ...nodeModulesAliases,
    ],
    // Source files in core/ import bare modules (react, @testing-library/react,
    // etc.) that only exist in clients/web/node_modules. Dedupe ensures Vite
    // resolves them from this package rather than walking up from core/'s
    // location (which has no node_modules of its own yet).
    dedupe: sharedDedupe,
  },
  // Pin the Vite dev server to the same port (and host) the Hono plugin
  // configures from env, so `allowedOrigins` actually matches the browser
  // origin. Without this, `vite dev` falls back to Vite's default 5173
  // while the dev backend's `buildWebServerConfigFromEnv()` defaults to
  // CLIENT_PORT=6274 — origin check rejects every `/api/*` request from
  // the browser. CLIENT_PORT / HOST overrides flow through here too.
  // `strictPort: true` so a port collision fails loudly instead of
  // silently picking a different port (which would leave `allowedOrigins`
  // pointing at the wrong host and break browser fetches).
  server: {
    port: parseInt(process.env.CLIENT_PORT ?? '6274', 10),
    host: process.env.HOST ?? 'localhost',
    strictPort: true,
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
        'clients/web/server/**/*.{ts,tsx}',
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
        // Dev-backend runtime glue: each file is exercised end-to-end via
        // `npm run dev` (Hono plugin attaches, banner prints, /api/* serves).
        // `vite-hono-plugin.ts` requires standing up a real Vite server with
        // an HTTP listener to drive `configureServer`; `server.ts` is the
        // production Hono entry that the v2 launcher (not yet ported, #1246)
        // will invoke; `start-vite-dev-server.ts` is its dev counterpart.
        // The non-glue parts are extracted to `web-server-config.ts` (fully
        // tested) and `sandbox-controller.ts` (HTTP behavior tested).
        'clients/web/server/vite-hono-plugin.ts',
        'clients/web/server/server.ts',
        'clients/web/server/start-vite-dev-server.ts',
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
          exclude: [integrationGlob],
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
          include: [integrationGlob],
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
