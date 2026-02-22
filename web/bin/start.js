#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise, spawn } from "spawn-rx";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "@modelcontextprotocol/inspector-core/mcp/remote";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startDevClient(clientOptions) {
  const {
    CLIENT_PORT,
    inspectorApiToken,
    dangerouslyOmitAuth,
    command,
    mcpServerArgs,
    transport,
    serverUrl,
    envVars,
    abort,
    cancelledRef,
  } = clientOptions;
  const clientCommand = "npx";
  const host = process.env.HOST || "localhost";
  const clientArgs = ["vite", "--port", CLIENT_PORT, "--host", host];

  // Env for the child process (Vite): API token, initial MCP config, and client config vars
  const configEnv = {
    ...process.env,
    CLIENT_PORT,
    ...(dangerouslyOmitAuth
      ? {}
      : { [API_SERVER_ENV_VARS.AUTH_TOKEN]: inspectorApiToken }),
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

  // Include Inspector API auth token in URL for client (omit when auth disabled)
  const params = new URLSearchParams();
  if (!dangerouslyOmitAuth && inspectorApiToken) {
    params.set(API_SERVER_ENV_VARS.AUTH_TOKEN, inspectorApiToken);
  }
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
        if (!cancelledRef.current || process.env.DEBUG) {
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
    dangerouslyOmitAuth,
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
      ...(dangerouslyOmitAuth
        ? {}
        : { [API_SERVER_ENV_VARS.AUTH_TOKEN]: inspectorApiToken }),
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

    if (!parsingFlags) {
      if (command === null) command = arg;
      else mcpServerArgs.push(arg);
      continue;
    }

    if (arg === "--dev") {
      isDev = true;
      continue;
    }

    if (arg === "--transport" && i + 1 < args.length) {
      transport = args[++i];
      continue;
    }

    if (arg === "--server-url" && i + 1 < args.length) {
      serverUrl = args[++i];
      continue;
    }

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
    } else if (!command) {
      command = arg;
    } else {
      mcpServerArgs.push(arg);
    }
  }

  // Env fallback when no command/args were passed on the command line (explicit args take precedence)
  if (!command && process.env.MCP_INITIAL_COMMAND) {
    command = process.env.MCP_INITIAL_COMMAND;
    const initialArgs = process.env.MCP_INITIAL_ARGS;
    if (initialArgs)
      mcpServerArgs.push(...initialArgs.split(" ").filter(Boolean));
  }
  if (!serverUrl && process.env.MCP_INITIAL_SERVER_URL) {
    serverUrl = process.env.MCP_INITIAL_SERVER_URL;
  }
  if (!transport && process.env.MCP_INITIAL_TRANSPORT) {
    transport = process.env.MCP_INITIAL_TRANSPORT;
  }

  const CLIENT_PORT = process.env.CLIENT_PORT ?? "6274";

  console.log(
    isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;

  // Generate Inspector API auth token when auth is enabled (honor legacy MCP_PROXY_AUTH_TOKEN if present)
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

  if (isDev) {
    // In dev mode: start Vite with Inspector API middleware
    try {
      const clientOptions = {
        CLIENT_PORT,
        inspectorApiToken,
        dangerouslyOmitAuth,
        command,
        mcpServerArgs,
        transport,
        serverUrl,
        envVars,
        abort,
        cancelledRef,
      };
      await startDevClient(clientOptions);
    } catch (e) {
      if (!cancelledRef.current || process.env.DEBUG) throw e;
    }
  } else {
    // In prod mode: start Inspector API server (serves static files + /api/* endpoints)
    try {
      const clientOptions = {
        CLIENT_PORT,
        inspectorApiToken,
        dangerouslyOmitAuth,
        command,
        mcpServerArgs,
        transport,
        serverUrl,
        envVars,
        abort,
        cancelledRef,
      };
      await startProdClient(clientOptions);
    } catch (e) {
      if (!cancelledRef.current || process.env.DEBUG) throw e;
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
