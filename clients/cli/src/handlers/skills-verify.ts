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

import {
  allSkillsVerified,
  anySkillFailed,
  anySkillUnverifiable,
  type SkillVerifyReport,
} from "@inspector/core/mcp/skillsVerification.js";
import { EXIT_CODES } from "../error-handler.js";

/**
 * The exit code for a `--verify` run, or `undefined` for success.
 *
 * Precedence follows the outcomes: a broken MUST (`7`) outranks a walk the read
 * bounds cut short (`8`), and both outrank a skill that advertised no digests.
 * That last one is `9` only under `--require-digests` — `"dynamic"` is a
 * conforming wire form, so by default the run still succeeds and the report
 * carries `outcome: "unverifiable"` instead (#2405).
 */
export function skillVerificationExitCode(
  reports: readonly SkillVerifyReport[],
  requireDigests: boolean,
): number | undefined {
  if (allSkillsVerified(reports)) return undefined;
  if (anySkillFailed(reports)) return EXIT_CODES.SKILL_NONCONFORMANT;
  if (reports.some((report) => report.outcome === "incomplete"))
    return EXIT_CODES.SKILL_INCOMPLETE;
  return requireDigests && anySkillUnverifiable(reports)
    ? EXIT_CODES.SKILL_UNVERIFIABLE
    : undefined;
}

/**
 * A one-line human summary for stderr, so a reader who piped stdout to `jq`
 * still learns the verdict.
 */
export function summarizeSkillVerification(
  reports: readonly SkillVerifyReport[],
): string {
  // ⚠️ Counted off `outcome`, never off `ok`. `ok` means "nothing that was
  // checked is wrong", which an `incomplete` report satisfies while the walk
  // was cut short — so branching on `ok` printed "no conformance errors" one
  // line before exiting SKILL_INCOMPLETE (Copilot).
  const failed = reports.filter((report) => report.outcome === "failed").length;
  const incomplete = reports.filter(
    (report) => report.outcome === "incomplete",
  ).length;
  const unverifiable = reports.filter(
    (report) => report.outcome === "unverifiable",
  ).length;
  const files = reports.reduce((sum, report) => sum + report.files.length, 0);
  const mismatched = reports.reduce(
    (sum, report) =>
      sum + report.files.filter((file) => file.status === "mismatch").length,
    0,
  );
  const skillWord = reports.length === 1 ? "skill" : "skills";
  const fileWord = files === 1 ? "file" : "files";
  // A catalog can be both: some skills broken, others merely cut short. Say so
  // rather than letting the louder verdict hide the quieter one.
  const incompleteClause =
    incomplete === 0
      ? ""
      : ` ${incomplete} of ${reports.length} ${skillWord} could not be fully checked: the read bounds stopped the walk.`;
  // ⚠️ Never "Verified" when a skill advertised no digests: nothing of it was
  // hashed, and a headline saying otherwise is the false pass #2405 reported.
  const unverifiableClause =
    unverifiable === 0
      ? ""
      : ` ${unverifiable} of ${reports.length} ${skillWord} advertised no digests (resources: "dynamic"), so ${unverifiable === 1 ? "its" : "their"} integrity was not checked.`;
  const headline =
    failed !== 0
      ? `${failed} of ${reports.length} ${skillWord} failed verification (${mismatched} digest/size mismatch across ${files} ${fileWord}).`
      : incomplete !== 0
        ? `Checked ${reports.length} ${skillWord} and ${files} ${fileWord}: no conformance errors in what was read.`
        : unverifiable !== 0
          ? `Checked ${reports.length} ${skillWord} and ${files} ${fileWord}: no conformance errors.`
          : `Verified ${reports.length} ${skillWord} and ${files} ${fileWord}: no conformance errors.`;
  return `${headline}${incompleteClause}${unverifiableClause}`;
}
