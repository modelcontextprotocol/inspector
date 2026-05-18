/**
 * Start Vite dev server in-process via the Node API. Config is passed into the plugin; no shared state.
 *
 * Uses the shared base config so Node-only callers don't need to load
 * `vite.config.ts` (which Node can't import directly).
 */

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { WebServerConfig } from "./web-server-config.js";
import { honoMiddlewarePlugin } from "./vite-hono-plugin.js";
import { getViteBaseConfig } from "./vite-base-config.js";
import type { WebServerHandle } from "./types.js";

export type { WebServerHandle };

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Start the Vite dev server in-process. Passes config into the plugin. Caller owns SIGINT/SIGTERM.
 */
export async function startViteDevServer(
  config: WebServerConfig,
): Promise<WebServerHandle> {
  // Canonicalize so Vite's config hash is stable and matches the deps cache.
  const root = resolve(join(__dirname, ".."));
  const baseConfig = getViteBaseConfig();
  const inlineConfig: InlineConfig = {
    ...baseConfig,
    configFile: false,
    root,
    server: {
      port: config.port,
      host: config.hostname,
    },
    plugins: [react(), honoMiddlewarePlugin(config)],
  };
  const server = await createServer(inlineConfig);

  await server.listen();

  return {
    async close(): Promise<void> {
      await server.close();
    },
  };
}
