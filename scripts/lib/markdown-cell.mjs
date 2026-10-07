/**
 * Escape a value for a Markdown table cell (#2546).
 *
 * The issue-filing sweeps (`dependabot-alerts.mjs`, `sdk-watch.mjs`) build
 * table rows from text they do not control: advisory summaries and upstream
 * release data. A `|` in that text ends the cell early, so it is escaped as
 * `\|`. That alone is incomplete: a value that itself ends in a backslash,
 * such as `abc\`, would become `abc\\|`, where the backslash pair cancels and
 * the pipe is live again, breaking the row. So backslashes are escaped
 * **first**, then pipes (CodeQL js/incomplete-sanitization, alerts #74–#76).
 *
 * One helper for both scripts, so the order cannot drift between copies.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeTableCell(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
