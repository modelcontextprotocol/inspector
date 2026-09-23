#!/usr/bin/env node
/**
 * Session daemon entrypoint. Spawned detached by {@link ensureDaemon}.
 * Optional foreground `mcpi daemon run` is not shipped yet (see v2_cli_v2.md).
 */
import { DaemonServer } from "./server.js";
import { generateDaemonToken, getDaemonTokenFromEnv } from "./auth.js";
import { ensureDaemonDir } from "./paths.js";

async function main(): Promise<void> {
  const server = new DaemonServer({
    // No tokenless daemons: when the spawner didn't hand one down via
    // MCP_INSPECTOR_DAEMON_TOKEN, generate one. start() publishes it to
    // daemon.token (0600) for clients to read.
    requiredToken: getDaemonTokenFromEnv() ?? generateDaemonToken(),
    onShutdown: () => {
      // Allow natural exit once the server closes and idle work finishes.
      process.exitCode = 0;
    },
  });

  // Never keep the cwd of whichever mcpi invocation happened to spawn this
  // daemon: connects would resolve relative stdio paths against it (and pin
  // the directory against unmounting). The front end always sends an
  // explicit cwd for stdio servers, so the daemon's own cwd is inert.
  ensureDaemonDir(server.dir);
  process.chdir(server.dir);

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
