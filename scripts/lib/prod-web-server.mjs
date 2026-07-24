/**
 * Shared boot/readiness helper for the prod web smokes.
 *
 * Both `scripts/smoke-web.mjs` (serves-the-HTML check) and
 * `scripts/smoke-web-browser.mjs` (runs-the-bundle check, #1615) boot the *same*
 * prod `mcp-inspector --web` server, so the spawn + readiness-poll boilerplate
 * lives here once instead of being copy-pasted (and drifting) in each script.
 *
 * Repo-root paths are derived from import.meta.url, so a caller's cwd (e.g.
 * `smoke:web:browser` does `cd clients/web` first so its `npx playwright
 * install` finds the local bin) doesn't affect which launcher/build tree runs.
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");
const launcherEntry = resolve(repoRoot, "clients/launcher/build/index.js");

/**
 * Spawn `mcp-inspector --web` (prod, no `--dev`) against the built
 * `clients/web/dist` and return handles for readiness + teardown.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.port
 * @param {string} opts.token  value injected as MCP_INSPECTOR_API_TOKEN
 */
export function startProdWebServer({ host, port, token }) {
  const baseUrl = `http://${host}:${port}`;

  const child = spawn(process.execPath, [launcherEntry, "--web"], {
    env: {
      ...process.env,
      CLIENT_PORT: port,
      HOST: host,
      MCP_INSPECTOR_API_TOKEN: token,
      // Don't pop a browser in CI.
      MCP_AUTO_OPEN_ENABLED: "false",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  let exited = false;
  let exitCode = null;
  let spawnError = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });
  // A spawn-level failure (e.g. a missing launcher entry) emits 'error', not
  // 'exit'; without a listener Node throws it uncaught with a raw stack instead
  // of the smoke's `… FAILED —` line. Capture it so readiness surfaces it.
  child.on("error", (err) => {
    exited = true;
    spawnError = err;
  });

  function bootFailure(phase) {
    return new Error(
      spawnError
        ? `launcher failed to spawn: ${spawnError.message}`
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
      if (exited) throw bootFailure("before serving");
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
      if (exited) onDeath();
      else {
        child.once("exit", onDeath);
        child.once("error", onDeath);
      }
    });
  }

  return {
    baseUrl,
    waitForReady,
    whenChildExits,
    stop: () => {
      if (!exited) child.kill("SIGTERM");
    },
  };
}
