/**
 * Sandbox server controller: start/close and get URL.
 * Used by server.ts (prod) and the Vite plugin (dev/test). Same process lifecycle as the main server.
 */

import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalUrlHost,
  isAllInterfacesHost,
} from "../../../core/node/hostUrl.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SandboxControllerOptions {
  /** Port to bind (0 = dynamic). */
  port: number;
  /** Host to bind (default localhost). */
  host?: string;
  /**
   * The backend's origin allow-list (the embedder origins). Used to build the
   * proxy's `frame-ancestors` so the sandbox iframe isn't CSP-blocked when the
   * inspector is served on a non-loopback host (network hosting / Docker). The
   * real callers always pass a non-empty list (`buildWebServerConfig` never
   * produces an empty `allowedOrigins` since #1795's H1 fix); an empty/omitted
   * list (only a hand-constructed caller or a test) falls back to loopback-only.
   */
  allowedOrigins?: string[];
}

// Loopback fallback. NB: no `http://[::1]:*` — a **bracketed IPv6 literal is not
// a valid CSP `host-source`** (the CSP3 `host-char` grammar is ALPHA/DIGIT/"-"
// only). Chromium rejects `http://[::1]:*` and, if it's the sole source, the
// directive degrades to `frame-ancestors 'none'` and blocks the frame — verified
// empirically. So MCP Apps requires browsing the app at a name or IPv4
// (`localhost` / `127.0.0.1`), which these two cover; a bare `[::1]` embedder
// can't be admitted by any frame-ancestors source and is unsupported for Apps.
const LOOPBACK_FRAME_ANCESTORS = ["http://127.0.0.1:*", "http://localhost:*"];

/**
 * A well-formed CSP host-source: `scheme://host[:port]` with no whitespace, CSP
 * metacharacters, or brackets. `allowedOrigins` comes from
 * `web-server-config.ts`, where every entry is already a `new URL().origin`
 * (canonical, no path/newline/`;`), so its **load-bearing job today is dropping
 * bracketed IPv6** — a `http://[::1]:PORT` literal isn't a valid CSP host-source
 * and, as the only source, would collapse the directive to `'none'`. The
 * whitespace/metacharacter exclusions are belt-and-braces: `sandboxFrameAncestors`
 * takes the list from a caller, not from env directly, so a future caller that
 * doesn't pre-canonicalize can't corrupt the header. Only values matching this
 * shape survive into {@link sandboxFrameAncestors}.
 */
const CSP_HOST_SOURCE = /^[a-z][a-z0-9+.-]*:\/\/[^\s;,'"[\]]+$/i;

/**
 * The proxy's `frame-ancestors` sources. The embedder is the inspector app
 * page, whose origin is (by construction) in the backend's `allowedOrigins`, so
 * derive the directive from that list — this keeps the MCP Apps iframe working
 * on whatever host the app is actually served from, not just loopback.
 * Malformed entries are dropped (see {@link CSP_HOST_SOURCE}); if nothing valid
 * remains (the real backend always passes a non-empty list, so this is a
 * hand-constructed caller, a test, or an all-malformed `ALLOWED_ORIGINS`), it
 * falls back to the loopback family so the sandbox still loads locally and the
 * header can't be corrupted.
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
 * A usable listen port from a raw env value, or `undefined` if it isn't a plain
 * integer in `0`–`65535` (0 = OS-assigned). The `^\d+$` test rejects `parseInt`
 * partial parses (`6274abc`) and the upper bound keeps an out-of-range value
 * (`70000`) from reaching `server.listen`, which throws `ERR_SOCKET_BAD_PORT`
 * synchronously — matching the strict `CLIENT_PORT` validation.
 */
function parseListenPort(raw: string | undefined): number | undefined {
  const v = raw?.trim();
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = parseInt(v, 10);
  return n <= 65535 ? n : undefined;
}

/**
 * Resolve sandbox port from env: MCP_SANDBOX_PORT → SERVER_PORT → 0 (dynamic).
 * An invalid value falls through rather than crashing the boot; a set-but-invalid
 * MCP_SANDBOX_PORT (the dedicated knob) is warned so the fall-through isn't
 * silent — matching the warn-and-drop precedent for ALLOWED_ORIGINS.
 */
export function resolveSandboxPort(): number {
  const fromSandbox = parseListenPort(process.env.MCP_SANDBOX_PORT);
  if (fromSandbox === undefined && process.env.MCP_SANDBOX_PORT?.trim()) {
    console.warn(
      `Ignoring invalid MCP_SANDBOX_PORT="${process.env.MCP_SANDBOX_PORT}" (need an integer 0–65535); falling back.`,
    );
  }
  return fromSandbox ?? parseListenPort(process.env.SERVER_PORT) ?? 0;
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
          // Advertise `localhost` for a wildcard bind: the sandbox URL is
          // served to the browser (via /api/config) and printed in the banner,
          // and `http://0.0.0.0:PORT` isn't reachable from the client — but a
          // wildcard bind serves loopback, so `localhost` is. Otherwise use the
          // same canonical host the origin allow-list emits, so the served URL
          // is reachable and its origin is allow-listed (matches the app banner).
          // One normalized value drives both the predicate and the value.
          const canonicalHost = canonicalUrlHost(host);
          const urlHost = isAllInterfacesHost(canonicalHost)
            ? "localhost"
            : canonicalHost;
          sandboxUrl = `http://${urlHost}:${actualPort}/sandbox`;
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
