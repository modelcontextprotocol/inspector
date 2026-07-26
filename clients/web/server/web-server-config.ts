/**
 * Config object for the web server (dev and prod). Passed in-process; no env handoff.
 */

import pino from "pino";
import type { Logger } from "pino";
import type { MCPConfig, MCPServerConfig } from "../../../core/mcp/types.ts";
// Import directly from the leaf module — not the `core/mcp/remote/index.ts`
// barrel — so Vite's config-time module graph doesn't pull in `createRemoteLogger`
// (which references `pino/browser.js`) or other browser-side re-exports that
// have no business showing up in this Node-only file's import chain.
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "../../../core/mcp/remote/constants.ts";
import type { InitialConfigPayload } from "../../../core/mcp/remote/node/server.ts";
import { readInspectorVersionSafe } from "../../../core/node/version.ts";
import { resolveSandboxPort } from "./sandbox-controller.js";
import { resolveBindHostname } from "./resolve-bind-host.js";
import {
  canonicalUrlHost,
  isAllInterfacesHost,
} from "../../../core/node/hostUrl.ts";

// The single-source Inspector version (root package.json), read once at load.
// The browser can't read the filesystem the way the CLI/TUI do, so the backend
// reads it here and hands it to the client via GET /api/config. Uses the
// non-throwing read: the version is cosmetic, so a resolution failure hides the
// badge (version omitted from the payload) rather than crashing the backend.
const inspectorVersion = readInspectorVersionSafe(import.meta.url);

export interface WebServerConfig {
  port: number;
  hostname: string;
  authToken: string;
  dangerouslyOmitAuth: boolean;
  /** Single initial MCP server config, or null when no server specified. */
  initialMcpConfig: MCPServerConfig | null;
  /**
   * Absolute path to the `mcp.json` file the backend reads (and writes/watches
   * when {@link writable}). When undefined the backend falls back to the
   * default catalog (`~/.mcp-inspector/mcp.json`). Set by the launcher for
   * `--catalog <path>` (writable) or `--config <path>` (read-only session).
   * Mutually exclusive with {@link initialServers} (#1481).
   */
  mcpConfigPath: string | undefined;
  /**
   * When false, the server list is read-only for the session: the backend
   * rejects `/api/servers` mutations and never seeds/migrates the file, and
   * the web UI hides catalog CRUD. True for the default catalog and
   * `--catalog`; false for `--config` and ad-hoc launches (#1481).
   */
  writable: boolean;
  /**
   * In-memory server list served by the backend instead of reading a file —
   * set by the launcher to seed an ad-hoc `--server-url` / command target
   * (with `--header`) without writing any file. Implies `writable: false`.
   * Mutually exclusive with {@link mcpConfigPath} (#1481/#1483).
   */
  initialServers: MCPConfig | null;
  storageDir: string | undefined;
  allowedOrigins: string[];
  /** Sandbox port (0 = dynamic). */
  sandboxPort: number;
  sandboxHost: string;
  logger: Logger | undefined;
  /** When true, open browser after server starts. */
  autoOpen: boolean;
  /** Root directory for static files (index.html, assets). When runner starts server in-process, pass path to dist/. */
  staticRoot?: string;
}

function defaultEnvironmentFromProcess(
  extra?: Record<string, string>,
): Record<string, string> {
  const keys =
    process.platform === "win32"
      ? [
          "APPDATA",
          "HOMEDRIVE",
          "HOMEPATH",
          "LOCALAPPDATA",
          "PATH",
          "PROCESSOR_ARCHITECTURE",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "TEMP",
          "USERNAME",
          "USERPROFILE",
          "PROGRAMFILES",
        ]
      : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value && !value.startsWith("()")) {
      out[key] = value;
    }
  }
  if (extra) {
    Object.assign(out, extra);
  }
  return out;
}

/**
 * Convert WebServerConfig.initialMcpConfig to the shape expected by GET
 * /api/config, tagging on the single-source Inspector `version` so the browser
 * can display it.
 */
export function webServerConfigToInitialPayload(
  config: WebServerConfig,
): InitialConfigPayload {
  return { ...transportDefaults(config), version: inspectorVersion };
}

/** The transport-specific defaults half of the `/api/config` payload. */
function transportDefaults(config: WebServerConfig): InitialConfigPayload {
  const mc = config.initialMcpConfig;
  const defaultEnvironment = defaultEnvironmentFromProcess(
    mc && "env" in mc && mc.env ? mc.env : undefined,
  );

  if (!mc) {
    return { defaultEnvironment };
  }

  if (mc.type === "stdio" || mc.type === undefined) {
    return {
      defaultCommand: mc.command,
      defaultArgs: mc.args ?? [],
      defaultTransport: "stdio",
      defaultCwd: mc.cwd,
      defaultEnvironment,
    };
  }
  if (mc.type === "sse") {
    return {
      defaultTransport: "sse",
      defaultServerUrl: mc.url,
      defaultEnvironment,
    };
  }
  if (mc.type === "streamable-http") {
    return {
      defaultTransport: "streamable-http",
      defaultServerUrl: mc.url,
      defaultEnvironment,
    };
  }
  // Forward-compat fallback: if a future SDK ships a new transport type the
  // launcher hasn't taught us about yet, prefer streamable-http (the most
  // permissive shape with `url`) over throwing. Worst case the UI shows the
  // URL the user supplied; throwing here would deny the user a hint at
  // startup. Add a real branch above once the type is known.
  const c = mc as unknown as { url: string };
  return {
    defaultTransport: "streamable-http",
    defaultServerUrl: c.url,
    defaultEnvironment,
  };
}

export function printServerBanner(
  config: WebServerConfig,
  actualPort: number,
  resolvedToken: string,
  sandboxUrl: string | undefined,
): string {
  // Advertise `localhost` for a wildcard bind (`http://0.0.0.0:PORT` is an
  // awkward URL to click and points the user at a reachable, allow-listed
  // address); otherwise use the SAME canonical host the allow-list emits, so the
  // advertised URL's origin is always a member of `allowedOrigins`
  // (`banner ⊆ allowedOrigins`) — including the IPv4-mapped case where
  // `canonicalUrlHost` unmaps but `formatHostForUrl` wouldn't. `httpOrigin`
  // keeps the banner and the list agreeing on the default-port form (both drop
  // :80). Computing `h` once keeps the predicate and the value reading the same
  // form; `isAllInterfacesHost` also canonicalizes internally, so this is
  // belt-and-braces, not what makes them agree.
  const h = canonicalUrlHost(config.hostname);
  const bannerHost = isAllInterfacesHost(h) ? "localhost" : h;
  const baseUrl = httpOrigin(bannerHost, actualPort);
  const url =
    config.dangerouslyOmitAuth || !resolvedToken
      ? baseUrl
      : `${baseUrl}?${API_SERVER_ENV_VARS.AUTH_TOKEN}=${resolvedToken}`;

  console.log(`\nMCP Inspector Web is up and running at:\n   ${url}\n`);
  if (sandboxUrl) {
    console.log(`   Sandbox (MCP Apps): ${sandboxUrl}\n`);
  }
  if (config.dangerouslyOmitAuth) {
    console.log("   Auth: disabled (DANGEROUSLY_OMIT_AUTH)\n");
  } else {
    console.log(`   Auth token: ${resolvedToken}\n`);
  }

  if (config.autoOpen) {
    console.log("Opening browser...");
  }

  return url;
}

export interface BuildWebServerConfigOptions {
  initialMcpConfig?: MCPServerConfig | null;
  /** Catalog/session file the backend should serve; see {@link WebServerConfig.mcpConfigPath}. */
  mcpConfigPath?: string;
  /** Read-only when false; see {@link WebServerConfig.writable}. Defaults to true. */
  writable?: boolean;
  /** In-memory ad-hoc list; see {@link WebServerConfig.initialServers}. */
  initialServers?: MCPConfig | null;
}

/**
 * Loopback hostnames that all address the local machine. `localhost` resolves
 * to *either* `127.0.0.1` (IPv4) or `::1` (IPv6) depending on the OS resolver,
 * and Node/Vite may bind the IPv6 form — so the browser can legitimately end up
 * at `http://[::1]:PORT` even though the banner printed `http://localhost:PORT`.
 * IPv6 is the **bracketed** form only (`[::1]`): the sole caller looks up
 * `canonicalUrlHost(hostname)`, which always brackets an IPv6 literal.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Build an http origin string. The port is omitted when it's the http scheme
 * default (80): browsers drop the default port from `Origin`, and the guard is
 * an exact string match, so `http://host:80` could never match a real request.
 */
function httpOrigin(host: string, port: number): string {
  return port === 80 ? `http://${host}` : `http://${host}:${port}`;
}

/** The three interchangeable loopback origin forms for a port. */
function loopbackOrigins(port: number): string[] {
  return [
    httpOrigin("localhost", port),
    httpOrigin("127.0.0.1", port),
    httpOrigin("[::1]", port),
  ];
}

/**
 * The default allowed-origins list for a given bind host/port.
 *
 * When the bind host is loopback, `localhost`, `127.0.0.1`, and `[::1]` are
 * interchangeable ways to reach the same server, so the origin the browser
 * actually sends is nondeterministic (it depends on how `localhost` resolved
 * and which family got bound). Returning all three loopback origin forms keeps
 * the DNS-rebinding guard effective — still scoped to loopback at this exact
 * port — while not 403-ing a browser that landed on `[::1]` instead of the
 * `localhost` the banner advertised. The host is canonicalized first
 * ({@link canonicalUrlHost}), so a non-canonical spelling of a loopback address
 * still lands in the loopback branch.
 *
 * An **all-interfaces** bind (`0.0.0.0` / `::`, the opt-in path the Docker image
 * uses) also serves loopback, so it gets the loopback trio *plus the canonical
 * wildcard origins* `http://0.0.0.0:PORT` and `http://[::]:PORT`. Both are
 * locally connectable, the image/docs describe binding to `0.0.0.0:6274`, and a
 * dual-stack `::` bind serves IPv4 too — so a browser may send either. We emit
 * the **canonical** pair rather than the typed `HOST` spelling because browsers
 * canonicalize the address before building the `Origin` (`HOST=0` / `0x0` /
 * `0.0.0` all send `http://0.0.0.0:PORT`, `::0` sends `http://[::]:PORT`), so
 * echoing the raw spelling would emit an entry the browser can never match.
 * Including these weakens nothing (no attacker document can claim a loopback /
 * `0.0.0.0` origin without the user having navigated there). Reaching the server
 * at a non-loopback address — a LAN IP, a public hostname — still needs
 * `ALLOWED_ORIGINS`, since those origins can't be enumerated from the wildcard.
 *
 * For a specific non-loopback host (a real IP/hostname) we return the single
 * exact origin — canonicalized and, for an IPv6 literal, bracketed, so it
 * matches the `Origin` header the browser actually sends.
 */
export function defaultAllowedOrigins(
  hostname: string,
  port: number,
): string[] {
  // The loopback lookup and the emitted origin both read the canonicalized `h`
  // (the wildcard check via `isAllInterfacesHost` canonicalizes internally), so
  // every branch reasons about the same address.
  const h = canonicalUrlHost(hostname);
  if (LOOPBACK_HOSTNAMES.has(h)) {
    return loopbackOrigins(port);
  }
  if (isAllInterfacesHost(h)) {
    return [
      ...loopbackOrigins(port),
      httpOrigin("0.0.0.0", port),
      httpOrigin("[::]", port),
    ];
  }
  // `h` is already the canonical, URL-ready host (bracketed for IPv6).
  return [httpOrigin(h, port)];
}

/**
 * Build WebServerConfig from process.env and optional initial MCP server config.
 * Used by the launcher runner, Vite dev (`buildWebServerConfigFromEnv`), and prod standalone.
 */
export function buildWebServerConfig(
  options: BuildWebServerConfigOptions = {},
): WebServerConfig {
  const {
    initialMcpConfig = null,
    mcpConfigPath,
    writable = true,
    initialServers = null,
  } = options;
  // Treat an empty CLIENT_PORT as unset (matches resolveSandboxPort's handling
  // of MCP_SANDBOX_PORT / SERVER_PORT), then require a fixed port: the origin
  // allow-list and the sandbox CSP are both built from it, so `0` (OS-assigned),
  // a non-numeric value, or trailing garbage would make them reference a port
  // the server isn't on — every connect 403s and the MCP Apps iframe is blocked.
  // The `^\d+$` test rejects `parseInt`'s partial parses (`6274abc`, `80.9`).
  // Fail fast with an actionable message (run-web surfaces it cleanly).
  const rawPort = process.env.CLIENT_PORT?.trim() || "6274";
  const port = parseInt(rawPort, 10);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid CLIENT_PORT="${process.env.CLIENT_PORT}": the web server needs a fixed port in 1–65535 (0 / dynamic is unsupported — the origin allow-list and sandbox CSP are derived from it).`,
    );
  }
  const hostname = resolveBindHostname();
  const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;
  const authToken = dangerouslyOmitAuth
    ? ""
    : ((process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] as string | undefined) ??
      (process.env[LEGACY_AUTH_TOKEN_ENV] as string | undefined) ??
      "");

  const sandboxPort = resolveSandboxPort();

  let logger: Logger | undefined;
  if (process.env.MCP_LOG_FILE) {
    logger = pino(
      { level: "info" },
      pino.destination({
        dest: process.env.MCP_LOG_FILE,
        append: true,
        mkdir: true,
      }),
    );
  }

  // Parse ALLOWED_ORIGINS into canonical origins. Each entry is normalized via
  // `new URL(o).origin` (drops a trailing slash/path and any userinfo, lowercases
  // and punycodes the host, drops the default :80) so the natural copy-paste
  // forms — `http://localhost:6274/` from the address bar, an uppercase or IDN
  // host, an explicit `:80` — match the canonical `Origin` the browser sends
  // rather than 403ing on an exact-string compare. Unparseable, opaque, and
  // wildcard entries are warned and dropped (see inline).
  //
  // When nothing survives (unset, `""`, `" "`, `","`, or all-invalid) we fall
  // back to `defaultAllowedOrigins` below — critically NOT to `[]`, which the
  // origin middleware treats as *allow-all*, silently disabling the guard.
  const configuredOrigins = process.env.ALLOWED_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => {
      try {
        const { origin } = new URL(o);
        // A scheme-less entry (`localhost:6274`) doesn't throw — `new URL` reads
        // the host as the scheme and `.origin` is the literal string "null"
        // (also non-special schemes: `file:`, `about:`, `javascript:`, `data:`,
        // and browser-extension schemes like `chrome-extension:`). Reject it:
        // it's not the origin the user meant, AND "null" is a real header value
        // browsers send from opaque origins (a sandboxed iframe, a `data:` doc),
        // so allow-listing it would erode the guard. Only http(s)/ws(s) origins
        // are supported (the app is served over http(s)); entries need a scheme.
        if (origin === "null") throw new Error("opaque origin");
        // A wildcard (`http://*.example.com`) survives `new URL` but can never
        // match the exact-compare origin guard — yet `*.example.com` IS a legal
        // CSP host-source, so it would silently work for the sandbox iframe and
        // silently 403 every connect (the most confusing split). Reject it so it
        // fails loudly and consistently; list exact origins instead.
        if (origin.includes("*")) throw new Error("wildcard origin");
        return origin;
      } catch {
        console.warn(`Ignoring invalid ALLOWED_ORIGINS entry: ${o}`);
        return null;
      }
    })
    .filter((o): o is string => o !== null);

  return {
    port,
    hostname,
    authToken,
    dangerouslyOmitAuth,
    initialMcpConfig,
    mcpConfigPath,
    writable,
    initialServers,
    storageDir: process.env.MCP_STORAGE_DIR,
    allowedOrigins: configuredOrigins?.length
      ? configuredOrigins
      : defaultAllowedOrigins(hostname, port),
    sandboxPort,
    sandboxHost: hostname,
    logger,
    autoOpen: resolveAutoOpen(),
  };
}

/**
 * Build WebServerConfig from process.env only. Used by `vite dev` (the Hono dev plugin reads env, not argv).
 */
export function buildWebServerConfigFromEnv(): WebServerConfig {
  return buildWebServerConfig({ initialMcpConfig: null });
}

/**
 * Three-way resolution for `autoOpen`:
 *   - explicit `MCP_AUTO_OPEN_ENABLED=true`  → always open (overrides VITEST)
 *   - explicit `MCP_AUTO_OPEN_ENABLED=false` → never open
 *   - anything else                          → open by default UNLESS Vitest
 *     is running (Vitest sets `VITEST=true`; vite.config.ts is shared with
 *     vitest projects and the Hono plugin would otherwise shell out to
 *     `open()` on every test invocation).
 */
function resolveAutoOpen(): boolean {
  const flag = process.env.MCP_AUTO_OPEN_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return !process.env.VITEST;
}
