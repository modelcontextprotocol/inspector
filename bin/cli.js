#!/usr/bin/env node

import { resolve, dirname } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";

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
  const SSE_HOSTPORT = process.env.SSE_HOSTPORT;

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
      ...(mcpServerArgs ? [`--args=${mcpServerArgs.join(" ")}`] : []),
    ],
    {
      env: {
        ...process.env,
        PORT: SERVER_PORT,
        SSE_HOSTPORT: SSE_HOSTPORT,
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
  const params = new URLSearchParams();
  if (SERVER_PORT !== "3000") {
    params.set("proxyPort", SERVER_PORT);
  }
  if (SSE_HOSTPORT) {
    params.set("sseHostPort", SSE_HOSTPORT);
  }
  const queryString = params.toString() ? `?${params.toString()}` : "";

  console.log(
    `\n🔍 MCP Inspector is up and running at http://localhost:${CLIENT_PORT}${queryString} 🚀`,
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
