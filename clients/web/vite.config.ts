/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { honoMiddlewarePlugin } from './server/vite-hono-plugin';
import { getViteBaseConfig, getViteDevOptimizeDeps } from './server/vite-base-config';
import { buildWebServerConfigFromEnv } from './server/web-server-config';
import { vitestSharedPaths } from '../../vitest.shared.mts';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const { repoRoot, sharedDedupe, nodeModulesAliases, projectResolve, sharedAliases } =
  vitestSharedPaths(dirname);

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
export default defineConfig(({ command }) => {
  const isDevServer = command === "serve" && !process.env.VITEST;
  return {
  // `honoMiddlewarePlugin` is gated by `apply: 'serve'` so it only attaches
  // during `vite dev` / `vite preview` — vitest projects share this config
  // but never invoke `configureServer`, so the plugin stays inert there.
  //
  // The plugin statically imports the node-only dev backend
  // (`core/mcp/remote/node/server.ts`), so Vite's config bundler (Rolldown)
  // walks that chain when it loads this file and reaches node-only deps
  // (`chokidar`, `atomically`, `@napi-rs/keyring`). Those resolve cleanly at
  // config-bundle time because they're declared in the repo-root
  // `package.json` and installed into the repo-root `node_modules`, which sits
  // on `core/`'s module-resolution chain (core/ has no node_modules of its
  // own). Keep them in the root manifest: drop one and Rolldown can no longer
  // resolve it from core/, reviving the benign `UNRESOLVED_IMPORT` warnings
  // that #1491 eliminated at the source (by removing the old stream filter and
  // build-time onwarn suppressions rather than re-hiding the symptom).
  plugins: [react(), honoMiddlewarePlugin(buildWebServerConfigFromEnv())],
  // Shared optimizeDeps exclusions so node-only packages
  // (`@modelcontextprotocol/sdk/client/stdio.js`, `cross-spawn`, `which`)
  // consumed by the dev backend aren't scanned for browser pre-bundling.
  // Browser code reaches the node-side stack via the Hono plugin only.
  // Dev server: force a full dep pre-bundle each launch (no stale cache).
  optimizeDeps: isDevServer
    ? getViteDevOptimizeDeps()
    : getViteBaseConfig().optimizeDeps,
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
          // Don't let happy-dom actually navigate child frames. Components like
          // the MCP Apps sandbox render an <iframe src="/sandbox.html">; with
          // navigation enabled happy-dom fetches that URL (and unloads it on
          // teardown), which fails under the test server and floods the run with
          // alarming-but-expected `DOMException [NetworkError/AbortError]` and
          // `AsyncTaskManager destroyed` output. The component tests only assert
          // on the iframe element/attributes, not its loaded document, so
          // disabling frame navigation removes the noise without losing coverage.
          environmentOptions: {
            happyDOM: {
              settings: { navigation: { disableChildFrameNavigation: true } },
            },
          },
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
};
});
