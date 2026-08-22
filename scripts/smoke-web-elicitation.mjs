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
 * proof to a PR); unset, it asserts only. Playwright is resolved with a
 * `createRequire` based at clients/web/package.json for the reason documented at
 * length in smoke-web-browser.mjs.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first.
 * `test-servers/build` is built on demand if missing, as in smoke:web:app.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { join, resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";
import { stopChild } from "./lib/child-cleanup.mjs";
import { resolveNodeBin } from "./lib/resolve-node-bin.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const requireFromWeb = createRequire(
  resolve(repoRoot, "clients/web/package.json"),
);

const composableServer = join(
  repoRoot,
  "test-servers",
  "build",
  "server-composable.js",
);
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
  label: "smoke:web:elicit",
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
      label: "smoke:web:elicit",
      what: "MCP test server",
    });
  }
}

async function fail(message) {
  console.error(`smoke:web:elicit FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

/** Build the composable test server bundle if it isn't present yet. */
function ensureTestServer() {
  if (existsSync(composableServer)) return;
  console.log(
    "smoke:web:elicit — building test-servers (missing build output)...",
  );
  const r = spawnSync(
    process.execPath,
    [
      resolveNodeBin("typescript", "tsc", repoRoot),
      "-p",
      "test-servers",
      "--noCheck",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (r.status !== 0 || !existsSync(composableServer)) {
    throw new Error(
      "could not build the test servers (test-servers/build/server-composable.js). " +
        "Run `npm run test-servers:build` from clients/web.",
    );
  }
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

async function loadChromium() {
  let chromium;
  try {
    ({ chromium } = requireFromWeb("playwright"));
  } catch (err) {
    throw new Error(
      `could not resolve the Playwright package from clients/web — run \`npm install\` at the repo root (${err instanceof Error ? err.message : String(err)})`,
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

async function shot(page, name) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SHOT_DIR, `${name}.png`),
    fullPage: false,
  });
  console.log(`smoke:web:elicit — captured ${name}.png`);
}

/** Connect to `mcpUrl` through the deep link and wait for the Tools list. */
async function connect(page, mcpUrl) {
  const url =
    `${web.baseUrl}/?serverUrl=${encodeURIComponent(mcpUrl)}` +
    `&transport=http&autoConnect=${TOKEN}`;
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  if (!response || !response.ok()) {
    throw new Error(
      `GET / returned HTTP ${response ? response.status() : "no response"}`,
    );
  }
  const status = page.locator('[data-testid="connection-status"]');
  await status.waitFor({ state: "attached", timeout: 30_000 });
  const deeplink = await status.getAttribute("data-deeplink");
  if (deeplink !== "parsed") {
    throw new Error(
      `deep link was not accepted (data-deeplink="${deeplink}") — expected "parsed"`,
    );
  }
  await page
    .locator('[data-testid="connection-status"][data-status="connected"]')
    .waitFor({ state: "attached", timeout: 45_000 });
}

/** Select the elicitation tool in the Tools tab and run it. */
async function runTool(page) {
  // The main-view tabs are a Mantine SegmentedControl: a visually-hidden radio
  // plus a sibling <label for>. The label is the clickable element — there is
  // no role="tab" here, and the radio itself has no hit box.
  await page.locator('label[for$="-Tools"]').first().click({ timeout: 30_000 });
  await page
    .getByRole("button", { name: TOOL, exact: true })
    .click({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /execute tool/i })
    .click({ timeout: 30_000 });
}

try {
  ensureTestServer();
  const appUrl = await startMcpServer("app-elicitation-http");
  const nativeUrl = await startMcpServer("app-elicitation-native-http");
  await web.waitForReady();
  browser = await loadChromium();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  const pageErrors = [];
  page.on("pageerror", (err) =>
    pageErrors.push(err instanceof Error ? err.message : String(err)),
  );

  const drive = async () => {
    // ── 1. Negotiated: the server's app answers the elicitation ────────────
    await connect(page, appUrl);
    await runTool(page);

    const modal = page.locator(
      '[data-testid="app-elicitation"][data-app-elicitation-status="ready"]',
    );
    try {
      await modal.waitFor({ state: "attached", timeout: 45_000 });
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
    await app.locator('[data-testid="choose-a"]').click({ timeout: 30_000 });

    // The tool echoes the ElicitResult it received, so the result pane proves
    // the app's standard result reached the SERVER — not merely the host.
    await page
      .getByText(/"action":"accept".*"choice":"option-a"/)
      .first()
      .waitFor({ state: "attached", timeout: 45_000 });
    await shot(page, "app-elicitation-result");

    // ── 2. Not negotiated: the same tool falls back to the native form ─────
    await connect(page, nativeUrl);
    await runTool(page);
    // Scoped to the dialog on purpose: the prompt string also appears inside
    // the (hidden) Protocol-tab payload, which a bare text lookup matches first.
    const nativeDialog = page.getByRole("dialog", {
      name: /elicitation request/i,
    });
    await nativeDialog.waitFor({ state: "visible", timeout: 45_000 });
    await nativeDialog
      .getByText("Choose option A or B.")
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
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
    await fail(
      `${err instanceof Error ? err.message : String(err)}${
        pageErrors.length ? ` — page errors: ${pageErrors.join("; ")}` : ""
      }`,
    );
  }

  console.log("smoke:web:elicit OK — app-rendered and native paths both drive");
  await shutdown();
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
