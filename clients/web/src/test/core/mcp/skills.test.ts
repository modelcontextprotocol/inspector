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

function entry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    uri: "skill://demo/SKILL.md",
    frontmatter: { name: "demo", description: "A demo skill" },
    resources: [
      {
        uri: "skill://demo/ref.md",
        digest: `sha256:${"a".repeat(64)}`,
        size: 10,
      },
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
      entry({ resources: [{ uri: "skill://demo/ref.md", size: 1 }] }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-digest"]);
    expect(issues[0].resourceUri).toBe("skill://demo/ref.md");
  });

  it("reports a digest that is not sha256 + 64 lowercase hex", () => {
    for (const digest of [
      "sha256:XYZ",
      `sha256:${"A".repeat(64)}`,
      `sha512:${"a".repeat(64)}`,
      `sha256:${"a".repeat(63)}`,
    ]) {
      const issues = checkSkillConformance(
        entry({ resources: [{ uri: "skill://demo/ref.md", digest }] }),
      );
      expect(issues.map((i) => i.code)).toEqual(["malformed-digest"]);
    }
  });

  it("reports a manifest over the 512-entry limit", () => {
    const resources = Array.from(
      { length: SKILL_MAX_RESOURCE_ENTRIES + 1 },
      (_unused, i) => ({
        uri: `skill://demo/f${i}.md`,
        digest: `sha256:${"a".repeat(64)}`,
      }),
    );
    const issues = checkSkillConformance(entry({ resources }));
    expect(issues.map((i) => i.code)).toContain("resource-limit-exceeded");
  });

  it("reports a manifest over the 16 MiB limit", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          {
            uri: "skill://demo/big.bin",
            digest: `sha256:${"a".repeat(64)}`,
            size: SKILL_MAX_TOTAL_BYTES + 1,
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
            uri: "skill://demo/big.bin",
            digest: `sha256:${"a".repeat(64)}`,
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
