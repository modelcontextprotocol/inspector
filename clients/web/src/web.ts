import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { Command } from "commander";
import type { Logger } from "pino";
import type {
  MCPServerConfig,
  StreamableHttpServerConfig,
} from "@modelcontextprotocol/inspector-core/mcp/types.js";
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "@modelcontextprotocol/inspector-core/mcp/remote";
import {
  resolveServerConfigs,
  parseKeyValuePair,
  parseHeaderPair,
  type ServerConfigOptions,
} from "@modelcontextprotocol/inspector-core/mcp/node/config.js";
import {
  createFileLogger,
  silentLogger,
} from "@modelcontextprotocol/inspector-core/logging/node";
import { resolveSandboxPort } from "./sandbox-controller.js";
import type { WebServerConfig } from "./web-server-config.js";
import { startViteDevServer } from "./start-vite-dev-server.js";
import { startHonoServer } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebClientOptions {
  command: string | null;
  mcpServerArgs: string[];
  transport: string | null;
  serverUrl: string | null;
  headers: Record<string, string> | null;
  envVars: Record<string, string>;
  cwd: string | null;
  isDev: boolean;
}

function mcpConfigToWebClientOptions(
  config: MCPServerConfig,
  isDev: boolean,
): WebClientOptions {
  if (config.type === "stdio") {
    return {
      command: config.command ?? null,
      mcpServerArgs: config.args ?? [],
      transport: "stdio",
      serverUrl: null,
      headers: null,
      envVars: config.env ?? {},
      cwd: config.cwd ?? null,
      isDev,
    };
  }
  if (config.type === "sse") {
    return {
      command: null,
      mcpServerArgs: [],
      transport: "sse",
      serverUrl: config.url,
      headers: config.headers ?? null,
      envVars: {},
      cwd: null,
      isDev,
    };
  }
  if (config.type === "streamable-http") {
    return {
      command: null,
      mcpServerArgs: [],
      transport: "streamable-http",
      serverUrl: config.url,
      headers: config.headers ?? null,
      envVars: {},
      cwd: null,
      isDev,
    };
  }
  const c = config as unknown as StreamableHttpServerConfig;
  return {
    command: null,
    mcpServerArgs: [],
    transport: "streamable-http",
    serverUrl: c.url,
    headers: c.headers ?? null,
    envVars: {},
    cwd: null,
    isDev,
  };
}

function buildWebServerConfig(
  clientOptions: WebClientOptions,
  port: number,
  hostname: string,
  authToken: string,
  dangerouslyOmitAuth: boolean,
  logger: Logger,
): WebServerConfig {
  const baseUrl = `http://${hostname}:${port}`;
  const initialMcpConfig: MCPServerConfig | null =
    clientOptions.command != null || clientOptions.serverUrl != null
      ? clientOptions.transport === "stdio"
        ? {
            type: "stdio",
            command: clientOptions.command ?? "",
            args:
              clientOptions.mcpServerArgs.length > 0
                ? clientOptions.mcpServerArgs
                : undefined,
            cwd: clientOptions.cwd ?? undefined,
            env:
              Object.keys(clientOptions.envVars).length > 0
                ? clientOptions.envVars
                : undefined,
          }
        : clientOptions.transport === "sse"
          ? {
              type: "sse",
              url: clientOptions.serverUrl ?? "",
              headers: clientOptions.headers ?? undefined,
            }
          : {
              type: "streamable-http",
              url: clientOptions.serverUrl ?? "",
              headers: clientOptions.headers ?? undefined,
            }
      : null;

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
    sandboxPort: resolveSandboxPort(),
    sandboxHost: hostname,
    logger,
    autoOpen: process.env.MCP_AUTO_OPEN_ENABLED !== "false",
  };
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

  const hasServerInput =
    opts.config ||
    target.length > 0 ||
    opts.serverUrl ||
    (opts.transport && opts.transport !== "stdio");

  let clientOptions: WebClientOptions;

  if (!hasServerInput) {
    clientOptions = {
      command: null,
      mcpServerArgs: [],
      transport: null,
      serverUrl: null,
      headers: null,
      envVars: opts.e ?? {},
      cwd: null,
      isDev: !!opts.dev,
    };
  } else {
    const serverOptions: ServerConfigOptions = {
      configPath: opts.config,
      serverName: opts.server,
      target: target.length > 0 ? target : undefined,
      transport: opts.transport as "stdio" | "sse" | "http" | undefined,
      serverUrl: opts.serverUrl,
      cwd: opts.cwd,
      env: opts.e,
      headers: opts.header,
    };

    try {
      const configs = resolveServerConfigs(serverOptions, "single");
      const config = configs[0];
      if (!config) {
        console.error(
          "Error: Could not resolve server config. Use --config and --server, or pass a command/URL.",
        );
        process.exit(1);
      }
      clientOptions = mcpConfigToWebClientOptions(config, !!opts.dev);
      if (clientOptions.command && !clientOptions.cwd) {
        clientOptions.cwd = resolve(process.cwd());
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not resolve server config.";
      console.error("Error:", message);
      process.exit(1);
    }
  }

  const port = parseInt(process.env.CLIENT_PORT ?? "6274", 10);
  const hostname = process.env.HOST ?? "localhost";
  const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;
  const authToken = dangerouslyOmitAuth
    ? ""
    : ((process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] as string | undefined) ??
      (process.env[LEGACY_AUTH_TOKEN_ENV] as string | undefined) ??
      randomBytes(32).toString("hex"));

  const logger = process.env.MCP_LOG_FILE
    ? await createFileLogger({
        dest: process.env.MCP_LOG_FILE,
        append: true,
        mkdir: true,
        level: "info",
        name: "mcp-inspector-web",
      })
    : silentLogger;

  const webConfig = buildWebServerConfig(
    clientOptions,
    port,
    hostname,
    authToken,
    dangerouslyOmitAuth,
    logger,
  );
  if (!clientOptions.isDev) {
    webConfig.staticRoot = join(__dirname, "..", "dist");
  }

  console.log(
    clientOptions.isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  let handle: { close(): Promise<void> };

  try {
    if (clientOptions.isDev) {
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

  // Process stays alive until SIGINT/SIGTERM (handler exits). Return a never-resolving promise.
  return new Promise<number>(() => {});
}
