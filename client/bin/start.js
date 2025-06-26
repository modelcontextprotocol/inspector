#!/usr/bin/env node

import open from "open";
import { resolve, dirname } from "path";
import { spawnPromise, spawn } from "spawn-rx";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

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

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
