#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise, spawn } from "spawn-rx";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { API_SERVER_ENV_VARS } from "@modelcontextprotocol/inspector-core/mcp/remote";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startDevClient(clientOptions) {
  const {
    CLIENT_PORT,
    inspectorApiToken,
    command,
    mcpServerArgs,
    transport,
    serverUrl,
    envVars,
    abort,
    cancelled,
  } = clientOptions;
  const clientCommand = "npx";
  const host = process.env.HOST || "localhost";
  const clientArgs = ["vite", "--port", CLIENT_PORT, "--host", host];

  // Prepare config values for injection into HTML
  const configEnv = {
    ...process.env,
    CLIENT_PORT,
    [API_SERVER_ENV_VARS.AUTH_TOKEN]: inspectorApiToken, // Pass Inspector API token to Vite (read-only)
    // Pass config values for HTML injection
    ...(command ? { MCP_INITIAL_COMMAND: command } : {}),
    ...(mcpServerArgs && mcpServerArgs.length > 0
      ? { MCP_INITIAL_ARGS: mcpServerArgs.join(" ") }
      : {}),
    ...(transport ? { MCP_INITIAL_TRANSPORT: transport } : {}),
    ...(serverUrl ? { MCP_INITIAL_SERVER_URL: serverUrl } : {}),
    ...(envVars && Object.keys(envVars).length > 0
      ? { MCP_ENV_VARS: JSON.stringify(envVars) }
      : {}),
  };

  const client = spawn(clientCommand, clientArgs, {
    cwd: resolve(__dirname, ".."),
    env: configEnv,
    signal: abort.signal,
    echoOutput: true,
  });

  // Include Inspector API auth token in URL for client
  const params = new URLSearchParams();
  params.set(API_SERVER_ENV_VARS.AUTH_TOKEN, inspectorApiToken);
  const url =
    params.size > 0
      ? `http://${host}:${CLIENT_PORT}/?${params.toString()}`
      : `http://${host}:${CLIENT_PORT}`;

  // Give vite time to start before opening or logging the URL
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
    inspectorApiToken,
    abort,
    command,
    mcpServerArgs,
    transport,
    serverUrl,
    envVars,
  } = clientOptions;
  const honoServerPath = resolve(__dirname, "../dist/server.js");

  // Inspector API server (Hono) serves static files + /api/* endpoints
  // Pass Inspector API auth token and config values explicitly via env vars (read-only, server reads them)
  await spawnPromise("node", [honoServerPath], {
    env: {
      ...process.env,
      CLIENT_PORT,
      [API_SERVER_ENV_VARS.AUTH_TOKEN]: inspectorApiToken, // Pass Inspector API token explicitly
      // Pass config values for HTML injection
      ...(command ? { MCP_INITIAL_COMMAND: command } : {}),
      ...(mcpServerArgs && mcpServerArgs.length > 0
        ? { MCP_INITIAL_ARGS: mcpServerArgs.join(" ") }
        : {}),
      ...(transport ? { MCP_INITIAL_TRANSPORT: transport } : {}),
      ...(serverUrl ? { MCP_INITIAL_SERVER_URL: serverUrl } : {}),
      ...(envVars && Object.keys(envVars).length > 0
        ? { MCP_ENV_VARS: JSON.stringify(envVars) }
        : {}),
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
  let transport = null;
  let serverUrl = null;

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

    if (parsingFlags && arg === "--transport" && i + 1 < args.length) {
      transport = args[++i];
      continue;
    }

    if (parsingFlags && arg === "--server-url" && i + 1 < args.length) {
      serverUrl = args[++i];
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
    } else if (!parsingFlags) {
      // After "--", first arg is command, rest are server args (same in dev and prod)
      if (command === null) {
        command = arg;
      } else {
        mcpServerArgs.push(arg);
      }
    }
  }

  const CLIENT_PORT = process.env.CLIENT_PORT ?? "6274";

  console.log(
    isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  // Generate Inspector API auth token
  const inspectorApiToken =
    process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ||
    randomBytes(32).toString("hex");

  const abort = new AbortController();

  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  if (isDev) {
    // In dev mode: start Vite with Inspector API middleware
    try {
      const clientOptions = {
        CLIENT_PORT,
        inspectorApiToken, // Pass Inspector API token explicitly
        command,
        mcpServerArgs,
        transport,
        serverUrl,
        envVars,
        abort,
        cancelled,
      };
      await startDevClient(clientOptions);
    } catch (e) {
      if (!cancelled || process.env.DEBUG) throw e;
    }
  } else {
    // In prod mode: start Inspector API server (serves static files + /api/* endpoints)
    try {
      const clientOptions = {
        CLIENT_PORT,
        inspectorApiToken, // Pass token explicitly
        command,
        mcpServerArgs,
        transport,
        serverUrl,
        envVars,
        abort,
        cancelled,
      };
      await startProdClient(clientOptions);
    } catch (e) {
      if (!cancelled || process.env.DEBUG) throw e;
    }
  }

  return 0;
}

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
