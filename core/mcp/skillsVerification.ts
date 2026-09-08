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
  SKILL_MAX_CATALOG_BYTES,
  SKILL_MAX_CATALOG_SKILLS,
  SKILL_MAX_RESOURCE_ENTRIES,
  SKILL_MAX_TOTAL_BYTES,
  skillFileBytes,
  skillUriIdentity,
  verifySkillResource,
  type SkillIssue,
  type SkillVerification,
} from "./skills.js";
import {
  DYNAMIC_RESOURCES,
  type SkillEntry,
  type SkillResource,
} from "./skillsSchemas.js";

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
  /**
   * One entry per manifest file **read**, in manifest order.
   *
   * ⚠️ Capped at `SKILL_MAX_RESOURCE_ENTRIES` entries **and**
   * `SKILL_MAX_TOTAL_BYTES` of declared content. A manifest over either bound
   * is already reported by `resource-limit-exceeded` / `size-limit-exceeded`,
   * and reading it anyway would let a server dictate unbounded round trips or
   * bandwidth — so this can be SHORTER than the declared manifest, and a
   * consumer must not read its length as the manifest's.
   *
   * ⚠️ **Not necessarily empty for a `"dynamic"` skill.** Such a skill has no
   * manifest rows, but a failed read of its own `SKILL.md` — the file the
   * mandatory frontmatter comparison needs — is recorded here as a synthetic
   * `read-error` row against the entry's URI, so the failure is visible and
   * fails the report rather than passing silently. A consumer must not assume
   * `files` mirrors the manifest one-for-one (Copilot).
   */
  files: SkillFileReport[];
  /**
   * Why the manifest could not be checked in full, or `undefined` when it was.
   *
   * Set when the read bounds truncated the manifest, and **only** when entries
   * were actually left unread — a file that crosses the byte budget as the
   * last entry checked nothing short, so it is not incomplete.
   *
   * ⚠️ It does **not** make {@link ok} false. `ok` keeps the narrow meaning of
   * "nothing that was checked is wrong", and a truncated walk checked nothing
   * that was wrong. The signal a consumer must branch on is {@link outcome}
   * being `"incomplete"`, never `!ok` — a manifest whose unread 513th file was
   * tampered with reports `ok: true`, and a consumer that prints "verified" on
   * `ok` alone turns a denial of service into a false pass (Copilot). Both the
   * CLI summary and the TUI status line had exactly that bug.
   */
  incomplete?: string;
  /**
   * What the verification concluded. **Three outcomes, not two**, because
   * "this skill is wrong" and "this skill could not be fully checked" are
   * different answers and collapsing them misreports one of them:
   *
   * - `verified` — everything was checked and everything passed.
   * - `failed` — something the SEP makes a MUST was broken.
   * - `incomplete` — nothing checked was wrong, but the read bounds stopped
   *   the walk before it finished. See {@link incomplete} for the reason.
   *
   * ⚠️ The `incomplete` case exists because both of the obvious two-state
   * answers are wrong. Reporting success would be a **false pass** for a
   * manifest whose unread 513th file is tampered with. Reporting failure
   * would call a server nonconformant for exceeding limits SEP-2640 states as
   * SHOULD NOT — with hosts free to support more — which contradicts this
   * module's own rule that a warning never fails a report (Copilot).
   */
  outcome: "verified" | "failed" | "incomplete";
  /**
   * False when anything the SEP makes a MUST was broken: an error-severity
   * finding, a digest or size mismatch, or a file that could not be read.
   *
   * A `warning` does **not** clear it — a `"dynamic"` manifest is legal, and a
   * report that failed CI for it would be telling server authors their
   * conforming skill is broken. Neither does {@link incomplete}: an unfinished
   * walk is reported through {@link outcome}, so `ok` keeps its narrow meaning
   * of "nothing that was checked is wrong".
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

/**
 * The prefix of a manifest that may be read: at most
 * {@link SKILL_MAX_RESOURCE_ENTRIES} entries, and at most
 * {@link SKILL_MAX_TOTAL_BYTES} of declared content.
 */
function boundedManifest(
  declared: readonly SkillResource[],
): readonly SkillResource[] {
  const kept: SkillResource[] = [];
  let bytes = 0;
  for (const resource of declared) {
    if (kept.length >= SKILL_MAX_RESOURCE_ENTRIES) break;
    // Only a usable, non-negative size counts — matching `totalSkillBytes`, so
    // the bound and the finding that reports the overage agree on the total.
    const size =
      typeof resource.size === "number" &&
      Number.isSafeInteger(resource.size) &&
      resource.size >= 0
        ? resource.size
        : 0;
    if (bytes + size > SKILL_MAX_TOTAL_BYTES) break;
    bytes += size;
    kept.push(resource);
  }
  return kept;
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
 * How many bytes a string occupies as UTF-8, without encoding a copy of it.
 *
 * `TextEncoder` would be the obvious answer and allocates a second buffer for
 * a payload that may already be megabytes — and this is called on responses a
 * hostile server chose the size of, which is the case the count exists to
 * bound. Counting is O(n) and allocates nothing.
 *
 * A high surrogate is only worth 4 bytes when a low surrogate actually follows
 * it. An unpaired one encodes as U+FFFD, which is 3 — the same as any other
 * BMP character in that range, so it needs no special case beyond not
 * consuming the next unit.
 */
export function utf8Length(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      total += 1;
    } else if (code < 0x800) {
      total += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        total += 4;
        i += 1;
      } else {
        total += 3;
      }
    } else {
      total += 3;
    }
  }
  return total;
}

/**
 * What a `resources/read` response cost to receive, charged against the byte
 * budget regardless of whether any of it is usable.
 *
 * ⚠️ Deliberately measured on the RAW result rather than on decoded content.
 * The budget exists to stop a server from making this walk transfer unbounded
 * data, and a server that wants to do that has two free routes if only decoded
 * bytes are counted: label an enormous block with a URI that was not asked for,
 * or send an enormous blob that is not valid base64. Both leave the decode
 * paths empty-handed while the bytes have already crossed the wire.
 *
 * `text` is charged in **UTF-8 bytes**, the unit the limit is written in.
 * Charging `text.length` instead — UTF-16 code units — undercharged every
 * non-ASCII payload by up to 3×, so a decoy block of emoji or CJK kept the
 * counter under 16 MiB while the wire carried far more, and the walk read on
 * (Copilot). `blob` is charged in base64 characters, which is ~4/3 of what it
 * decodes to: an OVERcharge, and deliberately left as one, since a blob that
 * fails to decode has no byte count to be exact about.
 */
function responseBytes(result: unknown): number {
  const contents = (result as { contents?: unknown })?.contents;
  if (!Array.isArray(contents)) return 0;
  let total = 0;
  for (const block of contents) {
    if (typeof block !== "object" || block === null) continue;
    const { text, blob } = block as { text?: unknown; blob?: unknown };
    if (typeof text === "string") total += utf8Length(text);
    if (typeof blob === "string") total += blob.length;
  }
  return total;
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
  // ⚠️ Run-level budgets, on top of the per-skill ones below. The per-skill
  // caps bound what ONE entry can cost; nothing bounded how many entries there
  // are, and SEP-2640 puts no ceiling on a catalog — so a listing of a hundred
  // thousand skills, each individually conforming, made `--verify` run
  // indefinitely and transfer unboundedly (Copilot). See
  // {@link SKILL_MAX_CATALOG_SKILLS}.
  let walkedSkills = 0;
  let catalogBytes = 0;
  for (const entry of entries) {
    // Static checks still run for every entry — they cost no I/O, so a skill
    // past the budget is still reported on, just not read. What stops is the
    // reading.
    const withinBudget =
      walkedSkills < SKILL_MAX_CATALOG_SKILLS &&
      catalogBytes <= SKILL_MAX_CATALOG_BYTES;
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

    const declared =
      entry.resources === DYNAMIC_RESOURCES ? [] : entry.resources;
    // ⚠️ **Bounded on BOTH interoperability limits, because the manifest is
    // server-controlled.** `checkSkillConformance` reports when either is
    // exceeded — as warnings, since the SEP makes them bounds rather than MUSTs
    // — but checking constrains nothing, and this loop then downloads whatever
    // was advertised anyway.
    //
    // The entry count alone is not enough: a manifest can sit at exactly 512
    // entries and declare a gigabyte each, so bounding only the count still let
    // a server dictate unbounded bandwidth and time (Copilot). Both overages
    // are reported by `resource-limit-exceeded` / `size-limit-exceeded`; what
    // stops here is *reading* them.
    //
    // Sizes are summed the way `totalSkillBytes` sums them — an entry
    // declaring none contributes nothing, which cannot overstate the total and
    // is bounded by the count cap regardless. A read is skipped only when the
    // running total would CROSS the limit, so a conforming skill (≤ 16 MiB in
    // total, by definition) is never truncated.
    const manifest = withinBudget ? boundedManifest(declared) : [];
    let incomplete = !withinBudget
      ? `Not read: this run already reached its catalog budget of ${SKILL_MAX_CATALOG_SKILLS} skills / ${SKILL_MAX_CATALOG_BYTES} bytes. Nothing about this skill's files has been checked — verify it on its own with \`--method skills/get --uri\` to get a verdict.`
      : manifest.length < declared.length
        ? `Only ${manifest.length} of ${declared.length} manifest entries were read: the skill exceeds the ${SKILL_MAX_RESOURCE_ENTRIES}-entry / ${SKILL_MAX_TOTAL_BYTES}-byte interoperability limits, so the rest were not fetched and cannot be reported on.`
        : undefined;
    // ⚠️ Bytes ACTUALLY RECEIVED, which is the only budget a server cannot
    // lie its way past. `boundedManifest` above works from DECLARED sizes, and
    // those are server-controlled — a manifest advertising `size: 1` (or, since
    // the wire schema deliberately accepts it for reporting, no size at all)
    // sailed through the declared budget and then served arbitrarily large
    // bodies, defeating the 16 MiB safeguard entirely (Copilot). The declared
    // prefilter still earns its place by refusing to *schedule* an obviously
    // oversized set; this is what stops one that lied.
    let receivedBytes = 0;
    const entryIdentity = skillUriIdentity(entry.uri);
    // ⚠️ Whether the self entry was **actually reached**, not merely whether
    // the bounded slice contains it. The byte budget can break the loop before
    // a later self-entry, and a flag describing the slice stayed true — which
    // suppressed the fallback and skipped the mandatory frontmatter check
    // entirely (Copilot). Set inside the loop, so it can only be true of a row
    // the walk got to.
    //
    // Compared by NORMALIZED identity, like every other URI comparison here:
    // `checkSkillConformance` already accepts a manifest self-entry written in
    // an equivalent form, so a raw string test would disagree with it and read
    // the same file a second time.
    let selfAttempted = false;
    for (const [index, resource] of manifest.entries()) {
      if (skillUriIdentity(resource.uri) === entryIdentity) {
        // Marked before the read, not after: a row the walk reached but could
        // not read has still been attempted, and its failure is recorded here
        // rather than re-attempted by the fallback.
        selfAttempted = true;
      }
      // Bytes attributed to THIS response, charged whether or not any of them
      // turn out to be usable — see `responseBytes`.
      let charged = 0;
      try {
        const invocation = await client.readResource(resource.uri, metadata);
        // ⚠️ Charged from the RAW response, BEFORE the block is selected and
        // before it is decoded. Charging only the decoded bytes let a server
        // spend the budget for free: return one enormous block labelled some
        // other URI (so `contentsFor` finds nothing) or one enormous invalid
        // base64 blob (so `skillFileBytes` throws), and the walk banked zero
        // against the cap and went on to issue up to 512 more of them
        // (Copilot). The safeguard has to be paid for by the transfer, not by
        // the parse.
        charged = responseBytes(invocation.result);
        const contents = contentsFor(invocation.result, resource.uri);
        if (!contents) {
          files.push({
            uri: resource.uri,
            status: "read-error",
            reason:
              "resources/read returned no content block for this URI, so there are no bytes that can be checked against its digest.",
          });
        } else {
          let bytes: Uint8Array | undefined;
          try {
            bytes = skillFileBytes(contents);
          } catch (err) {
            files.push({
              uri: resource.uri,
              status: "read-error",
              reason: reasonOf(err),
            });
          }
          if (bytes) {
            // The decoded length is exact where `responseBytes` is only an
            // estimate, so the larger of the two is charged: never less than
            // what this file actually cost, and never less than what the rest
            // of the response was estimated to cost.
            charged = Math.max(charged, bytes.byteLength);
            if (skillUriIdentity(resource.uri) === entryIdentity)
              entryBytes = bytes;
            const verification = await verifySkillResource(resource, bytes);
            files.push({ uri: resource.uri, ...verification });
          }
        }
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) throw err;
        // Nothing to charge: a rejected read never handed us a payload to
        // measure. Whatever the transport moved before failing is invisible
        // at this layer.
        files.push({
          uri: resource.uri,
          status: "read-error",
          reason: reasonOf(err),
        });
      }
      // Counted AFTER this row is recorded, so the response that crosses the
      // line is still reported rather than fetched and discarded. The next
      // read is what stops. ⚠️ This bounds the total across responses, not the
      // size of any single one: a first response larger than the cap is
      // already in memory by the time it can be measured, which would need a
      // streaming read to prevent and is not something this API exposes.
      receivedBytes += charged;
      if (receivedBytes > SKILL_MAX_TOTAL_BYTES) {
        // ⚠️ Only *incomplete* when the budget actually cost a read. Crossing
        // the line on the final entry stopped nothing — every manifest row was
        // fetched and checked — and reporting "Stopped after 3 of 3" there
        // both reads as a contradiction and demotes a fully-checked skill out
        // of `verified` (Copilot). The prefilter's own reason, if it dropped
        // entries before the walk, is already set and is not overwritten.
        if (index < manifest.length - 1) {
          incomplete = `Stopped after ${index + 1} of ${declared.length} manifest entries: the files actually served exceed the ${SKILL_MAX_TOTAL_BYTES}-byte interoperability limit, whatever sizes the manifest declared.`;
        }
        break;
      }
    }

    // A `"dynamic"` skill has no manifest, so the loop above read nothing —
    // but its SKILL.md is still served and still has to match the frontmatter
    // the listing advertised. That obligation is not waived by the file set
    // being unenumerable; only integrity is. The same applies to a skill whose
    // manifest omits its own file.
    //
    // Gated on `selfAttempted` rather than on `entryBytes`, so a self-entry the
    // loop already tried and FAILED to read is not read a second time — its
    // failure is recorded there. A self-entry the walk never reached, whether
    // because a cap excluded it or because the byte budget broke the loop
    // first, still gets the fallback: the frontmatter comparison is mandatory
    // and must not be lost to a limit that exists to bound unrelated files.
    if (withinBudget && !selfAttempted) {
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
        // If the DECLARED manifest lists this file but the read bounds
        // excluded it, verify it here too. The fallback exists for the
        // frontmatter check, but reading a file and then not checking the
        // digest the manifest advertised for it would leave the entry's own
        // SKILL.md the one file nobody verified (Copilot).
        const declaredSelf = declared.find(
          (resource) => skillUriIdentity(resource.uri) === entryIdentity,
        );
        if (declaredSelf && entryBytes !== undefined) {
          files.push({
            // The DECLARED spelling, not the entry's. They can differ — a
            // manifest may write its self-entry in a normalized-equivalent
            // form — and a consumer matching rows against the manifest then
            // finds nothing, while a normalized "extra files" filter suppresses
            // it as already covered. The result was a verdict that existed in
            // the report and appeared nowhere on screen (Copilot).
            uri: declaredSelf.uri,
            ...(await verifySkillResource(declaredSelf, entryBytes)),
          });
        }
      } catch (err) {
        // An expired authorization is the one error that is not this file's
        // problem — see the note on the function.
        if (err instanceof AuthRecoveryRequiredError) throw err;
        fail(reasonOf(err));
      }
    }

    // Charged after this entry's reads, so the skill that crosses the run
    // budget is still fully reported rather than half-read. The NEXT one stops.
    if (withinBudget) {
      walkedSkills += 1;
      catalogBytes += receivedBytes;
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
      ...(incomplete ? { incomplete } : {}),
      ok: !hasError && !fileFailed,
      outcome:
        hasError || fileFailed
          ? "failed"
          : incomplete !== undefined
            ? "incomplete"
            : "verified",
    });
  }
  return reports;
}

/**
 * True when every skill was checked in full and passed.
 *
 * Deliberately stricter than `every(r => r.ok)`: a report that could not be
 * finished has not verified anything about the part it did not read, so it is
 * not "verified" even though nothing it *did* read was wrong.
 */
export function allSkillsVerified(
  reports: readonly SkillVerifyReport[],
): boolean {
  return reports.every((report) => report.outcome === "verified");
}

/** True when any skill broke something the SEP makes a MUST. */
export function anySkillFailed(reports: readonly SkillVerifyReport[]): boolean {
  return reports.some((report) => report.outcome === "failed");
}
