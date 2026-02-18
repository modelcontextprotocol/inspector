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
import {
  createSandboxController,
  resolveSandboxPort,
} from "./sandbox-controller.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When run as dist/server.js, __dirname is dist/; index and assets live there
const distPath = __dirname;
const sandboxHtmlPath = join(__dirname, "../static/sandbox_proxy.html");

const app = new Hono();

const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;
const authToken = dangerouslyOmitAuth
  ? ""
  : (process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ??
    process.env[LEGACY_AUTH_TOKEN_ENV] ??
    randomBytes(32).toString("hex"));

const port = parseInt(process.env.CLIENT_PORT || "6274", 10);
const host = process.env.HOST || "localhost";
const baseUrl = `http://${host}:${port}`;

let sandboxHtml: string;
try {
  sandboxHtml = readFileSync(sandboxHtmlPath, "utf-8");
} catch (e) {
  sandboxHtml =
    "<!DOCTYPE html><html><body>Sandbox not loaded: " +
    String((e as Error).message) +
    "</body></html>";
}

const sandboxController = createSandboxController({
  port: resolveSandboxPort(),
  sandboxHtml,
  host,
});
await sandboxController.start();

const { app: apiApp } = createRemoteApp({
  authToken: dangerouslyOmitAuth ? undefined : authToken,
  dangerouslyOmitAuth,
  storageDir: process.env.MCP_STORAGE_DIR,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") ?? [baseUrl],
  sandboxUrl: sandboxController.getUrl() ?? undefined,
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

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const forceExit = setTimeout(() => {
    console.error("Shutdown timeout; forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await sandboxController.close();
  } catch (err) {
    console.error("Sandbox close error:", err);
  }

  httpServer.close((err) => {
    clearTimeout(forceExit);
    if (err) {
      console.error("Server close error:", err);
      process.exit(1);
    }
    process.exit(0);
  });
}

let shuttingDown = false;
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
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

const httpServer = serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(
      `\n🚀 MCP Inspector Web is up and running at:\n   http://${host}:${info.port}\n`,
    );
    if (dangerouslyOmitAuth) {
      console.log("   Auth: disabled (DANGEROUSLY_OMIT_AUTH)\n");
    } else {
      console.log(`   Auth token: ${authToken}\n`);
    }
  },
);
