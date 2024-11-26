#!/usr/bin/env node

import { join, dirname } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Get command line arguments
  const [, , command, ...mcpServerArgs] = process.argv;

  const inspectorServerPath = join(__dirname, "../server/build/index.js");

  // Path to the client entry point
  const inspectorClientPath = join(__dirname, "../client/bin/cli.js");

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
      ...(mcpServerArgs ?? []),
    ],
    { env: { PORT: SERVER_PORT }, signal: abort.signal },
  );

  const client = spawnPromise("node", [inspectorClientPath], {
    env: { PORT: CLIENT_PORT },
    signal: abort.signal,
  });

  // Make sure our server/client didn't immediately fail
  await Promise.any([server, client, delay(2 * 1000)]);
  console.log(
    `\n🔍 MCP Inspector is up and running at http://localhost:${CLIENT_PORT} 🚀`,
  );

  try {
    await Promise.any([server, client]);
  } catch (e) {
    if (!cancelled) throw e;
  }

  return 0;
}

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
