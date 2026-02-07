#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise, spawn } from "spawn-rx";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

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
  const {
    SERVER_PORT,
    CLIENT_PORT,
    sessionToken,
    envVars,
    abort,
    transport,
    serverUrl,
  } = serverOptions;
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
      ...(transport ? { MCP_TRANSPORT: transport } : {}),
      ...(serverUrl ? { MCP_SERVER_URL: serverUrl } : {}),
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
    transport,
    serverUrl,
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
      ...(command ? [`--command=${command}`] : []),
      ...(mcpServerArgs && mcpServerArgs.length > 0
        ? [`--args=${mcpServerArgs.join(" ")}`]
        : []),
      ...(transport ? [`--transport=${transport}`] : []),
      ...(serverUrl ? [`--server-url=${serverUrl}`] : []),
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
    honoAuthToken,
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
    MCP_REMOTE_AUTH_TOKEN: honoAuthToken, // Pass token to Vite (read-only)
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

  // Include auth token in URL for client (Phase 3 will use this)
  const params = new URLSearchParams();
  params.set("MCP_REMOTE_AUTH_TOKEN", honoAuthToken);
  if (SERVER_PORT && SERVER_PORT !== DEFAULT_MCP_PROXY_LISTEN_PORT) {
    params.set("MCP_PROXY_PORT", SERVER_PORT);
  }
  if (!authDisabled) {
    params.set("MCP_PROXY_AUTH_TOKEN", sessionToken);
  }
  const url =
    params.size > 0
      ? `http://${host}:${CLIENT_PORT}/?${params.toString()}`
      : `http://${host}:${CLIENT_PORT}`;

  // Give vite time to start before opening or logging the URL
  setTimeout(() => {
    console.log(`\n🚀 MCP Inspector Web is up and running at:\n   ${url}\n`);
    console.log(`   Static files served by: Vite (dev) / Hono server (prod)\n`);
    console.log(`   Hono API endpoints: ${url}/api/*\n`);
    console.log(
      `   Express proxy: http://localhost:${SERVER_PORT} (web app API calls)\n`,
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
    honoAuthToken,
    abort,
    command,
    mcpServerArgs,
    transport,
    serverUrl,
    envVars,
  } = clientOptions;
  const honoServerPath = resolve(__dirname, "server.js");

  // Hono server serves static files + /api/* endpoints
  // Pass auth token and config values explicitly via env vars (read-only, server reads them)
  await spawnPromise("node", [honoServerPath], {
    env: {
      ...process.env,
      CLIENT_PORT,
      MCP_REMOTE_AUTH_TOKEN: honoAuthToken, // Pass token explicitly
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
    } else if (!command && !isDev) {
      command = arg;
    } else if (!isDev) {
      mcpServerArgs.push(arg);
    }
  }

  const CLIENT_PORT = process.env.CLIENT_PORT ?? "6274";
  const SERVER_PORT = process.env.SERVER_PORT ?? DEFAULT_MCP_PROXY_LISTEN_PORT;

  console.log(
    isDev
      ? "Starting MCP inspector in development mode..."
      : "Starting MCP inspector...",
  );

  // Generate auth tokens (separate tokens for Express proxy and Hono API)
  const proxySessionToken =
    process.env.MCP_PROXY_AUTH_TOKEN || randomBytes(32).toString("hex");
  const honoAuthToken =
    process.env.MCP_REMOTE_AUTH_TOKEN || randomBytes(32).toString("hex");
  const authDisabled = !!process.env.DANGEROUSLY_OMIT_AUTH;

  const abort = new AbortController();

  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  let server, serverOk;

  if (isDev) {
    // In dev mode: start Express proxy (web app uses this) AND Vite with Hono middleware
    try {
      const serverOptions = {
        SERVER_PORT,
        CLIENT_PORT,
        sessionToken: proxySessionToken,
        envVars,
        abort,
        command,
        mcpServerArgs,
        transport,
        serverUrl,
      };

      const result = await startDevServer(serverOptions);
      server = result.server;
      serverOk = result.serverOk;
    } catch (error) {
      // Continue even if Express proxy fails - Hono API still works
      console.warn("Express proxy failed to start:", error);
      serverOk = false;
    }

    if (serverOk) {
      // Start Vite with Hono middleware (runs alongside Express proxy)
      try {
        const clientOptions = {
          CLIENT_PORT,
          SERVER_PORT,
          authDisabled,
          sessionToken: proxySessionToken,
          honoAuthToken, // Pass Hono auth token explicitly
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
    }
  } else {
    // In prod mode: start Express proxy (web app uses this) AND Hono server
    try {
      const serverOptions = {
        SERVER_PORT,
        CLIENT_PORT,
        sessionToken: proxySessionToken,
        envVars,
        abort,
        command,
        mcpServerArgs,
        transport,
        serverUrl,
      };

      const result = await startProdServer(serverOptions);
      server = result.server;
      serverOk = result.serverOk;
    } catch (error) {
      console.warn("Express proxy failed to start:", error);
      serverOk = false;
    }

    if (serverOk) {
      // Start Hono server (serves static files + /api/* endpoints)
      try {
        const clientOptions = {
          CLIENT_PORT,
          honoAuthToken, // Pass token explicitly
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

    // Both servers run:
    // - Hono server (via startProdClient) serves static files + /api/* endpoints
    // - Express proxy (via startProdServer) handles web app API calls
  }

  return 0;
}

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
