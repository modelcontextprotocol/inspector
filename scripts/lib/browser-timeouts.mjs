/**
 * Playwright wall-clock budgets for the web smokes (#2323).
 *
 * Before this, `smoke-web-tabs.mjs`, `smoke-web-elicitation.mjs` and
 * `smoke-web-browser.mjs` carried 19 budgets between them across three
 * independently-chosen scales, with no config anywhere to raise — 17 locator
 * operations plus a `page.goto` and a `waitForLoadState`. They are the
 * same three or four decisions repeated, so they are named once here and the
 * scripts import them — the same shape `render-smoke.mjs`'s `DEFAULTS` already
 * has, and for the same reason: a budget nobody can find is a budget nobody
 * revisits. The shared flow helpers (`deep-link-connect.mjs`,
 * `mcp-app-flow.mjs`) default their budgets to these too (#2333); they used to
 * carry `ui`/`roundTrip` as literals of their own.
 *
 * Three of the four are ceilings on a poll rather than sleeps — `ui`,
 * `roundTrip` and `nested` each return the instant their locator condition
 * holds, so a passing smoke pays only the time the app actually took. What they
 * absorb is a smoke running against a cold `dist/` build on a machine already
 * carrying other agent sessions' gates.
 *
 * ⚠️ `bestEffort` is the exception and is not free: its expiry is caught and
 * ignored, so a smoke that never reaches network idle spends the full budget on
 * an otherwise **passing** run. That is why it is the smallest of the four, and
 * why it should stay that way.
 *
 * ⚠️ Raising any of these does delay the report when the thing waited on never
 * arrives — a larger budget is a longer wait before the failure. What the
 * launcher-death race in `smoke-web-browser.mjs` and the `waitForStage`
 * diagnostics in the other two buy is a better *eventual* message, naming a
 * cause instead of a locator; they do not make the wait shorter. Weigh both
 * when changing a value here.
 */

export const BROWSER_TIMEOUTS = Object.freeze({
  /**
   * Load the page, or act on a control the app is already showing — a click on
   * a rendered tab or list row, a wait for the first meaningful frame. What it
   * absorbs is the browser's own scheduling under load, not a server.
   */
  ui: 30_000,
  /**
   * Wait for something that only appears after a round trip to an MCP server:
   * an elicitation modal, a tool result panel. Longer than `ui` because a test
   * server has to boot, negotiate and answer before the DOM can change.
   */
  roundTrip: 45_000,
  /**
   * Wait on a sub-element of something already on screen — a row inside a
   * populated panel, a section of an open accordion. The enclosing wait has
   * already paid for the round trip, so this only covers the render.
   */
  nested: 15_000,
  /**
   * A wait whose expiry is caught and ignored, so it must stay short: it is
   * pure added latency on every passing run. `networkidle` is the only one —
   * the Google Fonts request may never idle on a restricted network.
   */
  bestEffort: 5_000,
});
