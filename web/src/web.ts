import open from "open";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { Command } from "commander";
import { spawnPromise, spawn } from "spawn-rx";
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

async function startDevClient(
  clientOptions: WebClientOptions & {
    CLIENT_PORT: string;
    inspectorApiToken: string;
    dangerouslyOmitAuth: boolean;
    abort: AbortController;
    cancelledRef: { current: boolean };
  },
): Promise<void> {
  const {
    CLIENT_PORT,
    inspectorApiToken,
    dangerouslyOmitAuth,
    command,
    mcpServerArgs,
    transport,
    serverUrl,
    headers,
    envVars,
    cwd,
    abort,
    cancelledRef,
  } = clientOptions;
  const clientCommand = "npx";
  const host = process.env.HOST || "localhost";
  const clientArgs = ["vite", "--port", CLIENT_PORT, "--host", host];

  const configEnv = {
    ...process.env,
    CLIENT_PORT,
    ...(dangerouslyOmitAuth
      ? {}
      : { [API_SERVER_ENV_VARS.AUTH_TOKEN]: inspectorApiToken }),
    ...(command ? { MCP_INITIAL_COMMAND: command } : {}),
    ...(mcpServerArgs.length > 0
      ? { MCP_INITIAL_ARGS: mcpServerArgs.join(" ") }
      : {}),
    ...(transport ? { MCP_INITIAL_TRANSPORT: transport } : {}),
    ...(serverUrl ? { MCP_INITIAL_SERVER_URL: serverUrl } : {}),
    ...(headers && Object.keys(headers).length > 0
      ? { MCP_INITIAL_HEADERS: JSON.stringify(headers) }
      : {}),
    ...(Object.keys(envVars).length > 0
      ? { MCP_ENV_VARS: JSON.stringify(envVars) }
      : {}),
    ...(cwd ? { MCP_INITIAL_CWD: cwd } : {}),
  };

  const client = spawn(clientCommand, clientArgs, {
    cwd: resolve(__dirname, ".."),
    env: configEnv,
    signal: abort.signal,
    echoOutput: true,
    split: false,
  });

  const params = new URLSearchParams();
  if (!dangerouslyOmitAuth && inspectorApiToken) {
    params.set(API_SERVER_ENV_VARS.AUTH_TOKEN, inspectorApiToken);
  }
  const url =
    params.size > 0
      ? `http://${host}:${CLIENT_PORT}/?${params.toString()}`
      : `http://${host}:${CLIENT_PORT}`;

  setTimeout(() => {
    console.log(`\n🚀 MCP Inspector Web is up and running at:\n   ${url}\n`);
    console.log(
      `   Static files served by: Vite (dev) / Inspector API server (prod)\n`,
    );
    if (process.env.MCP_AUTO_OPEN_ENABLED !== "false") {
      console.log("🌐 Opening browser...");
      open(url);
    }
  }, 3000);

  await new Promise<void>((resolvePromise) => {
    client.subscribe({
      complete: () => resolvePromise(),
      error: (err) => {
        if (!cancelledRef.current || process.env.DEBUG) {
          console.error("Client error:", err);
        }
        resolvePromise();
      },
      next: () => {},
    });
  });
}

async function startProdClient(
  clientOptions: WebClientOptions & {
    CLIENT_PORT: string;
    inspectorApiToken: string;
    dangerouslyOmitAuth: boolean;
    abort: AbortController;
    cancelledRef: { current: boolean };
  },
): Promise<void> {
  const {
    CLIENT_PORT,
    inspectorApiToken,
    dangerouslyOmitAuth,
    command,
    mcpServerArgs,
    transport,
    serverUrl,
    headers,
    envVars,
    cwd,
    abort,
  } = clientOptions;
  const honoServerPath = resolve(__dirname, "../dist/server.js");

  try {
    await spawnPromise("node", [honoServerPath], {
      env: {
        ...process.env,
        CLIENT_PORT,
        ...(dangerouslyOmitAuth
          ? {}
          : { [API_SERVER_ENV_VARS.AUTH_TOKEN]: inspectorApiToken }),
        ...(command ? { MCP_INITIAL_COMMAND: command } : {}),
        ...(mcpServerArgs.length > 0
          ? { MCP_INITIAL_ARGS: mcpServerArgs.join(" ") }
          : {}),
        ...(transport ? { MCP_INITIAL_TRANSPORT: transport } : {}),
        ...(serverUrl ? { MCP_INITIAL_SERVER_URL: serverUrl } : {}),
        ...(headers && Object.keys(headers).length > 0
          ? { MCP_INITIAL_HEADERS: JSON.stringify(headers) }
          : {}),
        ...(Object.keys(envVars).length > 0
          ? { MCP_ENV_VARS: JSON.stringify(envVars) }
          : {}),
        ...(cwd ? { MCP_INITIAL_CWD: cwd } : {}),
      },
      signal: abort.signal,
      echoOutput: true,
    });
  } catch (err: unknown) {
    const code =
      (err as { code?: number; exitCode?: number })?.code ??
      (err as { exitCode?: number })?.exitCode;
    if (typeof code === "number" && code !== 0) {
      process.exit(code);
    }
    throw err;
  }
}

async function runWithOptions(options: WebClientOptions): Promise<number> {
  const CLIENT_PORT = process.env.CLIENT_PORT ?? "6274";

  console.log(
    options.isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;
  const inspectorApiToken = dangerouslyOmitAuth
    ? ""
    : process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ||
      process.env[LEGACY_AUTH_TOKEN_ENV] ||
      randomBytes(32).toString("hex");

  const abort = new AbortController();
  const cancelledRef = { current: false };
  process.on("SIGINT", () => {
    cancelledRef.current = true;
    abort.abort();
  });

  const clientOptions = {
    ...options,
    CLIENT_PORT,
    inspectorApiToken,
    dangerouslyOmitAuth,
    abort,
    cancelledRef,
  };

  try {
    if (options.isDev) {
      await startDevClient(clientOptions);
    } else {
      await startProdClient(clientOptions);
    }
  } catch (e) {
    if (!cancelledRef.current || process.env.DEBUG) throw e;
  }

  return 0;
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

  try {
    return await runWithOptions(clientOptions);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Web client failed to start.";
    console.error("Error:", message);
    process.exit(1);
  }
}
