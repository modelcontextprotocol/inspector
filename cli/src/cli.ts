#!/usr/bin/env node

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// This represents the parsed arguments produced by parseArgs()
//
type Args = {
  command: string;
  args: string[];
  envArgs: Record<string, string>;
  cli: boolean;
  dev?: boolean;
  transport?: "stdio" | "sse" | "streamable-http";
  serverUrl?: string;
  headers?: Record<string, string>;
  cwd?: string;
};

// This is only to provide typed access to the parsed program options
// This could just be defined locally in parseArgs() since that's the only place it is used
//
type CliOptions = {
  e?: Record<string, string>;
  config?: string;
  server?: string;
  cli?: boolean;
  dev?: boolean;
  transport?: string;
  serverUrl?: string;
  header?: Record<string, string>;
  cwd?: string;
};

type ServerConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      type: "sse" | "streamable-http";
      url: string;
      note?: string;
    };

function handleError(error: unknown): never {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = "Unknown error";
  }

  console.error(message);

  process.exit(1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms, true));
}

async function runWeb(args: Args): Promise<void> {
  // Path to the web entry point
  const inspectorWebPath = resolve(
    __dirname,
    "../../",
    "web",
    "bin",
    "start.js",
  );

  const abort = new AbortController();
  let cancelled: boolean = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  // Build arguments to pass to start.js
  const startArgs: string[] = [];

  if (args.dev) {
    startArgs.push("--dev");
  }

  // Pass environment variables
  for (const [key, value] of Object.entries(args.envArgs)) {
    startArgs.push("-e", `${key}=${value}`);
  }

  // Pass transport type if specified
  if (args.transport) {
    startArgs.push("--transport", args.transport);
  }

  // Pass server URL if specified
  if (args.serverUrl) {
    startArgs.push("--server-url", args.serverUrl);
  }

  // Pass cwd if specified (for stdio transport)
  if (args.cwd) {
    startArgs.push("--cwd", path.resolve(args.cwd));
  }

  // Pass command and args (using -- to separate them)
  if (args.command) {
    startArgs.push("--", args.command, ...args.args);
  }

  try {
    await spawnPromise("node", [inspectorWebPath, ...startArgs], {
      signal: abort.signal,
      echoOutput: true,
      // pipe the stdout through here, prevents issues with buffering and
      // dropping the end of console.out after 8192 chars due to node
      // closing the stdout pipe before the output has finished flushing
      stdio: "inherit",
    });
  } catch (e) {
    if (!cancelled || process.env.DEBUG) throw e;
  }
}

async function runCli(args: Args): Promise<void> {
  const projectRoot = resolve(__dirname, "..");
  const cliPath = resolve(projectRoot, "build", "index.js");

  const abort = new AbortController();

  let cancelled = false;

  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  try {
    // Build CLI arguments
    const cliArgs = [cliPath];

    // Add target URL/command first
    cliArgs.push(args.command, ...args.args);

    // Add transport flag if specified
    if (args.transport && args.transport !== "stdio") {
      // Convert streamable-http back to http for CLI mode
      const cliTransport =
        args.transport === "streamable-http" ? "http" : args.transport;
      cliArgs.push("--transport", cliTransport);
    }

    // Add headers if specified
    if (args.headers) {
      for (const [key, value] of Object.entries(args.headers)) {
        cliArgs.push("--header", `${key}: ${value}`);
      }
    }

    // Add cwd if specified (for stdio transport)
    if (args.cwd) {
      cliArgs.push("--cwd", path.resolve(args.cwd));
    }

    await spawnPromise("node", cliArgs, {
      env: { ...process.env, ...args.envArgs },
      signal: abort.signal,
      echoOutput: true,
      // pipe the stdout through here, prevents issues with buffering and
      // dropping the end of console.out after 8192 chars due to node
      // closing the stdout pipe before the output has finished flushing
      stdio: "inherit",
    });
  } catch (e) {
    if (!cancelled || process.env.DEBUG) {
      throw e;
    }
  }
}

async function runTui(tuiArgs: string[]): Promise<void> {
  const projectRoot = resolve(__dirname, "../..");
  const tuiPath = resolve(projectRoot, "tui", "build", "tui.js");

  const abort = new AbortController();

  let cancelled = false;

  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  try {
    // Remove --tui flag and pass everything else directly to TUI
    const filteredArgs = tuiArgs.filter((arg) => arg !== "--tui");

    await spawnPromise("node", [tuiPath, ...filteredArgs], {
      env: process.env,
      signal: abort.signal,
      echoOutput: true,
      stdio: "inherit",
    });
  } catch (e) {
    if (!cancelled || process.env.DEBUG) {
      throw e;
    }
  }
}

function loadConfigFile(configPath: string, serverName: string): ServerConfig {
  try {
    const resolvedConfigPath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);

    if (!fs.existsSync(resolvedConfigPath)) {
      throw new Error(`Config file not found: ${resolvedConfigPath}`);
    }

    const configContent = fs.readFileSync(resolvedConfigPath, "utf8");
    const parsedConfig = JSON.parse(configContent);

    if (!parsedConfig.mcpServers || !parsedConfig.mcpServers[serverName]) {
      const availableServers = Object.keys(parsedConfig.mcpServers || {}).join(
        ", ",
      );
      throw new Error(
        `Server '${serverName}' not found in config file. Available servers: ${availableServers}`,
      );
    }

    const serverConfig = parsedConfig.mcpServers[serverName];

    return serverConfig;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${err.message}`);
    }

    throw err;
  }
}

function parseKeyValuePair(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const parts = value.split("=");
  const key = parts[0];
  const val = parts.slice(1).join("=");

  if (val === undefined || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`,
    );
  }

  return { ...previous, [key as string]: val };
}

function parseHeaderPair(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const colonIndex = value.indexOf(":");

  if (colonIndex === -1) {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`,
    );
  }

  const key = value.slice(0, colonIndex).trim();
  const val = value.slice(colonIndex + 1).trim();

  if (key === "" || val === "") {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`,
    );
  }

  return { ...previous, [key]: val };
}

function parseArgs(): Args {
  const program = new Command();

  const argSeparatorIndex = process.argv.indexOf("--");
  let preArgs = process.argv;
  let postArgs: string[] = [];

  if (argSeparatorIndex !== -1) {
    preArgs = process.argv.slice(0, argSeparatorIndex);
    postArgs = process.argv.slice(argSeparatorIndex + 1);
  }

  program
    .name("inspector-bin")
    .allowExcessArguments()
    .allowUnknownOption()
    .option(
      "-e <env>",
      "environment variables in KEY=VALUE format",
      parseKeyValuePair,
      {},
    )
    .option("--config <path>", "config file path")
    .option("--server <n>", "server name from config file")
    .option("--cli", "enable CLI mode")
    .option("--web", "launch web app (default)")
    .option("--dev", "run web in dev mode (Vite)")
    .option("--tui", "enable TUI mode")
    .option("--transport <type>", "transport type (stdio, sse, http)")
    .option("--server-url <url>", "server URL for SSE/HTTP transport")
    .option("--cwd <path>", "working directory for stdio server process")
    .option(
      "--header <headers...>",
      'HTTP headers as "HeaderName: Value" pairs (for HTTP/SSE transports)',
      parseHeaderPair,
      {},
    );

  // Parse only the arguments before --
  program.parse(preArgs);

  const options = program.opts() as CliOptions;
  const remainingArgs = program.args;

  // Add back any arguments that came after --
  const finalArgs = [...remainingArgs, ...postArgs];

  // If server specified but no config, default to mcp.json in cwd if it exists
  if (!options.config && options.server) {
    const defaultConfigPath = path.join(process.cwd(), "mcp.json");
    if (fs.existsSync(defaultConfigPath)) {
      options.config = "mcp.json";
    } else {
      throw new Error("--server requires --config to be specified");
    }
  }

  // If config is provided without server, try to auto-select
  if (options.config && !options.server) {
    const configContent = fs.readFileSync(
      path.isAbsolute(options.config)
        ? options.config
        : path.resolve(process.cwd(), options.config),
      "utf8",
    );
    const parsedConfig = JSON.parse(configContent);
    const servers = Object.keys(parsedConfig.mcpServers || {});

    if (servers.length === 1) {
      // Use the only server if there's just one
      options.server = servers[0];
    } else if (servers.length === 0) {
      throw new Error("No servers found in config file");
    } else {
      // Multiple servers, require explicit selection
      throw new Error(
        `Multiple servers found in config file. Please specify one with --server.\nAvailable servers: ${servers.join(", ")}`,
      );
    }
  }

  // If config file is specified, load and use the options from the file. We must merge the args
  // from the command line and the file together, or we will miss the method options (--method,
  // etc.)
  if (options.config && options.server) {
    const config = loadConfigFile(options.config, options.server);

    if (config.type === "stdio") {
      const cwd = options.cwd ?? config.cwd ?? path.resolve(process.cwd());
      return {
        command: config.command,
        args: [...(config.args || []), ...finalArgs],
        envArgs: { ...(config.env || {}), ...(options.e || {}) },
        cli: options.cli || false,
        dev: options.dev || false,
        transport: "stdio",
        headers: options.header,
        cwd: path.resolve(cwd),
      };
    } else if (config.type === "sse" || config.type === "streamable-http") {
      return {
        command: config.url,
        args: finalArgs,
        envArgs: options.e || {},
        cli: options.cli || false,
        dev: options.dev || false,
        transport: config.type,
        serverUrl: config.url,
        headers: options.header,
      };
    } else {
      // Backwards compatibility: if no type field, assume stdio
      const cwd =
        options.cwd ??
        (config as { cwd?: string }).cwd ??
        path.resolve(process.cwd());
      return {
        command: (config as { command?: string }).command || "",
        args: [
          ...(((config as { args?: string[] }).args || []) as string[]),
          ...finalArgs,
        ],
        envArgs: {
          ...(((config as { env?: Record<string, string> }).env ||
            {}) as Record<string, string>),
          ...(options.e || {}),
        },
        cli: options.cli || false,
        dev: options.dev || false,
        transport: "stdio",
        headers: options.header,
        cwd: path.resolve(cwd),
      };
    }
  }

  // Otherwise use command line arguments
  const command = finalArgs[0] || "";
  const args = finalArgs.slice(1);

  // Map "http" shorthand to "streamable-http"
  let transport = options.transport;
  if (transport === "http") {
    transport = "streamable-http";
  }

  const cwd = options.cwd
    ? path.resolve(options.cwd)
    : path.resolve(process.cwd());

  return {
    command,
    args,
    envArgs: options.e || {},
    cli: options.cli || false,
    dev: options.dev || false,
    transport: transport as "stdio" | "sse" | "streamable-http" | undefined,
    serverUrl: options.serverUrl,
    headers: options.header,
    cwd,
  };
}

async function main(): Promise<void> {
  process.on("uncaughtException", (error) => {
    handleError(error);
  });

  try {
    // For now we just pass the raw args to TUI (we'll integrate config later)
    // The main issue is that Inspector only supports a single server and the TUI supports a set
    //
    // Check for --tui in raw argv - if present, bypass all parsing
    if (process.argv.includes("--tui")) {
      await runTui(process.argv.slice(2));
      return;
    }

    const args = parseArgs();

    if (args.cli) {
      await runCli(args);
    } else {
      await runWeb(args);
    }
  } catch (error) {
    handleError(error);
  }
}

main();
