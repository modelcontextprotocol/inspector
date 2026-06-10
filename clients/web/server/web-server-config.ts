/**
 * Config object for the web server (dev and prod). Passed in-process; no env handoff.
 */

import pino from "pino";
import type { Logger } from "pino";
import type { MCPServerConfig } from "../../../core/mcp/types.ts";
// Import directly from the leaf module — not the `core/mcp/remote/index.ts`
// barrel — so Vite's config-time module graph doesn't pull in `createRemoteLogger`
// (which references `pino/browser.js`) or other browser-side re-exports that
// have no business showing up in this Node-only file's import chain.
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "../../../core/mcp/remote/constants.ts";
import type { InitialConfigPayload } from "../../../core/mcp/remote/node/server.ts";
import { resolveSandboxPort } from "./sandbox-controller.js";

export interface WebServerConfig {
  port: number;
  hostname: string;
  authToken: string;
  dangerouslyOmitAuth: boolean;
  /** Single initial MCP server config, or null when no server specified. */
  initialMcpConfig: MCPServerConfig | null;
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
 * Convert WebServerConfig.initialMcpConfig to the shape expected by GET /api/config.
 */
export function webServerConfigToInitialPayload(
  config: WebServerConfig,
): InitialConfigPayload {
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
  const baseUrl = `http://${config.hostname}:${actualPort}`;
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

/**
 * Build WebServerConfig from process.env. Used when running server as standalone (e.g. node dist/server.js).
 */
export function buildWebServerConfigFromEnv(): WebServerConfig {
  const port = parseInt(process.env.CLIENT_PORT ?? "6274", 10);
  const hostname = process.env.HOST ?? "localhost";
  const baseUrl = `http://${hostname}:${port}`;
  const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;
  const authToken = dangerouslyOmitAuth
    ? ""
    : ((process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] as string | undefined) ??
      (process.env[LEGACY_AUTH_TOKEN_ENV] as string | undefined) ??
      "");

  const initialMcpConfig: MCPServerConfig | null = null;

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

  return {
    port,
    hostname,
    authToken,
    dangerouslyOmitAuth,
    initialMcpConfig,
    storageDir: process.env.MCP_STORAGE_DIR,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [
      baseUrl,
    ],
    sandboxPort,
    sandboxHost: hostname,
    logger,
    autoOpen: resolveAutoOpen(),
  };
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
