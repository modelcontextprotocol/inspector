/**
 * App-origin server: the dedicated origin an MCP App gets when its UI resource
 * declares `_meta.ui.domain` (#2056).
 *
 * ## Why a third listener exists
 *
 * By default the Inspector renders an App by handing its HTML to the sandbox
 * proxy as `srcdoc`, in an iframe sandboxed **without** `allow-same-origin`.
 * That is the isolation model #1565 chose, and it is the right default — but it
 * gives the app document an *opaque* origin, so every request it makes carries
 * `Origin: null`. An app whose backend allowlists origins (CORS, an OAuth
 * callback, an API-key allowlist) therefore cannot work, which is exactly what
 * `_meta.ui.domain` exists to solve: the spec lets a server ask its host for a
 * stable, dedicated origin.
 *
 * `domain` is explicitly **host-dependent** — "the format and validation rules
 * for this field are determined by each host" — and the Inspector owns no
 * domain infrastructure. What it *can* provide is a real, stable HTTP origin on
 * loopback. So a UI resource that declares any non-empty `domain` opts into
 * being served from this listener instead of `srcdoc`, and its requests carry a
 * real `Origin: http://<host>:<port>`.
 *
 * ## One shared origin, not one per domain
 *
 * Every domain-declaring app is served from this single port, path-keyed by an
 * unguessable document id. That is a deliberate trade: it delivers the property
 * the spec field is *for* (a real, allowlistable origin) without minting a port
 * — or a DNS name — per app. The consequence is that this origin is **not** a
 * per-app isolation boundary: two apps served here share `localStorage`,
 * `sessionStorage`, and cookies for it.
 *
 * ## What the separate port does and does not isolate
 *
 * A distinct port makes a distinct **origin**, so the usual origin-scoped
 * surfaces are isolated from the sandbox proxy and from the Inspector page:
 * DOM and scripting access, `localStorage`, `sessionStorage`, IndexedDB.
 *
 * **Cookies are the exception, and they are not isolated.** Cookies are scoped
 * by host (and path), not by port — so an app served here shares the
 * `127.0.0.1` cookie jar with the Inspector on `6274` and with every other
 * service on loopback. It can read any non-`HttpOnly` cookie set for that host
 * and set `Path=/` cookies those services will receive.
 *
 * That is a real caveat, but it is not a hole in the Inspector's own auth: the
 * API token travels in the `x-mcp-remote-auth` header and is held in a
 * `window` global and `sessionStorage`, both of which a different origin
 * cannot read. Closing the cookie gap properly needs a distinct *host*, which
 * this listener cannot mint — the Inspector owns no DNS, and a second loopback
 * address is not portable. So it is documented rather than papered over; do
 * not run the Inspector beside a loopback service whose session cookie you
 * would not hand to an app under test.
 *
 * ## Why granting `allow-same-origin` here is not a regression
 *
 * The inner frame is sandboxed with `allow-same-origin` only on this path,
 * which is what makes the origin real rather than opaque. The #1565 rationale —
 * "the app cannot touch the proxy's DOM, so it cannot bypass its own CSP by
 * executing in the parent's realm" — still holds, because this listener is on
 * its own port and is therefore cross-origin to both the proxy and the app
 * page. Same-origin policy blocks the reach either way.
 *
 * The per-app CSP is additionally delivered as a real response **header** here,
 * which is stronger than the `<meta>` the `srcdoc` path must rely on: a header
 * applies to the document before any of its bytes are parsed and cannot be
 * displaced by anything in the app's own markup.
 */

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import {
  canonicalUrlHost,
  isAllInterfacesHost,
} from "../../../core/node/hostUrl.ts";
import { DEFAULT_BIND_HOST } from "./resolve-bind-host.js";
import { frameAncestorsDirective } from "./sandbox-controller.js";

/**
 * The default app-origin listen port — **fixed**, for the same reason
 * `DEFAULT_SANDBOX_PORT` is: a port that changes per run can never be named in
 * a dev container's `forwardPorts`, a `docker run -p`, or an SSH tunnel.
 *
 * **Not 6276, and not 6277.** `6276` is already taken, by the fixed loopback
 * OAuth callback the CLI and TUI listen on
 * (`RUNNER_OAUTH_CALLBACK_DEFAULT_PORT`) — fixed precisely so an OAuth app can
 * pre-register `http://127.0.0.1:6276/oauth/callback`, which means it is the
 * one port here that CANNOT move when something else takes it first. Binding it
 * would let a running `--web` (started at login, holding the port) break a
 * later `--cli`/`--tui` OAuth flow at its registered redirect URI — and the
 * handoff recipe in `docs/mcp-app-review.md` has those two running side by
 * side. Of the two listeners this listener is the one with a documented
 * dynamic fallback, so it is the one that yields. `6277` is skipped because it
 * was v1's MCP proxy port, which the migration guide tells people to stop
 * forwarding; reusing it would make that instruction wrong.
 */
export const DEFAULT_APP_ORIGIN_PORT = 6278;

/** Documents kept at once. Oldest is evicted past this; see {@link publish}. */
const MAX_DOCUMENTS = 32;

/**
 * Total retained document size, in UTF-16 code units, across every live entry.
 *
 * {@link MAX_DOCUMENTS} alone bounds the *count*, and the route admits up to
 * 8Mi code units per document — so the count bound permits ~256Mi retained for
 * a full hour, enough to OOM a memory-limited Inspector on documents a server
 * chose the size of. Both bounds apply; whichever binds first evicts.
 *
 * 64Mi is roughly a full complement of ordinary widgets (a real app document is
 * tens to hundreds of KiB) or a couple of pathological ones. An app large
 * enough to evict its predecessors still renders — the frame fetches its `src`
 * immediately, long before anything could push it out.
 */
const MAX_RETAINED_CHARS = 64 * 1024 * 1024;

/**
 * How long a published document stays fetchable. An iframe fetches its `src`
 * once, so this only has to outlive the gap between publishing and the frame
 * loading — but a generous window keeps a reload (React StrictMode, a devtools
 * "reload frame") working rather than blanking the app.
 */
const DOCUMENT_TTL_MS = 60 * 60 * 1000;

/**
 * The origins that may appear in a published document's ancestor chain, for
 * {@link AppOriginControllerOptions.embedderOrigins}.
 *
 * There are **two**, and getting this wrong blocks the frame outright: CSP's
 * `frame-ancestors` is checked against *every* ancestor, not just the immediate
 * parent. A published document is framed by the sandbox proxy, which is itself
 * framed by the Inspector app page — so the directive has to admit the proxy's
 * origin **and** the app's, which is exactly the backend's origin allow-list.
 *
 * `undefined` when neither is known, which makes the directive fall back to the
 * loopback family rather than to `'none'`.
 */
export function appDocumentEmbedders(
  sandboxUrl: string | null | undefined,
  allowedOrigins?: string[],
): string[] | undefined {
  const origins: string[] = [];
  if (sandboxUrl) {
    try {
      origins.push(new URL(sandboxUrl).origin);
    } catch {
      /* v8 ignore next -- the sandbox controller only ever emits a URL it built
         itself; an unparseable value would be a bug there, not input. */
    }
  }
  origins.push(...(allowedOrigins ?? []));
  return origins.length > 0 ? origins : undefined;
}

export interface AppOriginControllerOptions {
  /** Port to bind (0 = dynamic). */
  port: number;
  /** Host to bind (default {@link DEFAULT_BIND_HOST}). */
  host?: string;
  /**
   * The origin(s) allowed to frame a published document — in practice the
   * sandbox proxy's own origin, since the proxy is what embeds the inner
   * iframe. Malformed entries are dropped and an empty result falls back to
   * loopback, exactly as the sandbox proxy's own `frame-ancestors` does.
   */
  embedderOrigins?: string[];
}

/** A document handed to {@link AppOriginController.publish}. */
export interface AppDocument {
  /** The fully-wrapped HTML the sandbox would otherwise have received. */
  html: string;
  /** The per-app CSP policy string, delivered as a response header. */
  csp?: string;
}

export interface AppOriginController {
  start(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
  /** The origin this listener serves on, or null when it never bound. */
  getOrigin(): string | null;
  /**
   * Store a document and return the absolute URL the sandbox proxy should load
   * it from, or `null` when this listener isn't running (the caller then falls
   * back to the default `srcdoc` path rather than failing the render).
   */
  publish(doc: AppDocument): { url: string } | null;
}

/**
 * A usable listen port from a raw env value, or `undefined` if it isn't a plain
 * integer in `0`–`65535`. Mirrors `sandbox-controller`'s parser: `^\d+$` rejects
 * `parseInt`'s partial parses (`6278abc`) and the bound keeps an out-of-range
 * value from reaching `server.listen`, which throws synchronously.
 */
function parseListenPort(raw: string | undefined): number | undefined {
  const v = raw?.trim();
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = parseInt(v, 10);
  return n <= 65535 ? n : undefined;
}

/**
 * Resolve the app-origin port from env: `MCP_APP_ORIGIN_PORT` →
 * {@link DEFAULT_APP_ORIGIN_PORT}. A set-but-invalid value is warned and falls
 * through rather than crashing the boot, matching `resolveSandboxPort`.
 */
export function resolveAppOriginPort(): number {
  const parsed = parseListenPort(process.env.MCP_APP_ORIGIN_PORT);
  if (parsed === undefined && process.env.MCP_APP_ORIGIN_PORT?.trim()) {
    console.warn(
      `Ignoring invalid MCP_APP_ORIGIN_PORT="${process.env.MCP_APP_ORIGIN_PORT}" (need an integer 0–65535); falling back.`,
    );
  }
  return parsed ?? DEFAULT_APP_ORIGIN_PORT;
}

/** The path a published document is served at, given its id. */
const DOC_PATH_PREFIX = "/app-document/";

/** `/app-document/<id>` → `<id>`, or null for any other request target. */
export function parseDocumentId(url: string | undefined): string | null {
  if (!url || !url.startsWith(DOC_PATH_PREFIX)) return null;
  // Drop a query string: an app's own URL may carry one and it is not part of
  // the id. Anything with a further path segment is not a document target.
  const id = url.slice(DOC_PATH_PREFIX.length).split(/[?#]/)[0];
  return /^[0-9a-f]{32}$/.test(id ?? "") ? (id ?? null) : null;
}

interface StoredDocument extends AppDocument {
  expiresAt: number;
  /** Retained size in UTF-16 code units, against {@link MAX_RETAINED_CHARS}. */
  size: number;
}

export function createAppOriginController(
  options: AppOriginControllerOptions,
): AppOriginController {
  // Same defaulting rationale as the sandbox controller: never the *name*
  // `localhost`, which resolves to a single address family and would put this
  // listener on a different family than the web server (#1951).
  const { port, host = DEFAULT_BIND_HOST, embedderOrigins } = options;
  let server: Server | null = null;
  let origin: string | null = null;

  // Insertion-ordered, so the first key is the oldest entry.
  const documents = new Map<string, StoredDocument>();
  // Running sum of every live entry's `size`, kept in step with the map on
  // every insert and every delete. Tracked rather than recomputed: eviction
  // runs per publish and summing the map there would be O(n) on a hot path.
  let retainedChars = 0;

  /** The single removal seam, so the running total cannot drift from the map. */
  function drop(id: string): void {
    const doc = documents.get(id);
    if (!doc) return;
    retainedChars -= doc.size;
    documents.delete(id);
  }

  const FRAME_ANCESTORS = frameAncestorsDirective(embedderOrigins);

  /** Drop everything past its TTL. Cheap: the map is bounded by MAX_DOCUMENTS. */
  function evictExpired(now: number): void {
    for (const [id, doc] of documents) {
      if (doc.expiresAt <= now) drop(id);
    }
  }

  return {
    async start(): Promise<{ port: number; url: string }> {
      if (server && origin) {
        return { port: parseInt(new URL(origin).port, 10), url: origin };
      }
      return new Promise((resolve) => {
        let settled = false;
        const settle = (value: { port: number; url: string }) => {
          /* v8 ignore next -- defensive double-settle guard: `error` and
             `listening` are mutually exclusive for a TCP listen. */
          if (settled) return;
          settled = true;
          resolve(value);
        };

        server = createServer((req, res) => {
          const id = req.method === "GET" ? parseDocumentId(req.url) : null;
          const doc = id ? documents.get(id) : undefined;
          if (!doc || doc.expiresAt <= Date.now()) {
            if (id) drop(id);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
            // `nosniff` matters more here than on a page we authored: these
            // bytes are server-supplied and untrusted.
            "X-Content-Type-Options": "nosniff",
            // The per-app policy as a real header. It is the same policy baked
            // into the document's <meta>; delivering both is deliberate —
            // multiple policies intersect, and two copies of one policy
            // intersect to itself, so this can only ever be at least as strict.
            "Content-Security-Policy": doc.csp
              ? `${doc.csp}; ${FRAME_ANCESTORS}`
              : FRAME_ANCESTORS,
          });
          res.end(doc.html);
        });

        // Same fallback as the sandbox controller: a fixed default port can
        // collide (a second Inspector), and losing the listener would take
        // dedicated-origin rendering down. Retry once on an OS-assigned port,
        // loudly — whoever pinned the port to forward it needs to know.
        let retriedDynamic = false;
        server.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            if (!retriedDynamic && port !== 0) {
              retriedDynamic = true;
              console.warn(
                `App origin: port ${port} in use; falling back to an OS-assigned port. ` +
                  `Apps declaring _meta.ui.domain will still render, but the origin ` +
                  `they are served from is no longer predictable — set ` +
                  `MCP_APP_ORIGIN_PORT to a free one if your app's backend ` +
                  `allowlists it.`,
              );
              server!.listen(0, host);
              return;
            }
            console.error(
              `App origin: port ${port || "dynamic"} in use. Apps declaring _meta.ui.domain will fall back to an opaque origin.`,
            );
          } else {
            console.error("App origin server error:", err);
          }
          // Degrade rather than reject: `publish` then returns null and the
          // renderer keeps working on the default srcdoc path. Clearing
          // `origin` is what makes that true — `publish` gates on it, not on
          // `server`, so an error arriving AFTER a successful listen would
          // otherwise keep minting URLs on a dead listener and the browser
          // would never take the promised fallback. Dropping the documents
          // with it releases their memory, since nothing can fetch them now.
          server = null;
          origin = null;
          documents.clear();
          retainedChars = 0;
          settle({ port: 0, url: "" });
        });

        server.listen(port, host, () => {
          const addr = server!.address();
          /* v8 ignore next 4 -- unreachable for a TCP listen: inside the
             `listening` callback `address()` returns an AddressInfo. The guard
             is a narrowing for the string (pipe/socket) and null members of the
             return type, not a case this listener can produce. */
          if (typeof addr !== "object" || addr === null) {
            settle({ port: 0, url: "" });
            return;
          }
          const actualPort = addr.port;
          // A wildcard bind isn't reachable as `http://0.0.0.0:PORT`, but it
          // does serve loopback — advertise `localhost` there, and otherwise
          // the same canonical host the origin allow-list emits.
          const canonicalHost = canonicalUrlHost(host);
          const urlHost = isAllInterfacesHost(canonicalHost)
            ? "localhost"
            : canonicalHost;
          origin = `http://${urlHost}:${actualPort}`;
          settle({ port: actualPort, url: origin });
        });
      });
    },

    async close(): Promise<void> {
      documents.clear();
      retainedChars = 0;
      if (!server) return;
      return new Promise((resolve) => {
        server!.close(() => {
          server = null;
          origin = null;
          resolve();
        });
      });
    },

    getOrigin(): string | null {
      return origin;
    },

    publish(doc: AppDocument): { url: string } | null {
      if (!origin) return null;
      const now = Date.now();
      evictExpired(now);
      const size = doc.html.length + (doc.csp?.length ?? 0);
      // Bound the store even if nothing has expired: drop oldest-first until
      // BOTH the count and the retained-size budget have room. An evicted
      // document's frame has long since loaded, and the alternative is a store
      // fed — in count and in bytes — by whatever the servers under test send.
      while (
        documents.size >= MAX_DOCUMENTS ||
        (documents.size > 0 && retainedChars + size > MAX_RETAINED_CHARS)
      ) {
        const oldest = documents.keys().next();
        /* v8 ignore next -- both loop conditions require a non-empty map. */
        if (oldest.done) break;
        drop(oldest.value);
      }
      const id = randomBytes(16).toString("hex");
      documents.set(id, { ...doc, expiresAt: now + DOCUMENT_TTL_MS, size });
      retainedChars += size;
      return { url: `${origin}${DOC_PATH_PREFIX}${id}` };
    },
  };
}
