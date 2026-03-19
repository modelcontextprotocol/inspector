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
import { createRemoteApp } from "@modelcontextprotocol/inspector-core/mcp/remote/node";
import { createSandboxController } from "./sandbox-controller.js";
import type { WebServerConfig } from "./web-server-config.js";
import {
  webServerConfigToInitialPayload,
  buildWebServerConfigFromEnv,
  printServerBanner,
} from "./web-server-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface WebServerHandle {
  close(): Promise<void>;
}

/**
 * Start the Hono production server in-process. Returns a handle that closes sandbox then HTTP server.
 * Caller owns SIGINT/SIGTERM; do not register signal handlers here.
 */
export async function startHonoServer(
  config: WebServerConfig,
): Promise<WebServerHandle> {
  config.logger.info("Web server starting");
  const sandboxController = createSandboxController({
    port: config.sandboxPort,
    host: config.sandboxHost,
  });
  await sandboxController.start();

  const resolvedAuthToken =
    config.authToken ||
    (config.dangerouslyOmitAuth ? "" : randomBytes(32).toString("hex"));

  const rootPath = config.staticRoot ?? __dirname;

  const { app: apiApp } = createRemoteApp({
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

  app.get("/", async (c) => {
    try {
      const indexPath = join(rootPath, "index.html");
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch (error) {
      console.error("Error serving index.html:", error);
      return c.notFound();
    }
  });

  app.use(
    "/*",
    serveStatic({
      root: rootPath,
      rewriteRequestPath: (path) => {
        if (!path.includes(".") && !path.startsWith("/api")) {
          return "/index.html";
        }
        return path;
      },
    }),
  );

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
        `❌  MCP Inspector PORT IS IN USE at http://${config.hostname}:${config.port} ❌ `,
      );
      process.exit(1);
    } else {
      throw err;
    }
  });

  return {
    async close(): Promise<void> {
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
  const config = await buildWebServerConfigFromEnv();
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
