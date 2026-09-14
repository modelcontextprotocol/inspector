#!/usr/bin/env node
/**
 * Fetch the Playwright browser binary a headless web smoke is about to launch
 * (#2086).
 *
 * This replaces the `cd clients/web && npx playwright install chromium` prefix
 * each smoke's npm script used to carry. Two reasons it is a script rather than
 * a longer npm-script line:
 *
 *   - The engine is now a variable. `npx playwright install ${SMOKE_BROWSER:-…}`
 *     is a POSIX-shell expansion that does not expand under Windows' `cmd.exe`,
 *     which npm uses there — it would silently try to install a browser named
 *     `${SMOKE_BROWSER:-chromium}`.
 *   - `npx` is a `.cmd` shim on Windows, which a shell-free spawn cannot start.
 *     `resolveNodeBin` walks to the JS entry behind the package's `bin` and runs
 *     it with `process.execPath` instead — the same fix #1939 made for the
 *     verify scripts, and it keeps the resolution pinned to the repo's own
 *     Playwright rather than whatever `npx` might fetch.
 *
 * Usage: `node scripts/install-smoke-browser.mjs [engine]`. With no argument the
 * engine comes from `SMOKE_BROWSER` (default `chromium`); pass one explicitly
 * where the consumer's engine is fixed regardless of that variable, as
 * `pack:verify` does.
 *
 * Execution lives behind `main()` so importing this module for tests does not
 * run an install — the same shape `verify-typecheck-coverage.mjs` uses.
 */

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SUPPORTED_BROWSERS,
  resolveBrowserName,
} from "./lib/headless-browser.mjs";
import { resolveNodeBin } from "./lib/resolve-node-bin.mjs";

/**
 * Which engine to install: the explicit argument if given, else `SMOKE_BROWSER`.
 *
 * The precedence is the load-bearing part, and it is why this is a function
 * rather than three lines inline. `pack:verify` passes `chromium` explicitly
 * *because* it launches Chromium explicitly — if the argument ever lost to the
 * environment, `SMOKE_BROWSER=webkit npm run pack:verify` would install WebKit
 * and then launch Chromium, and the mismatch would surface as a confusing
 * "Executable doesn't exist" rather than as the wiring error it is.
 *
 * An explicit argument is validated here rather than deferred, so a typo in an
 * npm script fails naming itself instead of reaching the Playwright CLI.
 */
export function resolveRequestedBrowser(argv = [], env = process.env) {
  const requested = argv[0];
  if (requested === undefined) return resolveBrowserName(env);
  if (!SUPPORTED_BROWSERS.includes(requested)) {
    throw new Error(
      `unsupported browser "${requested}" — expected one of ${SUPPORTED_BROWSERS.join(", ")}`,
    );
  }
  return requested;
}

function main() {
  const repoRoot = resolve(import.meta.dirname, "..");
  const webDir = join(repoRoot, "clients", "web");

  let browserName;
  try {
    browserName = resolveRequestedBrowser(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(
      `install-smoke-browser: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  let cli;
  try {
    cli = resolveNodeBin("playwright", "playwright", webDir);
  } catch (err) {
    console.error(
      "install-smoke-browser: could not resolve the Playwright CLI from clients/web — " +
        `run \`npm install\` at the repo root (${err instanceof Error ? err.message : String(err)})`,
    );
    process.exit(1);
  }

  // `install` is a no-op when the binary is already present, so this is cheap on
  // a warm machine and on a CI runner whose Playwright cache was restored.
  const result = spawnSync(process.execPath, [cli, "install", browserName], {
    cwd: webDir,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(
      `install-smoke-browser: could not run the Playwright CLI: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `install-smoke-browser: \`playwright install ${browserName}\` exited ${result.status}`,
    );
    process.exit(result.status ?? 1);
  }
}

// Only when run as a script, never on import (see the header). Same guard as
// verify-typecheck-coverage.mjs — `pathToFileURL` so it holds on Windows paths.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
