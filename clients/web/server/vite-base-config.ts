/**
 * Shared Vite config (build externals + optimizeDeps). Consumed by `vite.config.ts`
 * and by `start-vite-dev-server.ts` so the in-process Vite starter can apply the
 * same node-only exclusions without re-loading `vite.config.ts` (Node can't
 * import .ts directly).
 *
 * Aliases and the vitest project setup live in `vite.config.ts` itself — only
 * the parts needed by both the CLI runner and `vite dev` belong here.
 */

export function getViteBaseConfig() {
  return {
    optimizeDeps: {
      // Node-only modules that the dev backend (core/mcp/remote/node/*,
      // core/mcp/node/*) consumes. Excluding them from Vite's dep-pre-bundling
      // step keeps `vite dev` from trying to scan/bundle them into the
      // browser graph during startup.
      exclude: [
        "@modelcontextprotocol/sdk/client/stdio.js",
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
      ],
    },
  };
}
