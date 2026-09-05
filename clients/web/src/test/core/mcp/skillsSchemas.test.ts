import { describe, it, expect } from "vitest";
import {
  DYNAMIC_RESOURCES,
  GetSkillResultSchema,
  ListSkillsResultSchema,
  ModernListSkillsResultSchema,
  SKILLS_EXTENSION_KEY,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  SkillEntrySchema,
} from "@inspector/core/mcp/skillsSchemas";

const ENTRY = {
  uri: "skill://demo/SKILL.md",
  frontmatter: { name: "demo", description: "A demo skill" },
  resources: [
    { uri: "skill://demo/ref.md", digest: `sha256:${"a".repeat(64)}`, size: 3 },
  ],
};

describe("skills wire constants", () => {
  it("names the extension and its two required methods", () => {
    expect(SKILLS_EXTENSION_KEY).toBe("io.modelcontextprotocol/skills");
    expect(SKILLS_LIST_METHOD).toBe("skills/list");
    expect(SKILLS_GET_METHOD).toBe("skills/get");
  });
});

describe("SkillEntrySchema", () => {
  it("parses a full manifest entry", () => {
    expect(SkillEntrySchema.parse(ENTRY)).toEqual(ENTRY);
  });

  it("parses the dynamic form", () => {
    const dynamic = { ...ENTRY, resources: DYNAMIC_RESOURCES };
    expect(SkillEntrySchema.parse(dynamic).resources).toBe("dynamic");
  });

  it("passes unknown frontmatter fields through untouched", () => {
    // The skill *format* versions independently of this extension, so an
    // unrecognized frontmatter field is a future Agent Skills field, not junk.
    const parsed = SkillEntrySchema.parse({
      ...ENTRY,
      frontmatter: { ...ENTRY.frontmatter, license: "MIT" },
    });
    expect(parsed.frontmatter.license).toBe("MIT");
  });

  it("accepts a malformed digest rather than rejecting the entry", () => {
    // Rejecting here would turn a reportable server bug into a parse failure,
    // and the Inspector exists to report it. See `checkSkillConformance`.
    const parsed = SkillEntrySchema.parse({
      ...ENTRY,
      resources: [{ uri: "skill://demo/ref.md", digest: "nope" }],
    });
    expect(parsed.resources).toEqual([
      { uri: "skill://demo/ref.md", digest: "nope" },
    ]);
  });

  it("rejects an entry with no uri", () => {
    expect(() =>
      SkillEntrySchema.parse({ frontmatter: {}, resources: [] }),
    ).toThrow();
  });

  it("rejects a resources value that is neither a list nor 'dynamic'", () => {
    expect(() =>
      SkillEntrySchema.parse({ ...ENTRY, resources: "static" }),
    ).toThrow();
  });
});

describe("ListSkillsResultSchema", () => {
  it("parses a page with a cursor", () => {
    const parsed = ListSkillsResultSchema.parse({
      skills: [ENTRY],
      nextCursor: "2",
    });
    expect(parsed.skills).toHaveLength(1);
    expect(parsed.nextCursor).toBe("2");
  });

  it("parses a final page with no cursor", () => {
    expect(
      ListSkillsResultSchema.parse({ skills: [] }).nextCursor,
    ).toBeUndefined();
  });
});

describe("ModernListSkillsResultSchema", () => {
  const envelope = { resultType: "complete", ttlMs: 0, cacheScope: "public" };

  it("accepts a modern page carrying the base list envelope", () => {
    const parsed = ModernListSkillsResultSchema.parse({
      ...envelope,
      skills: [ENTRY],
    });
    expect(parsed.skills).toHaveLength(1);
  });

  it("rejects a modern page that omits the caching attributes", () => {
    // The whole reason for the era split: `skills/*` is consumer-owned, so the
    // SDK codec validates none of it, and `{ skills: [] }` would otherwise
    // reach the conformance UI as a clean list.
    expect(() => ModernListSkillsResultSchema.parse({ skills: [] })).toThrow();
    expect(() =>
      ModernListSkillsResultSchema.parse({
        ...envelope,
        ttlMs: undefined,
        skills: [],
      }),
    ).toThrow();
  });

  it("rejects a malformed ttlMs rather than accepting the envelope loosely", () => {
    for (const ttlMs of [-1, 0.5]) {
      expect(() =>
        ModernListSkillsResultSchema.parse({ ...envelope, ttlMs, skills: [] }),
      ).toThrow();
    }
  });

  it("rejects an unknown cacheScope", () => {
    expect(() =>
      ModernListSkillsResultSchema.parse({
        ...envelope,
        cacheScope: "shared",
        skills: [],
      }),
    ).toThrow();
  });

  it("the LEGACY schema still accepts a page without the envelope", () => {
    // Those are 2026-era attributes; a legacy server has no business sending
    // them and must not be failed for their absence.
    expect(ListSkillsResultSchema.parse({ skills: [] }).skills).toEqual([]);
  });
});

describe("GetSkillResultSchema", () => {
  it("unwraps the envelope to the entry", () => {
    expect(GetSkillResultSchema.parse({ skill: ENTRY })).toEqual(ENTRY);
  });

  it("rejects an entry returned inline rather than normalizing it", () => {
    // The envelope is required. Accepting the inline form would silently
    // normalize a non-conforming response, which is the failure this
    // extension's support exists to report.
    expect(() => GetSkillResultSchema.parse(ENTRY)).toThrow();
  });

  it("rejects a result that is neither shape", () => {
    expect(() => GetSkillResultSchema.parse({ nothing: true })).toThrow();
  });

  it("rejects an envelope whose skill is not an entry", () => {
    expect(() =>
      GetSkillResultSchema.parse({ skill: { frontmatter: {} } }),
    ).toThrow();
  });
});
