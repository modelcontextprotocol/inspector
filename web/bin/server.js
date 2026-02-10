#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createRemoteApp } from "@modelcontextprotocol/inspector-shared/mcp/remote/node";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "node:crypto";
import pino from "pino";
import { readFileSync } from "node:fs";
import { API_SERVER_ENV_VARS } from "@modelcontextprotocol/inspector-shared/mcp/remote";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

const app = new Hono();

// Read Inspector API auth token from env (provided by start script via spawn env)
// createRemoteApp will use this, or generate one if not provided
// The token is passed explicitly from start script, not written to process.env
const authToken =
  process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ||
  randomBytes(32).toString("hex");

// Add API routes first (more specific)
const port = parseInt(process.env.CLIENT_PORT || "6274", 10);
const host = process.env.HOST || "localhost";
const baseUrl = `http://${host}:${port}`;

const { app: apiApp } = createRemoteApp({
  authToken,
  storageDir: process.env.MCP_STORAGE_DIR,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || [baseUrl],
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
// Mount API app at root - routes inside are /api/mcp/connect, so they become /api/mcp/connect
// Static files need to be served without auth, so we check for /api/* first, then serve static
app.use("/api/*", async (c, next) => {
  // Forward /api/* requests to apiApp
  return apiApp.fetch(c.req.raw);
});

// Serve index.html for root (config is fetched from GET /api/config by the client)
app.get("/", async (c) => {
  try {
    const indexPath = join(distPath, "index.html");
    const html = readFileSync(indexPath, "utf-8");
    return c.html(html);
  } catch (error) {
    console.error("Error serving index.html:", error);
    return c.notFound();
  }
});

// Then add static file serving (fallback for SPA routing)
app.use(
  "/*",
  serveStatic({
    root: distPath,
    rewriteRequestPath: (path) => {
      // If path doesn't exist and doesn't have extension, serve index.html (SPA routing)
      if (!path.includes(".") && !path.startsWith("/api")) {
        return "/index.html";
      }
      return path;
    },
  }),
);

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(
      `\n🚀 MCP Inspector Web is up and running at:\n   http://${host}:${info.port}\n`,
    );
    console.log(`   Auth token: ${authToken}\n`);
  },
);
