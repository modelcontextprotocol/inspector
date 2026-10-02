#!/usr/bin/env node
// Stdio entrypoint for a COMPOSED test server, owned by the mcpdo behavior
// eval (`skills:eval:mcpdo`).
//
// A behavior case may carry a `server` field — the test-servers declarative
// config-file shape (serverInfo + preset refs + capability switches; see
// test-servers/src/load-config.ts). The harness writes it to disk and points
// the sample's catalog entry at this launcher, so each case talks to exactly
// the server it needs: an eliciting tool, task tools, subscriptions,
// whatever the preset registry can compose.
//
// Deliberately NOT an extension of `test-server-stdio.js`: that entrypoint
// is a purpose-built default composition and stays that way. This launcher
// is the composition path the framework already exposes — `loadConfig` →
// `resolveConfig` → `TestServerStdio` (whose constructor takes any
// ServerConfig; only its standalone main hard-wires the default). Built
// output is imported, same as the eval's use of the default server: the
// eval measures what a user would run, and `scripts/` cannot import the
// workspace package by name anyway.
//
// Usage: mcpdo-eval-server-launcher.mjs <config.(json|yaml)>

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function main() {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stderr.write(
      "mcpdo-eval-server-launcher: usage: mcpdo-eval-server-launcher.mjs <config.(json|yaml)>\n",
    );
    process.exit(2);
  }
  const { loadConfig, resolveConfig, TestServerStdio } = await import(
    path.join(ROOT, "test-servers", "build", "index.js")
  );
  const loaded = loadConfig(path.resolve(configPath));
  if (loaded.transport?.type !== "stdio") {
    throw new Error(
      `config transport.type must be "stdio" (got ${JSON.stringify(loaded.transport?.type)})`,
    );
  }
  const config = resolveConfig(loaded);
  await new TestServerStdio(config).start();
  // Stdio transport holds the process open; exit is the client closing us.
}

main().catch((err) => {
  process.stderr.write(`mcpdo-eval-server-launcher: ${err?.message ?? err}\n`);
  process.exit(1);
});
