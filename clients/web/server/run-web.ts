/**
 * Programmatic entry for the launcher and published `mcp-inspector --web`.
 * Day-to-day dev still uses `npm run dev` (Vite CLI + buildWebServerConfigFromEnv).
 * Prod (`--web`, no `--dev`) starts the Hono server in-process via `startHonoServer`.
 */

import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type {
  MCPConfig,
  MCPServerConfig,
  ServerProtocolEra,
  StoredMCPServer,
} from "../../../core/mcp/types.ts";
import {
  resolveServerConfigs,
  parseKeyValuePair,
  parseHeaderPair,
  parseProtocolEra,
  type ServerConfigOptions,
} from "../../../core/mcp/node/config.ts";
import {
  buildWebServerConfig,
  type WebServerConfig,
} from "./web-server-config.js";
import { startViteDevServer } from "./start-vite-dev-server.js";
import { startHonoServer } from "./server.js";
import { ensureWebBuild } from "./ensure-web-build.js";
import { readInspectorVersionSafe } from "../../../core/node/version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureStdioCwd(config: MCPServerConfig): MCPServerConfig {
  if (
    (config.type === "stdio" || config.type === undefined) &&
    config.command &&
    !config.cwd
  ) {
    return { ...config, cwd: resolve(process.cwd()) };
  }
  return config;
}

/**
 * Derive a readable catalog id for an ad-hoc server seeded from CLI flags:
 * the URL host for HTTP/SSE, or the command basename for stdio. Falls back to
 * "server" so the id is always a non-empty `mcpServers` map key.
 */
function deriveSeedServerId(config: MCPServerConfig): string {
  if (config.type === "sse" || config.type === "streamable-http") {
    try {
      return new URL(config.url).host || "server";
    } catch {
      return "server";
    }
  }
  return config.command?.split(/[\\/]/).pop() || "server";
}

export async function runWeb(argv: string[]): Promise<number> {
  const program = new Command();

  const argSeparatorIndex = argv.indexOf("--");
  let preArgs = argv;
  let postArgs: string[] = [];
  if (argSeparatorIndex !== -1) {
    preArgs = argv.slice(0, argSeparatorIndex);
    postArgs = argv.slice(argSeparatorIndex + 1);
  }

  program
    .name("mcp-inspector-web")
    .description("Web UI for MCP Inspector")
    // Prints the root package version and exits before any server binds — the
    // web mode is the launcher's default, so a bare `mcp-inspector --version`
    // lands here (#2632). The safe reader matches web-server-config.ts: an
    // unresolvable manifest must not take startup down.
    .version(
      readInspectorVersionSafe(import.meta.url) ?? "unknown",
      "-V, --version",
      "Print the Inspector version",
    )
    .allowExcessArguments()
    .allowUnknownOption()
    .option(
      "-e <env>",
      "environment variables in KEY=VALUE format",
      parseKeyValuePair,
      {},
    )
    .option("--catalog <path>", "writable catalog file path")
    .option("--config <path>", "read-only session config file path")
    .option("--server <name>", "server name from config file")
    .option("--transport <type>", "transport type (stdio, sse, http)")
    .option("--server-url <url>", "server URL for SSE/HTTP transport")
    .option("--cwd <path>", "working directory for stdio server process")
    .option(
      "--header <headers...>",
      'HTTP headers as "HeaderName: Value" pairs (for HTTP/SSE transports)',
      parseHeaderPair,
      {},
    )
    .option(
      "--protocol-era <era>",
      "protocol era for the ad-hoc server: legacy, auto, or modern (default legacy)",
      parseProtocolEra,
    )
    .option("--dev", "run in development mode (Vite)")
    .parse(preArgs);

  const opts = program.opts() as {
    catalog?: string;
    config?: string;
    server?: string;
    e?: Record<string, string>;
    transport?: string;
    serverUrl?: string;
    cwd?: string;
    header?: Record<string, string>;
    protocolEra?: ServerProtocolEra;
    dev?: boolean;
  };

  const args = program.args;
  const target = [...args, ...postArgs];
  const isDev = !!opts.dev;

  // Catalog source for the web backend (spec: v2_catalog_launch_config.md):
  //  - `--catalog <path>` / MCP_CATALOG_PATH → that file is the active WRITABLE
  //    catalog (CRUD, seed-if-missing, file-watch) — like the default catalog.
  //  - `--config <path>` → a READ-ONLY session file: shown in the UI but never
  //    written, seeded, or migrated (so a foreign config is safe to point at).
  //  - ad-hoc `--server-url` / command target → a one-server READ-ONLY session
  //    held in memory (no file written), with `--header` lifted onto the entry
  //    so the seeded connection actually uses those headers (#1483).
  //  - nothing → default catalog (writable), backend uses its default path.
  // `initialMcpConfig` stays populated for the ad-hoc case only so the legacy
  // GET /api/config defaults survive; the catalog path / in-memory list is what
  // the UI's server list actually reads.
  const catalogPath = opts.catalog ?? process.env.MCP_CATALOG_PATH;
  const hasCatalog = !!catalogPath;
  const hasConfig = !!opts.config;
  const hasHeaders = !!opts.header && Object.keys(opts.header).length > 0;
  // Like `--header`, web applies `--protocol-era` only to an ad-hoc server: a
  // catalog/config entry carries its own `protocolEra`, editable in Server
  // Settings, and web never overlays launch flags onto a file's settings.
  const hasProtocolEra = opts.protocolEra !== undefined;
  const hasAdHocServer =
    target.length > 0 ||
    !!opts.serverUrl ||
    (!!opts.transport && opts.transport !== "stdio");

  // Reject illegal flag combinations up front so each branch below is clean.
  const conflict =
    hasCatalog && hasConfig
      ? "--catalog and --config are mutually exclusive. --catalog is the writable catalog; --config is a read-only session file."
      : hasCatalog && hasAdHocServer
        ? "--catalog cannot be combined with an ad-hoc server URL/command."
        : hasCatalog && hasHeaders
          ? "--header cannot be combined with --catalog. Set per-server headers in the catalog file."
          : hasCatalog && hasProtocolEra
            ? "--protocol-era cannot be combined with --catalog. Set protocolEra per server in the catalog file."
            : hasConfig && hasAdHocServer
              ? "--config cannot be combined with an ad-hoc server URL/command. --config selects a read-only session file."
              : hasConfig && hasHeaders
                ? "--header cannot be combined with --config. Set per-server headers inside the config file instead."
                : hasConfig && hasProtocolEra
                  ? "--protocol-era cannot be combined with --config. Set protocolEra per server inside the config file instead."
                  : null;
  if (conflict) {
    console.error(`Error: ${conflict}`);
    process.exit(1);
  }

  let initialMcpConfig: MCPServerConfig | null = null;
  let mcpConfigPath: string | undefined;
  let writable = true;
  let initialServers: MCPConfig | null = null;

  if (hasCatalog) {
    if (opts.server) {
      console.warn(
        "Note: --server has no effect on the web UI yet; it lists every server in the catalog.",
      );
    }
    // A writable catalog may not exist yet — the backend seeds it on first
    // read, exactly like the default catalog — so we don't pre-validate it.
    mcpConfigPath = resolve(process.cwd(), catalogPath!);
    writable = true;
  } else if (hasConfig) {
    if (opts.server) {
      console.warn(
        "Note: --server has no effect on the web UI yet; it lists every server in the file.",
      );
    }
    const resolvedConfigPath = resolve(process.cwd(), opts.config!);
    try {
      // Validate the file loads (and exists) before serving it: a read-only
      // session never seeds, so a typo'd path would otherwise show a silently
      // empty server list instead of a clear error.
      resolveServerConfigs({ configPath: resolvedConfigPath }, "multi");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not load config file.";
      console.error("Error:", message);
      process.exit(1);
    }
    mcpConfigPath = resolvedConfigPath;
    writable = false;
  } else if (hasAdHocServer) {
    let config: MCPServerConfig;
    try {
      const serverOptions: ServerConfigOptions = {
        serverName: opts.server,
        target: target.length > 0 ? target : undefined,
        transport: opts.transport as "stdio" | "sse" | "http" | undefined,
        serverUrl: opts.serverUrl,
        cwd: opts.cwd,
        env: opts.e,
      };
      const resolved = resolveServerConfigs(serverOptions, "single")[0];
      if (!resolved) {
        console.error(
          "Error: Could not resolve server config. Pass a command/URL, or use --catalog / --config to serve a file.",
        );
        process.exit(1);
      }
      config = ensureStdioCwd(resolved);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not resolve server config.";
      console.error("Error:", message);
      process.exit(1);
    }

    if (hasHeaders && (config.type === "stdio" || config.type === undefined)) {
      console.error(
        "Error: --header only applies to HTTP/SSE servers; stdio servers take no HTTP headers.",
      );
      process.exit(1);
    }

    initialMcpConfig = config;

    // In-memory session entry: the SDK config plus the flat `headers` record
    // and `protocolEra`, which the backend lifts into `settings` on read.
    // Nothing is written to disk — the ad-hoc server is a read-only session
    // list. The era is transport-agnostic, so unlike `--header` it applies to
    // stdio too.
    const entry: StoredMCPServer =
      hasHeaders && config.type !== "stdio" && config.type !== undefined
        ? { ...config, headers: opts.header }
        : { ...config };
    if (opts.protocolEra !== undefined) {
      entry.protocolEra = opts.protocolEra;
    }
    initialServers = {
      mcpServers: { [deriveSeedServerId(config)]: entry },
    };
    writable = false;
  } else if (hasHeaders) {
    console.error(
      "Error: --header requires an ad-hoc --server-url or command target.",
    );
    process.exit(1);
  } else if (hasProtocolEra) {
    console.error(
      "Error: --protocol-era requires an ad-hoc --server-url or command target.",
    );
    process.exit(1);
  }

  let webConfig: WebServerConfig;
  try {
    webConfig = buildWebServerConfig({
      initialMcpConfig,
      mcpConfigPath,
      writable,
      initialServers,
    });
  } catch (err) {
    // e.g. the bind-host guard refusing HOST=0.0.0.0 — surface the actionable
    // message rather than a raw stack trace from the launcher's top-level handler.
    const message =
      err instanceof Error
        ? err.message
        : /* v8 ignore next -- buildWebServerConfig only ever throws Error instances; this fallback is a defensive guard for the impossible non-Error throw. */
          "Invalid web server configuration.";
    console.error("Error:", message);
    process.exit(1);
  }
  const webRoot = join(__dirname, "..");
  const distRoot = join(webRoot, "dist");
  if (!isDev) {
    webConfig.staticRoot = distRoot;
  }

  console.log(
    isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  let handle: { close(): Promise<void> };

  try {
    if (isDev) {
      handle = await startViteDevServer(webConfig);
    } else {
      // Build clients/web/dist on demand if it's missing so prod `--web` never
      // serves a broken page (#1486); throws an actionable error if it can't.
      ensureWebBuild(webRoot, distRoot);
      handle = await startHonoServer(webConfig);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Web client failed to start.";
    console.error("Error:", message);
    process.exit(1);
  }

  const shutdown = () => {
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return new Promise<number>(() => {});
}
