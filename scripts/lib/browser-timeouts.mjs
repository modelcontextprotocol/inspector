/**
 * Playwright wall-clock budgets for the web smokes (#2323).
 *
 * Before this, `smoke-web-tabs.mjs`, `smoke-web-elicitation.mjs` and
 * `smoke-web-browser.mjs` carried 15 locator budgets between them across three
 * independently-chosen scales, with no config anywhere to raise. They are the
 * same three or four decisions repeated, so they are named once here and the
 * scripts import them — the same shape `render-smoke.mjs`'s `DEFAULTS` already
 * has, and for the same reason: a budget nobody can find is a budget nobody
 * revisits.
 *
 * These are generous on purpose and cost a passing run nothing. Playwright
 * budgets are ceilings on a poll, not sleeps: every one of them returns the
 * instant its locator condition holds. What they have to absorb is a smoke
 * running against a cold `dist/` build on a machine already carrying three
 * other agent sessions' gates.
 *
 * ⚠️ Raising one of these does NOT make a smoke wait longer for a server that
 * is never coming: the launcher-death race in `smoke-web-browser.mjs` and the
 * `waitForStage` diagnostics in the other two are what report that, and they
 * report it with a cause rather than a timeout.
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
