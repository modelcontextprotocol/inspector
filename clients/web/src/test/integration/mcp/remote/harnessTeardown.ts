import type { ServerType } from "@hono/node-server";

/**
 * Deterministically close a Hono-served HTTP server in test teardown.
 *
 * Node's `server.close(cb)` stops accepting new connections and then waits for
 * every existing keep-alive socket to go idle before firing its callback.
 * undici's global-`fetch` connection pool holds sockets open, and under the
 * full parallel/instrumented `npm run coverage` load they may not go idle
 * before the 30s `afterEach` timeout — the #1667 teardown hang. Some of these
 * suites' sessions (crash-on-startup / dead-transport) never disconnect, so the
 * session and its dead subprocess transport also linger at close time.
 *
 * Force the pooled sockets closed with `closeAllConnections()` alongside
 * `close()` so the callback fires regardless of load. `closeAllConnections` is
 * declared only on http1's `Server` (absent on the `Http2Server` arm of
 * `ServerType`); `serve()` returns an http1 server here, so the `in` narrow is
 * always taken at runtime while keeping the union type-safe without a cast.
 */
export async function closeHarnessServer(server: ServerType): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    if ("closeAllConnections" in server) server.closeAllConnections();
  });
}
