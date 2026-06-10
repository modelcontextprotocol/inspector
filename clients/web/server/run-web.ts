/**
 * Programmatic entry for the launcher and published `mcp-inspector --web`.
 * Day-to-day dev still uses `npm run dev` (Vite CLI + buildWebServerConfigFromEnv).
 * Standalone prod uses `node dist/server.js` (env-only, no argv).
 */

import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { MCPServerConfig } from "../../../core/mcp/types.ts";
import {
  resolveServerConfigs,
  parseKeyValuePair,
  parseHeaderPair,
  type ServerConfigOptions,
} from "../../../core/mcp/node/config.ts";
import { buildWebServerConfig } from "./web-server-config.js";
import { startViteDevServer } from "./start-vite-dev-server.js";
import { startHonoServer } from "./server.js";

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
    .allowExcessArguments()
    .allowUnknownOption()
    .option(
      "-e <env>",
      "environment variables in KEY=VALUE format",
      parseKeyValuePair,
      {},
    )
    .option("--config <path>", "config file path")
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
    .option("--dev", "run in development mode (Vite)")
    .parse(preArgs);

  const opts = program.opts() as {
    config?: string;
    server?: string;
    e?: Record<string, string>;
    transport?: string;
    serverUrl?: string;
    cwd?: string;
    header?: Record<string, string>;
    dev?: boolean;
  };

  const args = program.args;
  const target = [...args, ...postArgs];
  const isDev = !!opts.dev;

  const hasServerInput =
    opts.config ||
    target.length > 0 ||
    opts.serverUrl ||
    (opts.transport && opts.transport !== "stdio");

  let initialMcpConfig: MCPServerConfig | null = null;

  if (hasServerInput) {
    const serverOptions: ServerConfigOptions = {
      configPath: opts.config,
      serverName: opts.server,
      target: target.length > 0 ? target : undefined,
      transport: opts.transport as "stdio" | "sse" | "http" | undefined,
      serverUrl: opts.serverUrl,
      cwd: opts.cwd,
      env: opts.e,
    };

    if (opts.header && Object.keys(opts.header).length > 0) {
      console.warn(
        "Warning: --header is accepted but initial HTTP headers are configured via server settings in the web UI (post-#1358).",
      );
    }

    try {
      const configs = resolveServerConfigs(serverOptions, "single");
      const config = configs[0];
      if (!config) {
        console.error(
          "Error: Could not resolve server config. Use --config and --server, or pass a command/URL.",
        );
        process.exit(1);
      }
      initialMcpConfig = ensureStdioCwd(config);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not resolve server config.";
      console.error("Error:", message);
      process.exit(1);
    }
  }

  const webConfig = buildWebServerConfig({ initialMcpConfig });
  if (!isDev) {
    webConfig.staticRoot = join(__dirname, "..", "dist");
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
