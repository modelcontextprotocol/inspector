/**
 * Fetch-and-verify: run every SEP-2640 check that needs the *bytes* of a skill's
 * files, over a whole set of entries (#2248).
 *
 * Separate from `skills.ts`, which is deliberately I/O-free —
 * `checkSkillConformance` reads a manifest, `verifySkillResource` compares bytes
 * it is handed, `checkSkillFrontmatterMatch` compares text it is handed, and
 * none of them knows how to obtain a file. This module is the part that does,
 * and keeping it in its own file is what lets the pure checks stay testable with
 * no client at all.
 *
 * It lives in `core/` because **two** clients drive it: the CLI's `--verify`
 * turns it into an NDJSON report with an exit code, and the TUI's Skills pane
 * runs it for one selected skill. Only the web screen does something different
 * — it fetches lazily, per click, because a browser user is reading one file at
 * a time rather than asking a yes/no question about a catalog. That difference
 * is about *when* to fetch, not *how* to check, so it does not belong here.
 *
 * ⚠️ Reads are **sequential, deliberately.** A conforming manifest may declare
 * 512 entries, and a parallel walk over one would open 512 `resources/read`
 * calls against a server whose whole purpose here is to be tested — the hazard
 * the web screen bounds with a concurrency limit. Sequential also makes the
 * report deterministic: entries come back in manifest order on every run, so a
 * CI diff of two reports shows what changed rather than what raced.
 */

import { AuthRecoveryRequiredError } from "../auth/challenge.js";
import type { InspectorClientProtocol } from "./inspectorClientProtocol.js";
import type { RequestMetadata } from "./types.js";
import {
  checkSkillConformance,
  checkSkillFrontmatterMatch,
  skillDisplayName,
  skillFileBytes,
  verifySkillResource,
  type SkillIssue,
  type SkillVerification,
} from "./skills.js";
import { DYNAMIC_RESOURCES, type SkillEntry } from "./skillsSchemas.js";

/** One manifest entry's outcome. `read-error` means the fetch itself failed. */
export type SkillFileStatus = SkillVerification["status"] | "read-error";

export interface SkillFileReport {
  uri: string;
  status: SkillFileStatus;
  expectedDigest?: string;
  actualDigest?: string;
  expectedSize?: number;
  actualSize?: number;
  reason?: string;
}

/** One skill's full verdict, and the unit of the NDJSON stream. */
export interface SkillVerifyReport {
  uri: string;
  name: string;
  /** Structural findings against the entry as listed. */
  conformance: SkillIssue[];
  /**
   * Findings from comparing the served `SKILL.md`'s own frontmatter against the
   * listed one. Empty when the file could not be read — the read failure is
   * reported once, as a file result, rather than a second time as a phantom
   * frontmatter discrepancy.
   */
  frontmatter: SkillIssue[];
  /** One entry per manifest file, in manifest order. Empty for `"dynamic"`. */
  files: SkillFileReport[];
  /**
   * False when anything the SEP makes a MUST was broken: an error-severity
   * finding, a digest or size mismatch, or a file that could not be read.
   *
   * A `warning` does **not** clear it — a `"dynamic"` manifest is legal, and a
   * report that failed CI for it would be telling server authors their
   * conforming skill is broken.
   */
  ok: boolean;
}

/** Result shape of one `resources/read`, narrowed to what a digest needs. */
interface ReadContents {
  text?: string;
  blob?: string;
  mimeType?: string;
}

/**
 * The first content block of a `resources/read` result.
 *
 * `contents[0]` rather than a search by URI: a server may legitimately answer
 * with a canonicalized spelling of the URI we asked for, and matching on the
 * string would reject it. A result with no blocks is a read failure and is
 * reported as one.
 */
function firstContents(result: unknown): ReadContents | undefined {
  const contents = (result as { contents?: unknown })?.contents;
  if (!Array.isArray(contents) || contents.length === 0) return undefined;
  const first: unknown = contents[0];
  if (typeof first !== "object" || first === null) return undefined;
  return first as ReadContents;
}

/**
 * Verify every skill in `entries` against the connected server.
 *
 * Never throws for a single skill or a single file: a report that aborted on
 * the first unreadable file would hide every finding after it, and finding
 * everything wrong in one pass is the entire value of running this in CI.
 *
 * ⚠️ **`AuthRecoveryRequiredError` is the deliberate exception and is re-thrown.**
 * It is not a property of the file that happened to be in flight — it says the
 * session's authorization expired, so every remaining read would fail the same
 * way. Recording it per file would produce a report of N identical read
 * failures and, worse, would swallow the one error a caller keys off to start a
 * reauthorization: the TUI pane hands it to its recovery callback and the web
 * commands retry after it. Absorbed here, the user is simply told the files
 * could not be read, with no way offered to fix it.
 */
export async function verifySkills(
  client: InspectorClientProtocol,
  entries: readonly SkillEntry[],
  metadata?: RequestMetadata,
): Promise<SkillVerifyReport[]> {
  const reports: SkillVerifyReport[] = [];
  for (const entry of entries) {
    // The entry's own SKILL.md, read once and used twice — for its digest and
    // for the frontmatter cross-check. Reading it twice would double the load
    // on the server and, worse, could compare a digest against one snapshot
    // and frontmatter against another.
    let entryText: string | undefined;
    const files: SkillFileReport[] = [];

    const manifest =
      entry.resources === DYNAMIC_RESOURCES ? [] : entry.resources;
    for (const resource of manifest) {
      let contents: ReadContents | undefined;
      try {
        const invocation = await client.readResource(resource.uri, metadata);
        contents = firstContents(invocation.result);
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) throw err;
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!contents) {
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason: "resources/read returned no content blocks.",
        });
        continue;
      }
      if (resource.uri === entry.uri && typeof contents.text === "string") {
        entryText = contents.text;
      }
      let bytes: Uint8Array;
      try {
        bytes = skillFileBytes(contents);
      } catch (err) {
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const verification = await verifySkillResource(resource, bytes);
      files.push({ uri: resource.uri, ...verification });
    }

    // A `"dynamic"` skill has no manifest, so the loop above read nothing —
    // but its SKILL.md is still served and still has to match the frontmatter
    // the listing advertised. That obligation is not waived by the file set
    // being unenumerable; only integrity is.
    if (entryText === undefined) {
      try {
        const invocation = await client.readResource(entry.uri, metadata);
        const contents = firstContents(invocation.result);
        if (typeof contents?.text === "string") entryText = contents.text;
      } catch (err) {
        // Left undefined: the frontmatter check is skipped below. When the
        // manifest listed this file the failure is already reported there, and
        // when it did not, `manifest-missing-self` is the finding that matters.
        // An expired authorization is not that case — see the note above.
        if (err instanceof AuthRecoveryRequiredError) throw err;
      }
    }

    const conformance = checkSkillConformance(entry);
    const frontmatter =
      entryText === undefined
        ? []
        : checkSkillFrontmatterMatch(entry, entryText);
    const hasError = [...conformance, ...frontmatter].some(
      (issue) => issue.severity === "error",
    );
    const fileFailed = files.some(
      (file) => file.status === "mismatch" || file.status === "read-error",
    );
    reports.push({
      uri: entry.uri,
      name: skillDisplayName(entry),
      conformance,
      frontmatter,
      files,
      ok: !hasError && !fileFailed,
    });
  }
  return reports;
}

/** True when every skill in the report passed. */
export function allSkillsVerified(
  reports: readonly SkillVerifyReport[],
): boolean {
  return reports.every((report) => report.ok);
}
