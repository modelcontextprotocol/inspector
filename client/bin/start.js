#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise, spawn } from "spawn-rx";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MCP_PROXY_LISTEN_PORT = "6277";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, true));
}

function getClientUrl(port, authDisabled, sessionToken, serverPort) {
  const host = process.env.HOST || "localhost";
  const baseUrl = `http://${host}:${port}`;

  const params = new URLSearchParams();
  if (serverPort && serverPort !== DEFAULT_MCP_PROXY_LISTEN_PORT) {
    params.set("MCP_PROXY_PORT", serverPort);
  }
  if (!authDisabled) {
    params.set("MCP_PROXY_AUTH_TOKEN", sessionToken);
  }
  return params.size > 0 ? `${baseUrl}/?${params.toString()}` : baseUrl;
}

async function startDevServer(serverOptions) {
  const { SERVER_PORT, CLIENT_PORT, sessionToken, envVars, abort } =
    serverOptions;
  const serverCommand = "npx";
  const serverArgs = ["tsx", "watch", "--clear-screen=false", "src/index.ts"];
  const isWindows = process.platform === "win32";

  const spawnOptions = {
    cwd: resolve(__dirname, "../..", "server"),
    env: {
      ...process.env,
      SERVER_PORT,
      CLIENT_PORT,
      MCP_PROXY_AUTH_TOKEN: sessionToken,
      MCP_ENV_VARS: JSON.stringify(envVars),
    },
    signal: abort.signal,
    echoOutput: true,
  };

  // For Windows, we need to use stdin: 'ignore' to simulate < NUL
  if (isWindows) {
    spawnOptions.stdin = "ignore";
  }

  const server = spawn(serverCommand, serverArgs, spawnOptions);

  // Give server time to start
  const serverOk = await Promise.race([
    new Promise((resolve) => {
      server.subscribe({
        complete: () => resolve(false),
        error: () => resolve(false),
        next: () => {}, // We're using echoOutput
      });
    }),
    delay(3000).then(() => true),
  ]);

  return { server, serverOk };
}

async function startProdServer(serverOptions) {
  const {
    SERVER_PORT,
    CLIENT_PORT,
    sessionToken,
    envVars,
    abort,
    command,
    mcpServerArgs,
  } = serverOptions;
  const inspectorServerPath = resolve(
    __dirname,
    "../..",
    "server",
    "build",
    "index.js",
  );

  const server = spawnPromise(
    "node",
    [
      inspectorServerPath,
      ...(command ? [`--command`, command] : []),
      ...(mcpServerArgs && mcpServerArgs.length > 0
        ? [`--args`, mcpServerArgs.join(" ")]
        : []),
    ],
    {
      env: {
        ...process.env,
        SERVER_PORT,
        CLIENT_PORT,
        MCP_PROXY_AUTH_TOKEN: sessionToken,
        MCP_ENV_VARS: JSON.stringify(envVars),
      },
      signal: abort.signal,
      echoOutput: true,
    },
  );

  // Make sure server started before starting client
  const serverOk = await Promise.race([server, delay(2 * 1000)]);

  return { server, serverOk };
}

async function startDevClient(clientOptions) {
  const {
    CLIENT_PORT,
    SERVER_PORT,
    authDisabled,
    sessionToken,
    abort,
    cancelled,
  } = clientOptions;
  const clientCommand = "npx";
  const host = process.env.HOST || "localhost";
  const clientArgs = ["vite", "--port", CLIENT_PORT, "--host", host];

  const client = spawn(clientCommand, clientArgs, {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, CLIENT_PORT },
    signal: abort.signal,
    echoOutput: true,
  });

  const url = getClientUrl(
    CLIENT_PORT,
    authDisabled,
    sessionToken,
    SERVER_PORT,
  );

  // Give vite time to start before opening or logging the URL
  setTimeout(() => {
    console.log(`\n🚀 MCP Inspector is up and running at:\n   ${url}\n`);
    if (process.env.MCP_AUTO_OPEN_ENABLED !== "false") {
      console.log("🌐 Opening browser...");
      open(url);
    }
  }, 3000);

  await new Promise((resolve) => {
    client.subscribe({
      complete: resolve,
      error: (err) => {
        if (!cancelled || process.env.DEBUG) {
          console.error("Client error:", err);
        }
        resolve(null);
      },
      next: () => {}, // We're using echoOutput
    });
  });
}

async function startProdClient(clientOptions) {
  const {
    CLIENT_PORT,
    SERVER_PORT,
    authDisabled,
    sessionToken,
    abort,
    cancelled,
  } = clientOptions;
  const inspectorClientPath = resolve(
    __dirname,
    "../..",
    "client",
    "bin",
    "client.js",
  );

  const url = getClientUrl(
    CLIENT_PORT,
    authDisabled,
    sessionToken,
    SERVER_PORT,
  );

  await spawnPromise("node", [inspectorClientPath], {
    env: {
      ...process.env,
      CLIENT_PORT,
      INSPECTOR_URL: url,
    },
    signal: abort.signal,
    echoOutput: true,
  });
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const envVars = {};
  const mcpServerArgs = [];
  let command = null;
  let parsingFlags = true;
  let isDev = false;
  let configPath = null;
  let serverName = null;

  // Inspector can either be ran with a config file or a command to start an MCP server
  // Order of precedence is:
  // 1. Load configuration from MCP server config file
  // 2. Use direct command (and args) provided on the command line (if no config file is provided)

  // Early check if an MCP server config file is provided to make logic simpler below
  const configProvided = args.includes("--config");

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (parsingFlags && arg === "--") {
      parsingFlags = false;
      continue;
    }

    if (parsingFlags) {
      // Parse the --dev flag to run the inspector in development mode
      // This will ignore any command or args provided on the command line
      if (parsingFlags && arg === "--dev") {
        isDev = true;
        continue;
      }

      // Parse a file path to an MCP servers' config file where each server has:
      // - Server type (sse, streamable-http, or stdio)
      // - Server URL (for sse/streamable-http)
      // - Command and args (for stdio)
      // - Environment variables
      if (arg === "--config" && i + 1 < args.length) {
        configPath = args[++i];
        continue;
      }

      // Parse a server name to use from the relevant config file
      if (arg === "--server" && i + 1 < args.length) {
        serverName = args[++i];
        continue;
      }

      // Process any environment variables (in addition to those provided in the config file)
      // CLI env vars will override those in the config file - handled below
      // Format: -e KEY=VALUE or -e KEY (empty value)
      if (arg === "-e" && i + 1 < args.length) {
        const envVar = args[++i];
        const equalsIndex = envVar.indexOf("=");

        if (equalsIndex !== -1) {
          const key = envVar.substring(0, equalsIndex);
          const value = envVar.substring(equalsIndex + 1);
          envVars[key] = value;
        } else {
          envVars[envVar] = "";
        }
        continue;
      }
    }

    // If a config file isn't provided, then an explicit command (and args) can be provided instead
    // eg. node //some/path/to/a/build/index.js
    if (!configProvided) {
      // Set the first argument as the command to run
      if (!command) {
        command = arg;
      } else {
        // If a command has already been provided, then the remaining args as passed to the command
        mcpServerArgs.push(arg);
      }
    }
  }

  if ((configPath && !serverName) || (!configPath && serverName)) {
    console.error("Both --config and --server must be provided together.");
    process.exit(1);
  }

  let serverConfig = null;
  if (configPath && serverName) {
    try {
      serverConfig = loadConfigFile(configPath, serverName);
      console.log(
        `Loaded configuration for '${serverName}' from '${configPath}'`,
      );
    } catch (error) {
      console.error(`Error loading config: ${error.message}`);
      process.exit(1);
    }
  }

  const inspectorServerPath = resolve(
    __dirname,
    "../..",
    "server",
    "build",
    "index.js",
  );

  // Path to the client entry point
  const inspectorClientPath = resolve(
    __dirname,
    "../..",
    "client",
    "bin",
    "client.js",
  );

  const CLIENT_PORT = process.env.CLIENT_PORT ?? "6274";
  const SERVER_PORT = process.env.SERVER_PORT ?? DEFAULT_MCP_PROXY_LISTEN_PORT;

  console.log(
    isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  // Use provided token from environment or generate a new one
  const sessionToken =
    process.env.MCP_PROXY_AUTH_TOKEN || randomBytes(32).toString("hex");
  const authDisabled = !!process.env.DANGEROUSLY_OMIT_AUTH;

  const abort = new AbortController();

  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  // Build server arguments based on config or command line
  let serverArgs = [];

  // Environment variables precedence:
  // 1. Command line env vars (-e flag) take highest precedence
  // 2. Config file env vars are next
  // 3. System environment variables are lowest precedence
  let envVarsToPass = { ...envVars };

  let serverEnv = {
    ...process.env,
    PORT: SERVER_PORT,
  };

  if (serverConfig) {
    if (
      serverConfig.type === "sse" ||
      serverConfig.type === "streamable-http"
    ) {
      console.log(
        `Using ${serverConfig.type} transport with URL: ${serverConfig.url}`,
      );
      serverEnv.MCP_SERVER_CONFIG = JSON.stringify(serverConfig);
    } else if (serverConfig.command) {
      console.log(
        `Using stdio transport with command: ${serverConfig.command}`,
      );
      serverArgs = [
        ...(serverConfig.command ? [`--env`, serverConfig.command] : []),
        ...(serverConfig.args ? [`--args=${serverConfig.args.join(" ")}`] : []),
      ];
    }

    // Treat command line env vars as overrides of server config
    envVarsToPass = {
      ...(serverConfig.env ?? {}),
      ...envVarsToPass,
    };
  } else {
    serverArgs = [
      ...(command ? [`--env`, command] : []),
      ...(mcpServerArgs ? [`--args=${mcpServerArgs.join(" ")}`] : []),
    ];
  }

  serverEnv.MCP_ENV_VARS = JSON.stringify(envVarsToPass);

  let server, serverOk;
  try {
    server = spawnPromise("node", [inspectorServerPath, ...serverArgs], {
      env: serverEnv,
      signal: abort.signal,
      echoOutput: true,
    });

  let server, serverOk;

  try {
    const serverOptions = {
      SERVER_PORT,
      CLIENT_PORT,
      sessionToken,
      envVars,
      abort,
      command,
      mcpServerArgs,
    };

    const result = isDev
      ? await startDevServer(serverOptions)
      : await startProdServer(serverOptions);

    server = result.server;
    serverOk = result.serverOk;
  } catch (error) {}

  if (serverOk) {
    try {
      const clientOptions = {
        CLIENT_PORT,
        SERVER_PORT,
        authDisabled,
        sessionToken,
        abort,
        cancelled,
      };

      await (isDev
        ? startDevClient(clientOptions)
        : startProdClient(clientOptions));
    } catch (e) {
      if (!cancelled || process.env.DEBUG) throw e;
    }
  }

  return 0;
}

function loadConfigFile(configPath, serverName) {
  try {
    const resolvedConfigPath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);

    if (!fs.existsSync(resolvedConfigPath)) {
      console.error(`Config file not found: ${resolvedConfigPath}`);
      process.exit(1);
    }

    const configContent = fs.readFileSync(resolvedConfigPath, "utf8");
    const parsedConfig = JSON.parse(configContent);

    if (!parsedConfig.mcpServers || !parsedConfig.mcpServers[serverName]) {
      const availableServers = Object.keys(parsedConfig.mcpServers || {}).join(
        ", ",
      );
      console.error(
        `Server '${serverName}' not found in config file. Available servers: ${availableServers}`,
      );
      process.exit(1);
    }

    return parsedConfig.mcpServers[serverName];
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${err.message}`);
    }
    throw err;
  }
}

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
