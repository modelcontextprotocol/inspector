/**
 * `--verify`: the scriptable SEP-2640 conformance report (#2248).
 *
 * The Skills screen in the web client can verify a skill, but only by hand, one
 * file at a time, in a browser. A server author wants the same verdict in CI,
 * over the whole catalog, with an exit code — which is exactly the argument
 * `--strict` makes for the tool-schema lint, so this follows that handler's
 * shape rather than inventing a second one.
 *
 * The walk itself is `core/mcp/skillsVerification.ts`, shared with the TUI's
 * Skills pane. What is left here is presentation: the one-line stderr summary,
 * which is a CLI concern and nothing else's.
 */

import type { SkillVerifyReport } from "@inspector/core/mcp/skillsVerification.js";

/**
 * A one-line human summary for stderr, so a reader who piped stdout to `jq`
 * still learns the verdict.
 */
export function summarizeSkillVerification(
  reports: readonly SkillVerifyReport[],
): string {
  const failed = reports.filter((report) => !report.ok).length;
  const files = reports.reduce((sum, report) => sum + report.files.length, 0);
  const mismatched = reports.reduce(
    (sum, report) =>
      sum + report.files.filter((file) => file.status === "mismatch").length,
    0,
  );
  const skillWord = reports.length === 1 ? "skill" : "skills";
  const fileWord = files === 1 ? "file" : "files";
  return failed === 0
    ? `Verified ${reports.length} ${skillWord} and ${files} ${fileWord}: no conformance errors.`
    : `${failed} of ${reports.length} ${skillWord} failed verification (${mismatched} digest/size mismatch across ${files} ${fileWord}).`;
}
