#!/usr/bin/env node
/**
 * Headless-browser connected-flow smoke for the Events tab (SEP-3415, #3030).
 *
 * ── What it drives ──────────────────────────────────────────────────────────
 *
 * One `events-modern-http` test server, one browser, one page:
 *
 *   1. **Connect on the modern era.** The Events extension exists only on a
 *      2026-07-28+ connection, and a deep link carries no era, so the web
 *      server starts on a catalog that already holds the deep link's server
 *      with `protocolEra: "modern"` (`seedTempCatalog`). The deep link then
 *      finds that row with a matching config and connects it as stored.
 *   2. **The tab appears and lists.** The Events tab is shown only when the
 *      server advertises the extension on a modern connection, so reaching it
 *      at all is the gate's assertion; the list must populate too.
 *   3. **Subscribe twice.** `incident.created` advertises poll, push and
 *      webhook: one poll and one push subscription are started from the form,
 *      so both runners (and the web relay's unbounded `events/stream`) run
 *      through the prod bundle. Both must reach `active`.
 *   4. **Deliver.** `emit_event` is called from the Tools tab, and the
 *      occurrence must reach the Events log through **both** subscriptions.
 *
 * Everything is asserted on `data-*` attributes (the readiness contract in
 * clients/web/README.md#core-tab-automation-contract), never on copy.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * Chromium only, like `smoke:web:tabs`, and for the same reason: this is
 * ordinary React and Mantine, not engine-sensitive sandbox code. Gap, error,
 * termination and reconnect handling are the subscription engine's, covered by
 * its integration tests against this fixture
 * (`clients/web/src/test/integration/mcp/eventSubscriptions.test.ts`).
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first,
 * as every web smoke does. `test-servers/build` is rebuilt on every run.
 */

import { resolve } from "node:path";
import { startProdWebServer } from "./lib/prod-web-server.mjs";
import { stopChild } from "./lib/child-cleanup.mjs";
import { attachPageDiagnostics, loadBrowser } from "./lib/headless-browser.mjs";
import { resolveRequestedBrowser } from "./install-smoke-browser.mjs";
import {
  buildConnectDeepLink,
  connectViaDeepLink,
} from "./lib/deep-link-connect.mjs";
import { startMcpAppServer } from "./lib/mcp-app-flow.mjs";
import { BROWSER_TIMEOUTS } from "./lib/browser-timeouts.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

// An explicit argument wins over `SMOKE_BROWSER`, as in `smoke:web:tabs`, so
// an ambient variable cannot redirect a tier that claims to be Chromium-only.
let BROWSER;
try {
  BROWSER = resolveRequestedBrowser(process.argv.slice(2), process.env);
} catch (err) {
  console.error(
    `smoke:web:events FAILED — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
const LABEL = `smoke:web:events [${BROWSER}]`;

const HOST = "127.0.0.1";
// Distinct from the other web smokes (6292–6299; docs/quality-gate.md).
const PORT = process.env.SMOKE_WEB_EVENTS_PORT ?? "6291";
const TOKEN = "smoke-web-events-token";

/** The fixture's poll + push + webhook event type. */
const EVENT_TYPE = "incident.created";
/** The fixture's control tool that emits an occurrence. */
const EMIT_TOOL = "emit_event";

let mcpServer = null;
let browser = null;
let web = null;

async function shutdown() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // best-effort
    }
    browser = null;
  }
  if (web) await web.stop();
  if (mcpServer) {
    const child = mcpServer;
    mcpServer = null;
    await stopChild(child, { label: LABEL, what: "MCP test server" });
  }
}

async function fail(message) {
  console.error(`${LABEL} FAILED — ${message}`);
  await shutdown();
  process.exit(1);
}

/** Switch main-view tab: the SegmentedControl's label is the clickable part. */
async function openTab(page, name) {
  await page
    .locator(`label[for$="-${name}"]`)
    .first()
    .click({ timeout: BROWSER_TIMEOUTS.ui });
}

/**
 * Wait for `selector`, reporting the screen's status attributes on failure so
 * a timeout names the stage it stalled at.
 */
async function waitForStage(page, { selector, screen, attrs, what }) {
  try {
    await page
      .locator(selector)
      .waitFor({ state: "attached", timeout: BROWSER_TIMEOUTS.roundTrip });
  } catch {
    const root = page.locator(screen).first();
    const present = (await page.locator(screen).count()) > 0;
    const observed = present
      ? (
          await Promise.all(
            attrs.map(async (a) => `${a}="${await root.getAttribute(a)}"`),
          )
        ).join(", ")
      : `(no ${screen})`;
    throw new Error(`${what} — last observed: ${observed}`);
  }
}

const EVENTS_SCREEN = '[data-testid="events-screen"]';
const EVENTS_ATTRS = [
  "data-event-count",
  "data-subscription-count",
  "data-log-count",
];

try {
  // The MCP server first: the catalog the web server starts on names its URL.
  const mcpUrl = await startMcpAppServer({
    repoRoot,
    config: "events-modern-http",
    onSpawn: (child) => {
      mcpServer = child;
    },
    label: LABEL,
  });
  web = startProdWebServer({
    host: HOST,
    port: PORT,
    token: TOKEN,
    label: LABEL,
    catalog: {
      mcpServers: {
        "deep-link": {
          type: "streamable-http",
          url: mcpUrl,
          protocolEra: "modern",
        },
      },
    },
  });
  await web.waitForReady();
  browser = await loadBrowser(repoRoot, BROWSER);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const diagnostics = attachPageDiagnostics(page);

  const drive = async () => {
    await connectViaDeepLink({
      page,
      url: buildConnectDeepLink({ baseUrl: web.baseUrl, mcpUrl, token: TOKEN }),
    });

    // ── The tab, gated on a modern connection that advertises Events ─────
    await openTab(page, "Events");
    await waitForStage(page, {
      selector: `${EVENTS_SCREEN}:not([data-event-count="0"])`,
      screen: EVENTS_SCREEN,
      attrs: EVENTS_ATTRS,
      what: "the Events list never populated",
    });

    // ── A poll and a push subscription to the same type ──────────────────
    await page
      .getByRole("button", { name: EVENT_TYPE, exact: true })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    const subscribe = page.getByRole("button", {
      name: "Subscribe",
      exact: true,
    });
    // Poll is the type's first advertised mode, so it is the default.
    await subscribe.click({ timeout: BROWSER_TIMEOUTS.ui });
    await page
      .getByRole("radiogroup", { name: "Delivery mode" })
      .getByText("Push", { exact: true })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await subscribe.click({ timeout: BROWSER_TIMEOUTS.ui });
    await waitForStage(page, {
      selector:
        '[data-testid="event-subscription"][data-status="active"] >> nth=1',
      screen: EVENTS_SCREEN,
      attrs: EVENTS_ATTRS,
      what: "the poll and push subscriptions did not both become active",
    });

    // ── Emit one occurrence through the fixture's control tool ───────────
    await openTab(page, "Tools");
    await page
      // The row's accessible name is its label plus the protocol name.
      .getByRole("button", { name: new RegExp(EMIT_TOOL) })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await page
      .getByRole("textbox", { name: /^name/ })
      .fill(EVENT_TYPE, { timeout: BROWSER_TIMEOUTS.ui });
    await page
      .getByRole("button", { name: /execute tool/i })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await waitForStage(page, {
      selector: '[data-testid="tools-screen"][data-call-status="ok"]',
      screen: '[data-testid="tools-screen"]',
      attrs: ["data-call-status"],
      what: `\`${EMIT_TOOL}\` did not complete successfully`,
    });

    // ── Both subscriptions deliver it ────────────────────────────────────
    await openTab(page, "Events");
    await waitForStage(page, {
      selector: '[data-testid="event-log-entry"][data-kind="event"] >> nth=1',
      screen: EVENTS_SCREEN,
      attrs: EVENTS_ATTRS,
      what: "the occurrence did not reach the log through both subscriptions",
    });
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

  const fatal = diagnostics.fatal();
  if (fatal.length > 0) {
    await fail(`page logged uncaught error(s): ${fatal.join("; ")}`);
  }
  const benign = diagnostics.benignConsole();
  if (benign.length > 0) {
    console.log(
      `${LABEL} note — ${benign.length} non-fatal console error(s): ${benign.join("; ")}`,
    );
  }

  console.log(
    `${LABEL} OK — connected to ${mcpUrl} on the modern era; Events listed, ` +
      `a poll and a push subscription to "${EVENT_TYPE}" went active, and an ` +
      `emitted occurrence reached the log through both`,
  );
  await shutdown();
  process.exit(0);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
