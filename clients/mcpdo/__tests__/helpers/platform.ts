/**
 * Which mcpdo cases skip on Windows, and why that set is small (#2748, #2922).
 *
 * The connection daemon's endpoint is a Unix domain socket on POSIX and a
 * named pipe on win32 (`getDaemonSocketPath`). The suites derive the endpoint
 * from that function and tear a daemon down through
 * `helpers/daemon-endpoint.ts`, so every suite that needs a live daemon runs
 * on the `windows` CI job too.
 *
 * What is left behind this flag is behaviour that does not exist on Windows at
 * all — a socket FILE on disk (stale-file removal, `sun_path` length limits),
 * POSIX mode bits (`0700` directories, `0600` files, the exec bit) and
 * `getuid`-based ownership checks. Each skip names its reason at its own site.
 */
export const isWindows = process.platform === "win32";
