#!/usr/bin/env node
/**
 * Session daemon entrypoint. Spawned detached by {@link ensureDaemon}.
 * Optional foreground `mcpi daemon run` is not shipped yet (see v2_cli_v2.md).
 */
import { DaemonServer } from "./server.js";

async function main(): Promise<void> {
  const server = new DaemonServer({
    onShutdown: () => {
      // Allow natural exit once the server closes and idle work finishes.
      process.exitCode = 0;
    },
  });

  const shutdown = () => {
    void server.stop("signal").then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mcpi daemon: ${message}\n`);
  process.exit(1);
});
