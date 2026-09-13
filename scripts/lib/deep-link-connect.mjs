/**
 * The **connect** half of a headless web smoke: build the deep link, navigate
 * to it, and wait until the Inspector reports a live connection (#2148).
 *
 * Every browser-driven smoke that touches a server starts the same way — the
 * `?serverUrl=…&transport=http&autoConnect=<token>` link, the `data-deeplink`
 * token gate, and the `data-status="connected"` wait. `smoke:web:app` had it
 * inside `driveAppFlow`, and `smoke:web:elicit` carried a second, hand-rolled
 * copy; a third copy for the tab smoke is what this exists to prevent.
 *
 * Sharing it matters more than the line count. The deep link's shape is owned
 * by clients/web/README.md#deep-link-auto-connect and enforced by
 * `parseDeepLink`, which **ignores** a link it cannot validate rather than
 * reporting one — so a drifted copy does not fail as a mismatch, it fails as an
 * opaque 45s connect timeout in whichever smoke was not updated. One copy is
 * one thing to keep right.
 *
 * The two gates are separate on purpose and both are worth asserting:
 *
 *   - `data-deeplink` distinguishes "the link was rejected by the CSRF token
 *     gate" from "no deep link was present at all". Without it a bad token
 *     reads as a connect that simply never happened.
 *   - `data-status` is the connection itself.
 *
 * Takes only the slice of Playwright's `page` it uses (`goto`, `locator` →
 * `waitFor`/`getAttribute`), which is what lets its failure branches be
 * unit-tested against a stand-in — a smoke only ever drives its happy path.
 *
 * The two budgets default to `BROWSER_TIMEOUTS` rather than restating them
 * (#2333): `goto` and the status element attaching are the page loading and
 * painting (`ui`), and `data-status="connected"` only appears after a round
 * trip to the MCP server (`roundTrip`). `driveAppFlow` in `mcp-app-flow.mjs`
 * passes the same two through, so the two helpers cannot drift apart — which
 * is the point: they used to carry the same literals by hand.
 */

import { BROWSER_TIMEOUTS } from "./browser-timeouts.mjs";

/**
 * The deep link that connects to `mcpUrl`.
 *
 * `autoConnect` must equal the session's `MCP_INSPECTOR_API_TOKEN`: it is the
 * CSRF gate, and a link that fails it is silently ignored. Shape owned by
 * clients/web/README.md#deep-link-auto-connect.
 */
export function buildConnectDeepLink({
  baseUrl,
  mcpUrl,
  token,
  transport = "http",
}) {
  return (
    `${baseUrl}/?serverUrl=${encodeURIComponent(mcpUrl)}` +
    `&transport=${transport}&autoConnect=${token}`
  );
}

/**
 * Navigate to `url` and wait for a connected Inspector.
 *
 * `expectDeepLink: false` skips the token-gate assertion — useful when
 * re-navigating an already-proven page to a second server, where a rejected
 * link would fail at the connect wait anyway and the gate is not the subject.
 */
export async function connectViaDeepLink({
  page,
  url,
  expectDeepLink = true,
  gotoTimeoutMs = BROWSER_TIMEOUTS.ui,
  connectTimeoutMs = BROWSER_TIMEOUTS.roundTrip,
}) {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: gotoTimeoutMs,
  });
  if (!response || !response.ok()) {
    throw new Error(
      `GET / returned HTTP ${response ? response.status() : "no response"}`,
    );
  }

  const status = page.locator('[data-testid="connection-status"]');
  if (expectDeepLink) {
    await status.waitFor({ state: "attached", timeout: gotoTimeoutMs });
    const deeplink = await status.getAttribute("data-deeplink");
    if (deeplink !== "parsed") {
      throw new Error(
        `deep link was not accepted (data-deeplink="${deeplink}") — expected "parsed"`,
      );
    }
  }

  await page
    .locator('[data-testid="connection-status"][data-status="connected"]')
    .waitFor({ state: "attached", timeout: connectTimeoutMs });
}
