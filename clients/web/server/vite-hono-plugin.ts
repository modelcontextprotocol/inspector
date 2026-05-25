/**
 * Vite plugin that adds Hono middleware for /api/* and the MCP Apps sandbox.
 * Receives WebServerConfig only (from runner or from buildWebServerConfigFromEnv in vite.config).
 *
 * `apply: 'serve'` confines the plugin to `vite dev` / `vite preview` — vitest
 * projects share this config but never run the dev server, so the plugin stays
 * inert there.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import open from "open";
// Direct leaf import — the `core/mcp/remote/node/index.ts` barrel re-exports
// from `../constants.js`, which would otherwise drag the broader
// `core/mcp/remote/index.ts` barrel (including `createRemoteLogger`, with its
// `pino/browser.js` import) into Vite's config-time module graph and produce
// spurious "could not resolve" warnings during build.
import { createRemoteApp } from "../../../core/mcp/remote/node/server.ts";
import { createSandboxController } from "./sandbox-controller.js";
import type { WebServerConfig } from "./web-server-config.js";
import {
  webServerConfigToInitialPayload,
  printServerBanner,
} from "./web-server-config.js";

export function honoMiddlewarePlugin(config: WebServerConfig): Plugin {
  return {
    name: "hono-api-middleware",
    // `apply: 'serve'` keeps the plugin out of `vite build`, but Vitest still
    // instantiates a Vite server in middleware mode (no HTTP server) for
    // transforms and invokes `configureServer` regardless. Returning early
    // when `server.httpServer` is missing keeps the plugin inert in that
    // context — only an actual `vite dev` (or `vite preview`) instance has
    // an HTTP server to attach to.
    apply: "serve",
    async configureServer(server) {
      // Skip the plugin entirely under Vitest. The storybook project runs
      // tests in a real headless Chromium and spins up a Vite server with
      // `httpServer` attached — that would otherwise pass the next guard and
      // attach the Hono backend (sandbox HTTP server, banner, auto-open) for
      // every test run. Component stories never hit `/api/*`, so the plugin
      // brings no value to that context and only adds noise / port churn.
      if (process.env.VITEST) {
        return;
      }
      if (!server.httpServer) {
        return;
      }

      const sandboxController = createSandboxController({
        port: config.sandboxPort,
        host: config.sandboxHost,
      });
      await sandboxController.start();

      const {
        app: honoApp,
        authToken: resolvedToken,
        close: closeApi,
      } = createRemoteApp({
        authToken: config.dangerouslyOmitAuth ? undefined : config.authToken,
        dangerouslyOmitAuth: config.dangerouslyOmitAuth,
        storageDir: config.storageDir,
        allowedOrigins: config.allowedOrigins,
        sandboxUrl: sandboxController.getUrl() ?? undefined,
        logger: config.logger,
        initialConfig: webServerConfigToInitialPayload(config),
      });

      // Chain the API close (mcp.json watcher) and the sandbox into the
      // Vite server's close so dev-server restarts release both resources.
      const originalClose = server.close.bind(server);
      server.close = async () => {
        await closeApi();
        await sandboxController.close();
        return originalClose();
      };

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
          Object.entries(req.headers).forEach(
            ([key, value]: [string, string | string[] | undefined]) => {
              if (value) {
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(", ") : value,
                );
              }
            },
          );
          const init: RequestInit = { method: req.method, headers };
          if (req.method !== "GET" && req.method !== "HEAD") {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            // Listen for `end`, `error`, AND `close`. Without `error`/`close`
            // an aborted upload (browser navigates away mid-POST) leaves this
            // promise pending forever, leaking memory and the connection.
            // We resolve on every terminal event — partial body bytes flow on
            // to Hono; the underlying fetch will fail downstream if the
            // payload is truncated, which is the expected behavior on abort.
            await new Promise<void>((resolve) => {
              req.once("end", () => resolve());
              req.once("error", () => resolve());
              req.once("close", () => resolve());
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
            // The recursive pump() awaits internally, but a sync throw before
            // the first `await reader.read()` (e.g. a broken reader) would
            // surface as an unhandled rejection without this kickoff catch.
            pump().catch((err) => {
              console.error("[Hono Middleware] Initial pump error:", err);
              reader.cancel().catch(() => {});
              res.end();
            });
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
