/**
 * Sandbox server controller: start/close and get URL.
 * Used by server.ts (prod) and Vite plugin (dev/test). Same process lifecycle as the main server.
 */

import { createServer, type Server } from "node:http";

export interface SandboxControllerOptions {
  /** Port to bind (0 = dynamic). */
  port: number;
  /** HTML content to serve for GET /sandbox and /sandbox/ */
  sandboxHtml: string;
  /** Host to bind (default localhost). */
  host?: string;
}

export interface SandboxController {
  start(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
  getUrl(): string | null;
}

/**
 * Resolve sandbox port from env: MCP_SANDBOX_PORT → SERVER_PORT → 0 (dynamic).
 */
export function resolveSandboxPort(): number {
  const fromSandbox = process.env.MCP_SANDBOX_PORT;
  if (fromSandbox !== undefined && fromSandbox !== "") {
    const n = parseInt(fromSandbox, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const fromServer = process.env.SERVER_PORT;
  if (fromServer !== undefined && fromServer !== "") {
    const n = parseInt(fromServer, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 0;
}

export function createSandboxController(
  options: SandboxControllerOptions,
): SandboxController {
  const { port, sandboxHtml, host = "localhost" } = options;
  let server: Server | null = null;
  let sandboxUrl: string | null = null;

  return {
    async start(): Promise<{ port: number; url: string }> {
      if (server && sandboxUrl) {
        const p = parseInt(new URL(sandboxUrl).port, 10);
        return { port: p, url: sandboxUrl };
      }
      return new Promise((resolve) => {
        server = createServer((req, res) => {
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
        server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            console.error(
              `Sandbox: port ${port || "dynamic"} in use. MCP Apps tab may not work.`,
            );
          } else {
            console.error("Sandbox server error:", err);
          }
        });
        server.listen(port, host, () => {
          const addr = server!.address();
          const actualPort =
            typeof addr === "object" && addr !== null && "port" in addr
              ? addr.port
              : (addr as unknown as number);
          sandboxUrl = `http://${host}:${actualPort}/sandbox`;
          console.log(`   Sandbox (MCP Apps): ${sandboxUrl}`);
          resolve({ port: actualPort, url: sandboxUrl });
        });
      });
    },

    async close(): Promise<void> {
      if (!server) return;
      return new Promise((resolve) => {
        server!.close(() => {
          server = null;
          sandboxUrl = null;
          resolve();
        });
      });
    },

    getUrl(): string | null {
      return sandboxUrl;
    },
  };
}
