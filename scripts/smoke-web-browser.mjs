#!/usr/bin/env node
/**
 * Headless-browser boot smoke for the prod web client (#1615).
 *
 * `smoke:web` (scripts/smoke-web.mjs) only asserts that `GET /` serves the SPA
 * HTML with the injected auth token — it never executes the React app, so a
 * regression that only manifests when the bundle *runs* slips through. The
 * canonical example (#1612): the browser bundle transitively value-imported a
 * Node-only module, pulling `node:*` built-ins into the browser build and
 * crashing the app to a blank page with
 *   `Module "node:*" has been externalized for browser compatibility`.
 * Unit/integration tests run in node / happy-dom, never a real browser bundle,
 * so none of them caught it.
 *
 * This script closes that gap as a *class* of bug rather than one import at a
 * time: it launches `mcp-inspector --web` (prod, no `--dev`) against the built
 * `clients/web/dist`, opens the served page in headless Chromium (Playwright,
 * already a clients/web devDependency for the Storybook tests), and asserts the
 * app renders its first meaningful frame (the "Add Servers" control) with **no
 * uncaught page errors** — in particular no `node:*` externalization error.
 *
 * Run from the clients/web directory (`npm run smoke:web:browser` does
 * `cd clients/web` first) so `import("playwright")` resolves against that
 * client's node_modules. Repo-root paths below are derived from import.meta.url,
 * so the cwd change doesn't affect which launcher/build tree is exercised.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this.
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const launcherEntry = resolve(repoRoot, "clients/launcher/build/index.js");

const HOST = "127.0.0.1";
const PORT = process.env.SMOKE_WEB_PORT ?? "6298";
const TOKEN = "smoke-web-browser-token";
const BASE_URL = `http://${HOST}:${PORT}`;

const child = spawn(process.execPath, [launcherEntry, "--web"], {
  env: {
    ...process.env,
    CLIENT_PORT: PORT,
    HOST,
    MCP_INSPECTOR_API_TOKEN: TOKEN,
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

let browser = null;

async function shutdown() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // best-effort
    }
    browser = null;
  }
  if (!exited) child.kill("SIGTERM");
}

async function fail(message) {
  console.error(`smoke:web:browser FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (exited) {
      throw new Error(
        `launcher exited (code ${exitCode}) before serving — see output above`,
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await delay(500);
  }
  throw new Error("server did not start within 60s");
}

// A page error whose message mentions a node: built-in being externalized is
// the #1612 signature; treat *any* uncaught page error as a failure, but call
// this class out explicitly since it's the regression this smoke exists for.
function describeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/Module "node:.*" has been externalized/.test(message)) {
    return `Node built-in reached the browser bundle: ${message}`;
  }
  return message;
}

try {
  const { chromium } = await import("playwright");
  await waitForServer();

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(describeError(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(`console.error: ${msg.text()}`);
  });

  // Token is injected into index.html by the prod server, so a bare `/` load
  // authenticates without a query param.
  const response = await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (!response || !response.ok()) {
    await fail(
      `GET / returned HTTP ${response ? response.status() : "no response"}`,
    );
  }

  // First meaningful frame: the always-present "Add Servers" control.
  await page
    .getByRole("button", { name: /Add Servers/ })
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(async () => {
      await fail(
        `app did not render the "Add Servers" control within 30s${
          pageErrors.length ? ` — page errors: ${pageErrors.join("; ")}` : ""
        }`,
      );
    });

  if (pageErrors.length > 0) {
    await fail(`app rendered but logged page errors: ${pageErrors.join("; ")}`);
  }

  console.log(
    `smoke:web:browser OK — app booted at ${BASE_URL}, rendered "Add Servers" with no page errors`,
  );
  await shutdown();
  process.exit(0);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
