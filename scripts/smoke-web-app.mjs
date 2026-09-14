#!/usr/bin/env node
/**
 * Headless-browser MCP Apps smoke for the prod web client (#1859).
 *
 * `smoke:web:browser` proves the bundle boots and paints its first frame. It
 * stops there — it never connects to a server, so everything downstream of the
 * connect (the Apps tab, the sandbox controller, the UI-protocol bridge) is
 * unexercised by any smoke. This closes that gap: it drives the full
 * **connect → open app → widget ready** chain against a real MCP App server.
 *
 * A second phase (#2056) drives the same app declaring `_meta.ui.domain`, and
 * asserts the thing that field exists for: the app document is served from the
 * backend's dedicated app-origin listener and runs at a REAL origin, not the
 * opaque one whose requests carry `Origin: null`. Both phases end at
 * `data-app-status="ready"`, so only reading the inner frame's own
 * `location.origin` can tell them apart.
 *
 * The flow both phases share lives in `lib/mcp-app-flow.mjs`, shared with
 * `pack:verify` (#2003) — see that header for why it is shared rather than
 * copied, and for the `data-app-status="ready"` contract the assertion rests on.
 *
 * ── What this does and does NOT catch ───────────────────────────────────────
 *
 * This runs against the **repo build tree**, like every other `smoke:*`. That
 * matters for the bug that motivated it: #1859 was a *packaging* failure —
 * `clients/web/static/sandbox_proxy.html` was missing from the published
 * tarball's "files" allowlist. In the repo that file is always present, so this
 * smoke would have stayed green through that entire bug.
 *
 * The packaging dimension is owned by `npm run pack:verify`, which asserts the
 * file in the tarball packlist and on disk after a real install — and, since
 * #2003, drives phase 1's flow against the **installed** bin. Keep both:
 * pack:verify covers the published artifact, this covers the repo tree on every
 * `npm run local:gate`, where pack:verify (network-bound, local/release-only) does not
 * run — and this is the only one of the two that drives phase 2. Neither
 * subsumes the other.
 *
 * As a cheap extra, this does assert the proxy page exists at the location the
 * runtime resolves it from (`clients/web/build/../static/…`, see
 * server/sandbox-controller.ts) — which catches the file being *moved or
 * renamed* without its reader being updated, a repo-tree failure pack:verify
 * would only find later.
 *
 * ── Which engine ────────────────────────────────────────────────────────────
 *
 * `SMOKE_BROWSER` picks the engine (`chromium` — the default — `firefox`, or
 * `webkit`). Three tiers, deliberately (#2086):
 *
 *   - **GitHub CI** runs this smoke in **Chromium** only.
 *   - **`npm run local:gate`**, the local pre-push gate, runs it in **Chromium and
 *     Firefox** — the Firefox pass is `smoke:web:firefox`, and it is the one
 *     gate step with no GitHub CI counterpart.
 *   - **WebKit is on demand only**: `SMOKE_BROWSER=webkit npm run smoke:web:app`
 *     for this smoke alone, or `npm run smoke:web:webkit` for all three.
 *
 * Firefox passes. WebKit fails this smoke for reasons nobody has identified and
 * nobody is investigating: it does not reproduce in real Safari, and an isolated
 * SSE repro did not reproduce it under Playwright's WebKit either, so it reads
 * as a property of that build rather than a browser bug. Do not read a WebKit
 * failure here as a defect until someone has actually looked.
 *
 * This smoke is one of the two places the
 * MCP Apps sandbox is genuinely exercised, and the sandbox is built out of the
 * primitives that actually diverge between engines — `srcdoc` CSP inheritance,
 * nested sandboxed iframes, `Permissions-Policy`, cross-frame `postMessage`. See
 * `lib/headless-browser.mjs`, including why a green WebKit run is not a Safari
 * guarantee.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this. `test-servers/build` is rebuilt on
 * every run, as in smoke:cli — see `scripts/lib/ensure-test-servers.mjs` for why
 * presence isn't freshness. This smoke is the one that found that out: a
 * `v2/main` merge touching `preset-registry.ts` made it report the dedicated
 * app-origin path as broken when it was really driving the pre-merge fixture.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";
import { stopChild } from "./lib/child-cleanup.mjs";
import {
  attachPageDiagnostics,
  loadBrowser,
  resolveBrowserName,
} from "./lib/headless-browser.mjs";
import {
  APP_TOOL,
  buildAppDeepLink,
  driveAppFlow,
  sandboxProxyPageFor,
  startMcpAppServer,
} from "./lib/mcp-app-flow.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

// Resolved before anything is started, so an unsupported SMOKE_BROWSER fails
// immediately rather than after a web server and two MCP servers are up. Every
// message this smoke prints carries the engine, so a failure names which one
// broke rather than leaving the reader to remember what they invoked it with.
let BROWSER;
try {
  BROWSER = resolveBrowserName();
} catch (err) {
  console.error(
    `smoke:web:app FAILED — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
const LABEL = `smoke:web:app [${BROWSER}]`;

// Resolved exactly as the runtime does, from the built runner's directory.
const sandboxProxyPage = sandboxProxyPageFor(
  join(repoRoot, "clients", "web", "build"),
);

const HOST = "127.0.0.1";
// Distinct from smoke:web (6299) and smoke:web:browser (6298) so a prior smoke
// whose port is still bound — slow teardown, TIME_WAIT, or a parallel run —
// can't EADDRINUSE this one. The three run back-to-back in `npm run smoke`.
const PORT = process.env.SMOKE_WEB_APP_PORT ?? "6297";
const TOKEN = "smoke-web-app-token";
// The URL each test server announces on startup — authoritative over the
// config's port; see startMcpAppServer.
let mcpUrl = null;

let mcpServer = null;
let domainMcpServer = null;
let browser = null;
const server = startProdWebServer({
  host: HOST,
  port: PORT,
  token: TOKEN,
  label: LABEL,
});

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
  if (mcpServer) {
    const child = mcpServer;
    mcpServer = null;
    await stopChild(child, { label: LABEL, what: "MCP test server" });
  }
  if (domainMcpServer) {
    const child = domainMcpServer;
    domainMcpServer = null;
    await stopChild(child, { label: LABEL, what: "MCP test server (domain)" });
  }
}

async function fail(message) {
  console.error(`${LABEL} FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

try {
  // Cheap structural check first: the sandbox proxy page must exist where the
  // runtime looks for it. Fails fast with a clear cause instead of surfacing as
  // an opaque "app never reached ready" 45s timeout below.
  if (!existsSync(sandboxProxyPage)) {
    await fail(
      `sandbox proxy page missing at ${sandboxProxyPage} — clients/web/server/sandbox-controller.ts ` +
        `reads it as \`join(__dirname, "../static/sandbox_proxy.html")\`; if it moved, update both ` +
        `(and the "files" allowlist in the root package.json, see #1859)`,
    );
  }

  // `startMcpAppServer` publishes the child through `onSpawn` itself, so
  // teardown reaches it even when this throws before returning (#2000).
  mcpUrl = await startMcpAppServer({
    repoRoot,
    onSpawn: (child) => {
      mcpServer = child;
    },
    label: LABEL,
  });
  await server.waitForReady();
  browser = await loadBrowser(repoRoot, BROWSER);
  const page = await browser.newPage();
  const diagnostics = attachPageDiagnostics(page);

  const deepLink = (target) =>
    buildAppDeepLink({
      baseUrl: server.baseUrl,
      mcpUrl: target,
      token: TOKEN,
      appArgs: { title: LABEL },
    });

  /** The frames a failure should name, so "never rendered" reads differently
   *  from "rendered at the wrong origin". */
  const frameList = () =>
    `frames: ${page
      .frames()
      .map((f) => f.url() || "(blank)")
      .join(", ")}`;

  /**
   * Phase 2 (#2056): the same app, this time declaring `_meta.ui.domain`.
   *
   * Phase 1 proves the default render works; it cannot distinguish it from the
   * dedicated-origin render, because both end at `data-app-status="ready"`. The
   * thing #2056 is actually about is the *origin the app document runs at* — an
   * opaque origin sends `Origin: null`, which no CORS / OAuth-callback /
   * API-key allowlist can admit. So this phase asserts the two facts that only
   * hold on the dedicated path: the inner frame was navigated to a published
   * document on the backend's app-origin listener, and the document's own
   * `location.origin` is a real origin rather than the literal "null".
   *
   * It reuses the running web server and browser page — only a second MCP
   * server and a second deep-link navigate are added. The deep-link gate is not
   * re-asserted (`expectDeepLink: false`): it was proven on the first navigate,
   * and a rejected one would fail at the connect wait regardless.
   */
  const driveDedicatedOrigin = async () => {
    const domainUrl = await startMcpAppServer({
      repoRoot,
      config: "mcp-app-domain-http",
      onSpawn: (child) => {
        domainMcpServer = child;
      },
      label: LABEL,
    });
    await driveAppFlow({
      page,
      url: deepLink(domainUrl),
      expectDeepLink: false,
      what: "dedicated-origin app",
      extraDiagnostics: frameList,
    });

    const appFrame = page
      .frames()
      .find((f) => /\/app-document\/[0-9a-f]{32}$/.test(f.url()));
    if (!appFrame) {
      throw new Error(
        "app declaring _meta.ui.domain was not served from the dedicated app " +
          `origin — no frame at /app-document/<id> (${frameList()})`,
      );
    }
    const origin = await appFrame.evaluate(() => window.location.origin);
    if (!/^http:\/\/[^/]+$/.test(origin)) {
      throw new Error(
        `app document ran at origin "${origin}" — expected a real http origin. ` +
          "An opaque origin sends `Origin: null`, which is the bug #2056 fixes.",
      );
    }
    return { origin, url: appFrame.url() };
  };

  // Race against launcher death so a mid-run server crash is reported as the
  // real cause instead of a downstream timeout.
  let dedicated = null;
  try {
    await Promise.race([
      server.whenChildExits(),
      driveAppFlow({ page, url: deepLink(mcpUrl) }),
    ]);
    dedicated = await Promise.race([
      server.whenChildExits(),
      driveDedicatedOrigin(),
    ]);
  } catch (err) {
    const notes = [
      ...diagnostics.pageErrors,
      ...diagnostics.fatalConsole().map((m) => `console: ${m}`),
    ];
    await fail(
      `${err instanceof Error ? err.message : String(err)}${
        notes.length ? ` — page diagnostics: ${notes.join("; ")}` : ""
      }`,
    );
  }

  // Hard failures: any uncaught sync page error, plus the console errors that
  // are the async half of the same class.
  const fatal = diagnostics.fatal();
  if (fatal.length > 0) {
    await fail(`app logged uncaught error(s): ${fatal.join("; ")}`);
  }

  // Non-fatal console errors: surface them so a real problem isn't invisible,
  // without failing on benign subresource/warning noise.
  const benign = diagnostics.benignConsole();
  if (benign.length > 0) {
    console.log(
      `${LABEL} note — ${benign.length} non-fatal console error(s): ${benign.join("; ")}`,
    );
  }

  console.log(
    `${LABEL} OK — connected to ${mcpUrl}, opened "${APP_TOOL}", ` +
      `widget reached data-app-status="ready" through the sandbox proxy; ` +
      `and an app declaring _meta.ui.domain rendered from the dedicated origin ` +
      `${dedicated?.origin} (${dedicated?.url})`,
  );
  await shutdown();
  process.exit(0);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
