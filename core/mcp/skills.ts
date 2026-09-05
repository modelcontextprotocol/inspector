/**
 * Skills extension (SEP-2640) detection, conformance checking, and digest
 * verification — the part of the extension that makes the Inspector more than a
 * viewer.
 *
 * SEP-2640 puts real obligations on whoever consumes a skill: verify each
 * fetched file against the digest its manifest advertised, treat a mismatch as
 * a failure, and honor the per-skill limits. Every one of those is a check a
 * server author wants run against their implementation, which is the same
 * argument the CLI's `--strict` tool-schema lint makes. So the checks live here,
 * shared by every client, and produce a structured finding list rather than a
 * boolean — a report is useful, "invalid" is not.
 *
 * ⚠️ Skills is a **server-declared** extension, read off the connecting server's
 * `capabilities.extensions`. It deliberately does NOT belong in
 * `ADVERTISABLE_EXTENSIONS` (`core/mcp/extensions.ts`), which is the catalog of
 * extensions the *Inspector* advertises and the user toggles in Server Settings.
 * The precedent is `appElicitation.ts`, which reads the server side the same
 * way; getting it backwards would put a meaningless toggle in Server Settings.
 *
 * The Inspector is an inspector, not a host: a `resources/read` of a `SKILL.md`
 * is explicitly not a load and confers no standing, so none of the SEP's host
 * machinery (activation, per-skill consent, content-bound approval) is
 * implemented here. Surface and verify.
 *
 * ⚠️ **One SEP-2640 obligation is deliberately NOT checked here: that an entry's
 * `frontmatter` matches the fetched `SKILL.md`'s frontmatter field by field.**
 * The digest check does not cover it — a digest is taken over the bytes the
 * server served, so it proves the file was not tampered with in transit and
 * says nothing about whether the *listing* described that file honestly. A
 * server can therefore advertise one description, serve a different one, and
 * pass every check in this module. Closing it needs a YAML parser, which is a
 * new runtime dependency and a placement decision of its own, so it is tracked
 * on #2248 rather than half-done here.
 */

import type { ServerCapabilities } from "@modelcontextprotocol/client";
import {
  DYNAMIC_RESOURCES,
  SKILLS_EXTENSION_KEY,
  type SkillEntry,
  type SkillResource,
} from "./skillsSchemas.js";
import { sha256Bytes } from "./sha256.js";

/** Maximum resource entries a single skill may declare (SEP-2640). */
export const SKILL_MAX_RESOURCE_ENTRIES = 512;

/** Maximum total size, in bytes, of a single skill's resources (16 MiB). */
export const SKILL_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/** The suffix every skill URI ends with; the segment before it is the name. */
export const SKILL_FILE_SUFFIX = "/SKILL.md";

/** `sha256:` followed by exactly 64 lowercase hex characters. */
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * The Agent Skills name format SEP-2640 requires of `frontmatter.name`: 1–64
 * characters of lowercase alphanumerics and hyphens, with no leading, trailing
 * or consecutive hyphen.
 *
 * Checking only that the name is non-empty let `Bad Name` reach the UI as
 * "Conforms" — and the name is not decorative here: it must equal the URI path
 * segment, so a name that cannot appear in a URI is a contradiction the entry
 * cannot satisfy.
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;

/**
 * What the server declared under `io.modelcontextprotocol/skills`. The only
 * sub-option SEP-2640 defines is `directoryRead`, which gates
 * `resources/directory/read`.
 */
export interface SkillsExtensionSupport {
  /** True when the server declared `directoryRead: true`. */
  directoryRead: boolean;
}

/**
 * Read the Skills extension off a server's advertised capabilities, or
 * `undefined` when the server did not declare it.
 *
 * Not era-gated, unlike `isTasksExtensionNegotiated()`: `skills/*` are not spec
 * method names in either codec, so nothing about the negotiated era changes
 * whether the extension can be served or called. A legacy-era server that
 * declares it is serving it.
 */
export function getSkillsExtension(
  capabilities: ServerCapabilities | undefined,
): SkillsExtensionSupport | undefined {
  const declared = capabilities?.extensions?.[SKILLS_EXTENSION_KEY];
  if (declared === undefined || declared === null) return undefined;
  const directoryRead =
    typeof declared === "object" &&
    (declared as { directoryRead?: unknown }).directoryRead === true;
  return { directoryRead };
}

/** True when the connected server declared the Skills extension. */
export function isSkillsExtensionSupported(
  capabilities: ServerCapabilities | undefined,
): boolean {
  return getSkillsExtension(capabilities) !== undefined;
}

/**
 * A skill URI in normalized form, or `undefined` when it is not one.
 *
 * Two things a raw string comparison gets wrong, and both matter:
 *
 * 1. **`..` segments.** `skill://acme/billing/refunds/../other.md` starts with
 *    the advertised root but resolves outside it. Containment has to be decided
 *    on the resolved path, so every check below goes through the parser.
 * 2. **Relative strings.** SEP-2640 requires a full resource URI, and
 *    `demo/SKILL.md` is not one — it fails to parse and is reported as
 *    `malformed-uri` rather than quietly treated as a skill path.
 *
 * An **opaque-path** URI (`skill:demo/SKILL.md`, no authority) parses but is
 * NOT normalized by the parser — its `..` segments survive verbatim — so it is
 * rejected too: containment could not be decided on it, and silently accepting
 * one would reintroduce exactly the hole this function closes.
 *
 * The scheme is deliberately **not** constrained. `skill://` is what SEP-2640
 * recommends and what this repo's fixture serves, but the SEP only says servers
 * SHOULD use it and explicitly allows a domain-native scheme (`github://…`), so
 * requiring `skill:` would hand a conforming server a false `malformed-uri` and
 * skip its name and root checks entirely. Containment is scheme-independent
 * anyway: it compares a resource against *this entry's own* root, so an entry
 * cannot escape its skill whatever scheme it uses.
 */
export function normalizeSkillUri(uri: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  return parsed.pathname.startsWith("/") ? parsed.href : undefined;
}

/**
 * The final `<skill-path>` segment of a skill URI — the segment *before*
 * `/SKILL.md`, not the filename. SEP-2640 requires it to equal
 * `frontmatter.name`, which is what makes a skill's name recoverable from its
 * URI alone. Returns `undefined` when the URI does not have that shape, which
 * is itself a conformance finding.
 *
 * Read off the **normalized** URI, so a traversal segment cannot produce a
 * name the resolved path does not actually carry.
 */
export function skillNameFromUri(uri: string): string | undefined {
  const normalized = normalizeSkillUri(uri);
  if (normalized === undefined || !normalized.endsWith(SKILL_FILE_SUFFIX)) {
    return undefined;
  }
  const path = normalized.slice(0, -SKILL_FILE_SUFFIX.length);
  const segment = path.slice(path.lastIndexOf("/") + 1);
  return segment.length > 0 ? segment : undefined;
}

/**
 * The label a UI shows for a skill: the declared name, falling back to the URI
 * path segment, falling back to the raw URI. Never empty, so a list row is
 * always addressable even for a badly non-conforming entry.
 */
export function skillDisplayName(entry: SkillEntry): string {
  const declared = entry.frontmatter.name?.trim();
  if (declared) return declared;
  return skillNameFromUri(entry.uri) ?? entry.uri;
}

/** Machine-readable identity of a conformance finding. */
export type SkillIssueCode =
  | "dynamic-resources"
  | "missing-name"
  | "malformed-name"
  | "missing-description"
  | "malformed-uri"
  | "name-path-mismatch"
  | "missing-digest"
  | "malformed-digest"
  | "missing-size"
  | "malformed-size"
  | "duplicate-resource"
  | "resource-outside-skill-root"
  | "manifest-missing-self"
  | "resource-limit-exceeded"
  | "size-limit-exceeded";

/**
 * `error` marks a **MUST** of SEP-2640 that the server broke, so a manifest
 * reporting "0 errors" really is one the spec accepts. `warning` covers
 * everything the spec permits but a consumer still wants told about: the
 * `SHOULD NOT`-exceed interoperability limits, and — above all — `"dynamic"`
 * resources, which are legal and leave integrity unverifiable, the case most
 * worth surfacing and the one most easily buried.
 */
export type SkillIssueSeverity = "error" | "warning";

export interface SkillIssue {
  code: SkillIssueCode;
  severity: SkillIssueSeverity;
  /** Human-readable statement of what is wrong. */
  message: string;
  /** The manifest entry the finding is about, when it is a per-file finding. */
  resourceUri?: string;
}

/**
 * Run every structural check SEP-2640 states against one skill entry, returning
 * the findings in a stable order (skill-level first, then per-resource in
 * manifest order). An empty array means the entry conforms.
 *
 * This is the static half. Digest *verification* needs the file's bytes and so
 * lives in {@link verifySkillResource}, which the UI runs on demand.
 */
export function checkSkillConformance(entry: SkillEntry): SkillIssue[] {
  const issues: SkillIssue[] = [];
  const declaredName = entry.frontmatter.name?.trim();
  const uriName = skillNameFromUri(entry.uri);

  if (!declaredName) {
    issues.push({
      code: "missing-name",
      severity: "error",
      message: "frontmatter.name is required but missing or empty.",
    });
  } else if (
    declaredName.length > SKILL_NAME_MAX_LENGTH ||
    !SKILL_NAME_PATTERN.test(declaredName)
  ) {
    issues.push({
      code: "malformed-name",
      severity: "error",
      message: `frontmatter.name "${declaredName}" is not a valid Agent Skills name: 1–${SKILL_NAME_MAX_LENGTH} lowercase alphanumerics and hyphens, with no leading, trailing or consecutive hyphen.`,
    });
  }
  if (!entry.frontmatter.description?.trim()) {
    // An error, not a warning: SEP-2640 requires `description` on every skill,
    // so an absent one is a format violation and must not read as "0 errors".
    issues.push({
      code: "missing-description",
      severity: "error",
      message: "frontmatter.description is required but missing or empty.",
    });
  }
  if (uriName === undefined) {
    issues.push({
      code: "malformed-uri",
      severity: "error",
      message: `Skill URI must be a hierarchical URI ending with "${SKILL_FILE_SUFFIX}" and carrying a non-empty path segment before it.`,
    });
  } else if (declaredName && uriName !== declaredName) {
    // The one structural invariant the spec states outright: the segment before
    // /SKILL.md must equal frontmatter.name, so the name is recoverable from
    // the URI alone. Only checked when both halves exist — a missing name is
    // already reported above, and reporting it twice reads as two defects.
    issues.push({
      code: "name-path-mismatch",
      severity: "error",
      message: `URI path segment "${uriName}" does not match frontmatter.name "${declaredName}".`,
    });
  }

  if (entry.resources === DYNAMIC_RESOURCES) {
    issues.push({
      code: "dynamic-resources",
      severity: "warning",
      message:
        'resources is "dynamic": the file set is generated, so no digest is advertised and integrity cannot be verified.',
    });
    return issues;
  }

  // Both limits are *interoperability* bounds, not MUSTs: SEP-2640 says a
  // server SHOULD NOT exceed them and a host MAY support more. So they are
  // warnings — calling a permitted oversized skill an error would contradict
  // what `error` means here and tell a server author their skill is invalid
  // when it is merely less portable.
  if (entry.resources.length > SKILL_MAX_RESOURCE_ENTRIES) {
    issues.push({
      code: "resource-limit-exceeded",
      severity: "warning",
      message: `Skill declares ${entry.resources.length} resource entries, above the ${SKILL_MAX_RESOURCE_ENTRIES}-entry interoperability limit; a host is only required to support up to it.`,
    });
  }
  const totalBytes = totalSkillBytes(entry.resources);
  if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
    issues.push({
      code: "size-limit-exceeded",
      severity: "warning",
      message: `Skill resources total ${totalBytes} bytes, above the ${SKILL_MAX_TOTAL_BYTES}-byte (16 MiB) interoperability limit; a host is only required to support up to it.`,
    });
  }

  // A manifest is the *complete* file set, and the skill's own SKILL.md is one
  // of those files. An empty list, or one that omits the entry's own URI, is
  // therefore not "a skill with no extra files" — it is a manifest that cannot
  // be checked against what the skill actually is, and reporting `Conforms`
  // for it would be a wrong answer rather than a missing one.
  if (!entry.resources.some((resource) => resource.uri === entry.uri)) {
    issues.push({
      code: "manifest-missing-self",
      severity: "error",
      message: `Manifest does not list the skill's own entry file (${entry.uri}); a manifest must be the complete file set.`,
    });
  }

  const seenUris = new Set<string>();
  // Relative references resolve against the skill root, so every manifest entry
  // must live under it. A URI outside that prefix is either a typo or a server
  // claiming integrity over a file that is not part of this skill. Computed
  // from the NORMALIZED entry URI, and compared against normalized resource
  // URIs, so a `..` segment cannot walk out of the root while still matching it
  // as a string. Left `undefined` for a malformed entry URI — there is no root
  // to measure against, and `malformed-uri` already reports that.
  const normalizedEntryUri = normalizeSkillUri(entry.uri);
  const root =
    normalizedEntryUri !== undefined &&
    normalizedEntryUri.endsWith(SKILL_FILE_SUFFIX)
      ? `${normalizedEntryUri.slice(0, -SKILL_FILE_SUFFIX.length)}/`
      : undefined;

  for (const resource of entry.resources) {
    // Compared on the NORMALIZED identity, because everything else here treats
    // normalized-equivalents as the same resource — containment does, and so
    // does the read that fetches the bytes. On the raw string,
    // `skill://demo/SKILL.md` and `skill://demo/x/../SKILL.md` would pass as
    // two distinct files while naming one. The raw URI is still what the
    // finding reports, so the diagnostic points at what the server actually
    // sent. Unparseable URIs fall back to the raw string: they are already
    // reported by the root check, and normalizing them all to `undefined`
    // would make two different bad URIs look like one duplicate.
    const identity = normalizeSkillUri(resource.uri) ?? resource.uri;
    if (seenUris.has(identity)) {
      issues.push({
        code: "duplicate-resource",
        severity: "error",
        message:
          "Manifest lists this URI more than once; entries must be unique.",
        resourceUri: resource.uri,
      });
    }
    seenUris.add(identity);
    if (root !== undefined) {
      const normalized = normalizeSkillUri(resource.uri);
      // An unparseable entry URI is outside the root by construction: nothing
      // can establish that it is inside one.
      if (normalized === undefined || !normalized.startsWith(root)) {
        issues.push({
          code: "resource-outside-skill-root",
          severity: "error",
          message: `Manifest entry does not resolve inside the skill root "${root}".`,
          resourceUri: resource.uri,
        });
      }
    }
    if (resource.digest === undefined) {
      // An error, not a warning: SEP-2640 requires `digest` on every manifest
      // entry, so an entry without one is invalid — and reporting it as a
      // warning would let such a manifest show "0 errors", which is the
      // affirmative pass this checker must never give.
      issues.push({
        code: "missing-digest",
        severity: "error",
        message:
          "Manifest entry declares no digest, which is required — and without it the file cannot be verified.",
        resourceUri: resource.uri,
      });
    } else if (!DIGEST_PATTERN.test(resource.digest)) {
      issues.push({
        code: "malformed-digest",
        severity: "error",
        message: `Digest "${resource.digest}" is not "sha256:" followed by 64 lowercase hex characters.`,
        resourceUri: resource.uri,
      });
    }
    if (resource.size === undefined) {
      // Also an error: `size` is a required field, not an integrity hint, and
      // an omitted one is what lets a server slip past the 16 MiB pre-fetch
      // limit — the entry is excluded from the total — while the UI reports no
      // conformance errors at all.
      issues.push({
        code: "missing-size",
        severity: "error",
        message:
          "Manifest entry declares no size, which is required — and without it the entry is excluded from the 16 MiB total and its length cannot be cross-checked.",
        resourceUri: resource.uri,
      });
    } else if (!isUsableSize(resource.size)) {
      issues.push({
        code: "malformed-size",
        severity: "error",
        message: `Size ${resource.size} is not a non-negative integer byte length.`,
        resourceUri: resource.uri,
      });
    }
  }

  return issues;
}

/**
 * Whether a declared `size` is a usable byte length. SEP-2640 defines it as the
 * raw byte count, so anything that is not a non-negative safe integer is
 * nonsense — and a *negative* one is worse than nonsense, because summing it
 * would pull the manifest total back under the 16 MiB limit and hide a
 * violation. Reported as `malformed-size` and excluded from the sum.
 */
function isUsableSize(size: number | undefined): size is number {
  return size !== undefined && Number.isSafeInteger(size) && size >= 0;
}

/**
 * Sum of the manifest's declared `size` fields. An entry that omits `size` — or
 * declares an unusable one — contributes nothing rather than failing the sum:
 * the limit check is about catching a server that is demonstrably over, and an
 * incomplete manifest can only ever understate the total, so this never
 * produces a false positive.
 */
export function totalSkillBytes(resources: readonly SkillResource[]): number {
  return resources.reduce(
    (sum, r) => sum + (isUsableSize(r.size) ? r.size : 0),
    0,
  );
}

/**
 * Whether a `skills/get` entry describes the same skill as the `skills/list`
 * entry alongside it, compared **semantically** rather than byte-for-byte.
 *
 * Two things a `JSON.stringify` comparison gets wrong here, and both would
 * report a conforming server as broken: object key order is not meaningful in
 * JSON, and the resource manifest is a *set*, so a server free to enumerate it
 * in any order would look inconsistent for reordering it. Both sides are
 * canonicalized — keys sorted recursively, manifest entries sorted by URI —
 * before they are compared.
 *
 * A difference is still worth showing, but it is NOT by itself an error:
 * SEP-2640 defines `skills/get` as a fresh point-in-time snapshot, so a skill
 * that genuinely changed since the listing legitimately differs. The caller
 * presents it as "the snapshot moved" and leaves the judgement to the reader.
 */
export function skillEntriesMatch(a: SkillEntry, b: SkillEntry): boolean {
  return canonicalEntry(a) === canonicalEntry(b);
}

/**
 * Deterministic JSON for one entry: object keys sorted recursively, and **the
 * entry's own manifest** — nothing else — sorted by URI.
 *
 * The manifest sort is deliberately not recursive. `frontmatter` is verbatim
 * arbitrary JSON from the skill author, so a custom `frontmatter.metadata.
 * resources` array would be caught by a recursive rule and two genuinely
 * different frontmatters would compare equal. Only `SkillEntry.resources` is
 * a set; every other array keeps its order.
 */
function canonicalEntry(entry: SkillEntry): string {
  const { resources, ...rest } = entry;
  const manifest = Array.isArray(resources)
    ? [...resources]
        .sort((x, y) => String(x?.uri).localeCompare(String(y?.uri)))
        .map(canonicalize)
    : resources;
  return JSON.stringify({ ...sortKeys(rest), resources: manifest });
}

/** Object keys sorted recursively; array ORDER is preserved throughout. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return sortKeys(value as Record<string, unknown>);
}

function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, member]): [string, unknown] => [key, canonicalize(member)])
      .sort(([x], [y]) => x.localeCompare(y)),
  );
}

/** Outcome of comparing a fetched file against its advertised digest. */
export type SkillVerificationStatus =
  | "verified"
  | "mismatch"
  | "unverifiable"
  | "error";

export interface SkillVerification {
  status: SkillVerificationStatus;
  /** The digest computed over the fetched bytes, when one was computed. */
  actualDigest?: string;
  /** The manifest's digest, echoed so a mismatch renders both halves. */
  expectedDigest?: string;
  /** The manifest's declared byte length, when it declared one. */
  expectedSize?: number;
  /** The fetched file's actual byte length, when it was measured. */
  actualSize?: number;
  /** Why the file could not be verified or fetched. */
  reason?: string;
}

/** Lowercase hex of a byte array — the form SEP-2640 digests are written in. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * `sha256:<64 hex>` over the given bytes, in the exact form a manifest digest
 * takes, so a caller can compare strings rather than re-deriving the prefix.
 *
 * Uses WebCrypto (`crypto.subtle`), which both Node ≥22 and the browser provide
 * — no dependency, and per [Dependency placement] this module adds nothing to
 * any manifest. The Inspector's web client is served over localhost, a secure
 * context, so `subtle` is present there too.
 */
export async function sha256Digest(bytes: Uint8Array): Promise<string> {
  // `crypto.subtle` is exposed only in a SECURE CONTEXT, and this app is
  // documented as servable over plain HTTP on a LAN IP
  // (`clients/web/README.md#hosting-on-a-network`). There, `crypto` exists but
  // `crypto.subtle` does not — so without this fallback every verification
  // would throw and the UI would report a read failure for a file it fetched
  // perfectly well. `sha256Bytes` is checked against the published FIPS 180-4
  // vectors and differentially against WebCrypto, so the two paths agree.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `sha256:${toHex(sha256Bytes(bytes))}`;
  // Copy the VIEW into a fresh typed array rather than slicing its backing
  // store. Two things depend on that: a `Uint8Array` can be a window into a
  // larger buffer, so hashing the buffer would digest neighbouring bytes; and
  // `SharedArrayBuffer.prototype.slice()` returns another `SharedArrayBuffer`,
  // which `crypto.subtle.digest` rejects — so slicing-and-casting would have
  // failed at runtime for the exact input a cast claimed to handle.
  // `new Uint8Array(view)` always allocates a plain `ArrayBuffer`, which is
  // also why no cast is needed here.
  const copy = new Uint8Array(bytes);
  const hash = await subtle.digest("SHA-256", copy.buffer);
  return `sha256:${toHex(new Uint8Array(hash))}`;
}

/** UTF-8 bytes of a `resources/read` text content block. */
export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Raw bytes of a `resources/read` blob content block (standard base64).
 * Uses `atob`, which Node ≥22 and every browser provide, so this stays
 * dependency-free and works unchanged in both.
 */
export function base64ToBytes(blob: string): Uint8Array {
  const binary = atob(blob);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Verify one fetched skill file against its manifest entry.
 *
 * A mismatch is reported as `"mismatch"` with both digests attached rather than
 * thrown — the whole value proposition is showing a digest mismatch loudly, and
 * a thrown error would collapse into whatever the caller's generic failure UI
 * says. `"unverifiable"` means the manifest advertised no digest (or advertised
 * a malformed one, already reported by {@link checkSkillConformance}); nothing
 * about the file itself is wrong, we simply have nothing to compare against.
 *
 * The declared `size` is cross-checked **before** the digest and fails
 * verification on its own. A length that disagrees with the manifest is a real
 * inconsistency even when the digest matches — the digest is taken over the
 * bytes the server served, so agreeing with it says nothing about whether the
 * manifest describes those bytes — and it is the cheaper check, so a
 * 16 MiB file that was never going to verify is not hashed first.
 */
export async function verifySkillResource(
  resource: SkillResource,
  bytes: Uint8Array,
): Promise<SkillVerification> {
  const expectedSize = resource.size;
  if (expectedSize !== undefined && expectedSize !== bytes.byteLength) {
    return {
      status: "mismatch",
      expectedSize,
      actualSize: bytes.byteLength,
      ...(resource.digest !== undefined
        ? { expectedDigest: resource.digest }
        : {}),
      reason: `Manifest declares ${expectedSize} bytes but the fetched file is ${bytes.byteLength}.`,
    };
  }
  const expectedDigest = resource.digest;
  if (expectedDigest === undefined) {
    return {
      status: "unverifiable",
      reason: "The manifest entry advertises no digest.",
    };
  }
  if (!DIGEST_PATTERN.test(expectedDigest)) {
    return {
      status: "unverifiable",
      expectedDigest,
      reason:
        'The advertised digest is not "sha256:" followed by 64 lowercase hex characters.',
    };
  }
  const actualDigest = await sha256Digest(bytes);
  return {
    status: actualDigest === expectedDigest ? "verified" : "mismatch",
    actualDigest,
    expectedDigest,
    ...(expectedSize !== undefined
      ? { expectedSize, actualSize: bytes.byteLength }
      : {}),
  };
}
