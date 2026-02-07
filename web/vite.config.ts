import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import { createRemoteApp } from "@modelcontextprotocol/inspector-shared/mcp/remote/node";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";

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
          // Convert Node req/res to Web Standard Request
          const url = `http://${req.headers.host}${req.url}`;
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

          if (response.body) {
            const reader = response.body.getReader();
            const pump = async () => {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
              } else {
                res.write(Buffer.from(value));
                await pump();
              }
            };
            await pump();
          } else {
            res.end();
          }
        } catch (error) {
          next(error);
        }
      };

      // Mount at root - routes inside createRemoteApp already have /api/ prefix
      // Only handle /api/* routes, let others pass through to Vite
      server.middlewares.use("/api", honoMiddleware);
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
