#!/usr/bin/env node
/**
 * Headless-browser boot smoke for the prod web client (#1615).
 *
 * `smoke:web` (scripts/smoke-web.mjs) only asserts that `GET /` serves the SPA
 * HTML with the injected auth token — it never executes the React app, so a
 * regression that only manifests when the bundle *runs* slips through. The
 * canonical example (#1612): the browser bundle transitively value-imported a
 * Node-only module (`store-io` → `atomically` → `stubborn-fs` → `node:process`),
 * pulling a Node built-in into the browser graph and crashing the app to a blank
 * page at runtime. Unit/integration tests run in node / happy-dom, never a real
 * browser bundle, so none of them caught it.
 *
 * The assertion: the prod bundle **boots and paints its first meaningful frame
 * (the "Add Servers" control) with no uncaught page error.** That is how a
 * Node-only module reaching the browser bundle actually manifests under Vite:
 * the excluded module is replaced by an empty stub, and the first call into it
 * (e.g. `fs.readFileSync(...)` during a transitive module's init) throws a
 * `TypeError` that aborts app mount — an uncaught `pageerror` here.
 *
 * What this does NOT rely on: the literal `Module "…" has been externalized`
 * string. Under Vite 8 that is a **build-time** warning (surfaced by
 * `vite build`, i.e. `npm run build`), not a runtime message — the shipped stub
 * is a silent `module.exports = {}`. So the browser never sees that string; the
 * load-bearing signal is the uncaught `TypeError`. (Corollary: an externalized
 * import that is never *called* ships a harmless empty object and is invisible
 * to this smoke by design — an unused Node import doesn't crash the app.)
 *
 * Two channels carry the failure. A *synchronous* uncaught exception (the
 * CASE-1 shape above — a stub call during module init) fires `pageerror`. Its
 * *async* twin — the same `TypeError` reached through an `await`/`.then()`, or a
 * failed dynamic import (this app lazy-loads chunks) — is NOT a `pageerror`; it
 * arrives on the **console** channel as `Uncaught (in promise) …` /
 * `Failed to fetch dynamically imported module`. Both are hard failures, and
 * both channels are read on every engine rather than branching per browser.
 *
 * Every *other* `console.error` is NOT a hard failure: the console is also where
 * benign things a boot smoke shouldn't fail on land — a failed
 * subresource load (e.g. the Google-Fonts `<link>` in index.html on a
 * network-restricted box) or a React key/prop warning. Those are printed as
 * diagnostics. The `Uncaught` / dynamic-import prefixes are unambiguous — a
 * font/CDN miss reads `Failed to load resource: net::ERR_…` and a React warning
 * never starts with `Uncaught` — so hard-failing on them can't reintroduce that
 * flake.
 *
 * Launching the browser (and resolving Playwright from clients/web, which has
 * its own gotcha — see `lib/headless-browser.mjs`) is delegated to that module,
 * which is also where `SMOKE_BROWSER` picks the engine: `chromium` (the
 * default), `firefox`, or `webkit` (#2086). GitHub CI runs this in **Chromium**
 * only; `npm run local:gate`, the local pre-push gate, also runs it in **Firefox** via
 * `smoke:web:firefox`; **WebKit is on demand only**. This smoke passes in all
 * three — it is the two App smokes that fail under WebKit (see their headers).
 *
 * The engine question here is narrower than in the App smokes — this asserts a clean
 * first paint, i.e. that the shipped bundle's syntax and API level are
 * *reachable* on the engine at all, rather than anything about the sandbox — but
 * it is real, and it is nearly free to include.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this.
 */

import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";
import { BROWSER_TIMEOUTS } from "./lib/browser-timeouts.mjs";
import {
  attachPageDiagnostics,
  loadBrowser,
  resolveBrowserName,
} from "./lib/headless-browser.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Resolved before the web server is started, so an unsupported SMOKE_BROWSER
// fails immediately. Every message carries the engine, so a failure names which
// one broke.
let BROWSER;
try {
  BROWSER = resolveBrowserName();
} catch (err) {
  console.error(
    `smoke:web:browser FAILED — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
const LABEL = `smoke:web:browser [${BROWSER}]`;

const HOST = "127.0.0.1";
// Distinct from smoke:web's SMOKE_WEB_PORT so overriding one doesn't make both
// back-to-back smokes bind the same port (→ EADDRINUSE on the second).
const PORT = process.env.SMOKE_WEB_BROWSER_PORT ?? "6298";
const TOKEN = "smoke-web-browser-token";

const server = startProdWebServer({
  host: HOST,
  port: PORT,
  token: TOKEN,
  label: LABEL,
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
  await server.stop();
}

async function fail(message) {
  console.error(`${LABEL} FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

try {
  await server.waitForReady();
  browser = await loadBrowser(repoRoot, BROWSER);
  const page = await browser.newPage();

  // Uncaught (synchronous) page errors are a hard failure — a Node-only module
  // reaching the browser bundle surfaces here as a TypeError when its empty stub
  // is called during module init. Console errors are diagnostic only EXCEPT the
  // async half of that same crash class; see the header comment, and the shared
  // helper for the split.
  const diagnostics = attachPageDiagnostics(page);

  const render = async () => {
    // Token is injected into index.html by the prod server, so a bare `/` load
    // authenticates without a query param.
    const response = await page.goto(server.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUTS.ui,
    });
    if (!response || !response.ok()) {
      throw new Error(
        `GET / returned HTTP ${response ? response.status() : "no response"}`,
      );
    }
    // First meaningful frame: the always-present "Add Servers" control.
    await page
      .getByRole("button", { name: /Add Servers/ })
      .waitFor({ state: "visible", timeout: BROWSER_TIMEOUTS.ui });
    // Settle window: let lazily-evaluated chunks that throw a tick after first
    // paint surface before we assert a clean boot. networkidle is best-effort
    // (the Google-Fonts request may never idle on a restricted network).
    await page
      .waitForLoadState("networkidle", { timeout: BROWSER_TIMEOUTS.bestEffort })
      .catch(() => {});
    await delay(500);
  };

  // Race the render against launcher death so a mid-load server crash is
  // reported as the real cause instead of a 30s render timeout.
  try {
    await Promise.race([server.whenChildExits(), render()]);
  } catch (err) {
    const notes = [
      ...diagnostics.pageErrors,
      ...diagnostics.consoleErrors.map((m) => `console: ${m}`),
    ];
    await fail(
      `${err instanceof Error ? err.message : String(err)}${
        notes.length ? ` — page diagnostics: ${notes.join("; ")}` : ""
      }`,
    );
  }

  // Hard failures: any uncaught (sync) page error, plus console errors that are
  // the async half of the class (unhandled rejection / failed dynamic import).
  const fatal = diagnostics.fatal();
  if (fatal.length > 0) {
    await fail(`app logged uncaught error(s): ${fatal.join("; ")}`);
  }

  // Non-fatal console errors: surface them so a real problem isn't invisible,
  // without failing the smoke on benign subresource/warning noise.
  const benign = diagnostics.benignConsole();
  if (benign.length > 0) {
    console.log(
      `${LABEL} note — ${benign.length} non-fatal console error(s): ${benign.join("; ")}`,
    );
  }

  console.log(
    `${LABEL} OK — app booted at ${server.baseUrl}, rendered "Add Servers" with no uncaught errors (sync page error or unhandled rejection)`,
  );
  await shutdown();
  process.exit(0);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
