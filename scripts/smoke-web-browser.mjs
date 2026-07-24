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
 * app renders its first meaningful frame (the "Add Servers" control).
 *
 * Failure signal: an **uncaught `pageerror`** — that's how the #1612 class
 * arrives (Vite's `__vite-browser-external` proxy *throws* on property access).
 * A `console.error` is NOT treated as a hard failure by itself, because the
 * console is also where Chromium reports benign things a boot smoke shouldn't
 * fail on: a failed subresource load (e.g. the Google-Fonts `<link>` in
 * index.html on a network-restricted box) or a React key/prop warning. Console
 * errors are collected and printed as diagnostics, and only fail the run when
 * they carry the externalized-module signature.
 *
 * Run from the clients/web directory (`npm run smoke:web:browser` does
 * `cd clients/web` first) so `import("playwright")` resolves against that
 * client's node_modules. Repo-root paths are derived inside the shared helper
 * from import.meta.url, so the cwd change doesn't affect which build tree runs.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this.
 */

import { setTimeout as delay } from "node:timers/promises";
import { startProdWebServer } from "./lib/prod-web-server.mjs";

const HOST = "127.0.0.1";
// Distinct from smoke:web's SMOKE_WEB_PORT so overriding one doesn't make both
// back-to-back smokes bind the same port (→ EADDRINUSE on the second).
const PORT = process.env.SMOKE_WEB_BROWSER_PORT ?? "6298";
const TOKEN = "smoke-web-browser-token";

// Vite emits `Module "${id}" has been externalized for browser compatibility…`
// where `id` is whatever was imported — `node:fs` OR a bare `fs` (both common
// in transitive deps). Match either so the diagnostic label always attaches.
const EXTERNALIZED = /Module "[^"]+" has been externalized/;

function labelExternalized(message) {
  return EXTERNALIZED.test(message)
    ? `Node built-in reached the browser bundle: ${message}`
    : message;
}

const server = startProdWebServer({ host: HOST, port: PORT, token: TOKEN });
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
  server.stop();
}

async function fail(message) {
  console.error(`smoke:web:browser FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

async function loadChromium() {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new Error(
      `could not load Playwright — run \`npx playwright install --with-deps chromium\` (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (err) {
    throw new Error(
      `chromium failed to launch — on a bare Linux box run \`npx playwright install --with-deps chromium\` for the system libraries (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

try {
  await server.waitForReady();
  browser = await loadChromium();
  const page = await browser.newPage();

  // Uncaught page errors are the hard failure (the #1612 signature lands here).
  const pageErrors = [];
  // Console errors are diagnostic unless they carry the externalization
  // signature (see the header comment for why they're not a blanket failure).
  const consoleErrors = [];
  page.on("pageerror", (err) =>
    pageErrors.push(err instanceof Error ? err.message : String(err)),
  );
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const render = async () => {
    // Token is injected into index.html by the prod server, so a bare `/` load
    // authenticates without a query param.
    const response = await page.goto(server.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!response || !response.ok()) {
      throw new Error(
        `GET / returned HTTP ${response ? response.status() : "no response"}`,
      );
    }
    // First meaningful frame: the always-present "Add Servers" control.
    await page
      .getByRole("button", { name: /Add Servers/ })
      .waitFor({ state: "visible", timeout: 30_000 });
    // Settle window: let lazily-evaluated chunks that throw a tick after first
    // paint surface before we assert a clean boot. networkidle is best-effort
    // (the Google-Fonts request may never idle on a restricted network).
    await page
      .waitForLoadState("networkidle", { timeout: 5_000 })
      .catch(() => {});
    await delay(500);
  };

  // Race the render against launcher death so a mid-load server crash is
  // reported as the real cause instead of a 30s render timeout.
  try {
    await Promise.race([server.whenChildExits(), render()]);
  } catch (err) {
    const diagnostics = [
      ...pageErrors.map(labelExternalized),
      ...consoleErrors.map((m) => `console: ${labelExternalized(m)}`),
    ];
    await fail(
      `${err instanceof Error ? err.message : String(err)}${
        diagnostics.length
          ? ` — page diagnostics: ${diagnostics.join("; ")}`
          : ""
      }`,
    );
  }

  // Hard failures: any uncaught page error, plus console errors that carry the
  // externalization signature.
  const hardErrors = [
    ...pageErrors.map(labelExternalized),
    ...consoleErrors
      .filter((m) => EXTERNALIZED.test(m))
      .map((m) => `console: ${labelExternalized(m)}`),
  ];
  if (hardErrors.length > 0) {
    await fail(
      `app logged uncaught / externalization errors: ${hardErrors.join("; ")}`,
    );
  }

  // Non-fatal console errors: surface them so a real problem isn't invisible,
  // without failing the smoke on benign subresource/warning noise.
  const benignConsole = consoleErrors.filter((m) => !EXTERNALIZED.test(m));
  if (benignConsole.length > 0) {
    console.log(
      `smoke:web:browser note — ${benignConsole.length} non-fatal console error(s): ${benignConsole.join("; ")}`,
    );
  }

  console.log(
    `smoke:web:browser OK — app booted at ${server.baseUrl}, rendered "Add Servers" with no uncaught page errors`,
  );
  await shutdown();
  process.exit(0);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
