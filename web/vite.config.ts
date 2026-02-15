import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { defineConfig, type Plugin } from "vite";
import { createRemoteApp } from "@modelcontextprotocol/inspector-core/mcp/remote/node";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import { API_SERVER_ENV_VARS } from "@modelcontextprotocol/inspector-core/mcp/remote";

const SANDBOX_PORT = 6277;

/**
 * Vite plugin that adds Hono middleware to handle /api/* routes
 * and starts the MCP Apps sandbox server on 6277 (same process).
 */
function honoMiddlewarePlugin(authToken: string): Plugin {
  return {
    name: "hono-api-middleware",
    configureServer(server) {
      // Sandbox for MCP Apps (different origin; same process as Vite dev server)
      const sandboxHtmlPath = path.join(
        __dirname,
        "static",
        "sandbox_proxy.html",
      );
      let sandboxHtml: string;
      try {
        sandboxHtml = readFileSync(sandboxHtmlPath, "utf-8");
      } catch {
        sandboxHtml =
          "<!DOCTYPE html><html><body>Sandbox not loaded</body></html>";
      }
      const sandboxServer = createServer((req, res) => {
        if (
          req.method !== "GET" ||
          (req.url !== "/sandbox" && req.url !== "/sandbox/")
        ) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        });
        res.end(sandboxHtml);
      });
      sandboxServer.listen(SANDBOX_PORT, "localhost", () => {
        console.log(
          `   Sandbox (MCP Apps): http://localhost:${SANDBOX_PORT}/sandbox`,
        );
      });
      sandboxServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(
            `Sandbox: port ${SANDBOX_PORT} in use. MCP Apps tab may not work.`,
          );
        }
      });

      // createRemoteApp returns { app, authToken } - we pass authToken explicitly
      // If not provided, it will read from env or generate one
      const { app: honoApp } = createRemoteApp({
        authToken, // Pass Inspector API token explicitly (from start script)
        storageDir: process.env.MCP_STORAGE_DIR,
        allowedOrigins: [
          `http://localhost:${process.env.CLIENT_PORT || "6274"}`,
          `http://127.0.0.1:${process.env.CLIENT_PORT || "6274"}`,
        ],
        logger: process.env.MCP_LOG_FILE
          ? pino(
              { level: "info" },
              pino.destination({
                dest: process.env.MCP_LOG_FILE,
                append: true,
                mkdir: true,
              }),
            )
          : undefined,
      });

      // Convert Connect middleware to handle Hono app
      const honoMiddleware = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => {
        try {
          // Only handle /api/* routes, let others pass through to Vite
          const path = req.url || "";
          if (!path.startsWith("/api")) {
            return next();
          }

          const url = `http://${req.headers.host}${path}`;

          const headers = new Headers();
          Object.entries(req.headers).forEach(([key, value]) => {
            if (value) {
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            }
          });

          const init: RequestInit = {
            method: req.method,
            headers,
          };

          // Handle body for non-GET requests
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

          const request = new Request(url, init);
          const response = await honoApp.fetch(request);

          // Convert Web Standard Response back to Node res
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          // For SSE streams, we need to stream data immediately without buffering
          const isSSE = response.headers
            .get("content-type")
            ?.includes("text/event-stream");
          if (isSSE) {
            // Disable buffering for SSE
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
          }

          if (response.body) {
            // Flush headers immediately so the client gets 200 before any body chunks.
            // Otherwise for SSE (no data until first event) reader.read() blocks and
            // Node never sends headers, so the client's fetch() hangs.
            res.flushHeaders?.();
            const reader = response.body.getReader();
            const pump = async () => {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  res.end();
                } else {
                  // Write immediately without buffering
                  res.write(Buffer.from(value), (err) => {
                    if (err) {
                      console.error("[Hono Middleware] Write error:", err);
                      reader.cancel().catch(() => {});
                      res.end();
                    }
                  });
                  // Continue pumping (don't await, but handle errors)
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
            // Start pumping (don't await - let it run in background for SSE)
            pump();
          } else {
            res.end();
          }
        } catch (error) {
          next(error);
        }
      };

      // Mount at root - check path ourselves to avoid Connect prefix stripping
      // Only handle /api/* routes, let others pass through to Vite
      server.middlewares.use(honoMiddleware);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Inspector API auth token is passed via env var (read-only, set by start script)
    // Vite plugin reads it and passes explicitly to createRemoteApp
    honoMiddlewarePlugin(process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] || ""),
  ],
  server: {
    host: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Prevent bundling Node.js-only modules
    conditions: ["browser", "module", "import"],
  },
  build: {
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
      external: [
        // Prevent bundling Node.js-only stdio transport code
        "@modelcontextprotocol/sdk/client/stdio.js",
        "cross-spawn",
        "which",
      ],
    },
  },
  optimizeDeps: {
    exclude: [
      // Exclude Node.js-only modules from pre-bundling
      "@modelcontextprotocol/sdk/client/stdio.js",
      "@modelcontextprotocol/inspector-core/mcp/node",
      "@modelcontextprotocol/inspector-core/mcp/remote/node",
      "cross-spawn",
      "which",
    ],
  },
});
