#!/usr/bin/env node
/**
 * Headless-browser connected-flow smoke for the core tabs — Tools, Resources,
 * Prompts (#2148).
 *
 * ── What was missing ────────────────────────────────────────────────────────
 *
 * The web client had exactly one connected-flow smoke, and it was the Apps tab.
 * `smoke:web:browser` proves the bundle boots and paints; it never connects.
 * `smoke:web:app` / `smoke:web:elicit` connect, but only ever drive the Apps
 * surface. So the three highest-traffic tabs — the ones nearly every session
 * actually uses — were unexercised through the prod bundle end to end.
 *
 * Everything that *did* cover them mocks or bypasses the prod server: unit
 * tests render a screen with fixture props, Storybook play functions do the
 * same in a browser, and the integration project drives `InspectorClient`
 * without a browser at all. A regression living only in the built bundle, or in
 * the prod Hono backend's wiring of a tab, passes all of them. That is the same
 * class `smoke:web:browser` was added for (#1615) and `smoke:web:app` extended
 * (#1859).
 *
 * ── What it drives ──────────────────────────────────────────────────────────
 *
 * One server, one browser, one page, three tabs:
 *
 *   1. **Tools** — the list renders, `list_items` is selected and executed, and
 *      the result panel populates *including* its `structuredContent` section.
 *      That last part is the half #1908 fixed: a tool declaring an
 *      `outputSchema` returns its real payload there and the `content[]` blocks
 *      only summarize it, so a result panel that renders text alone looks
 *      correct while dropping the data.
 *   2. **Resources** — the list renders, a resource is read, and the preview
 *      panel renders its contents. Templates are asserted present (the RFC 6570
 *      fixture, #1919), which is what proves `resources/templates/list` reached
 *      the screen — that list is fetched by a *different* call than
 *      `resources/list` and can fail on its own.
 *   3. **Prompts** — the list renders, `simple_prompt` is fetched (selecting an
 *      argument-less prompt auto-fetches), and the messages panel renders.
 *
 * The read/get stages assert the RPC status **and** the rendered panel, not the
 * status alone. Each `data-*-status` flips the moment its call resolves, so a
 * smoke stopping there would stay green with the panel deleted — which is the
 * opposite of what a connected-flow smoke is for.
 *
 * Deliberately **one script over one browser launch** rather than one per tab:
 * launching the browser and booting the server dominate the cost, and
 * `npm run local:gate` is already several minutes. Measured added wall-clock is ~5s
 * on a warm checkout (macOS, Chromium), the test-server build included.
 *
 * ── What it asserts on ──────────────────────────────────────────────────────
 *
 * `data-*` attributes, never copy. Each screen carries a readiness contract
 * mirroring the `data-app-status` precedent — `data-testid="tools-screen"` with
 * `data-tool-count` / `data-call-status`, and the Resources / Prompts
 * equivalents. See clients/web/README.md#core-tab-automation-contract. A smoke
 * that waited on visible text would fail the next time a label is reworded,
 * which is noise rather than signal.
 *
 * The connect half is `lib/deep-link-connect.mjs`, shared with every other
 * browser smoke — see that header for why a copied deep link fails as an opaque
 * timeout rather than a mismatch.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * **Chromium only, and not in `ENGINE_SMOKES`.** The engine tiers exist for the
 * MCP Apps sandbox, which is built out of the primitives that genuinely diverge
 * between engines (`srcdoc` CSP inheritance, nested sandboxed iframes,
 * cross-frame `postMessage`). These three tabs are ordinary React and Mantine;
 * running them a second time under Firefox would double their cost for
 * coverage that is not engine-sensitive. Cross-engine parameterization is
 * #2031's third bullet and is tracked separately.
 *
 * The deeper tabs — Network, Protocol, Logs, Tasks — are **not** covered here.
 * Each needs its own server config and more waiting, and #2148 explicitly
 * allows splitting. They remain unsmoked; that is a stated gap, not an
 * oversight.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this. `test-servers/build` is rebuilt on
 * every run; see `scripts/lib/ensure-test-servers.mjs` for why presence is not
 * freshness (#2111).
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

// The engine comes from an explicit ARGUMENT first, and only then from
// `SMOKE_BROWSER`. That precedence is the load-bearing part: `smoke:web:tabs`
// passes `chromium` to both this and the installer, so an ambient
// `SMOKE_BROWSER=firefox npm run local:gate` cannot silently redirect a gated tier that
// claims to be Chromium-only — the same invariant `run-engine-smokes.test.mjs`
// pins for the engine tiers (Copilot, #2148). Running another engine by hand is
// still one argument away: `node scripts/smoke-web-tabs.mjs firefox`.
//
// Resolved before anything starts, so an unsupported value fails immediately
// rather than after a web server and an MCP server are up. Every message
// carries the engine, so a failure names which run it came from.
let BROWSER;
try {
  BROWSER = resolveRequestedBrowser(process.argv.slice(2), process.env);
} catch (err) {
  console.error(
    `smoke:web:tabs FAILED — ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
const LABEL = `smoke:web:tabs [${BROWSER}]`;

const HOST = "127.0.0.1";
// Distinct from the other web smokes (6299 / 6298 / 6297 / 6296) so a prior
// run whose port is still in TIME_WAIT can't EADDRINUSE this one.
const PORT = process.env.SMOKE_WEB_TABS_PORT ?? "6295";
const TOKEN = "smoke-web-tabs-token";

/** The fixture's tool with an `outputSchema`, so its result carries
 *  `structuredContent` (#1908) as well as a `content[]` summary. */
const TOOL = "list_items";
/** The fixture's plain resource — `foobar://events`, listed as "events". */
const RESOURCE = "events";
/** The fixture's argument-less prompt; selecting it auto-fetches. */
const PROMPT = "simple_prompt";

let mcpServer = null;
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

/**
 * Switch to a main-view tab.
 *
 * The tabs are a Mantine `SegmentedControl`: a visually-hidden radio plus a
 * sibling `<label for>`. There is no `role="tab"` here and the radio has no hit
 * box, so the label is the clickable element.
 */
async function openTab(page, name) {
  await page
    .locator(`label[for$="-${name}"]`)
    .first()
    .click({ timeout: BROWSER_TIMEOUTS.ui });
}

/**
 * Wait for `selector`, reporting the screen's own status attributes on failure
 * instead of a bare timeout — so a failure names the stage it stalled at.
 */
async function waitForStage(page, { selector, screen, attrs, what }) {
  try {
    await page
      .locator(selector)
      .waitFor({ state: "attached", timeout: BROWSER_TIMEOUTS.roundTrip });
  } catch {
    const root = page.locator(screen);
    const present = (await root.count()) > 0;
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

try {
  // Reuses the App smoke's spawner: it is the composable test server either
  // way, and it publishes the child through `onSpawn` before the readiness
  // wait, so teardown reaches it even when startup throws (#2000). The
  // announced URL is authoritative over the config's port — `findAvailablePort`
  // walks upward when the configured one is taken.
  const mcpUrl = await startMcpAppServer({
    repoRoot,
    config: "web-tabs-http",
    onSpawn: (child) => {
      mcpServer = child;
    },
    label: LABEL,
  });
  await web.waitForReady();
  browser = await loadBrowser(repoRoot, BROWSER);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });

  // Uncaught synchronous page errors plus their async twin (an unhandled
  // rejection or a failed dynamic import), which arrives on the console channel
  // instead. Both are hard failures; every other console error stays a
  // diagnostic so benign font/React noise can't flake CI.
  const diagnostics = attachPageDiagnostics(page);

  const drive = async () => {
    await connectViaDeepLink({
      page,
      url: buildConnectDeepLink({ baseUrl: web.baseUrl, mcpUrl, token: TOKEN }),
    });

    // ── Tools ──────────────────────────────────────────────────────────────
    await openTab(page, "Tools");
    await waitForStage(page, {
      // `:not([data-tool-count="0"])` rather than a numeric comparison, which
      // a CSS attribute selector cannot express — an empty list and a missing
      // list are the two failures worth telling apart, and both are excluded.
      selector: '[data-testid="tools-screen"]:not([data-tool-count="0"])',
      screen: '[data-testid="tools-screen"]',
      attrs: ["data-tool-count", "data-call-status"],
      what: "the Tools list never populated",
    });
    await page
      .getByRole("button", { name: TOOL, exact: true })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await page
      .getByRole("button", { name: /execute tool/i })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await waitForStage(page, {
      selector: '[data-testid="tools-screen"][data-call-status="ok"]',
      screen: '[data-testid="tools-screen"]',
      attrs: ["data-call-status"],
      what: `\`${TOOL}\` did not complete successfully`,
    });
    // The half #1908 fixed: the payload lives in `structuredContent`, and a
    // panel rendering only the `content[]` summary looks right while dropping
    // the data.
    await page
      .locator('[data-testid="structured-output"]')
      .waitFor({ state: "attached", timeout: BROWSER_TIMEOUTS.nested });

    // ── Resources ──────────────────────────────────────────────────────────
    await openTab(page, "Resources");
    await waitForStage(page, {
      // Both counts, in one selector: `resources/list` and
      // `resources/templates/list` are separate calls and either can fail
      // alone, so asserting only the first would pass on a screen with no
      // templates at all.
      selector:
        '[data-testid="resources-screen"]:not([data-resource-count="0"])' +
        ':not([data-template-count="0"])',
      screen: '[data-testid="resources-screen"]',
      attrs: ["data-resource-count", "data-template-count", "data-read-status"],
      what: "the Resources / templates lists never populated",
    });
    // The sidebar sections are an accordion whose open set is a persisted
    // preference, so it may legitimately start collapsed. Open it only when it
    // is closed rather than clicking blind, which would toggle it shut.
    const uris = page.getByRole("button", { name: /^URIs/ });
    if ((await uris.getAttribute("aria-expanded")) !== "true") {
      await uris.click({ timeout: BROWSER_TIMEOUTS.nested });
    }
    // Selecting a resource reads it — there is no separate Read button here.
    await page
      .getByRole("button", { name: RESOURCE, exact: true })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await waitForStage(page, {
      // Both the RPC status AND the rendered preview. The status flips the
      // moment `resources/read` resolves, so stopping there would stay green
      // with the preview panel removed entirely (Copilot, #2148) — and #2148
      // asks for the content to *render*, not merely for the call to return.
      selector:
        '[data-testid="resources-screen"][data-read-status="ok"]' +
        ' [data-testid="resource-preview"]',
      screen: '[data-testid="resources-screen"]',
      attrs: ["data-read-status"],
      what: `reading \`${RESOURCE}\` did not render a preview`,
    });

    // ── Prompts ────────────────────────────────────────────────────────────
    await openTab(page, "Prompts");
    await waitForStage(page, {
      selector: '[data-testid="prompts-screen"]:not([data-prompt-count="0"])',
      screen: '[data-testid="prompts-screen"]',
      attrs: ["data-prompt-count", "data-get-status"],
      what: "the Prompts list never populated",
    });
    // An argument-less prompt is fetched the moment it is selected, so no
    // submit step follows.
    await page
      .getByRole("button", { name: new RegExp(`^${PROMPT}`) })
      .click({ timeout: BROWSER_TIMEOUTS.ui });
    await waitForStage(page, {
      // As with the resource preview: the messages panel must have rendered,
      // not merely `prompts/get` returned (Copilot, #2148).
      selector:
        '[data-testid="prompts-screen"][data-get-status="ok"]' +
        ' [data-testid="prompt-messages"]',
      screen: '[data-testid="prompts-screen"]',
      attrs: ["data-get-status"],
      what: `getting \`${PROMPT}\` did not render its messages`,
    });
  };

  // Race against launcher death so a mid-run server crash is reported as the
  // real cause instead of a downstream timeout.
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

  // A drive that reached every assertion still fails if the page threw on the
  // way: without this the smoke prints OK over a broken bundle.
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
    `${LABEL} OK — connected to ${mcpUrl}; Tools ran "${TOOL}" with structured ` +
      `output, Resources read "${RESOURCE}" with templates listed, and Prompts ` +
      `fetched "${PROMPT}"`,
  );
  await shutdown();
  process.exit(0);
} catch (err) {
  await fail(err instanceof Error ? err.message : String(err));
}
