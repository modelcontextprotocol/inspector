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
  // handlers. It's a native-binding package (no browser code path) so
  // excluding it keeps Vite's dep scanner from chasing into the
  // platform-specific binaries during dev startup.
  "@napi-rs/keyring",
] as const;

export function getViteBaseConfig() {
  return {
    optimizeDeps: {
      exclude: [...NODE_ONLY_OPTIMIZE_DEPS_EXCLUDE],
    },
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
