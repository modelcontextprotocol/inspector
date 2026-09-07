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
  bytesToText,
  checkSkillConformance,
  checkSkillFrontmatterMatch,
  checkSkillNameCollisions,
  skillDisplayName,
  skillFileBytes,
  skillUriIdentity,
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

/**
 * The reason string for a failed read.
 *
 * One helper rather than the same ternary at each of the four call sites: a
 * rejection is not required to be an `Error` — a `throw "string"` anywhere in a
 * transport or its dependencies reaches here — and reading `.message` off one
 * would put `undefined` where the diagnosis belongs.
 */
function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Result shape of one `resources/read`, narrowed to what a digest needs. */
interface ReadContents {
  text?: string;
  blob?: string;
  mimeType?: string;
}

/**
 * The block of a `resources/read` result that answers for `uri` — **selected by
 * URI, never by position**.
 *
 * `contents` is an array, and taking `contents[0]` is wrong in the one way that
 * matters here: these bytes are about to be hashed against `uri`'s advertised
 * digest, so accepting a block the server labelled something else would verify
 * one file's content against another file's digest — and could report that as
 * `verified`. A false pass from a positional read is worse than a missing
 * check, because it is an affirmative statement about a file nobody looked at.
 *
 * A **normalized** match is accepted, because a server may echo the URI back in
 * a different but equivalent form — a resolved `..`, a percent-encoding
 * difference. That is what `skillUriIdentity` is for, and it is the same rule
 * the whole module applies to every other URI comparison, so a server cannot be
 * treated as conforming by one check and non-conforming by another.
 *
 * `undefined` when nothing answers for the URI, which the caller reports as a
 * read failure. This mirrors `onReadSkillFile` in the web client, deliberately:
 * two code paths that hash bytes against a digest must not disagree about which
 * bytes they are.
 */
function contentsFor(result: unknown, uri: string): ReadContents | undefined {
  const contents = (result as { contents?: unknown })?.contents;
  if (!Array.isArray(contents)) return undefined;
  const wanted = skillUriIdentity(uri);
  for (const block of contents) {
    if (typeof block !== "object" || block === null) continue;
    const got = (block as { uri?: unknown }).uri;
    if (typeof got !== "string") continue;
    if (skillUriIdentity(got) === wanted) return block as ReadContents;
  }
  return undefined;
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
  // Computed once over the whole set, because a name collision is a property
  // of the listing rather than of an entry — `checkSkillConformance` sees one
  // at a time and structurally cannot report it. Note this is scoped to the
  // entries passed in, so `--method skills/get --verify` on a single skill
  // reports no collision: there is no listing to collide within.
  const collisions = checkSkillNameCollisions(entries);
  const reports: SkillVerifyReport[] = [];
  for (const entry of entries) {
    // The entry's own SKILL.md, read once and used twice — for its digest and
    // for the frontmatter cross-check. Reading it twice would double the load
    // on the server and, worse, could compare a digest against one snapshot
    // and frontmatter against another.
    //
    // Held as BYTES, not text. Taking `contents.text` skipped the whole
    // frontmatter comparison whenever a server returned the markdown as a
    // base64 `blob` — which is a legal `resources/read` shape, and which this
    // module already decodes for the digest — so a mandatory check silently did
    // not run while the report still said `ok` (Copilot). Deriving the text from
    // the same verified bytes also guarantees the digest and the frontmatter
    // describe one snapshot.
    let entryBytes: Uint8Array | undefined;
    const files: SkillFileReport[] = [];

    const manifest =
      entry.resources === DYNAMIC_RESOURCES ? [] : entry.resources;
    const entryIdentity = skillUriIdentity(entry.uri);
    // Compared by NORMALIZED identity, like every other URI comparison here —
    // `checkSkillConformance` already accepts a manifest self-entry written in
    // an equivalent form, so a raw string test would disagree with it and read
    // the same file a second time.
    const manifestListsSelf = manifest.some(
      (resource) => skillUriIdentity(resource.uri) === entryIdentity,
    );
    for (const resource of manifest) {
      let contents: ReadContents | undefined;
      try {
        const invocation = await client.readResource(resource.uri, metadata);
        contents = contentsFor(invocation.result, resource.uri);
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) throw err;
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason: reasonOf(err),
        });
        continue;
      }
      if (!contents) {
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason:
            "resources/read returned no content block for this URI, so there are no bytes that can be checked against its digest.",
        });
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = skillFileBytes(contents);
      } catch (err) {
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason: reasonOf(err),
        });
        continue;
      }
      if (skillUriIdentity(resource.uri) === entryIdentity) entryBytes = bytes;
      const verification = await verifySkillResource(resource, bytes);
      files.push({ uri: resource.uri, ...verification });
    }

    // A `"dynamic"` skill has no manifest, so the loop above read nothing —
    // but its SKILL.md is still served and still has to match the frontmatter
    // the listing advertised. That obligation is not waived by the file set
    // being unenumerable; only integrity is. The same applies to a skill whose
    // manifest omits its own file.
    //
    // Gated on `manifestListsSelf` rather than on `entryBytes`, so a self-entry
    // the loop already tried and FAILED to read is not read a second time — its
    // failure is recorded there.
    if (!manifestListsSelf) {
      // Recorded as a file result, not swallowed. Because a dynamic skill has
      // no manifest rows, `files` would otherwise stay empty and its only static
      // finding is a warning — so an unreadable SKILL.md returned `ok: true`
      // for a skill whose mandatory frontmatter check never ran (Copilot).
      const fail = (reason: string) =>
        files.push({ uri: entry.uri, status: "read-error", reason });
      try {
        const invocation = await client.readResource(entry.uri, metadata);
        const contents = contentsFor(invocation.result, entry.uri);
        if (!contents) {
          fail(
            "resources/read returned no content block for this skill's own SKILL.md, so its frontmatter cannot be checked against the listing.",
          );
        } else {
          try {
            entryBytes = skillFileBytes(contents);
          } catch (err) {
            fail(reasonOf(err));
          }
        }
      } catch (err) {
        // An expired authorization is the one error that is not this file's
        // problem — see the note on the function.
        if (err instanceof AuthRecoveryRequiredError) throw err;
        fail(reasonOf(err));
      }
    }

    const entryText =
      entryBytes === undefined ? undefined : bytesToText(entryBytes);

    const collision = collisions.get(skillUriIdentity(entry.uri));
    const conformance = [
      ...checkSkillConformance(entry),
      ...(collision ? [collision] : []),
    ];
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
