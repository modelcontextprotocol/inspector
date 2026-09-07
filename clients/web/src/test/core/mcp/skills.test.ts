import { describe, it, expect } from "vitest";
import type { ServerCapabilities } from "@modelcontextprotocol/client";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import { SKILLS_EXTENSION_KEY } from "@inspector/core/mcp/skillsSchemas";
import {
  SKILL_MAX_RESOURCE_ENTRIES,
  SKILL_MAX_TOTAL_BYTES,
  base64ToBytes,
  checkSkillConformance,
  checkSkillFrontmatterMatch,
  checkSkillNameCollisions,
  getSkillsExtension,
  isSkillsExtensionSupported,
  normalizeSkillUri,
  skillEntriesMatch,
  skillUriIdentity,
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

  it("rejects a non-object declaration", () => {
    // SEP-2133 declares an extension as an object of sub-options, so a
    // primitive is not a declaration — and treating one as support would show
    // the Skills tab and send `skills/list` to a server that never claimed to
    // serve it. Same parsing as the UI extension in `appElicitation.ts`.
    for (const declared of [true, false, "skills", 1]) {
      expect(
        getSkillsExtension(caps({ [SKILLS_EXTENSION_KEY]: declared })),
      ).toBeUndefined();
    }
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

  it("reads the name off a domain-native scheme too", () => {
    expect(skillNameFromUri("github://acme/repo/data-analysis/SKILL.md")).toBe(
      "data-analysis",
    );
  });

  it("returns undefined for a URI that does not end in /SKILL.md", () => {
    expect(skillNameFromUri("skill://demo/other.md")).toBeUndefined();
    // The suffix must include the separator: a bare "SKILL.md" has no segment.
    expect(skillNameFromUri("SKILL.md")).toBeUndefined();
  });

  it("returns undefined for a relative string", () => {
    // SEP-2640 requires a full resource URI; treating `demo/SKILL.md` as one
    // would let a non-conforming entry report a name and pass the path check.
    expect(skillNameFromUri("demo/SKILL.md")).toBeUndefined();
  });

  it("reads the name off the RESOLVED path, not the raw string", () => {
    expect(skillNameFromUri("skill://acme/wrong/../demo/SKILL.md")).toBe(
      "demo",
    );
  });

  it("returns undefined when the segment before the suffix is empty", () => {
    expect(skillNameFromUri("skill:///SKILL.md")).toBeUndefined();
  });
});

describe("normalizeSkillUri", () => {
  it("resolves traversal segments", () => {
    expect(normalizeSkillUri("skill://acme/billing/refunds/../other.md")).toBe(
      "skill://acme/billing/other.md",
    );
  });

  it("rejects a relative string, which is not a resource URI", () => {
    expect(normalizeSkillUri("demo/SKILL.md")).toBeUndefined();
  });

  it("does not privilege the skill: scheme", () => {
    // SEP-2640 only says a server SHOULD use `skill://`, and explicitly allows
    // a domain-native scheme — so rejecting one would hand a conforming server
    // a false `malformed-uri` and skip its name and root checks.
    expect(normalizeSkillUri("github://acme/repo/SKILL.md")).toBe(
      "github://acme/repo/SKILL.md",
    );
    expect(normalizeSkillUri("https://demo/a/../SKILL.md")).toBe(
      "https://demo/SKILL.md",
    );
  });

  it("rejects an opaque-path URI, which the parser does not normalize", () => {
    // `skill:demo/../x.md` parses but keeps its `..` verbatim, so containment
    // could not be decided on it — accepting it would reopen the hole.
    expect(normalizeSkillUri("skill:demo/SKILL.md")).toBeUndefined();
  });

  it("decodes escapes that stand for unreserved characters", () => {
    // `URL.href` leaves these encoded, so without canonicalizing them a server
    // echoing an RFC-equivalent form would be treated as a different resource
    // and an encoded name segment would produce a false name/path mismatch.
    expect(normalizeSkillUri("skill://demo/%72eference.md")).toBe(
      "skill://demo/reference.md",
    );
    expect(skillNameFromUri("skill://%64emo/SKILL.md")).toBe("demo");
  });

  it("upper-cases the hex of escapes that must stay encoded", () => {
    // A space is not unreserved, so it stays escaped — but in one spelling, so
    // two RFC-equivalent URIs compare equal.
    expect(normalizeSkillUri("skill://demo/a%2fb.md")).toBe(
      normalizeSkillUri("skill://demo/a%2Fb.md"),
    );
  });

  it("leaves an already-normal URI alone", () => {
    expect(normalizeSkillUri("skill://demo/SKILL.md")).toBe(
      "skill://demo/SKILL.md",
    );
  });
});

describe("skillUriIdentity", () => {
  it("is the normalized form when the URI parses", () => {
    expect(skillUriIdentity("skill://demo/a/../SKILL.md")).toBe(
      "skill://demo/SKILL.md",
    );
  });

  it("falls back to the raw string, keeping two bad URIs distinct", () => {
    expect(skillUriIdentity("not a uri")).toBe("not a uri");
    expect(skillUriIdentity("not a uri")).not.toBe(
      skillUriIdentity("also not a uri"),
    );
  });
});

describe("skillEntriesMatch", () => {
  const base = (): SkillEntry => ({
    uri: "skill://demo/SKILL.md",
    frontmatter: { name: "demo", description: "d" },
    resources: [
      { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
      { uri: "skill://demo/ref.md", digest: DIGEST, size: 10 },
    ],
  });

  it("ignores object key order", () => {
    const reordered = {
      resources: base().resources,
      uri: base().uri,
      frontmatter: { description: "d", name: "demo" },
    };
    expect(skillEntriesMatch(base(), reordered)).toBe(true);
  });

  it("ignores manifest order, because the manifest is a set", () => {
    const reversed = {
      ...base(),
      resources: [...(base().resources as object[])].reverse(),
    } as SkillEntry;
    expect(skillEntriesMatch(base(), reversed)).toBe(true);
  });

  it("does NOT reorder an array nested in frontmatter", () => {
    // `frontmatter` is verbatim arbitrary JSON from the skill author, so a
    // custom `resources` array inside it is an ordinary list. A recursive
    // sort would make these two genuinely different entries compare equal.
    const withNested = (order: string[]): SkillEntry => ({
      ...base(),
      frontmatter: {
        ...base().frontmatter,
        metadata: { resources: order.map((uri) => ({ uri })) },
      },
    });
    expect(
      skillEntriesMatch(withNested(["a", "b"]), withNested(["b", "a"])),
    ).toBe(false);
    expect(
      skillEntriesMatch(withNested(["a", "b"]), withNested(["a", "b"])),
    ).toBe(true);
  });

  it("treats RFC-equivalent URI spellings as the same entry", () => {
    // A server that canonicalizes an escape between the listing and the fetch
    // has not changed the skill, so it must not read as a new snapshot.
    const encoded: SkillEntry = {
      ...base(),
      uri: "skill://demo/%53KILL.md",
      resources: [
        { uri: "skill://demo/%53KILL.md", digest: DIGEST, size: 20 },
        { uri: "skill://demo/x/../ref.md", digest: DIGEST, size: 10 },
      ],
    };
    expect(skillEntriesMatch(base(), encoded)).toBe(true);
  });

  it("still sees a real difference", () => {
    expect(
      skillEntriesMatch(base(), {
        ...base(),
        frontmatter: { name: "demo", description: "changed" },
      }),
    ).toBe(false);
  });

  it("compares the dynamic form without sorting it", () => {
    const dynamic = { ...base(), resources: "dynamic" } as SkillEntry;
    expect(skillEntriesMatch(dynamic, { ...dynamic })).toBe(true);
    expect(skillEntriesMatch(dynamic, base())).toBe(false);
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

  it("reports a name that is not a valid Agent Skills name", () => {
    // The name is not decorative: it must equal the URI path segment, so a
    // name that cannot appear in a URI is a contradiction the entry cannot
    // satisfy. Checking only for non-emptiness let these read as "Conforms".
    for (const name of [
      "Bad Name",
      "UPPER",
      "-leading",
      "trailing-",
      "double--hyphen",
      "under_score",
      "a".repeat(65),
    ]) {
      const issues = checkSkillConformance(
        entry({ frontmatter: { name, description: "d" } }),
      );
      expect(issues.map((i) => i.code)).toContain("malformed-name");
      expect(issues.find((i) => i.code === "malformed-name")?.severity).toBe(
        "error",
      );
    }
  });

  it("applies the name grammar to the RAW value, not a trimmed copy", () => {
    // Trimming first would let `" demo "` through — and whitespace is not in
    // the grammar, so the entry would report "Conforms" with a name that can
    // never equal its URI path segment.
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: " demo ", description: "d" } }),
    );
    expect(issues.map((i) => i.code)).toContain("malformed-name");
  });

  it("accepts the names the Agent Skills format allows", () => {
    for (const name of ["a", "demo", "data-analysis", "a1-b2-c3"]) {
      const issues = checkSkillConformance(
        entry({
          uri: `skill://${name}/SKILL.md`,
          frontmatter: { name, description: "d" },
          resources: [
            { uri: `skill://${name}/SKILL.md`, digest: DIGEST, size: 1 },
          ],
        }),
      );
      expect(issues.map((i) => i.code)).not.toContain("malformed-name");
    }
  });

  it("does not report a malformed name when there is no name at all", () => {
    // `missing-name` already says it; two findings would read as two defects.
    const issues = checkSkillConformance(
      entry({ frontmatter: { description: "d" } }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-name"]);
  });

  it("reports a description above the 1024-character limit", () => {
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: "demo", description: "d".repeat(1025) } }),
    );
    expect(issues.map((i) => i.code)).toEqual(["malformed-description"]);
    expect(issues[0].severity).toBe("error");
  });

  it("counts description length in code points, not UTF-16 code units", () => {
    // 600 non-BMP characters are 1200 code units. Measuring those would report
    // a perfectly valid description as over the 1024-character limit — a
    // conforming server failed by an off-by-encoding.
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: "demo", description: "𝄞".repeat(600) } }),
    );
    expect(issues).toEqual([]);
  });

  it("still reports a description over the limit in code points", () => {
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: "demo", description: "𝄞".repeat(1025) } }),
    );
    expect(issues.map((i) => i.code)).toEqual(["malformed-description"]);
    expect(issues[0].message).toContain("1025");
  });

  it("accepts a description exactly at the limit", () => {
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: "demo", description: "d".repeat(1024) } }),
    );
    expect(issues).toEqual([]);
  });

  it("reports a missing description as an error", () => {
    // SEP-2640 requires `description`, so an absent one is a format violation
    // and must not read as "0 errors" in the conformance summary.
    const issues = checkSkillConformance(
      entry({ frontmatter: { name: "demo" } }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-description"]);
    expect(issues[0].severity).toBe("error");
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

  it("reports a manifest entry with no digest as an error", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "skill://demo/ref.md", size: 1 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-digest"]);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].resourceUri).toBe("skill://demo/ref.md");
  });

  it("accepts a self-entry listed in an RFC-equivalent spelling", () => {
    // The manifest names the same file the entry does, and it is fetchable as
    // that file — reporting it missing would be the tool disagreeing with
    // itself about which URIs are the same resource.
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/%53KILL.md", digest: DIGEST, size: 20 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).not.toContain("manifest-missing-self");
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

  it("reports an entry that traverses out of the skill root", () => {
    // The raw string starts with the root; the resolved path does not. A
    // prefix check alone would miss this and report `Conforms`.
    const issues = checkSkillConformance(
      entry({
        uri: "skill://demo/refunds/SKILL.md",
        frontmatter: { name: "refunds", description: "d" },
        resources: [
          { uri: "skill://demo/refunds/SKILL.md", digest: DIGEST, size: 1 },
          { uri: "skill://demo/refunds/../other.md", digest: DIGEST, size: 1 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["resource-outside-skill-root"]);
  });

  it("reports an unparseable manifest entry as outside the root", () => {
    // Nothing can establish that a non-URI is inside a root.
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "not a uri", digest: DIGEST, size: 1 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["resource-outside-skill-root"]);
  });

  it("detects a duplicate that differs only before normalization", () => {
    // Containment and the read that fetches the bytes both treat these as one
    // resource, so the uniqueness check must too — otherwise a manifest naming
    // one file twice passes as two distinct files.
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "skill://demo/x/../SKILL.md", digest: DIGEST, size: 20 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["duplicate-resource"]);
    // Reported against the raw URI, so the diagnostic points at what the
    // server actually sent.
    expect(issues[0].resourceUri).toBe("skill://demo/x/../SKILL.md");
  });

  it("does not fold two different unparseable URIs into one duplicate", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "not a uri", digest: DIGEST, size: 1 },
          { uri: "also not a uri", digest: DIGEST, size: 1 },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).not.toContain("duplicate-resource");
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

  it("reports a manifest entry with no size as an error", () => {
    const issues = checkSkillConformance(
      entry({
        resources: [
          { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
          { uri: "skill://demo/ref.md", digest: DIGEST },
        ],
      }),
    );
    expect(issues.map((i) => i.code)).toEqual(["missing-size"]);
    expect(issues[0].severity).toBe("error");
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
    const finding = issues.find((i) => i.code === "size-limit-exceeded");
    expect(finding?.severity).toBe("warning");
  });

  // Both limits are SHOULD NOTs for a server and MAYs for a host, so exceeding
  // one makes a skill less portable rather than invalid.
  it("reports a manifest over the 512-entry limit as a warning", () => {
    const resources = [
      { uri: "skill://demo/SKILL.md", digest: DIGEST, size: 20 },
      ...Array.from({ length: SKILL_MAX_RESOURCE_ENTRIES }, (_unused, i) => ({
        uri: `skill://demo/f${i}.md`,
        digest: DIGEST,
        size: 1,
      })),
    ];
    const issues = checkSkillConformance(entry({ resources }));
    const finding = issues.find((i) => i.code === "resource-limit-exceeded");
    expect(finding?.severity).toBe("warning");
  });

  it("reports a manifest over the 16 MiB limit as a warning", () => {
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

describe("checkSkillFrontmatterMatch (#2248)", () => {
  const entry = (frontmatter: Record<string, unknown>): SkillEntry => ({
    uri: "skill://demo/SKILL.md",
    frontmatter,
    resources: [],
  });
  const file = (yaml: string, body = "# Demo\n") =>
    `---\n${yaml}\n---\n\n${body}`;

  it("reports nothing when every field agrees", () => {
    expect(
      checkSkillFrontmatterMatch(
        entry({ name: "demo", description: "A demo" }),
        file("name: demo\ndescription: A demo"),
      ),
    ).toEqual([]);
  });

  it("catches a listing that advertises a different description", () => {
    // The violation no digest can catch: the digest is over the bytes the
    // server served and says nothing about whether the listing described them
    // honestly.
    const issues = checkSkillFrontmatterMatch(
      entry({ name: "demo", description: "Reads a spreadsheet" }),
      file("name: demo\ndescription: Emails the spreadsheet"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("frontmatter-mismatch");
    // Equivalent to a digest mismatch per the SEP, so it must be an error.
    expect(issues[0].severity).toBe("error");
    // The diagnosis, not just the verdict — a server author has to be able to
    // fix it from the message alone.
    expect(issues[0].message).toContain("Reads a spreadsheet");
    expect(issues[0].message).toContain("Emails the spreadsheet");
    expect(issues[0].resourceUri).toBe("skill://demo/SKILL.md");
  });

  it("reports one finding per differing field", () => {
    const issues = checkSkillFrontmatterMatch(
      entry({ name: "a", description: "x" }),
      file("name: b\ndescription: y"),
    );
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.message.match(/"(\w+)"/)?.[1])).toEqual([
      "description",
      "name",
    ]);
  });

  it("reports a field the file declares and the listing omits", () => {
    const issues = checkSkillFrontmatterMatch(
      entry({ name: "demo", description: "A demo" }),
      file("name: demo\ndescription: A demo\nlicense: MIT"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/declares "license".*omits it/);
  });

  it("reports a field the listing declares and the file omits", () => {
    const issues = checkSkillFrontmatterMatch(
      entry({ name: "demo", description: "A demo", license: "MIT" }),
      file("name: demo\ndescription: A demo"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(
      /listing declares "license".*served SKILL.md omits it/,
    );
  });

  it("treats a file with no frontmatter block as a violation", () => {
    const issues = checkSkillFrontmatterMatch(
      entry({ name: "demo" }),
      "# Demo\n\nNo fence here.\n",
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "frontmatter-absent",
        severity: "error",
      }),
    ]);
  });

  it("reports unparsable YAML as its own code, not as a mismatch", () => {
    const issues = checkSkillFrontmatterMatch(
      entry({ name: "demo" }),
      file("a: [1,"),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "frontmatter-unparsable",
        severity: "error",
      }),
    ]);
  });

  it("compares nested mappings by content, not by key order", () => {
    // Key order is not meaningful in JSON or YAML, so calling it a discrepancy
    // would report a conforming server as broken.
    expect(
      checkSkillFrontmatterMatch(
        entry({ meta: { b: 2, a: 1 } }),
        file("meta:\n  a: 1\n  b: 2"),
      ),
    ).toEqual([]);
  });

  it("treats array ORDER as significant", () => {
    // A YAML sequence is ordered, so two orderings are two different values.
    const issues = checkSkillFrontmatterMatch(
      entry({ tags: ["a", "b"] }),
      file("tags: [b, a]"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("frontmatter-mismatch");
  });

  it("distinguishes an explicit null from an absent field", () => {
    // `license:` with no value parses to null — a field that is present and
    // holds null, which is not the same fact as a field that is not there.
    const issues = checkSkillFrontmatterMatch(
      entry({ license: null }),
      file("license:"),
    );
    expect(issues).toEqual([]);
    expect(
      checkSkillFrontmatterMatch(entry({}), file("license:")),
    ).toHaveLength(1);
  });

  it("does not let a YAML non-finite number match a listing's null", () => {
    // `.nan` / `.inf` are YAML values JSON cannot express, and
    // `JSON.stringify` turns every one of them into `null` — so a naive
    // canonical comparison reported a served `.nan` as EQUAL to a listed
    // `null`: a mismatch silently presented as agreement (Copilot).
    const issues = checkSkillFrontmatterMatch(
      entry({ threshold: null }),
      file("threshold: .nan"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("frontmatter-mismatch");
    // The value is named in the finding rather than hidden behind `null`.
    expect(issues[0].message).toContain("NaN");
  });

  it("distinguishes the three non-finite values from one another", () => {
    expect(
      checkSkillFrontmatterMatch(entry({ x: null }), file("x: .inf")),
    ).toHaveLength(1);
    // Infinity vs -Infinity: both stringify to `null`, so they would have
    // compared equal to each other as well.
    const both = checkSkillFrontmatterMatch(
      entry({ a: 1, b: 2 }),
      file("a: .inf\nb: -.inf"),
    );
    expect(both).toHaveLength(2);
    expect(both[0].message).toContain("Infinity");
    expect(both[1].message).toContain("-Infinity");
  });

  it("still matches a null the served file also writes as null", () => {
    // The fix must not turn a genuine agreement into a finding.
    expect(
      checkSkillFrontmatterMatch(entry({ x: null }), file("x: null")),
    ).toEqual([]);
  });

  it("reports nothing for two empty frontmatters", () => {
    expect(checkSkillFrontmatterMatch(entry({}), file(""))).toEqual([]);
  });
});

describe("checkSkillNameCollisions (#2248)", () => {
  const at = (uri: string, name?: string): SkillEntry => ({
    uri,
    frontmatter: name === undefined ? {} : { name, description: "d" },
    resources: [],
  });

  it("reports nothing when every name is distinct", () => {
    expect(
      checkSkillNameCollisions([
        at("skill://a/SKILL.md", "a"),
        at("skill://b/SKILL.md", "b"),
      ]).size,
    ).toBe(0);
  });

  it("flags both entries of a collision, each naming the other", () => {
    // SEP-2640's own shape: two conforming skills whose paths differ but whose
    // final segment — and so their name — is the same.
    const collisions = checkSkillNameCollisions([
      at("skill://acme/reports/SKILL.md", "reports"),
      at("skill://globex/reports/SKILL.md", "reports"),
    ]);
    expect(collisions.size).toBe(2);
    const acme = collisions.get("skill://acme/reports/SKILL.md");
    const globex = collisions.get("skill://globex/reports/SKILL.md");
    expect(acme?.message).toContain("skill://globex/reports/SKILL.md");
    expect(acme?.message).not.toContain("skill://acme/reports/SKILL.md");
    expect(globex?.message).toContain("skill://acme/reports/SKILL.md");
  });

  it("is a WARNING, because the server did nothing wrong", () => {
    // The obligation is on the consumer, not the server. Reporting an error
    // would tell a conforming server author their catalog is invalid.
    const [issue] = [
      ...checkSkillNameCollisions([
        at("skill://a/reports/SKILL.md", "reports"),
        at("skill://b/reports/SKILL.md", "reports"),
      ]).values(),
    ];
    expect(issue.code).toBe("duplicate-name");
    expect(issue.severity).toBe("warning");
  });

  it("names every other colliding entry when three share a name", () => {
    const collisions = checkSkillNameCollisions([
      at("skill://a/r/SKILL.md", "r"),
      at("skill://b/r/SKILL.md", "r"),
      at("skill://c/r/SKILL.md", "r"),
    ]);
    expect(collisions.size).toBe(3);
    const first = collisions.get("skill://a/r/SKILL.md");
    expect(first?.message).toContain("skill://b/r/SKILL.md");
    expect(first?.message).toContain("skill://c/r/SKILL.md");
  });

  it("does not report the SAME skill listed twice as a collision", () => {
    // A repeated entry is a different defect from two skills sharing a name,
    // and calling it this one would be a wrong diagnosis rather than a missing
    // one. Compared on normalized identity, like every other URI comparison.
    expect(
      checkSkillNameCollisions([
        at("skill://a/r/SKILL.md", "r"),
        at("skill://a/x/../r/SKILL.md", "r"),
      ]).size,
    ).toBe(0);
  });

  it("ignores entries with no name, which is already its own finding", () => {
    // Two entries that both omit a name are not "colliding on a name" — there
    // is no name — and saying so would bury `missing-name` under a derived
    // finding.
    expect(
      checkSkillNameCollisions([
        at("skill://a/SKILL.md"),
        at("skill://b/SKILL.md"),
      ]).size,
    ).toBe(0);
    expect(
      checkSkillNameCollisions([
        at("skill://a/SKILL.md", "   "),
        at("skill://b/SKILL.md", "   "),
      ]).size,
    ).toBe(0);
  });

  it("does not treat names differing only in case as colliding", () => {
    // The Agent Skills grammar is lowercase already; normalizing more than the
    // grammar does would report a collision the spec considers two names.
    expect(
      checkSkillNameCollisions([
        at("skill://a/r/SKILL.md", "reports"),
        at("skill://b/R/SKILL.md", "Reports"),
      ]).size,
    ).toBe(0);
  });

  it("reports nothing for an empty or single-entry listing", () => {
    expect(checkSkillNameCollisions([]).size).toBe(0);
    expect(checkSkillNameCollisions([at("skill://a/SKILL.md", "a")]).size).toBe(
      0,
    );
  });
});
