/**
 * Pre-build step for `build:dev`: stop a daemon still running from a previous
 * build so the fresh bundle isn't shadowed by a stale resident process.
 *
 * Best-effort by design — a missing `build/` (first build) or no running
 * daemon must not fail the build. Kept as a script rather than shell syntax
 * so the npm script works on Windows too (cmd.exe has no `;` sequencing or
 * `/dev/null`).
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync(process.execPath, ["build/mcp-bin.js", "daemon", "stop"], {
    stdio: "ignore",
  });
} catch {
  // Nothing to stop (or nothing built yet) — proceed with the build.
}
