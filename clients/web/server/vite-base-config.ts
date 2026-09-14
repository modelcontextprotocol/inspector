/**
 * Shared Vite config (build externals + optimizeDeps). Consumed by `vite.config.ts`
 * and by `start-vite-dev-server.ts` so the in-process Vite starter can apply the
 * same node-only exclusions without re-loading `vite.config.ts` (Node can't
 * import .ts directly).
 *
 * Aliases and the vitest project setup live in `vite.config.ts` itself — only
 * the parts needed by both the CLI runner and `vite dev` belong here.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";

const NODE_ONLY_OPTIMIZE_DEPS_EXCLUDE = [
  "@modelcontextprotocol/client/stdio",
  // `atomically` is reached only through `core/storage/store-io.ts`,
  // which is imported by `core/mcp/remote/node/server.ts` (the Hono
  // app). The module never lands in the browser graph; excluding it
  // keeps Vite's dev-time scanner from chasing it through the plugin's
  // node-only import chain.
  "atomically",
  // `chokidar` is only loaded inside `core/mcp/remote/node/server.ts`
  // when the lazy mcp.json watcher starts. It transitively imports
  // `readdirp` and core node fs/os modules; excluding it keeps Vite's
  // dep scanner from walking into them during dev startup.
  "chokidar",
  "cross-spawn",
  "which",
  // `@napi-rs/keyring` is loaded only inside
  // `core/auth/node/secret-store.ts` from the Hono `/api/servers`
  // handlers — and lazily even there, via a cached dynamic import, so
  // an unsupported platform degrades instead of crashing at startup
  // (#1905). It's a native-binding package (no browser code path) so
  // excluding it keeps Vite's dep scanner from chasing into the
  // platform-specific binaries during dev startup.
  "@napi-rs/keyring",
  // `proper-lockfile` is reached only through `core/auth/node/file-lock.ts`
  // — the secrets file's cross-process lock (#2082) — which the Hono
  // `/api/servers` handlers pull in via `core/auth/node/file-secret-store.ts`.
  // Same node-only import chain as `atomically` above, and the same reason:
  // it is CJS with a `graceful-fs`/`signal-exit`/`retry` graph that Vite's
  // dev scanner has no business walking. Note the tsup `external` lists do
  // **not** cover this — they configure the production bundles, not `vite dev`.
  "proper-lockfile",
] as const;

export function getViteBaseConfig() {
  return {
    optimizeDeps: {
      exclude: [...NODE_ONLY_OPTIMIZE_DEPS_EXCLUDE],
      // Pre-bundle the browser-safe client barrel up front so Vitest's
      // Storybook (browser) project doesn't discover it lazily and re-optimize
      // mid-run — which reloads the worker and fails in-flight dynamic story
      // imports with "Failed to fetch dynamically imported module". Several
      // components import it at runtime (e.g. `protocolUtils`'s
      // `isInputRequiredResult` / `SUBSCRIPTION_ID_META_KEY`), so listing it
      // here keeps the dep graph stable across story files.
      //
      // That was one instance of a class, not the class: any package a story
      // or component starts importing after the cache was written is
      // discovered the same way, and pinning each one here would chase the
      // symptom. `getStorybookOptimizeDeps` below adds `force` so every run
      // re-scans the story entries up front (#2340); this entry stays as the
      // explicit include it always was.
      include: ["@modelcontextprotocol/client"],
    },
  };
}

/**
 * Storybook (browser Vitest project) optimizeDeps: the base set, re-bundled
 * on every run instead of read from the cache (#2340).
 *
 * Vite keys that cache on the lockfile and on the config, never on what the
 * story graph imports, so a cached bundle stays "valid" after a story or
 * component gains an import of a package that is already installed. With a
 * valid cache Vite skips the scan, and the first request for the new package
 * re-runs the optimizer mid-run: the shared chunks are rewritten, the `?v=`
 * browser hash is bumped, and Vite sends a `full-reload` that the Vitest
 * tester iframes do not act on. The `@storybook/react` renderer already loaded
 * in a live iframe still holds the old hash for its lazy
 * `import("@storybook/react-dom-shim")`, so every story that iframe renders
 * from then on fails with "Failed to fetch dynamically imported module" — and
 * the next run is green, because the cache has caught up. `force` discards the
 * cache up front so the scanner crawls every story entry before the browser
 * opens: the same cold path CI takes on every PR. Cost: ~0.8s per run.
 *
 * Spread from `getViteBaseConfig()` rather than left to Vitest's project merge
 * so the include/exclude the base set carries are the helper's own claim, and
 * tested as such.
 */
export function getStorybookOptimizeDeps() {
  return {
    ...getViteBaseConfig().optimizeDeps,
    force: true,
  };
}

/**
 * Dev-server optimizeDeps: rebuild from scratch each launch — no stale
 * pre-bundles carried across restarts (avoids 504 Outdated Optimize Dep).
 * Do not use under Vitest.
 */
export function getViteDevOptimizeDeps() {
  return {
    exclude: [...NODE_ONLY_OPTIMIZE_DEPS_EXCLUDE],
    force: true,
    ignoreOutdatedRequests: true,
    include: ["ajv", "@modelcontextprotocol/client/validators/ajv"],
  };
}

/** Remove Vite's pre-bundle cache under clients/web before a dev launch. */
export function clearViteDepsCache(clientWebRoot: string): void {
  rmSync(join(clientWebRoot, "node_modules", ".vite"), {
    recursive: true,
    force: true,
  });
}
