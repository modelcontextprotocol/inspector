/**
 * Sandbox server controller: start/close and get URL.
 * Used by server.ts (prod) and the Vite plugin (dev/test). Same process lifecycle as the main server.
 */

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatHostForUrl } from "../../../core/node/hostUrl.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SandboxControllerOptions {
  /** Port to bind (0 = dynamic). */
  port: number;
  /** Host to bind (default localhost). */
  host?: string;
  /**
   * The backend's origin allow-list (the embedder origins). Used to build the
   * proxy's `frame-ancestors` so the sandbox iframe isn't CSP-blocked when the
   * inspector is served on a non-loopback host (network hosting / Docker). When
   * empty or omitted, falls back to loopback-only.
   */
  allowedOrigins?: string[];
}

const LOOPBACK_FRAME_ANCESTORS = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "http://[::1]:*",
];

/**
 * A well-formed CSP host-source: `scheme://host[:port]` with no whitespace or
 * CSP metacharacters. `allowedOrigins` is user-controlled (the `ALLOWED_ORIGINS`
 * env var), and its values are interpolated into the `Content-Security-Policy`
 * response header — so a newline would make `writeHead` throw `ERR_INVALID_CHAR`
 * (killing the sandbox page) and a `;` would inject extra CSP directives. Only
 * values matching this shape are allowed through {@link sandboxFrameAncestors}.
 */
const CSP_HOST_SOURCE = /^[a-z][a-z0-9+.-]*:\/\/[^\s;,'"]+$/i;

/**
 * The proxy's `frame-ancestors` sources. The embedder is the inspector app
 * page, whose origin is (by construction) in the backend's `allowedOrigins`, so
 * derive the directive from that list — this keeps the MCP Apps iframe working
 * on whatever host the app is actually served from, not just loopback.
 * Malformed entries are dropped (see {@link CSP_HOST_SOURCE}); if nothing valid
 * remains (empty list, or the "origin check disabled" case), falls back to the
 * loopback family so the sandbox still loads locally and the header can't be
 * corrupted.
 */
export function sandboxFrameAncestors(allowedOrigins?: string[]): string {
  const valid = (allowedOrigins ?? []).filter((o) => CSP_HOST_SOURCE.test(o));
  const sources = valid.length > 0 ? valid : LOOPBACK_FRAME_ANCESTORS;
  return `frame-ancestors ${sources.join(" ")}`;
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
  const { port, host = "localhost", allowedOrigins } = options;
  let server: Server | null = null;
  let sandboxUrl: string | null = null;

  // Defense-in-depth for the proxy page itself. Only `frame-ancestors` is set
  // here — fetch directives (`default-src`, `connect-src`, etc.) are
  // deliberately omitted because a `srcdoc` iframe clones its embedder's CSP
  // policy container: any fetch directive on this header would be inherited by
  // the inner app document and, since multiple CSPs intersect, would override
  // the per-app `connect-src`/`img-src` allowlists the host bakes into the
  // wrapped HTML (see src/utils/sandbox-csp.ts). The opaque-origin sandbox on
  // the inner frame is the structural boundary; `frame-ancestors` restricts the
  // proxy to being embedded by the inspector app itself — see
  // `sandboxFrameAncestors` for how the embedder origins are derived.
  const SANDBOX_PROXY_CSP = sandboxFrameAncestors(allowedOrigins);

  let sandboxHtml: string;
  try {
    const sandboxHtmlPath = join(__dirname, "../static/sandbox_proxy.html");
    sandboxHtml = readFileSync(sandboxHtmlPath, "utf-8");
  } catch (e) {
    sandboxHtml =
      "<!DOCTYPE html><html><body>Sandbox not loaded: " +
      String((e as Error).message) +
      "</body></html>";
  }

  return {
    async start(): Promise<{ port: number; url: string }> {
      if (server && sandboxUrl) {
        const p = parseInt(new URL(sandboxUrl).port, 10);
        return { port: p, url: sandboxUrl };
      }
      return new Promise((resolve) => {
        // Guard so a `listen` error followed by a (theoretically possible)
        // late `listening` callback doesn't double-resolve the promise. The
        // first signal wins.
        let settled = false;
        const settle = (value: { port: number; url: string }) => {
          /* v8 ignore next -- defensive double-settle guard: for a TCP listen
             the `error` and `listening` events are mutually exclusive, so the
             second-signal early-return is unreachable in practice. */
          if (settled) return;
          settled = true;
          resolve(value);
        };

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
            "Content-Security-Policy": SANDBOX_PROXY_CSP,
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
          // Best-effort degradation: resolve with empty values rather than
          // rejecting so callers (the Vite plugin in particular) keep
          // attaching `/api/*`. `sandboxUrl` stays null, `getUrl()` keeps
          // returning null, and the banner omits the sandbox line.
          server = null;
          settle({ port: 0, url: "" });
        });
        server.listen(port, host, () => {
          const addr = server!.address();
          const actualPort =
            typeof addr === "object" && addr !== null && "port" in addr
              ? addr.port
              : /* v8 ignore next -- unreachable for a TCP listen: `address()`
                   always returns an `AddressInfo` object with `port`. The
                   string form only occurs for unix-socket/pipe listens, which
                   this controller never performs. */
                (addr as unknown as number);
          sandboxUrl = `http://${formatHostForUrl(host)}:${actualPort}/sandbox`;
          settle({ port: actualPort, url: sandboxUrl });
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
