import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import pino from "pino";
import { createRemoteApp } from "@modelcontextprotocol/inspector-core/mcp/remote/node";
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "@modelcontextprotocol/inspector-core/mcp/remote";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When run as dist/server.js, __dirname is dist/; index and assets live there
const distPath = __dirname;
const sandboxHtmlPath = join(__dirname, "../static/sandbox_proxy.html");

const SANDBOX_PORT = 6277;

const app = new Hono();

const authToken =
  process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ??
  process.env[LEGACY_AUTH_TOKEN_ENV] ??
  randomBytes(32).toString("hex");

const port = parseInt(process.env.CLIENT_PORT || "6274", 10);
const host = process.env.HOST || "localhost";
const baseUrl = `http://${host}:${port}`;

const { app: apiApp } = createRemoteApp({
  authToken,
  storageDir: process.env.MCP_STORAGE_DIR,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") ?? [baseUrl],
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

app.use("/api/*", async (c) => {
  return apiApp.fetch(c.req.raw);
});

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

app.use(
  "/*",
  serveStatic({
    root: distPath,
    rewriteRequestPath: (path) => {
      if (!path.includes(".") && !path.startsWith("/api")) {
        return "/index.html";
      }
      return path;
    },
  }),
);

let sandboxHtml: string;
try {
  sandboxHtml = readFileSync(sandboxHtmlPath, "utf-8");
} catch (e) {
  sandboxHtml =
    "<!DOCTYPE html><html><body>Sandbox not loaded: " +
    String((e as Error).message) +
    "</body></html>";
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

sandboxServer.listen(SANDBOX_PORT, host, () => {
  console.log(`   Sandbox (MCP Apps): http://${host}:${SANDBOX_PORT}/sandbox`);
});
sandboxServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Sandbox: port ${SANDBOX_PORT} in use. MCP Apps tab may not work.`,
    );
  } else {
    console.error("Sandbox server error:", err);
  }
});

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
