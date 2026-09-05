import { describe, it, expect } from "vitest";
import type { ServerCapabilities } from "@modelcontextprotocol/client";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import { SKILLS_EXTENSION_KEY } from "@inspector/core/mcp/skillsSchemas";
import {
  SKILL_MAX_RESOURCE_ENTRIES,
  SKILL_MAX_TOTAL_BYTES,
  base64ToBytes,
  checkSkillConformance,
  getSkillsExtension,
  isSkillsExtensionSupported,
  sha256Digest,
  skillDisplayName,
  skillNameFromUri,
  textToBytes,
  totalSkillBytes,
  verifySkillResource,
} from "@inspector/core/mcp/skills";

/** The digest of the string "hello", precomputed so the assertion is a fact
 * about SHA-256 rather than a restatement of what the code just did. */
const HELLO_SHA256 =
  "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

const DIGEST = `sha256:${"a".repeat(64)}`;

/**
 * A conforming entry: the manifest is complete (it lists the skill's own
 * SKILL.md), unique, inside the skill root, and every row carries a digest and
 * a size. Overrides make exactly one of those false, one test at a time.
 */
function entry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    uri: "skill://demo/SKILL.md",
    frontmatter: { name: "demo", description: "A demo skill" },
    resources: [
      { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
      { uri: "skill://demo/ref.md", digest: DIGEST, size: 10 },
    ],
    ...overrides,
  };
}

function caps(extensions?: Record<string, unknown>): ServerCapabilities {
  return { ...(extensions ? { extensions } : {}) } as ServerCapabilities;
}

describe("getSkillsExtension", () => {
  it("returns undefined when the server declared no extensions at all", () => {
    expect(getSkillsExtension(undefined)).toBeUndefined();
    expect(getSkillsExtension(caps())).toBeUndefined();
  });

  it("returns undefined when other extensions are declared but not skills", () => {
    expect(
      getSkillsExtension(caps({ "io.modelcontextprotocol/tasks": {} })),
    ).toBeUndefined();
  });

  it("reports directoryRead false for a bare declaration", () => {
    expect(getSkillsExtension(caps({ [SKILLS_EXTENSION_KEY]: {} }))).toEqual({
      directoryRead: false,
    });
  });

  it("reports directoryRead only for a literal true", () => {
    expect(
      getSkillsExtension(
        caps({ [SKILLS_EXTENSION_KEY]: { directoryRead: true } }),
      ),
    ).toEqual({ directoryRead: true });
    // A truthy non-`true` value is a non-conforming advertisement; treating it
    // as support would make the Inspector call a method the server may not
    // serve, so it reads as unsupported.
    expect(
      getSkillsExtension(
        caps({ [SKILLS_EXTENSION_KEY]: { directoryRead: "yes" } }),
      ),
    ).toEqual({ directoryRead: false });
  });

  it("treats a declared-but-null value as no declaration", () => {
    expect(
      getSkillsExtension(caps({ [SKILLS_EXTENSION_KEY]: null })),
    ).toBeUndefined();
  });

  it("treats a non-object declaration as declared with no sub-options", () => {
    expect(getSkillsExtension(caps({ [SKILLS_EXTENSION_KEY]: true }))).toEqual({
      directoryRead: false,
    });
  });

  it("isSkillsExtensionSupported mirrors presence", () => {
    expect(isSkillsExtensionSupported(caps())).toBe(false);
    expect(
      isSkillsExtensionSupported(caps({ [SKILLS_EXTENSION_KEY]: {} })),
    ).toBe(true);
  });
});

describe("skillNameFromUri", () => {
  it("returns the segment before /SKILL.md, not the filename", () => {
    expect(skillNameFromUri("skill://a/b/data-analysis/SKILL.md")).toBe(
      "data-analysis",
    );
  });

  it("returns undefined for a URI that does not end in /SKILL.md", () => {
    expect(skillNameFromUri("skill://demo/other.md")).toBeUndefined();
    // The suffix must include the separator: a bare "SKILL.md" has no segment.
    expect(skillNameFromUri("SKILL.md")).toBeUndefined();
  });

  it("returns undefined when the segment before the suffix is empty", () => {
    expect(skillNameFromUri("skill:///SKILL.md")).toBeUndefined();
  });
});

describe("skillDisplayName", () => {
  it("prefers the declared frontmatter name", () => {
    expect(skillDisplayName(entry())).toBe("demo");
  });

  it("falls back to the URI segment when the name is blank", () => {
    expect(skillDisplayName(entry({ frontmatter: { name: "   " } }))).toBe(
      "demo",
    );
  });

  it("falls back to the raw URI when neither is available", () => {
    expect(skillDisplayName(entry({ uri: "skill://x", frontmatter: {} }))).toBe(
      "skill://x",
    );
  });
});

describe("checkSkillConformance", () => {
  it("reports nothing for a conforming entry", () => {
    expect(checkSkillConformance(entry())).toEqual([]);
  });

  it("reports a missing name as an error", () => {
    const issues = checkSkillConformance(
      entry({ frontmatter: { description: "d" } }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-name"]);
    expect(issues[0].severity).toBe("error");
  });

  it("reports a missing description as a warning", () => {
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: "demo" } }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-description"]);
    expect(issues[0].severity).toBe("warning");
  });

  it("reports a URI that does not carry a skill path", () => {
    const issues = checkSkillConformance(entry({ uri: "skill://demo/x.md" }));
    expect(issues.map((i) => i.code)).toContain("malformed-uri");
    // The name/path check is suppressed: there is no path segment to compare,
    // and reporting both would present one defect as two.
    expect(issues.map((i) => i.code)).not.toContain("name-path-mismatch");
  });

  it("reports a path segment that disagrees with frontmatter.name", () => {
    const issues = checkSkillConformance(
      entry({ uri: "skill://wrong-folder/SKILL.md" }),
    );
    const mismatch = issues.find((i) => i.code === "name-path-mismatch");
    expect(mismatch?.severity).toBe("error");
    expect(mismatch?.message).toContain("wrong-folder");
    expect(mismatch?.message).toContain("demo");
  });

  it("does not report a mismatch when the name is missing entirely", () => {
    // The missing name is already an error of its own; a second finding
    // comparing against an absent value would be noise.
    const issues = checkSkillConformance(
      entry({ uri: "skill://other/SKILL.md", frontmatter: {} }),
    );
    expect(issues.map((i) => i.code)).not.toContain("name-path-mismatch");
    expect(issues.map((i) => i.code)).toContain("missing-name");
  });

  it("reports dynamic resources as a warning and checks nothing further", () => {
    const issues = checkSkillConformance(entry({ resources: "dynamic" }));
    expect(issues.map((i) => i.code)).toEqual(["dynamic-resources"]);
    expect(issues[0].severity).toBe("warning");
  });

  it("reports a manifest entry with no digest as unverifiable", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "skill://demo/ref.md", size: 1 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-digest"]);
    expect(issues[0].resourceUri).toBe("skill://demo/ref.md");
  });

  it("reports a manifest that omits the skill's own SKILL.md", () => {
    // A manifest is the complete file set, so one without the entry file is
    // not "a skill with no extras" — it cannot be checked against the skill.
    const issues = checkSkillConformance(
      entry({
        resources: [{ uri: "skill://demo/ref.md", digest: DIGEST, size: 1 }],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["manifest-missing-self"]);
    expect(issues[0].severity).toBe("error");
  });

  it("reports an empty manifest through the same finding", () => {
    const issues = checkSkillConformance(entry({ resources: [] }));
    expect(issues.map((i) => i.code)).toEqual(["manifest-missing-self"]);
  });

  it("reports a duplicated manifest URI", () => {
    const dup = { uri: "skill://demo/ref.md", digest: DIGEST, size: 1 };
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          dup,
          dup,
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["duplicate-resource"]);
    expect(issues[0].resourceUri).toBe("skill://demo/ref.md");
  });

  it("reports a manifest entry outside the skill root", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "skill://other/ref.md", digest: DIGEST, size: 1 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["resource-outside-skill-root"]);
    expect(issues[0].resourceUri).toBe("skill://other/ref.md");
  });

  it("does not check the skill root when the entry URI is malformed", () => {
    // There is no root to measure against, and `malformed-uri` already says so;
    // a second finding per resource would present one defect as many.
    const issues = checkSkillConformance(
      entry({
        uri: "skill://demo/other.md",
        resources: [{ uri: "skill://elsewhere/a.md", digest: DIGEST, size: 1 }],
      }),
    );
    expect(issues.map((i) => i.code)).not.toContain(
      "resource-outside-skill-root",
    );
    expect(issues.map((i) => i.code)).toContain("malformed-uri");
  });

  it("reports a manifest entry with no size as a warning", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "skill://demo/ref.md", digest: DIGEST },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-size"]);
    expect(issues[0].severity).toBe("warning");
  });

  it("reports a digest that is not sha256 + 64 lowercase hex", () => {
    for (const digest of [
      "sha256:XYZ",
      `sha256:${"A".repeat(64)}`,
      `sha512:${"a".repeat(64)}`,
      `sha256:${"a".repeat(63)}`,
    ]) {
      const issues = checkSkillConformance(
        entry({
          resources: [
            { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
            { uri: "skill://demo/ref.md", digest, size: 1 },
          ],
        }),
      );
      expect(issues.map((i) => i.code)).toEqual(["malformed-digest"]);
    }
  });

  it("reports a size that is not a non-negative integer byte length", () => {
    for (const size of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      const issues = checkSkillConformance(
        entry({
          resources: [
            { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
            { uri: "skill://demo/ref.md", digest: DIGEST, size },
          ],
        }),
      );
      expect(issues.map((i) => i.code)).toEqual(["malformed-size"]);
      expect(issues[0].severity).toBe("error");
    }
  });

  it("a negative size cannot pull the total back under the 16 MiB limit", () => {
    // The reason `malformed-size` is an error and not just noise: summing a
    // negative would hide a genuine `size-limit-exceeded`.
    const issues = checkSkillConformance(
      entry({
        resources: [
          {
            uri: "skill://demo/SKILL.md",
            digest: DIGEST,
            size: SKILL_MAX_TOTAL_BYTES + 1,
          },
          { uri: "skill://demo/ref.md", digest: DIGEST, size: -1000 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toContain("size-limit-exceeded");
  });

  it("reports a manifest over the 512-entry limit", () => {
    const resources = [
      { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
      ...Array.from({ length: SKILL_MAX_RESOURCE_ENTRIES }, (_unused, i) => ({
        uri: `skill://demo/f${i}.md`,
        digest: DIGEST,
        size: 1,
      })),
    ];
    const issues = checkSkillConformance(entry({ resources }));
    expect(issues.map((i) => i.code)).toContain("resource-limit-exceeded");
  });

  it("reports a manifest over the 16 MiB limit", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          {
            uri: "skill://demo/big.bin",
            digest: DIGEST,
            size: SKILL_MAX_TOTAL_BYTES,
          },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toContain("size-limit-exceeded");
  });

  it("does not report the size limit at exactly the boundary", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          {
            uri: "skill://demo/SKILL.md",
            digest: DIGEST,
            size: SKILL_MAX_TOTAL_BYTES,
          },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });
});

describe("totalSkillBytes", () => {
  it("sums declared sizes and treats a missing size as zero", () => {
    expect(
      totalSkillBytes([
        { uri: "a", size: 10 },
        { uri: "b" },
        { uri: "c", size: 5 },
      ]),
    ).toBe(15);
  });

  it("excludes an unusable size rather than summing it", () => {
    // An incomplete manifest may only ever *understate* the total, which is
    // what keeps the limit check free of false positives. A negative or
    // fractional value would break that.
    expect(
      totalSkillBytes([
        { uri: "a", size: 10 },
        { uri: "b", size: -100 },
        { uri: "c", size: 2.5 },
        { uri: "d", size: Number.NaN },
      ]),
    ).toBe(10);
  });
});

describe("byte helpers", () => {
  it("textToBytes produces UTF-8, not code units", () => {
    // "é" is two bytes in UTF-8 and one JS code unit — the digest is over the
    // former, so a naive per-char encoding would verify the wrong thing.
    expect(Array.from(textToBytes("é"))).toEqual([0xc3, 0xa9]);
  });

  it("base64ToBytes decodes standard base64", () => {
    expect(Array.from(base64ToBytes("aGVsbG8="))).toEqual([
      104, 101, 108, 108, 111,
    ]);
  });

  it("sha256Digest matches the known digest of 'hello'", async () => {
    expect(await sha256Digest(textToBytes("hello"))).toBe(HELLO_SHA256);
  });

  it("sha256Digest hashes only the view, not the whole backing buffer", async () => {
    // A Uint8Array can be a window into a larger ArrayBuffer. Hashing the
    // buffer instead of the view would silently digest neighbouring bytes.
    const backing = new Uint8Array([0xff, ...textToBytes("hello"), 0xff]);
    const view = backing.subarray(1, 6);
    expect(await sha256Digest(view)).toBe(HELLO_SHA256);
  });
});

describe("verifySkillResource", () => {
  it("verifies matching bytes", async () => {
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md", digest: HELLO_SHA256 },
      textToBytes("hello"),
    );
    expect(result.status).toBe("verified");
    expect(result.actualDigest).toBe(HELLO_SHA256);
  });

  it("reports a mismatch with both digests instead of throwing", async () => {
    const expected = `sha256:${"b".repeat(64)}`;
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md", digest: expected },
      textToBytes("hello"),
    );
    expect(result.status).toBe("mismatch");
    expect(result.expectedDigest).toBe(expected);
    expect(result.actualDigest).toBe(HELLO_SHA256);
  });

  it("fails on a declared size that disagrees with the fetched bytes", async () => {
    // A size disagreement is a real inconsistency even when the digest would
    // match: the digest is taken over the bytes the server served, so agreeing
    // with it says nothing about whether the manifest describes those bytes.
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md", digest: HELLO_SHA256, size: 999 },
      textToBytes("hello"),
    );
    expect(result.status).toBe("mismatch");
    expect(result.expectedSize).toBe(999);
    expect(result.actualSize).toBe(5);
    expect(result.reason).toMatch(/999 bytes/);
  });

  it("checks the size before hashing, so a bad size never reports verified", async () => {
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md", size: 1 },
      textToBytes("hello"),
    );
    // No digest at all, and still a mismatch — the length alone settles it.
    expect(result.status).toBe("mismatch");
    expect(result.actualDigest).toBeUndefined();
  });

  it("echoes both sizes on a verified result when one was declared", async () => {
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md", digest: HELLO_SHA256, size: 5 },
      textToBytes("hello"),
    );
    expect(result.status).toBe("verified");
    expect(result.expectedSize).toBe(5);
    expect(result.actualSize).toBe(5);
  });

  it("reports unverifiable when no digest is advertised", async () => {
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md" },
      textToBytes("hello"),
    );
    expect(result.status).toBe("unverifiable");
    expect(result.actualDigest).toBeUndefined();
  });

  it("reports unverifiable — not a mismatch — for a malformed digest", async () => {
    // A malformed digest is already a conformance finding; calling it a
    // mismatch would accuse the file's bytes of being wrong when the manifest
    // is what is broken.
    const result = await verifySkillResource(
      { uri: "skill://demo/a.md", digest: "sha256:nope" },
      textToBytes("hello"),
    );
    expect(result.status).toBe("unverifiable");
    expect(result.expectedDigest).toBe("sha256:nope");
  });
});
