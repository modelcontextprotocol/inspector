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
 * `console.error` is NOT a hard failure: the console is where Chromium also
 * reports benign things a boot smoke shouldn't fail on — a failed subresource
 * load (e.g. the Google-Fonts `<link>` in index.html on a network-restricted
 * box) or a React key/prop warning. Console errors are printed as diagnostics.
 *
 * Playwright lives in clients/web's node_modules, so it's resolved with a
 * `createRequire` based at clients/web/package.json rather than a bare
 * `import("playwright")`. A bare ESM specifier resolves relative to *this
 * script's* directory (scripts/), not the cwd — so `cd clients/web` in the npm
 * script would NOT make it resolvable (it only appeared to work locally when an
 * ancestor node_modules happened to carry playwright; it fails in CI, which has
 * none). createRequire pins resolution to clients/web regardless of cwd.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this.
 */

import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// Resolve playwright from clients/web (where it's installed) no matter the cwd.
const requireFromWeb = createRequire(
  resolve(scriptDir, "..", "clients/web/package.json"),
);

const HOST = "127.0.0.1";
// Distinct from smoke:web's SMOKE_WEB_PORT so overriding one doesn't make both
// back-to-back smokes bind the same port (→ EADDRINUSE on the second).
const PORT = process.env.SMOKE_WEB_BROWSER_PORT ?? "6298";
const TOKEN = "smoke-web-browser-token";

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
  let chromium;
  try {
    ({ chromium } = requireFromWeb("playwright"));
  } catch (err) {
    throw new Error(
      `could not load Playwright from clients/web — run \`npx playwright install --with-deps chromium\` (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    return await chromium.launch({ headless: true });
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

  // Uncaught page errors are the hard failure — a Node-only module reaching the
  // browser bundle surfaces here as a TypeError when its empty stub is called.
  const pageErrors = [];
  // Console errors are diagnostic only (see the header comment for why they're
  // not a blanket failure).
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
      ...pageErrors,
      ...consoleErrors.map((m) => `console: ${m}`),
    ];
    await fail(
      `${err instanceof Error ? err.message : String(err)}${
        diagnostics.length
          ? ` — page diagnostics: ${diagnostics.join("; ")}`
          : ""
      }`,
    );
  }

  if (pageErrors.length > 0) {
    await fail(`app logged uncaught page error(s): ${pageErrors.join("; ")}`);
  }

  // Non-fatal console errors: surface them so a real problem isn't invisible,
  // without failing the smoke on benign subresource/warning noise.
  if (consoleErrors.length > 0) {
    console.log(
      `smoke:web:browser note — ${consoleErrors.length} non-fatal console error(s): ${consoleErrors.join("; ")}`,
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
