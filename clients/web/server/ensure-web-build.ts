/**
 * Ensure the production web assets exist before the Hono server tries to serve
 * them (#1486).
 *
 * `mcp-inspector --web` (prod, no `--dev`) serves static files from
 * `clients/web/dist/`, which only exists after a build. In the published package
 * `dist/` always ships, so this is a no-op there. In a fresh dev checkout the
 * directory is absent and the prod path would otherwise serve a broken page
 * (`ENOENT` on `index.html`). When the build is missing we build it once, on
 * demand; if that build can't run (e.g. dev dependencies are absent, as in a
 * stripped published install) we throw an actionable error instead of letting
 * the server come up and serve a broken page.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Seams for testing — defaults hit the real filesystem / child process. */
export interface EnsureWebBuildDeps {
  exists?: (path: string) => boolean;
  /** Build the web assets in `webRoot`; returns the child exit code (null if it never ran). */
  build?: (webRoot: string) => number | null;
  log?: (message: string) => void;
}

function runViteBuild(webRoot: string): number | null {
  const result = spawnSync("npm", ["run", "build:client"], {
    cwd: webRoot,
    stdio: "inherit",
    // npm resolves to npm.cmd on Windows, which needs a shell to be spawnable.
    shell: process.platform === "win32",
  });
  return result.status;
}

/**
 * Build `clients/web/dist` on demand when it is missing so `--web` always has
 * something to serve. `webRoot` is the web client root (where `package.json` and
 * the `build:client` script live); `distRoot` is the static-asset directory the
 * Hono server serves from. Throws an actionable error if the build can't be
 * produced — the caller surfaces the message and exits non-zero.
 */
export function ensureWebBuild(
  webRoot: string,
  distRoot: string,
  deps: EnsureWebBuildDeps = {},
): void {
  const exists = deps.exists ?? existsSync;
  const build = deps.build ?? runViteBuild;
  const log = deps.log ?? ((message: string) => console.log(message));

  const indexHtml = join(distRoot, "index.html");
  if (exists(indexHtml)) return;

  log(
    "No production web build found at clients/web/dist. Building the web UI now (first run only; this can take a minute)...",
  );

  const status = build(webRoot);

  if (status !== 0 || !exists(indexHtml)) {
    throw new Error(
      "Could not build the web UI automatically. Build it manually with `npm run build` (run from clients/web), or launch with `--dev` to use the Vite dev server.",
    );
  }
}
