/**
 * Shared boot/readiness helper for the prod web smokes.
 *
 * Both `scripts/smoke-web.mjs` (serves-the-HTML check) and
 * `scripts/smoke-web-browser.mjs` (runs-the-bundle check, #1615) boot the *same*
 * prod `mcp-inspector --web` server, so the spawn + readiness-poll boilerplate
 * lives here once instead of being copy-pasted (and drifting) in each script.
 *
 * Repo-root paths are derived from import.meta.url, so a caller's cwd (e.g.
 * `smoke:web:browser` does `cd clients/web` first so `import("playwright")`
 * resolves) doesn't affect which launcher/build tree is exercised.
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
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  /**
   * Poll `GET /` until the server answers with an ok status. Rejects early if
   * the launcher exits before serving (so a boot failure surfaces immediately
   * instead of after the full timeout). Resolves with the first ok Response.
   */
  async function waitForReady({ attempts = 120, intervalMs = 500 } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (exited) {
        throw new Error(
          `launcher exited (code ${exitCode}) before serving — see output above`,
        );
      }
      try {
        const res = await fetch(`${baseUrl}/`);
        if (res.ok) return res;
      } catch {
        // not listening yet
      }
      await delay(intervalMs);
    }
    throw new Error(
      `server did not start within ${(attempts * intervalMs) / 1000}s`,
    );
  }

  /**
   * A promise that rejects when the launcher process exits — race it against
   * page-load work so a mid-flight server death is reported as the real cause
   * instead of a downstream render timeout. Never resolves; if the server stays
   * up it simply stays pending until the process exits.
   */
  function whenChildExits() {
    return new Promise((_resolve, reject) => {
      const onExit = (code) =>
        reject(
          new Error(
            `launcher exited (code ${code ?? exitCode}) mid-run — see output above`,
          ),
        );
      if (exited) onExit(exitCode);
      else child.once("exit", onExit);
    });
  }

  return {
    baseUrl,
    child,
    isExited: () => exited,
    exitCode: () => exitCode,
    waitForReady,
    whenChildExits,
    stop: () => {
      if (!exited) child.kill("SIGTERM");
    },
  };
}
