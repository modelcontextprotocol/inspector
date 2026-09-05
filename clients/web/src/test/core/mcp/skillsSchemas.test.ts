import { describe, it, expect } from "vitest";
import {
  DYNAMIC_RESOURCES,
  GetSkillResultSchema,
  ListSkillsResultSchema,
  ReadResourceDirectoryResultSchema,
  SKILLS_EXTENSION_KEY,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  SkillEntrySchema,
  normalizeGetSkillResult,
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

describe("GetSkillResultSchema", () => {
  it("normalizes the enveloped form to the entry", () => {
    expect(GetSkillResultSchema.parse({ skill: ENTRY })).toEqual(ENTRY);
  });

  it("normalizes the inline form to the entry", () => {
    expect(GetSkillResultSchema.parse(ENTRY)).toEqual(ENTRY);
  });

  it("normalizeGetSkillResult accepts either shape directly", () => {
    expect(normalizeGetSkillResult({ skill: ENTRY })).toEqual(ENTRY);
    expect(normalizeGetSkillResult(ENTRY)).toEqual(ENTRY);
  });

  it("rejects a result that is neither shape", () => {
    expect(() => GetSkillResultSchema.parse({ nothing: true })).toThrow();
  });
});

describe("ReadResourceDirectoryResultSchema", () => {
  it("parses directory children including the directory mime type", () => {
    const parsed = ReadResourceDirectoryResultSchema.parse({
      contents: [
        { uri: "skill://demo/sub", mimeType: "inode/directory" },
        { uri: "skill://demo/ref.md", mimeType: "text/markdown", size: 3 },
      ],
    });
    expect(parsed.contents).toHaveLength(2);
  });
});
