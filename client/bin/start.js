#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, true));
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const envVars = {};
  const mcpServerArgs = [];
  let command = null;
  let parsingFlags = true;
  let configPath = null;
  let serverName = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (parsingFlags && arg === "--") {
      parsingFlags = false;
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
    } else if (!command && !configPath) {
      command = arg;
    } else {
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

  console.log("Starting MCP inspector...");

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

    // Make sure server started before starting client
    serverOk = await Promise.race([server, delay(2 * 1000)]);
  } catch (error) {}

  if (serverOk) {
    try {
      // Only auto-open when auth is disabled
      const authDisabled = !!process.env.DANGEROUSLY_OMIT_AUTH;
      if (process.env.MCP_AUTO_OPEN_ENABLED !== "false" && authDisabled) {
        open(`http://127.0.0.1:${CLIENT_PORT}`);
      }
      await spawnPromise("node", [inspectorClientPath], {
        env: { ...process.env, PORT: CLIENT_PORT },
        signal: abort.signal,
        echoOutput: true,
      });
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
