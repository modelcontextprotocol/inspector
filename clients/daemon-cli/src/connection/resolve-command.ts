import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a bare stdio command name to an absolute path using the CALLER's
 * `PATH`, before the config crosses the IPC boundary.
 *
 * The daemon inherits the environment of whichever mcpdo invocation first
 * spawned it, so a bare `node` would otherwise be looked up in a stale
 * `PATH` (a different nvm version, a venv from another shell) — the daemon
 * could run a different binary than the one the user's shell would.
 * Resolving here spawns exactly the caller's binary without forwarding any
 * environment across the boundary.
 *
 * Commands containing a path separator are returned unchanged: the daemon
 * resolves those against the connection cwd, which connect already pins to the
 * caller's cwd. Names not found on `PATH` are also returned unchanged so the
 * daemon's spawn error remains the user-visible failure.
 */
export function resolveCommandPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!command || command.includes("/") || command.includes(path.sep)) {
    return command;
  }
  const pathVar = env.PATH ?? "";
  /* v8 ignore next 4 -- platform-only branch: PATHEXT applies on win32 only */
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not there / not executable — keep looking.
      }
    }
  }
  return command;
}
