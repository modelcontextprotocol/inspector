#!/usr/bin/env node
/**
 * Headless-browser smoke for the MCP Apps sandbox proxy's navigation controls.
 *
 * A frame sandboxed with `allow-scripts` may always navigate ITSELF — the
 * `allow-top-navigation` family governs other frames, never its own — and the
 * sandbox flags follow it, so the page it lands on still has an opaque ("null")
 * origin and is still the proxy's `inner.contentWindow`. That page passes every
 * identity check the relay makes and runs under none of the app's CSP. So
 * `clients/web/static/sandbox_proxy.html` carries two controls, and this smoke
 * is what proves they hold in a real engine:
 *
 *   1. A `frame-src` / `child-src` policy on the proxy document, installed per
 *      render from the approved `frameDomains`. A parent's `frame-src` governs
 *      every navigation of its child frame — including one the child starts —
 *      so an app navigating to an undeclared origin is blocked before any
 *      request leaves the browser.
 *   2. Navigation detection: a refused navigation (a policy violation on the
 *      proxy document) or a second `load` on the srcdoc frame closes the
 *      relay, removes the frame and posts an error notification to the host.
 *
 * Why a browser smoke and not a unit test: both controls are browser
 * behaviour — which policy governs a child navigation, when `load` fires —
 * that happy-dom does not model, and the proxy is a static page outside every
 * coverage `include`. The question is also engine-sensitive, which is why this
 * is an ENGINE_SMOKE: GitHub CI runs it in Chromium, and the pre-push gate
 * also runs it in Firefox (`smoke:web:firefox`).
 *
 * The proxy under test is the REAL one, served by the prod web server's own
 * sandbox listener with its own headers — not a copy. The host side is a
 * minimal page served here, on an origin added to `ALLOWED_ORIGINS` so the
 * proxy's referrer check admits it; it speaks just enough of the bridge
 * protocol (proxy-ready → resource-ready, then a stream of tool results) to
 * stand in for the Inspector. The app document it hands over is wrapped the
 * way the host wraps one: a fixed shell whose first `<head>` child is the
 * app's CSP `<meta>`.
 *
 * Four cases, each on a fresh page (a fresh proxy document):
 *   - a well-behaved app keeps a working bridge (host messages reach it, its
 *     replies reach the host) — the controls must not break the normal path;
 *   - an app navigating itself to an undeclared origin is blocked: the
 *     "attacker" listener sees no request, no message from it reaches the
 *     host, and the host is told the frame was removed;
 *   - an app navigating to a DECLARED frame domain (which control 1 admits by
 *     design — a nested frame to it must load) is still caught by control 2;
 *   - the same, started while the srcdoc's own load is still pending, so the
 *     destination fires the frame's first `load`.
 *
 * Usage: `npm run smoke:web:sandbox` (expects `clients/web/dist` and
 * `clients/launcher/build` to be built, like the other web smokes).
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";
import { BROWSER_TIMEOUTS } from "./lib/browser-timeouts.mjs";
import { loadBrowser, resolveBrowserName } from "./lib/headless-browser.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let BROWSER;
try {
  BROWSER = resolveBrowserName();
} catch (err) {
  console.error(
    `smoke:web:sandbox FAILED — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
const LABEL = `smoke:web:sandbox [${BROWSER}]`;

const HOST = "127.0.0.1";
// Below the 6295–6299 block the other web smokes take, so overriding one of
// them never collides with this one.
const PORT = process.env.SMOKE_WEB_SANDBOX_NAV_PORT ?? "6294";
const HOST_PAGE_PORT = Number(PORT) - 1;
const ATTACKER_PORT = Number(PORT) - 2;
const TOKEN = "smoke-web-sandbox-nav-token";

const hostPageOrigin = `http://${HOST}:${HOST_PAGE_PORT}`;
const attackerOrigin = `http://${HOST}:${ATTACKER_PORT}`;

/** Every request the "attacker" listener sees; the blocked case asserts none. */
const attackerHits = [];

// The proxy admits an embedder only when ALLOWED_ORIGINS names it, and
// `startProdWebServer` builds the child's env from this process's.
process.env.ALLOWED_ORIGINS = [`http://${HOST}:${PORT}`, hostPageOrigin].join(
  ",",
);

const server = startProdWebServer({
  host: HOST,
  port: PORT,
  token: TOKEN,
  label: LABEL,
});
let browser = null;
const listeners = [];

/** A tiny HTML listener; resolves once it is accepting connections. */
function listen(port, handler) {
  return new Promise((resolveListen, rejectListen) => {
    const s = createServer(handler);
    s.once("error", rejectListen);
    s.listen(port, HOST, () => {
      listeners.push(s);
      resolveListen(s);
    });
  });
}

async function shutdown() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // best-effort
    }
    browser = null;
  }
  for (const s of listeners) {
    s.closeAllConnections();
    s.close();
  }
  await server.stop();
}

async function fail(message) {
  console.error(`${LABEL} FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

/**
 * The host wrapper's departure script, verbatim (DEPARTURE_SCRIPT in
 * clients/web/src/utils/sandbox-csp.ts): it tells the proxy when the srcdoc
 * document unloads, which is how a navigation away before the srcdoc's own
 * `load` is detected.
 */
const DEPARTURE_SCRIPT = `<script>(function(){var p=parent;function f(){p.postMessage({"mcpInspectorSandbox":"departing"},"*")}addEventListener("beforeunload",f,true);addEventListener("pagehide",f,true)})()</script>`;

/**
 * Wrap app markup the way the host does (src/utils/sandbox-csp.ts): a fixed
 * shell whose first `<head>` child is the app's CSP (then the departure
 * script), with `frame-src` limited
 * to the declared frame domains and no network egress at all.
 */
function wrapApp(appScript, frameDomains) {
  const frameSrc = frameDomains.length > 0 ? frameDomains.join(" ") : "'none'";
  const policy = [
    "default-src 'none'",
    "connect-src 'none'",
    "script-src 'unsafe-inline'",
    `frame-src ${frameSrc}`,
    "form-action 'none'",
  ].join("; ");
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta charset="utf-8">${DEPARTURE_SCRIPT}</head><body><script>${appScript}</script></body></html>`;
}

/**
 * `value` as a JavaScript literal safe to splice into an inline script:
 * `JSON.stringify` with `<`, `>` and the line separators escaped.
 */
const jsLiteral = (value) =>
  JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

// Every app echoes what it receives, so "the host's messages reach the app"
// is observable from the host page.
const ECHO = `addEventListener("message", (e) => parent.postMessage({ kind: "app-echo" }, "*"));`;
const HELLO = `parent.postMessage({ kind: "app-hello" }, "*");`;
const navigateTo = (url) =>
  `setTimeout(() => { location.href = ${jsLiteral(url)}; }, 50);`;
/**
 * Add a nested frame, which holds the srcdoc's `load` until it finishes, and
 * optionally run `then` once it has loaded.
 */
const nestFrame = (url, then = "") =>
  `{ const f = document.createElement("iframe"); f.src = ${jsLiteral(url)}; f.onload = () => { ${then} }; document.body.appendChild(f); }`;
const navigateNow = (url) => `location.href = ${jsLiteral(url)};`;
/** Navigate once the srcdoc itself has loaded (after every nested frame). */
const navigateAfterLoad = (url) =>
  `addEventListener("load", () => setTimeout(() => { ${navigateNow(url)} }));`;

/**
 * The page the frame is navigated to. It does what a takeover would: claim
 * the bridge with a `tools/call` and listen for host traffic.
 */
const ATTACKER_PAGE = `<!doctype html><script>
parent.postMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "takeover" } }, "*");
</script>`;

/**
 * The stand-in host page. It records everything the proxy relays into
 * `window.__received`, which the cases below wait on.
 */
function hostPage(sandboxUrl, params) {
  const sandboxOrigin = new URL(sandboxUrl).origin;
  return `<!doctype html><iframe id="f" src="${sandboxUrl}"></iframe><script>
window.__received = [];
const f = document.getElementById("f");
addEventListener("message", (e) => {
  if (e.source !== f.contentWindow) return;
  const d = e.data || {};
  if (d.method === "ui/notifications/sandbox-proxy-ready") {
    f.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: ${jsLiteral(params)} }, ${jsLiteral(sandboxOrigin)});
    setInterval(() => f.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [] } }, ${jsLiteral(sandboxOrigin)}), 100);
    return;
  }
  window.__received.push(d.kind || d.method || "unknown");
});
</script>`;
}

/** Load the host page for one case and return the Playwright page. */
async function openCase(params) {
  current = params;
  const page = await browser.newPage();
  await page.goto(`${hostPageOrigin}/`, {
    waitUntil: "domcontentloaded",
    timeout: BROWSER_TIMEOUTS.ui,
  });
  return page;
}

/** Wait until the host page has received a message of `kind`. */
function waitForReceived(page, kind) {
  return page.waitForFunction((k) => window.__received.includes(k), kind, {
    timeout: BROWSER_TIMEOUTS.roundTrip,
  });
}

const received = (page) => page.evaluate(() => [...window.__received]);

/** The resource-ready params the host page will send for the current case. */
let current = null;

/**
 * Run an app that frames the declared domain and, once that nested frame has
 * loaded (`appScript` decides exactly when), navigates its own frame to
 * `/declared` on the same domain. Require
 * that the nested frame was fetched — proof that the frame policy admits the
 * declared domain, since the srcdoc inherits it and a policy refusing every
 * navigation (`frame-src 'none'`) would block the nested frame too — and that
 * the proxy then closed the frame and told the host. `/declared` itself is
 * not required to arrive: the departure message usually removes the frame
 * before that request is sent.
 */
async function expectDeclaredNavigationClosed(what, appScript) {
  attackerHits.length = 0;
  const page = await openCase({
    html: wrapApp(appScript, [attackerOrigin]),
    csp: { frameDomains: [attackerOrigin] },
  });
  await waitForReceived(page, "notifications/message");
  // The navigation starts only after the nested frame's `load`, so by the time
  // the notification arrives the nested request has been served.
  if (!attackerHits.includes("/nested")) {
    await fail(
      `the declared frame domain was not admitted (listener saw: ${attackerHits.join(", ") || "nothing"})`,
    );
  }
  const frames = await page.frameLocator("#f").locator("iframe").count();
  if (frames !== 0) {
    await fail(`the frame navigated to ${what} was not removed from the proxy`);
  }
  await page.close();
  console.log(
    `${LABEL}: navigation to ${what} is detected and the frame removed`,
  );
}

try {
  await server.waitForReady();
  const configRes = await fetch(`${server.baseUrl}/api/config`, {
    headers: { "x-mcp-remote-auth": `Bearer ${TOKEN}` },
  });
  if (!configRes.ok) await fail(`GET /api/config answered ${configRes.status}`);
  const { sandboxUrl } = await configRes.json();
  if (typeof sandboxUrl !== "string" || sandboxUrl === "") {
    await fail("the prod server advertised no sandboxUrl");
  }

  await listen(HOST_PAGE_PORT, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(hostPage(sandboxUrl, current));
  });
  await listen(ATTACKER_PORT, (req, res) => {
    attackerHits.push(req.url);
    // Never answered, so a frame nesting it never finishes loading; the
    // connection is dropped at shutdown.
    if (req.url === "/slow") return;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(ATTACKER_PAGE);
  });

  browser = await loadBrowser(repoRoot, BROWSER);

  // 1. The normal path still works under the new policy and the watch.
  {
    const page = await openCase({
      html: wrapApp(`${ECHO}${HELLO}`, []),
      csp: {},
    });
    await waitForReceived(page, "app-hello");
    await waitForReceived(page, "app-echo");
    const got = await received(page);
    if (got.includes("notifications/message")) {
      await fail(
        `a well-behaved app was reported as navigating away: ${got.join(", ")}`,
      );
    }
    await page.close();
    console.log(`${LABEL}: a well-behaved app keeps a working bridge`);
  }

  // 2. Navigating to an undeclared origin is blocked before any request.
  {
    attackerHits.length = 0;
    const page = await openCase({
      html: wrapApp(
        `${ECHO}${HELLO}${navigateTo(`${attackerOrigin}/attack?leak=x`)}`,
        [],
      ),
      csp: {},
    });
    await waitForReceived(page, "app-hello");
    // The proxy reports a refused navigation from the policy violation it
    // raises on the proxy document — the one signal every engine gives
    // (Chromium then also commits an error page; Firefox leaves the original
    // document in place). The block happens before the request is sent, so
    // once the report has arrived the negative checks below are not a race.
    // A `tools/call` arriving first means the navigated page took the bridge
    // over, which is the failure itself; waiting on either names it at once
    // rather than after a timeout.
    await page.waitForFunction(
      () =>
        window.__received.includes("notifications/message") ||
        window.__received.includes("tools/call"),
      undefined,
      { timeout: BROWSER_TIMEOUTS.roundTrip },
    );
    const got = await received(page);
    if (attackerHits.length > 0) {
      await fail(
        `the frame reached an undeclared origin: ${attackerHits.join(", ")}`,
      );
    }
    if (got.includes("tools/call")) {
      await fail("a message from the navigated-to page reached the host");
    }
    await page.close();
    console.log(
      `${LABEL}: self-navigation to an undeclared origin is blocked and reported`,
    );
  }

  // 3. A declared frame domain passes the policy; the watch still closes it.
  await expectDeclaredNavigationClosed(
    "a declared frame domain",
    `${ECHO}${HELLO}${nestFrame(`${attackerOrigin}/nested`)}${navigateAfterLoad(`${attackerOrigin}/declared`)}`,
  );

  // 4. The same navigation started while the srcdoc's own load is still
  //    pending — held open by a nested frame that never finishes — so the
  //    srcdoc never fires `load` and the destination's would be the frame's
  //    first. The departure message is what catches it.
  await expectDeclaredNavigationClosed(
    "a declared frame domain while the original load is pending",
    `${ECHO}${HELLO}${nestFrame(`${attackerOrigin}/slow`)}${nestFrame(`${attackerOrigin}/nested`, navigateNow(`${attackerOrigin}/declared`))}`,
  );

  console.log(`${LABEL} OK`);
  await shutdown();
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
