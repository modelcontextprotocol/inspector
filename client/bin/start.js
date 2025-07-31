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

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
