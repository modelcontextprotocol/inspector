#!/usr/bin/env node

import { resolve, dirname } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";
import fs from "node:fs";
import path from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // First pass to extract --config and --server flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--config" && i + 1 < args.length) {
      configPath = args[++i];
    } else if (arg === "--server" && i + 1 < args.length) {
      serverName = args[++i];
    }
  }

  // Check if we're using config-based approach
  if (configPath !== null || serverName !== null) {
    // Both --config and --server must be present
    if (!configPath || !serverName) {
      console.error("Error: Both --config and --server flags must be provided together");
      process.exit(1);
    }

    // Check if there are any other arguments besides --config and --server
    const otherArgs = args.filter((arg, i) => {
      if (arg === "--config" || arg === "--server") {
        return false;
      }
      if ((args[i-1] === "--config" || args[i-1] === "--server")) {
        return false;
      }
      return true;
    });

    if (otherArgs.length > 0) {
      console.error("Error: When using --config and --server flags, no other arguments are allowed");
      console.error("Please choose either file-based configuration (--config and --server) or argument-based configuration");
      process.exit(1);
    }

    // Process the config file
    try {
      const resolvedConfigPath = path.isAbsolute(configPath)
        ? configPath
        : path.resolve(process.cwd(), configPath);

      if (!fs.existsSync(resolvedConfigPath)) {
        console.error(`Error: Config file not found: ${resolvedConfigPath}`);
        process.exit(1);
      }

      const configContent = fs.readFileSync(resolvedConfigPath, "utf8");
      const parsedConfig = JSON.parse(configContent);
      
      if (!parsedConfig.mcpServers || !parsedConfig.mcpServers[serverName]) {
        console.error(`Error: Server '${serverName}' not found in config file`);
        console.error(`Available servers: ${Object.keys(parsedConfig.mcpServers || {}).join(", ")}`);
        process.exit(1);
      }

      const serverConfig = parsedConfig.mcpServers[serverName];
      
      // Set command and args from config
      command = serverConfig.command;
      if (serverConfig.args) {
        mcpServerArgs.push(...serverConfig.args);
      }
      
      // Set environment variables from config
      if (serverConfig.env) {
        Object.assign(envVars, serverConfig.env);
      }
      
      console.log(`Using server configuration '${serverName}' from ${configPath}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error(`Error: Invalid JSON in config file: ${err.message}`);
      } else {
        console.error(`Error processing config file: ${err.message}`);
      }
      process.exit(1);
    }
  } else {
    // Standard argument parsing (as before)
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (parsingFlags && arg === "--") {
        parsingFlags = false;
        continue;
      }

      if (parsingFlags && arg === "-e" && i + 1 < args.length) {
        const [key, value] = args[++i].split("=");
        if (key && value) {
          envVars[key] = value;
        }
      } else if (!command) {
        command = arg;
      } else {
        mcpServerArgs.push(arg);
      }
    }
  }

  const inspectorServerPath = resolve(
    __dirname,
    "..",
    "server",
    "build",
    "index.js",
  );

  // Path to the client entry point
  const inspectorClientPath = resolve(
    __dirname,
    "..",
    "client",
    "bin",
    "cli.js",
  );

  const CLIENT_PORT = process.env.CLIENT_PORT ?? "5173";
  const SERVER_PORT = process.env.SERVER_PORT ?? "3000";

  console.log("Starting MCP inspector...");

  const abort = new AbortController();

  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  const server = spawnPromise(
    "node",
    [
      inspectorServerPath,
      ...(command ? [`--env`, command] : []),
      ...(mcpServerArgs.length > 0 ? [`--args=${mcpServerArgs.join(" ")}`] : []),
    ],
    {
      env: {
        ...process.env,
        PORT: SERVER_PORT,
        MCP_ENV_VARS: JSON.stringify(envVars),
      },
      signal: abort.signal,
      echoOutput: true,
    },
  );

  const client = spawnPromise("node", [inspectorClientPath], {
    env: { ...process.env, PORT: CLIENT_PORT },
    signal: abort.signal,
    echoOutput: true,
  });

  // Make sure our server/client didn't immediately fail
  await Promise.any([server, client, delay(2 * 1000)]);
  const portParam = SERVER_PORT === "3000" ? "" : `?proxyPort=${SERVER_PORT}`;
  console.log(
    `\n🔍 MCP Inspector is up and running at http://localhost:${CLIENT_PORT}${portParam} 🚀`,
  );

  try {
    await Promise.any([server, client]);
  } catch (e) {
    if (!cancelled || process.env.DEBUG) throw e;
  }

  return 0;
}

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
