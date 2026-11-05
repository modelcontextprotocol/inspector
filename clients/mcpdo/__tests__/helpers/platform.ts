/**
 * Why some mcpdo suites skip on Windows (#2748), stated once.
 *
 * mcpdo is experimental, and its connection daemon was built and tested
 * against a Unix domain socket. Production code already derives a named
 * pipe on win32 (`getDaemonSocketPath`), but these suites were written for
 * the socket: they bind or poll `<dir>/mcpdod.sock` directly (which Windows
 * refuses with `EACCES`), wait for that file to vanish before tearing down
 * (a pipe never appears there, so a live daemon keeps the temp dir open and
 * `rmSync` fails `EBUSY`), and assert POSIX-only premises such as `0700`
 * directories and the `sun_path` limit.
 *
 * Making them pass on Windows means porting the daemon's test harness to
 * named pipes. That is real work, so it is not folded into a fix for the gate.
 * Until it is done, a suite that needs a live daemon or a socket file is
 * skipped on win32 by name at its own site with a pointer here. The POSIX runs
 * keep every one of them and the coverage gate they carry.
 */
export const unixDaemonOnly = process.platform === "win32";
