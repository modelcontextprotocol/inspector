/**
 * Shared boot/readiness helper for the prod web smokes.
 *
 * `scripts/smoke-web.mjs` (serves-the-HTML check), `scripts/smoke-web-browser.mjs`
 * (runs-the-bundle check, #1615), `scripts/smoke-web-app.mjs` (MCP Apps
 * end-to-end, #1859) and `scripts/smoke-web-elicitation.mjs` (app-rendered
 * elicitations, #1854) all boot the *same* prod `mcp-inspector --web` server, so
 * the spawn + readiness-poll boilerplate lives here once instead of being
 * copy-pasted (and drifting) in each script. Catalog isolation (#1977) lives here
 * for the same reason — it is a property every web smoke needs, not one script's
 * concern.
 *
 * Repo-root paths are derived from import.meta.url rather than the cwd, so it
 * does not matter where a caller is run from. (Until #2086 the browser-driven
 * smokes were invoked through a `cd clients/web && npx playwright install …`
 * prefix, which is what originally made that independence load-bearing; they now
 * run from the repo root via `scripts/install-smoke-browser.mjs`. Deriving from
 * import.meta.url is still the right call — it is what lets a smoke be run by
 * hand from any directory.)
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { removeSafe, stopChild } from "./child-cleanup.mjs";

const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");
const launcherEntry = resolve(repoRoot, "clients/launcher/build/index.js");

/**
 * Mint a fresh throwaway catalog for one server run.
 *
 * `mkdtemp` (not a fixed name) is what makes concurrent runs safe: the three web
 * smokes run back-to-back today, but a fixed path would have them share — and
 * silently reintroduce the cross-run bleed this whole change removes.
 *
 * The catalog *file* is deliberately not created. The backend seeds an empty
 * catalog on first use, which is exactly the first-run state we want every run
 * to start from.
 *
 * @returns {{ dir: string, path: string }}
 */
export function createTempCatalog() {
  const dir = mkdtempSync(join(tmpdir(), "smoke-web-catalog-"));
  return { dir, path: join(dir, "catalog.json") };
}

/**
 * Build the child env for the prod web server.
 *
 * Split out from the spawn so the isolation contract is unit-testable without
 * starting a server (#1977). The ordering is load-bearing: `MCP_CATALOG_PATH`
 * is assigned *after* the `process.env` spread, so an inherited value from the
 * developer's shell is overridden rather than silently winning — which would
 * put the smoke straight back on whatever catalog that variable names.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.port
 * @param {string} opts.token
 * @param {string} opts.catalogPath
 * @param {NodeJS.ProcessEnv} [opts.baseEnv]
 */
export function buildWebServerEnv({
  host,
  port,
  token,
  catalogPath,
  baseEnv = process.env,
}) {
  return {
    ...baseEnv,
    CLIENT_PORT: port,
    HOST: host,
    MCP_INSPECTOR_API_TOKEN: token,
    MCP_CATALOG_PATH: catalogPath,
    // Don't pop a browser in CI.
    MCP_AUTO_OPEN_ENABLED: "false",
  };
}

/**
 * Terminate a spawned web server, then remove its catalog dir.
 *
 * The two halves are the documented pair in `child-cleanup.mjs`, and both are
 * needed. `stopChild` closes the #1801 race on the normal path (a bare `kill()`
 * only *delivers* the signal, so a synchronous remove can hit ENOTEMPTY when the
 * server writes the catalog on its way out); `removeSafe` then makes the
 * residual case harmless, warning instead of throwing so a leftover temp dir can
 * never turn a passing smoke red.
 *
 * Exported separately from `startProdWebServer` so the teardown *contract* is
 * testable against a stand-in child, without booting a real launcher. That split
 * is what makes the leak detectable at all: the smokes exit immediately after
 * teardown, so deleting the `removeSafe` call below would leave all three of them
 * green. The focused unit tests in `prod-web-server.test.mjs` are the only thing
 * that fails on it.
 *
 * @param {object} opts
 * @param {import("node:child_process").ChildProcess} opts.child
 * @param {string} opts.catalogDir
 * @param {string} [opts.label]
 */
export async function teardownWebServer({
  child,
  catalogDir,
  label = "smoke:web",
}) {
  await stopChild(child, { label, what: "prod web server" });
  removeSafe(catalogDir, { label });
}

/**
 * Spawn `mcp-inspector --web` (prod, no `--dev`) against the built
 * `clients/web/dist` and return handles for readiness + teardown.
 *
 * The server always runs against a **throwaway catalog**, never the developer's
 * real `~/.mcp-inspector/mcp.json` (#1977). Without `MCP_CATALOG_PATH` the web
 * backend falls back to that default writable catalog, which made these smokes
 * both destructive and non-deterministic: `smoke:web:app`'s deep link persists a
 * `deep-link` server row, so a second run finds it already on disk. The row is
 * then racing hydration — the deep-link effect misses it in `servers`, POSTs
 * `addServer` anyway, and the backend answers 409. The app swallows that 409 by
 * design so the smoke still passes, but it reports a spurious non-fatal console
 * error that is really just residue from the previous run. Isolating the catalog
 * makes every run look like the first one, and mirrors `smoke:cli` / `smoke:tui`,
 * which have always driven a temp `--catalog`.
 *
 * Only the catalog is redirected. Other per-user state under `~/.mcp-inspector`
 * (OAuth tokens, the `storage/` dir) is still shared — isolating that means
 * redirecting HOME wholesale, which these smokes deliberately do not do, since
 * HOME also resolves the npx and Playwright caches they depend on.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.port
 * @param {string} opts.token  value injected as MCP_INSPECTOR_API_TOKEN
 * @param {string} [opts.label]  prefix for teardown warnings (the temp dir's own
 *   prefix is fixed, so every run's dir is greppable as `smoke-web-catalog-*`)
 */
export function startProdWebServer({ host, port, token, label = "smoke:web" }) {
  const baseUrl = `http://${host}:${port}`;

  const { dir: catalogDir, path: catalogPath } = createTempCatalog();

  const child = spawn(process.execPath, [launcherEntry, "--web"], {
    env: buildWebServerEnv({ host, port, token, catalogPath }),
    stdio: ["ignore", "inherit", "inherit"],
  });

  let exited = false;
  let exitCode = null;
  let childError = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });
  // A child 'error' event covers a spawn failure (e.g. a missing launcher
  // entry) but ALSO a failed kill / failed send where the process is still
  // alive. Without a listener Node throws it uncaught with a raw stack instead
  // of the smoke's `… FAILED —` line. Record it, but deliberately do NOT set
  // `exited` — otherwise `stop()` (which guards on `exited`) would skip the
  // SIGTERM and orphan a still-running launcher on the port.
  child.on("error", (err) => {
    childError = err;
  });

  // Boot has failed if the process exited or emitted an error.
  const bootFailed = () => exited || childError !== null;

  function bootFailure(phase) {
    return new Error(
      childError
        ? `launcher process error: ${childError.message}`
        : `launcher exited (code ${exitCode}) ${phase} — see output above`,
    );
  }

  /**
   * Poll `GET /` until the server answers with an ok status. Keeps polling on a
   * non-ok status (a warming server may legitimately answer 503), but records
   * the last one so a server that boots yet never returns ok (e.g. a broken
   * `dist` answering 500) reports that status instead of a bare timeout. Rejects
   * early if the launcher exits before serving. Resolves with the first ok
   * Response.
   */
  async function waitForReady({ attempts = 120, intervalMs = 500 } = {}) {
    let lastStatus = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (bootFailed()) throw bootFailure("before serving");
      try {
        const res = await fetch(`${baseUrl}/`);
        if (res.ok) return res;
        lastStatus = res.status;
      } catch {
        // not listening yet
      }
      await delay(intervalMs);
    }
    throw new Error(
      `server did not start within ${(attempts * intervalMs) / 1000}s${
        lastStatus !== null ? ` (last response: HTTP ${lastStatus})` : ""
      }`,
    );
  }

  /**
   * A promise that rejects when the launcher process dies — race it against
   * page-load work so a mid-flight server death is reported as the real cause
   * instead of a downstream render timeout. Never resolves; if the server stays
   * up it simply stays pending until the process exits.
   */
  function whenChildExits() {
    return new Promise((_resolve, reject) => {
      const onDeath = () => reject(bootFailure("mid-run"));
      if (bootFailed()) onDeath();
      else {
        child.once("exit", onDeath);
        child.once("error", onDeath);
      }
    });
  }

  return {
    baseUrl,
    catalogPath,
    waitForReady,
    whenChildExits,
    /** Terminate the server, then remove its catalog dir. **Await this.** */
    stop: () => teardownWebServer({ child, catalogDir, label }),
  };
}
