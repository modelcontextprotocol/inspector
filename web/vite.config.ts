import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import { createRemoteApp } from "@modelcontextprotocol/inspector-shared/mcp/remote/node";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import { readFileSync } from "node:fs";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Vite plugin that adds Hono middleware to handle /api/* routes
 */
function honoMiddlewarePlugin(authToken: string): Plugin {
  return {
    name: "hono-api-middleware",
    configureServer(server) {
      // createRemoteApp returns { app, authToken } - we pass authToken explicitly
      // If not provided, it will read from env or generate one
      const { app: honoApp } = createRemoteApp({
        authToken, // Pass token explicitly (from start script)
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

      // Inject config into index.html for dev mode
      server.middlewares.use((req, res, next) => {
        if (req.url === "/" || req.url === "/index.html") {
          try {
            const indexPath = path.resolve(__dirname, "index.html");
            let html = readFileSync(indexPath, "utf-8");

            // Build initial config object from env vars
            const defaultEnvironment = {
              ...getDefaultEnvironment(),
              ...(process.env.MCP_ENV_VARS
                ? JSON.parse(process.env.MCP_ENV_VARS)
                : {}),
            };

            const initialConfig = {
              ...(process.env.MCP_INITIAL_COMMAND
                ? { defaultCommand: process.env.MCP_INITIAL_COMMAND }
                : {}),
              ...(process.env.MCP_INITIAL_ARGS
                ? { defaultArgs: process.env.MCP_INITIAL_ARGS.split(" ") }
                : {}),
              ...(process.env.MCP_INITIAL_TRANSPORT
                ? { defaultTransport: process.env.MCP_INITIAL_TRANSPORT }
                : {}),
              ...(process.env.MCP_INITIAL_SERVER_URL
                ? { defaultServerUrl: process.env.MCP_INITIAL_SERVER_URL }
                : {}),
              defaultEnvironment,
            };

            // Inject config as a script tag before closing </head>
            const configScript = `<script>window.__INITIAL_CONFIG__ = ${JSON.stringify(initialConfig)};</script>`;
            html = html.replace("</head>", `${configScript}</head>`);

            res.setHeader("Content-Type", "text/html");
            res.end(html);
            return;
          } catch (error) {
            console.error("Error injecting config into index.html:", error);
            // Fall through to Vite's default handling
          }
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Auth token is passed via env var (read-only, set by start script)
    // Vite plugin reads it and passes explicitly to createRemoteApp
    honoMiddlewarePlugin(process.env.MCP_REMOTE_AUTH_TOKEN || ""),
  ],
  server: {
    host: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
