/**
 * Hono production server. Export startHonoServer(config) for in-process use by the runner.
 * When run as the main module (e.g. node dist/server.js), build config from env and start.
 */

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import open from "open";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { createRemoteApp } from "../../../core/mcp/remote/node/server.ts";
import { createSandboxController } from "./sandbox-controller.js";
import { injectAuthToken } from "./inject-auth-token.js";
import type { WebServerConfig } from "./web-server-config.js";
import {
  webServerConfigToInitialPayload,
  buildWebServerConfigFromEnv,
  printServerBanner,
} from "./web-server-config.js";
import type { WebServerHandle } from "./types.js";

export type { WebServerHandle };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Start the Hono production server in-process. Returns a handle that closes sandbox then HTTP server.
 * Caller owns SIGINT/SIGTERM; do not register signal handlers here.
 */
export async function startHonoServer(
  config: WebServerConfig,
): Promise<WebServerHandle> {
  const sandboxController = createSandboxController({
    port: config.sandboxPort,
    host: config.sandboxHost,
  });
  await sandboxController.start();

  const resolvedAuthToken =
    config.authToken ||
    (config.dangerouslyOmitAuth ? "" : randomBytes(32).toString("hex"));

  const rootPath = config.staticRoot ?? __dirname;

  const { app: apiApp, close: closeApi } = createRemoteApp({
    authToken: config.dangerouslyOmitAuth ? undefined : resolvedAuthToken,
    dangerouslyOmitAuth: config.dangerouslyOmitAuth,
    storageDir: config.storageDir,
    allowedOrigins: config.allowedOrigins,
    sandboxUrl: sandboxController.getUrl() ?? undefined,
    logger: config.logger,
    initialConfig: webServerConfigToInitialPayload(config),
  });

  const app = new Hono();
  app.use("/api/*", async (c) => {
    return apiApp.fetch(c.req.raw);
  });

  // Serve index.html with the API token injected so a reload at any bare URL
  // (no `?MCP_INSPECTOR_API_TOKEN=…`) still authenticates against /api/*.
  // No-op when auth is dangerously omitted (empty token). The dev Vite plugin
  // applies the same injection via `transformIndexHtml`. `Cache-Control:
  // no-store` keeps a browser/proxy from serving a page that carries a stale
  // token after a server restart regenerates it (randomBytes per start).
  const serveIndexHtml = (c: Context) => {
    const indexPath = join(rootPath, "index.html");
    const html = readFileSync(indexPath, "utf-8");
    c.header("Cache-Control", "no-store");
    return c.html(injectAuthToken(html, resolvedAuthToken));
  };

  app.get("/", async (c) => {
    try {
      return serveIndexHtml(c);
    } catch (error) {
      console.error("Error serving index.html:", error);
      return c.notFound();
    }
  });

  // Real static assets (paths with a file extension). Missing files fall
  // through to the SPA fallback below via `next()`.
  app.use("/*", serveStatic({ root: rootPath }));

  // SPA deep-link fallback: any non-/api route that didn't resolve to a static
  // asset (e.g. `/oauth/callback`, the OAuth landing URL) serves the *injected*
  // index.html — not the raw file — so bookmarks and hand-typed reloads at
  // those paths get the token global too, matching the `/` route.
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.notFound();
    }
    try {
      return serveIndexHtml(c);
    } catch (error) {
      console.error("Error serving index.html:", error);
      return c.notFound();
    }
  });

  const httpServer = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.hostname,
    },
    (info) => {
      const sandboxUrl = sandboxController.getUrl();
      const url = printServerBanner(
        config,
        info.port,
        resolvedAuthToken,
        sandboxUrl ?? undefined,
      );
      if (config.autoOpen) {
        open(url);
      }
    },
  );

  httpServer.on("error", (err: Error) => {
    if (err.message.includes("EADDRINUSE")) {
      console.error(
        `MCP Inspector PORT IS IN USE at http://${config.hostname}:${config.port}`,
      );
      process.exit(1);
    } else {
      throw err;
    }
  });

  return {
    async close(): Promise<void> {
      await closeApi();
      await sandboxController.close();
      if ("closeAllConnections" in httpServer) {
        httpServer.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** Run when this file is executed as the main module (e.g. node dist/server.js). */
async function runStandalone(): Promise<void> {
  const config = buildWebServerConfigFromEnv();
  const handle = await startHonoServer(config);
  const shutdown = () => {
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);
if (isMain) {
  void runStandalone();
}
