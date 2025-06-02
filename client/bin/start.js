#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise, spawn } from "spawn-rx";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, true));
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
      PORT: SERVER_PORT,
      CLIENT_PORT: CLIENT_PORT,
      MCP_PROXY_TOKEN: sessionToken,
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
      ...(command ? [`--env`, command] : []),
      ...(mcpServerArgs ? [`--args=${mcpServerArgs.join(" ")}`] : []),
    ],
    {
      env: {
        ...process.env,
        PORT: SERVER_PORT,
        CLIENT_PORT: CLIENT_PORT,
        MCP_PROXY_TOKEN: sessionToken,
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
  const { CLIENT_PORT, authDisabled, sessionToken, abort, cancelled } =
    clientOptions;
  const clientCommand = "npx";
  const clientArgs = ["vite", "--port", CLIENT_PORT];

  const client = spawn(clientCommand, clientArgs, {
    cwd: resolve(__dirname, ".."),
    env: { ...process.env, PORT: CLIENT_PORT },
    signal: abort.signal,
    echoOutput: true,
  });

  // Auto-open browser after vite starts
  if (process.env.MCP_AUTO_OPEN_ENABLED !== "false") {
    const url = authDisabled
      ? `http://127.0.0.1:${CLIENT_PORT}`
      : `http://127.0.0.1:${CLIENT_PORT}/?MCP_PROXY_AUTH_TOKEN=${sessionToken}`;

    // Give vite time to start before opening browser
    setTimeout(() => {
      open(url);
      console.log(`\n🔗 Opening browser at: ${url}\n`);
    }, 3000);
  }

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
  const { CLIENT_PORT, authDisabled, sessionToken, abort } = clientOptions;
  const inspectorClientPath = resolve(
    __dirname,
    "../..",
    "client",
    "bin",
    "client.js",
  );

  // Auto-open browser with token
  if (process.env.MCP_AUTO_OPEN_ENABLED !== "false") {
    const url = authDisabled
      ? `http://127.0.0.1:${CLIENT_PORT}`
      : `http://127.0.0.1:${CLIENT_PORT}/?MCP_PROXY_AUTH_TOKEN=${sessionToken}`;
    open(url);
  }

  await spawnPromise("node", [inspectorClientPath], {
    env: { ...process.env, PORT: CLIENT_PORT },
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (parsingFlags && arg === "--") {
      parsingFlags = false;
      continue;
    }

    if (parsingFlags && arg === "--dev") {
      isDev = true;
      continue;
    }

    if (parsingFlags && arg === "--config" && i + 1 < args.length) {
      configPath = args[++i];
      continue;
    }

    if (parsingFlags && arg === "--server" && i + 1 < args.length) {
      serverName = args[++i];
      continue;
    }

    if (parsingFlags && arg === "-e" && i + 1 < args.length) {
      const envVar = args[++i];
      const equalsIndex = envVar.indexOf("=");

      if (equalsIndex !== -1) {
        const key = envVar.substring(0, equalsIndex);
        const value = envVar.substring(equalsIndex + 1);
        envVars[key] = value;
      } else {
        envVars[envVar] = "";
      }
      // If loading a config file, we don't need to pass the command or args
    } else if (!command && !isDev && !configPath) {
      command = arg;
    } else if (!isDev) {
      mcpServerArgs.push(arg);
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
  const SERVER_PORT = process.env.SERVER_PORT ?? "6277";

  console.log(
    isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  // Generate session token for authentication
  const sessionToken = randomBytes(32).toString("hex");
  const authDisabled = !!process.env.DANGEROUSLY_OMIT_AUTH;

  const abort = new AbortController();

  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  // Build server arguments based on config or command line
  let serverArgs = [];
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
