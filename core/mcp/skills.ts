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

/** Maximum resource entries a single skill may declare (SEP-2640). */
export const SKILL_MAX_RESOURCE_ENTRIES = 512;

/** Maximum total size, in bytes, of a single skill's resources (16 MiB). */
export const SKILL_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/** The suffix every skill URI ends with; the segment before it is the name. */
export const SKILL_FILE_SUFFIX = "/SKILL.md";

/** `sha256:` followed by exactly 64 lowercase hex characters. */
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

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
 * The final `<skill-path>` segment of a skill URI — the segment *before*
 * `/SKILL.md`, not the filename. SEP-2640 requires it to equal
 * `frontmatter.name`, which is what makes a skill's name recoverable from its
 * URI alone. Returns `undefined` when the URI does not have that shape, which
 * is itself a conformance finding.
 */
export function skillNameFromUri(uri: string): string | undefined {
  if (!uri.endsWith(SKILL_FILE_SUFFIX)) return undefined;
  const path = uri.slice(0, -SKILL_FILE_SUFFIX.length);
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
 * `error` marks a stated requirement of SEP-2640 that the server broke.
 * `warning` marks something that is legal but leaves the Inspector unable to
 * verify integrity — `"dynamic"` resources above all, which is the case most
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
  }
  if (!entry.frontmatter.description?.trim()) {
    issues.push({
      code: "missing-description",
      severity: "warning",
      message: "frontmatter.description is missing or empty.",
    });
  }
  if (uriName === undefined) {
    issues.push({
      code: "malformed-uri",
      severity: "error",
      message: `Skill URI must end with "${SKILL_FILE_SUFFIX}" and carry a non-empty path segment before it.`,
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

  if (entry.resources.length > SKILL_MAX_RESOURCE_ENTRIES) {
    issues.push({
      code: "resource-limit-exceeded",
      severity: "error",
      message: `Skill declares ${entry.resources.length} resource entries, above the ${SKILL_MAX_RESOURCE_ENTRIES}-entry limit.`,
    });
  }
  const totalBytes = totalSkillBytes(entry.resources);
  if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
    issues.push({
      code: "size-limit-exceeded",
      severity: "error",
      message: `Skill resources total ${totalBytes} bytes, above the ${SKILL_MAX_TOTAL_BYTES}-byte (16 MiB) limit.`,
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
  // claiming integrity over a file that is not part of this skill. Left
  // `undefined` for a malformed entry URI — there is no root to measure
  // against, and `malformed-uri` already reports that.
  const root = entry.uri.endsWith(SKILL_FILE_SUFFIX)
    ? `${entry.uri.slice(0, -SKILL_FILE_SUFFIX.length)}/`
    : undefined;

  for (const resource of entry.resources) {
    if (seenUris.has(resource.uri)) {
      issues.push({
        code: "duplicate-resource",
        severity: "error",
        message:
          "Manifest lists this URI more than once; entries must be unique.",
        resourceUri: resource.uri,
      });
    }
    seenUris.add(resource.uri);
    if (root !== undefined && !resource.uri.startsWith(root)) {
      issues.push({
        code: "resource-outside-skill-root",
        severity: "error",
        message: `Manifest entry is outside the skill root "${root}".`,
        resourceUri: resource.uri,
      });
    }
    if (resource.digest === undefined) {
      issues.push({
        code: "missing-digest",
        severity: "warning",
        message: "Manifest entry declares no digest, so it cannot be verified.",
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
      // A warning, not an error: an absent size costs the length cross-check in
      // `verifySkillResource` and silently understates the 16 MiB total, but
      // the digest still verifies the bytes.
      issues.push({
        code: "missing-size",
        severity: "warning",
        message:
          "Manifest entry declares no size, so it is excluded from the 16 MiB total and its length cannot be cross-checked.",
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
  // Copy the VIEW into a fresh typed array rather than slicing its backing
  // store. Two things depend on that: a `Uint8Array` can be a window into a
  // larger buffer, so hashing the buffer would digest neighbouring bytes; and
  // `SharedArrayBuffer.prototype.slice()` returns another `SharedArrayBuffer`,
  // which `crypto.subtle.digest` rejects — so slicing-and-casting would have
  // failed at runtime for the exact input a cast claimed to handle.
  // `new Uint8Array(view)` always allocates a plain `ArrayBuffer`, which is
  // also why no cast is needed here.
  const copy = new Uint8Array(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
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
