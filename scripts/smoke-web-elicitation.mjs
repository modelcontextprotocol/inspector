#!/usr/bin/env node
/**
 * Headless-browser smoke for app-rendered form elicitations (#1854).
 *
 * `smoke:web:app` proves an App *tool* renders. This proves the other thing an
 * MCP App can now do: answer a server's `elicitation/create`. It drives the
 * whole negotiated chain end to end against the public fixture —
 * **connect → call the tool → server elicits → app renders in the sandbox →
 * user clicks → the app's standard `ElicitResult` reaches the server** — and
 * then drives the SAME tool against a server that did NOT advertise the nested
 * MCP Apps `elicitation` capability, which must fall back to the Inspector's
 * native elicitation form.
 *
 * The fallback half is the more valuable of the two. The failure mode this
 * feature can produce is not "the app doesn't render" (loud, obvious) but
 * "an app renders when it should not have been offered one" — a client that
 * over-claims the capability strands every user of a server that never opted
 * in. Asserting the native form appears is what pins that.
 *
 * Two nested frames matter here: the outer trusted sandbox-proxy iframe and the
 * inner sandboxed iframe holding the untrusted app. Clicking the app's button
 * therefore needs `frameLocator(...).frameLocator(...)`, not one hop.
 *
 * Set `SMOKE_SCREENSHOT_DIR` to capture PNGs of each state (used to attach
 * proof to a PR); unset, it asserts only.
 *
 * `SMOKE_BROWSER` picks the engine (`chromium` — the default — `firefox`, or
 * `webkit`). Three tiers, deliberately (#2086):
 *
 *   - **GitHub CI** runs this smoke in **Chromium** only.
 *   - **`npm run local:gate`**, the local pre-push gate, runs it in **Chromium and
 *     Firefox** — the Firefox pass is `smoke:web:firefox`, and it is the one
 *     gate step with no GitHub CI counterpart.
 *   - **WebKit is on demand only**: `SMOKE_BROWSER=webkit npm run smoke:web:elicit`
 *     for this smoke alone, or `npm run smoke:web:webkit` for all three.
 *
 * Firefox passes. WebKit fails this smoke for reasons nobody has identified and
 * nobody is investigating: it does not reproduce in real Safari, and an isolated
 * SSE repro did not reproduce it under Playwright's WebKit either, so it reads
 * as a property of that build rather than a browser bug. Do not read a WebKit
 * failure here as a defect until someone has actually looked.
 *
 * Along with `smoke:web:app` this is one
 * of the two places the MCP Apps sandbox is actually loaded, and the two nested
 * frames below are precisely the surface that diverges between engines. See
 * `lib/headless-browser.mjs`, including why a green WebKit run is not a Safari
 * guarantee.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first.
 * `test-servers/build` is rebuilt on every run, as in smoke:web:app — see
 * `scripts/lib/ensure-test-servers.mjs` for why presence isn't freshness.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { join, resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";
import { stopChild } from "./lib/child-cleanup.mjs";
import { BROWSER_TIMEOUTS } from "./lib/browser-timeouts.mjs";
import {
  attachPageDiagnostics,
  loadBrowser,
  resolveBrowserName,
} from "./lib/headless-browser.mjs";
import {
  ensureTestServers,
  testServerEntryPath,
} from "./lib/ensure-test-servers.mjs";
import {
  buildConnectDeepLink,
  connectViaDeepLink,
} from "./lib/deep-link-connect.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

// Resolved before anything is started, so an unsupported SMOKE_BROWSER fails
// immediately rather than after a web server and two MCP servers are up. Every
// message carries the engine, so a failure names which one broke.
let BROWSER;
try {
  BROWSER = resolveBrowserName();
} catch (err) {
  console.error(
    `smoke:web:elicit FAILED — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
const LABEL = `smoke:web:elicit [${BROWSER}]`;

const composableServer = testServerEntryPath(repoRoot, "composable");
const configPath = (name) =>
  join(repoRoot, "test-servers", "configs", `${name}.json`);

const HOST = "127.0.0.1";
// Distinct from the other web smokes (6299 / 6298 / 6297) so a prior run whose
// port is still in TIME_WAIT can't EADDRINUSE this one.
const PORT = process.env.SMOKE_WEB_ELICIT_PORT ?? "6296";
const TOKEN = "smoke-web-elicit-token";
const TOOL = "app_choose_option";
const SHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR;

const servers = [];
let browser = null;
const web = startProdWebServer({
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
  await web.stop();
  while (servers.length) {
    await stopChild(servers.pop(), {
      label: LABEL,
      what: "MCP test server",
    });
  }
}

async function fail(message) {
  console.error(`${LABEL} FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

/**
 * Spawn a composable test server and wait for the URL it announces.
 *
 * The announced line is authoritative: `createTestServerHttp` resolves its port
 * with `findAvailablePort()`, which walks upward when the configured one is
 * taken. Both stdio channels are scanned because the announcement goes to
 * stderr (`console.error` in server-composable.ts).
 */
async function startMcpServer(configName) {
  const child = spawn(
    process.execPath,
    [composableServer, "--config", configPath(configName)],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  servers.push(child);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  let exited = false;
  let spawnError = null;
  child.on("error", (err) => (spawnError = err));
  child.on("exit", () => (exited = true));
  child.on("close", () => (exited = true));

  for (let attempt = 0; attempt < 120; attempt++) {
    const announced = out.match(/listening at (http:\/\/\S+)/i);
    if (announced) return announced[1];
    if (spawnError) {
      throw new Error(
        `could not spawn the MCP test server (${composableServer}): ${spawnError.message}`,
      );
    }
    if (exited) throw new Error(`MCP test server exited early:\n${out}`);
    await delay(250);
  }
  throw new Error(`MCP test server did not start within 30s:\n${out}`);
}

async function shot(page, name) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SHOT_DIR, `${name}.png`),
    fullPage: false,
  });
  console.log(`${LABEL} — captured ${name}.png`);
}

/**
 * Connect to `mcpUrl` through the deep link.
 *
 * Shared with every other browser smoke (#2148) rather than hand-rolled here:
 * a link `parseDeepLink` cannot validate is *ignored* rather than reported, so
 * a drifted copy surfaces as an opaque connect timeout instead of a mismatch.
 */
async function connect(page, mcpUrl) {
  await connectViaDeepLink({
    page,
    url: buildConnectDeepLink({
      baseUrl: web.baseUrl,
      mcpUrl,
      token: TOKEN,
    }),
  });
}

/** Select the elicitation tool in the Tools tab and run it. */
async function runTool(page) {
  // The main-view tabs are a Mantine SegmentedControl: a visually-hidden radio
  // plus a sibling <label for>. The label is the clickable element — there is
  // no role="tab" here, and the radio itself has no hit box.
  await page
    .locator('label[for$="-Tools"]')
    .first()
    .click({ timeout: BROWSER_TIMEOUTS.ui });
  await page
    .getByRole("button", { name: TOOL, exact: true })
    .click({ timeout: BROWSER_TIMEOUTS.ui });
  await page
    .getByRole("button", { name: /execute tool/i })
    .click({ timeout: BROWSER_TIMEOUTS.ui });
}

try {
  // Rebuilt on every run — presence is not freshness (#2111).
  ensureTestServers({
    repoRoot,
    label: LABEL,
    requires: ["composable"],
  });
  const appUrl = await startMcpServer("app-elicitation-http");
  const nativeUrl = await startMcpServer("app-elicitation-native-http");
  await web.waitForReady();
  browser = await loadBrowser(repoRoot, BROWSER);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  // Uncaught *synchronous* page errors, plus their *async* twin (an unhandled
  // rejection or a failed dynamic import), which arrives on the console channel
  // instead. Both are hard failures; every other console error is only a
  // diagnostic, so benign font/React noise cannot flake CI. Shared with
  // smoke:web:app rather than re-hand-rolled — the split is subtle enough that
  // two copies would drift, and it is documented at length on the helper.
  const diagnostics = attachPageDiagnostics(page);

  const drive = async () => {
    // ── 1. Negotiated: the server's app answers the elicitation ────────────
    await connect(page, appUrl);
    await runTool(page);

    const modal = page.locator(
      '[data-testid="app-elicitation"][data-app-elicitation-status="ready"]',
    );
    try {
      await modal.waitFor({
        state: "attached",
        timeout: BROWSER_TIMEOUTS.roundTrip,
      });
    } catch {
      const any = page.locator('[data-testid="app-elicitation"]');
      const last = (await any.count())
        ? await any.getAttribute("data-app-elicitation-status")
        : "(no app-elicitation modal)";
      throw new Error(
        `the app never rendered the elicitation (last status: "${last}") — ` +
          `either the negotiation gates rejected it or the sandbox/bridge failed`,
      );
    }
    await shot(page, "app-elicitation-rendered");

    // The app lives two frames deep: trusted sandbox proxy → sandboxed app.
    const app = page
      .frameLocator('[data-testid="app-elicitation"] iframe')
      .frameLocator("iframe");
    await app
      .locator('[data-testid="choose-a"]')
      .click({ timeout: BROWSER_TIMEOUTS.ui });

    // The tool echoes the ElicitResult it received, so the result pane proves
    // the app's standard result reached the SERVER — not merely the host.
    await page
      .getByText(/"action":"accept".*"choice":"option-a"/)
      .first()
      .waitFor({ state: "attached", timeout: BROWSER_TIMEOUTS.roundTrip });
    await shot(page, "app-elicitation-result");

    // ── 2. Not negotiated: the same tool falls back to the native form ─────
    await connect(page, nativeUrl);
    await runTool(page);
    // Scoped to the dialog on purpose: the prompt string also appears inside
    // the (hidden) Protocol-tab payload, which a bare text lookup matches first.
    const nativeDialog = page.getByRole("dialog", {
      name: /elicitation request/i,
    });
    await nativeDialog.waitFor({
      state: "visible",
      timeout: BROWSER_TIMEOUTS.roundTrip,
    });
    await nativeDialog
      .getByText("Choose option A or B.")
      .first()
      .waitFor({ state: "visible", timeout: BROWSER_TIMEOUTS.nested });
    // The modal fades in; a screenshot taken on the first visible frame catches
    // a transparent overlay. Nothing is asserted on this delay.
    await delay(600);
    if (await page.locator('[data-testid="app-elicitation"]').count()) {
      throw new Error(
        "an app was rendered for a server that never advertised the nested " +
          "MCP Apps elicitation capability — the negotiation gate is not holding",
      );
    }
    await shot(page, "native-elicitation-fallback");
  };

  try {
    await Promise.race([web.whenChildExits(), drive()]);
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

  // A drive that reached all of its assertions still fails if the page threw on
  // the way: without this the smoke prints OK over a broken bundle.
  const fatal = diagnostics.fatal();
  if (fatal.length > 0) {
    await fail(`page logged uncaught error(s): ${fatal.join("; ")}`);
  }

  console.log(`${LABEL} OK — app-rendered and native paths both drive`);
  await shutdown();
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
