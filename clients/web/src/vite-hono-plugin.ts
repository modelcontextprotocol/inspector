/**
 * Vite plugin that adds Hono middleware for /api/* and the MCP Apps sandbox.
 * Receives WebServerConfig only (from runner or from buildWebServerConfigFromEnv in vite.config).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import open from "open";
import { createRemoteApp } from "@modelcontextprotocol/inspector-core/mcp/remote/node";
import { createSandboxController } from "./sandbox-controller.js";
import type { WebServerConfig } from "./web-server-config.js";
import {
  webServerConfigToInitialPayload,
  printServerBanner,
} from "./web-server-config.js";

/**
 * Plugin factory. Caller must pass a WebServerConfig (runner builds it from argv; vite.config builds it from env via buildWebServerConfigFromEnv).
 */
export function honoMiddlewarePlugin(config: WebServerConfig): Plugin {
  return {
    name: "hono-api-middleware",
    async configureServer(server) {
      const sandboxController = createSandboxController({
        port: config.sandboxPort,
        host: config.sandboxHost,
      });
      await sandboxController.start();

      if (!server.httpServer) {
        throw new Error(
          "Vite HTTP server is not available. This plugin requires a running HTTP server (middleware mode is not supported).",
        );
      }

      const originalClose = server.close.bind(server);
      server.close = async () => {
        await sandboxController.close();
        return originalClose();
      };

      const { app: honoApp, authToken: resolvedToken } = createRemoteApp({
        authToken: config.dangerouslyOmitAuth ? undefined : config.authToken,
        dangerouslyOmitAuth: config.dangerouslyOmitAuth,
        storageDir: config.storageDir,
        allowedOrigins: config.allowedOrigins,
        sandboxUrl: sandboxController.getUrl() ?? undefined,
        logger: config.logger,
        initialConfig: webServerConfigToInitialPayload(config),
      });

      const sandboxUrl = sandboxController.getUrl();

      const logBanner = () => {
        const address = server.httpServer?.address();
        const actualPort =
          typeof address === "object" && address !== null
            ? address.port
            : config.port;

        const url = printServerBanner(
          config,
          actualPort,
          resolvedToken,
          sandboxUrl ?? undefined,
        );

        if (config.autoOpen) {
          open(url);
        }
      };

      server.httpServer.once("listening", () => {
        setImmediate(logBanner);
      });

      const honoMiddleware = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => {
        try {
          const pathname = req.url || "";
          if (!pathname.startsWith("/api")) {
            return next();
          }
          const url = `http://${req.headers.host}${pathname}`;
          const headers = new Headers();
          Object.entries(req.headers).forEach(([key, value]) => {
            if (value) {
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            }
          });
          const init: RequestInit = { method: req.method, headers };
          if (req.method !== "GET" && req.method !== "HEAD") {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            await new Promise<void>((resolve) => {
              req.on("end", () => resolve());
            });
            if (chunks.length > 0) {
              init.body = Buffer.concat(chunks);
            }
          }
          const response = await honoApp.fetch(new Request(url, init));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const isSSE = response.headers
            .get("content-type")
            ?.includes("text/event-stream");
          if (isSSE) {
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
          }
          if (response.body) {
            res.flushHeaders?.();
            const reader = response.body.getReader();
            const pump = async () => {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  res.end();
                } else {
                  res.write(Buffer.from(value), (err) => {
                    if (err) {
                      console.error("[Hono Middleware] Write error:", err);
                      reader.cancel().catch(() => {});
                      res.end();
                    }
                  });
                  pump().catch((err) => {
                    console.error("[Hono Middleware] Pump error:", err);
                    reader.cancel().catch(() => {});
                    res.end();
                  });
                }
              } catch (err) {
                console.error("[Hono Middleware] Read error:", err);
                reader.cancel().catch(() => {});
                res.end();
              }
            };
            pump();
          } else {
            res.end();
          }
        } catch (error) {
          next(error);
        }
      };

      server.middlewares.use(honoMiddleware);
    },
  };
}
