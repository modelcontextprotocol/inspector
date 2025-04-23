#!/usr/bin/env node

import { resolve, dirname } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";

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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (parsingFlags && arg === "--") {
      parsingFlags = false;
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
    } else if (!command) {
      command = arg;
    } else {
      mcpServerArgs.push(arg);
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
  let server, serverOk;
  try {
    server = spawnPromise(
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
          MCP_ENV_VARS: JSON.stringify(envVars),
        },
        signal: abort.signal,
        echoOutput: true,
      },
    );

    // Make sure server started before starting client
    serverOk = await Promise.race([server, delay(2 * 1000)]);
  } catch (error) {}

  if (serverOk) {
    try {
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

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
