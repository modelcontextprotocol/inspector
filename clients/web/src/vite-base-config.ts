/**
 * Shared Vite config (resolve, build, optimizeDeps). Used by vite.config.ts and start-vite-dev-server.ts
 * so the runner can build a full config without loading vite.config.ts (Node can't import .ts).
 */

import path from "path";

export function getViteBaseConfig(root: string) {
  const resolvedRoot = path.resolve(root);
  return {
    resolve: {
      alias: {
        "@": path.join(resolvedRoot, "src"),
      },
      conditions: ["browser", "module", "import"],
    },
    build: {
      minify: false,
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
        external: [
          "@modelcontextprotocol/sdk/client/stdio.js",
          "cross-spawn",
          "which",
        ],
      },
    },
    optimizeDeps: {
      exclude: [
        "@modelcontextprotocol/sdk/client/stdio.js",
        "@modelcontextprotocol/inspector-core/mcp/node",
        "@modelcontextprotocol/inspector-core/mcp/remote/node",
        "cross-spawn",
        "which",
      ],
    },
  };
}
