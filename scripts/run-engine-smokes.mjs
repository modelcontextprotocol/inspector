#!/usr/bin/env node
/**
 * Run the three headless web smokes in one browser engine (#2086).
 *
 * `SMOKE_BROWSER=firefox npm run smoke:web:engine` needs the variable to reach
 * three child processes, and a POSIX `VAR=x npm run …` prefix does not work
 * under Windows' `cmd.exe`, which npm uses there. Setting it in the child env
 * from Node does, on every platform — the same reason `install-smoke-browser`
 * exists rather than an inline shell expansion.
 *
 * It also gives the smoke list ONE home. `ENGINE_SMOKES` is that list, and
 * EVERY tier reads it — the default Chromium run inside `npm run smoke`
 * (`smoke:web:chromium`), the Firefox pass in the pre-push gate
 * (`smoke:web:firefox`), and the on-demand `smoke:web:engine`. Getting that
 * wrong is silent: a tier that enumerated the smokes itself would simply run
 * fewer of them and still pass, so `run-engine-smokes.test.mjs` asserts that no
 * tier names an individual smoke.
 *
 * Usage: `node scripts/run-engine-smokes.mjs [engine]`. With no argument the
 * engine comes from `SMOKE_BROWSER` (default `chromium`).
 */

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRequestedBrowser } from "./install-smoke-browser.mjs";

/**
 * The smokes that are engine-sensitive, in run order.
 *
 * Cheapest first, so a bundle that cannot even boot on the engine fails in
 * seconds rather than after two full App flows have timed out.
 */
export const ENGINE_SMOKES = [
  "smoke-web-browser.mjs",
  "smoke-web-app.mjs",
  "smoke-web-elicitation.mjs",
];

function main() {
  const scriptDir = resolve(import.meta.dirname);

  let browserName;
  try {
    browserName = resolveRequestedBrowser(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(
      `run-engine-smokes: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // Children inherit this rather than reading the ambient variable, so an
  // explicit argument wins over SMOKE_BROWSER all the way down.
  const env = { ...process.env, SMOKE_BROWSER: browserName };

  const install = spawnSync(
    process.execPath,
    [join(scriptDir, "install-smoke-browser.mjs"), browserName],
    { stdio: "inherit", env },
  );
  if (install.status !== 0) process.exit(install.status ?? 1);

  for (const smoke of ENGINE_SMOKES) {
    const result = spawnSync(process.execPath, [join(scriptDir, smoke)], {
      stdio: "inherit",
      env,
    });
    if (result.error) {
      console.error(
        `run-engine-smokes: could not run ${smoke}: ${result.error.message}`,
      );
      process.exit(1);
    }
    if (result.status !== 0) {
      // The smoke has already printed its own diagnosis; add only the engine,
      // so a failure in the pre-push gate names which run it came from.
      console.error(`run-engine-smokes: ${smoke} failed under ${browserName}`);
      process.exit(result.status ?? 1);
    }
  }
}

// Only when run as a script, never on import — see install-smoke-browser.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
