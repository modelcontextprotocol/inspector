/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { honoMiddlewarePlugin } from "./server/vite-hono-plugin";
import {
  getViteBaseConfig,
  getViteDevOptimizeDeps,
} from "./server/vite-base-config";
import { buildWebServerConfigFromEnv } from "./server/web-server-config";
import { createBrowserExternalizedBuiltinGate } from "./server/browser-externalized-builtin-gate";
import {
  INTEGRATION_TIMEOUTS,
  NO_RETRY_SETUP,
  TIMEOUTS,
  vitestSharedPaths,
} from "../../vitest.shared.mts";
const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const {
  repoRoot,
  sharedDedupe,
  nodeModulesAliases,
  projectResolve,
  sharedAliases,
} = vitestSharedPaths(dirname);

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
const integrationGlob = "clients/web/src/test/integration/**/*.test.{ts,tsx}";

// Fail `vite build` when a Node built-in lands in the browser bundle (#1769).
// Vite 8 otherwise only *warns* and ships a `module.exports = {}` stub, so a
// broken bundle builds green; the runtime browser smoke (`smoke:web:browser`,
// #1615) only catches the subset where that stub is *called* at module init.
// The detection + error logic lives in `browser-externalized-builtin-gate.ts`
// (Vite-agnostic, unit-tested); this is only the Vite wiring.
//
// Throwing directly in `onLog` does NOT abort a rolldown build (it's the one
// hook where a thrown error is swallowed — verified against vite@8.0.0), so the
// gate *records* the warning in `onLog` and re-throws in `buildEnd`, which runs
// after module resolution (by when the warning has fired) and where a throw
// aborts the build with a non-zero exit.
//
// `apply: 'build'` scopes it to `vite build` (never `vite dev` or the vitest
// projects), and `applyToEnvironment` narrows it to the **browser** (`client`)
// environment so a future SSR/node environment built from this config isn't
// failed for a legitimate `node:*` import — the browser-only intent is
// structural, not incidental. (The Node runner build is a separate tsup config.)
//
// `buildStart` resets the gate so a `vite build --watch` rebuild doesn't inherit
// a prior build's recorded warnings (the plugin instance is reused across
// rebuilds). `buildEnd` only asserts on the *success* path: rolldown also calls
// `buildEnd(error)` when the build already failed for another reason, and
// throwing then would mask that real error with the #1769 message.
function browserExternalizedBuiltinGate(): Plugin {
  const gate = createBrowserExternalizedBuiltinGate();
  return {
    name: "inspector:fail-on-browser-externalized-builtin",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    // `enforce: 'pre'` runs this ahead of the normal-plugin group (and Vite's
    // core plugins) in the `onLog` chain: a plugin whose `onLog` returns `false`
    // filters that log for every later plugin, so trailing the array would let a
    // future log-filtering plugin silently blind the gate. Ordering the gate
    // first makes "it sees every log" structural rather than dependent on array
    // position. Harmless to the emitting `rolldown:vite-resolve` plugin — the gate
    // defines no resolve/load/transform, and `onLog` delivery doesn't depend on
    // the emitter's position.
    enforce: "pre",
    buildStart() {
      gate.reset();
    },
    onLog(_level, log) {
      gate.recordLog(log.message);
    },
    buildEnd(error) {
      if (!error) gate.assertClean();
    },
  };
}

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig(({ command }) => {
  const isDevServer = command === "serve" && !process.env.VITEST;
  // Build the validated dev backend config ONCE (when serving) and reuse it for
  // both the Hono plugin and the `server` block below, so the dev server's
  // `port`/`host` come from the same guard-checked source (`resolveBindHostname`
  // + the CLIENT_PORT validation) rather than a second raw parse. This also
  // removes the implicit "plugins must be evaluated before server" ordering the
  // guard previously relied on to throw first.
  const devConfig = isDevServer ? buildWebServerConfigFromEnv() : undefined;
  return {
    // `honoMiddlewarePlugin` only attaches during `vite dev` / `vite preview`.
    // It's included conditionally on `isDevServer` (not merely `apply: 'serve'`)
    // because `devConfig` (from `buildWebServerConfigFromEnv()`, which calls
    // `resolveBindHostname()`) is built eagerly above. Left unconditional, an
    // ambient `HOST=0.0.0.0` would make the guard throw at config load for
    // `vite build` and every vitest project too, not just when serving. Gating
    // the whole plugin also skips that wasted config build for non-serve
    // commands.
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
    // `browserExternalizedBuiltinGate` fails `vite build` if a Node built-in
    // reaches the browser bundle (#1769) — see its definition above.
    plugins: [
      react(),
      ...(devConfig ? [honoMiddlewarePlugin(devConfig)] : []),
      browserExternalizedBuiltinGate(),
    ],
    // Shared optimizeDeps exclusions so node-only packages
    // (`@modelcontextprotocol/client/stdio`, `cross-spawn`, `which`)
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
      // vitest projects use so `vite dev` / `vite build` can resolve them.
      //
      // Which install each alias points at is `vitest.shared.mts`'s decision,
      // not this file's, and since #2195 it is no longer one answer: `react`
      // and `react-dom` resolve from `clients/web/node_modules`, everything
      // root-declared resolves from the repo root.
      alias: [
        ...Object.entries(sharedAliases).map(([find, replacement]) => ({
          find,
          replacement,
        })),
        ...nodeModulesAliases,
      ],
      // Source files in core/ import bare modules (react, @testing-library/react,
      // etc.) that core/ cannot resolve for itself, having no node_modules of
      // its own. Dedupe collapses each of these to a single copy per install,
      // whichever install the alias above selected.
      dedupe: sharedDedupe,
    },
    // Pin the Vite dev server to the same port and host the Hono plugin
    // configures, so `allowedOrigins` actually matches the browser origin.
    // Without this, `vite dev` falls back to Vite's default 5173 while the dev
    // backend defaults to CLIENT_PORT=6274 — origin check rejects every `/api/*`
    // request. When serving, both come from the already-validated `devConfig`
    // (guard-checked host + CLIENT_PORT); `vite build` and the vitest projects
    // evaluate this config but never bind, so they fall back to the raw env
    // (an ambient HOST=0.0.0.0 must not fail them at config load).
    // `strictPort: true` so a port collision fails loudly instead of silently
    // picking a different port (which would leave `allowedOrigins` wrong).
    server: {
      // The `|| "6274"` (empty ⇒ unset) mirrors buildWebServerConfig, so the
      // non-serve fallback agrees with the validated dev path on a blank
      // CLIENT_PORT rather than parsing it to NaN.
      port:
        devConfig?.port ??
        parseInt(process.env.CLIENT_PORT?.trim() || "6274", 10),
      // `|| "localhost"` (empty ⇒ unset) like the port above — an ambient
      // HOST="" is Node's all-interfaces address, the one value this guards.
      host: devConfig?.hostname ?? (process.env.HOST?.trim() || "localhost"),
      strictPort: true,
      fs: {
        allow: [path.resolve(dirname, "../..")],
      },
    },
    test: {
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "json-summary"],
        // Whitelist of gated directories. Deliberate top-level-file omissions
        // (every src *directory* below is gated):
        //   • `src/App.tsx` — a ~3.2k-line composition root at ~42% branch
        //     coverage; gating it is a dedicated testing/decomposition effort,
        //     not a whitelist tweak.
        //   • `src/main.tsx` / `src/index.ts` — the browser and bin bootstraps
        //     (createRoot render / `runWeb` re-export), the analog of
        //     clients/cli's excluded `src/index.ts`.
        // These omissions are intentional and documented here (and in AGENTS.md)
        // rather than silent. Add new gated dirs here as they appear.
        include: [
          "src/components/**/*.{ts,tsx}",
          "src/hooks/**/*.{ts,tsx}",
          "src/theme/**/*.{ts,tsx}",
          "src/lib/**/*.{ts,tsx}",
          "src/utils/**/*.{ts,tsx}",
          "clients/web/server/**/*.{ts,tsx}",
          path.join(repoRoot, "core/mcp/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/json/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/client/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/react/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/auth/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/storage/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/logging/**/*.{ts,tsx}"),
          path.join(repoRoot, "core/node/**/*.{ts,tsx}"),
        ],
        exclude: [
          "**/*.stories.{ts,tsx}",
          "**/*.test.{ts,tsx}",
          "**/*.fixtures.{ts,tsx}",
          "**/index.{ts,tsx}",
          "src/components/**/types.ts",
          // Dev-backend runtime glue: each file is exercised end-to-end via
          // `npm run dev` (Hono plugin attaches, banner prints, /api/* serves).
          // `vite-hono-plugin.ts` requires standing up a real Vite server with
          // an HTTP listener to drive `configureServer`; `server.ts` is the
          // production Hono entry that the v2 launcher (not yet ported, #1246)
          // will invoke; `start-vite-dev-server.ts` is its dev counterpart.
          // The non-glue parts are extracted to `web-server-config.ts` (fully
          // tested) and `sandbox-controller.ts` (HTTP behavior tested).
          "clients/web/server/vite-hono-plugin.ts",
          "clients/web/server/server.ts",
          "clients/web/server/start-vite-dev-server.ts",
          // Pure-type modules: `interface`/`type` declarations only, no runtime
          // statements. Excluding them keeps the report clean (would otherwise
          // surface as misleading 0/0 rows).
          path.join(repoRoot, "core/mcp/types.ts"),
          path.join(repoRoot, "core/mcp/elicitationCreateMessage.ts"),
          path.join(repoRoot, "core/mcp/samplingCreateMessage.ts"),
          path.join(repoRoot, "core/mcp/sessionStorage.ts"),
          path.join(repoRoot, "core/mcp/inspectorClientProtocol.ts"),
          path.join(repoRoot, "core/mcp/remote/types.ts"),
          path.join(repoRoot, "core/mcp/import/types.ts"),
          "clients/web/server/types.ts",
          // .d.ts files are declaration-only.
          path.join(repoRoot, "**/*.d.ts"),
          // inspectorClientEventTarget.ts is types + a single empty-body class
          // (extends TypedEventTarget). v8/istanbul records 0 statements for it
          // today. TODO(#1243): drop this exclusion once the class gains real
          // behavior as the v1.5 InspectorClient port progresses.
          path.join(repoRoot, "core/mcp/inspectorClientEventTarget.ts"),
          path.join(repoRoot, "core/mcp/__tests__/**"),
          // test-servers/ is test infrastructure (composable MCP servers and
          // fixtures), not application code — its build output also lives at
          // test-servers/build/, which we don't want to measure either.
          path.join(repoRoot, "test-servers/**"),
        ],
        thresholds: {
          perFile: true,
          // Uniform 90 per-file gate across every dimension. The branch floor was
          // lifted 50 → 70 (#1271) and then the whole gate raised to 90 after a
          // codebase-wide coverage audit added real tests for every outlier.
          // Genuinely-unreachable branches (Mantine portal / `useMediaQuery` /
          // `typeof window` SSR guards, React StrictMode effect replay, and
          // provably-dead defensive guards) are annotated with justified
          // `/* v8 ignore … */` comments at the source rather than relaxing the
          // gate. New code must clear 90 on all four dimensions.
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
      },
      projects: [
        {
          extends: true,
          // Vitest projects don't inherit `resolve` from the parent. The unit
          // project runs from repoRoot so vitest's coverage transformer can
          // reach core/, which leaves core/'s own bare imports with nothing to
          // resolve against — the shared regex aliases are what answer them,
          // sending `react` to clients/web/node_modules and the root-declared
          // packages (`pino`, `hono`, …) to the repo root (#2195).
          resolve: projectResolve,
          test: {
            name: "unit",
            environment: "happy-dom",
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
            include: ["clients/web/src/**/*.test.{ts,tsx}"],
            // Integration tests run in the integration project below (node env).
            exclude: [integrationGlob],
            setupFiles: [
              path.join(dirname, "src/test/setup.ts"),
              NO_RETRY_SETUP,
            ],
            // Pin after-hooks to LIFO (reverse registration). This is Vitest 4's
            // own default (`resolved.sequence.hooks ??= "stack"` — the CLI
            // help-text's "parallel" is stale), so this line documents intent and
            // guards a future default change rather than overriding anything. It's
            // defense-in-depth, NOT load-bearing: the real-transitions auto-settle
            // in `src/test/renderWithMantine.tsx` needs its `afterEach` to complete
            // before `setup.ts`'s setupFile `cleanup()` unmounts the tree (avoiding
            // the #1760 post-teardown `window is not defined` leak, #1786), and
            // that already holds in *every* `sequence.hooks` mode because
            // `cleanup()` is a setupFile (outer) hook, which Vitest runs after
            // inner afterEach hooks regardless of this setting (verified across
            // stack/list/parallel). The settle's own before/after
            // `container.isConnected` self-checks are the real guard against a
            // future regression.
            sequence: { hooks: "stack" },
            // Shared budgets (#2323). This is the largest test surface in the
            // repo — 342 files — and every one of them ran on Vitest's own
            // 5000ms until now. The single site that had been patched by hand
            // (`App.test.tsx`'s three-modal sequence) named that default as its
            // reason for existing.
            ...TIMEOUTS,
          },
        },
        {
          extends: true,
          // See note on the unit project: integration tests also run from
          // repoRoot and import core/ modules, so they need the same alias
          // setup, with the same split — `react` from this client's install,
          // `pino` / `hono` and the rest of the root-declared set from the
          // repo root.
          resolve: projectResolve,
          test: {
            name: "integration",
            environment: "node",
            // Same reason as the unit project: rooted at repoRoot so vitest
            // can transform core/ modules and run tests against the source.
            root: repoRoot,
            include: [integrationGlob],
            setupFiles: [NO_RETRY_SETUP],
            // Integration tests spawn real HTTP/stdio servers via test-servers/,
            // bind sockets, run e2e OAuth flows, and exercise filesystem-backed
            // storage. 30s matches the v1.5 core/vitest.config.ts. Now stated
            // once in `vitest.shared.mts` (#2323) rather than here, together
            // with the `teardownTimeout` that was left on the 10000ms default —
            // teardown is where these suites unlink that filesystem-backed
            // storage and reap the servers they spawned.
            ...INTEGRATION_TIMEOUTS,
            // Inline the MCP SDK so vi.mock("@modelcontextprotocol/client")
            // hooks the same transformed copy that source files import.
            // Externalized node_modules are loaded via Node's loader and bypass
            // Vitest's mock system. Inlining ensures the transformer pipeline
            // owns the module rather than the Node loader.
            server: {
              deps: {
                inline: [/@modelcontextprotocol\/(client|core)/],
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
              configDir: path.join(dirname, ".storybook"),
            }),
          ],
          optimizeDeps: {
            // Re-bundle the browser dep pre-bundle on every run instead of
            // trusting the cached one (#2340). Vite keys that cache on the
            // lockfile and on this config, never on what the story graph
            // imports, so a cached bundle stays "valid" after a story or
            // component gains an import of a package that is already
            // installed. The first request for it then re-runs the optimizer
            // mid-run, which bumps the `?v=` browser hash and rewrites the
            // shared chunks; the `@storybook/react` renderer already loaded in
            // a live test iframe still holds the old hash for its lazy
            // `import("@storybook/react-dom-shim")`, so every story that
            // iframe renders from then on fails with "Failed to fetch
            // dynamically imported module", and the next run is green because
            // the cache has caught up. `force` discards the cache up front, so
            // the scanner crawls every story entry before the browser opens —
            // the same cold path CI takes on every PR. Cost: ~0.8s per run.
            force: true,
          },
          test: {
            name: "storybook",
            // Vitest's default is 5000ms, which is the whole budget a play
            // function gets — including work that is genuinely slow rather than
            // racy. `JsonObjectInput`'s "Annotates The Offending Line" waits on
            // Ace's JSON worker, which starts out of process and debounces its
            // result; its own `waitFor` asked for 5000ms and so could never win
            // against the per-test ceiling, and it lost on a loaded machine
            // (#2292). A larger ceiling does not hide a defect here: a story
            // that blows 15s has genuinely failed, and every assertion stays as
            // strict as it was.
            // …which is the shared `TIMEOUTS.testTimeout` today (#2323): this
            // project is where the value was first chosen, and the other five
            // now follow it rather than restate it. The hook and teardown
            // budgets come along with it, having been left on the defaults.
            ...TIMEOUTS,
            // Carries the shared no-retry assertion and nothing else.
            // ⚠️ It is deliberately NOT in `.storybook/` and declares no
            // annotations: `@storybook/addon-vitest` skips its automatic
            // preview-annotation provisioning only for a setup file that is
            // both inside `configDir` and calls `setProjectAnnotations`, and
            // this one is neither (#1898).
            setupFiles: [NO_RETRY_SETUP],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright({}),
              instances: [
                {
                  browser: "chromium",
                },
              ],
            },
            // The `setupFiles` above is the project's only one, and it
            // carries no preview annotations: since Storybook 10.3
            // `@storybook/addon-vitest`
            // provisions the preview annotations (`.storybook/preview.tsx` plus
            // `@storybook/addon-a11y/preview`) itself, and *skips* doing so when
            // it finds a setup file that is both inside `configDir` and calls
            // `setProjectAnnotations` — so the old `.storybook/vitest.setup.ts`
            // was both redundant and actively opting out of the automatic path
            // (#1898). A green suite doesn't
            // prove the automatic provisioning works (stories rendered without
            // the Mantine decorator would very likely still pass), so
            // `src/test/PreviewAnnotations.stories.tsx` asserts it directly.
          },
        },
      ],
    },
  };
});
