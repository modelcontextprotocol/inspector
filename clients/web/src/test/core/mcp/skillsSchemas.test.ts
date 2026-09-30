import { describe, it, expect } from "vitest";
import {
  DIRECTORY_MIME_TYPE,
  DirectoryReadResultSchema,
  RESOURCES_DIRECTORY_READ_METHOD,
  DYNAMIC_RESOURCES,
  GetSkillEnvelopeSchema,
  GetSkillResultSchema,
  ModernGetSkillEnvelopeSchema,
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
  // What the schema actually receives on a modern connection: the SDK codec
  // has already checked `resultType` and lifted it off the result (#2373).
  const envelope = { ttlMs: 0, cacheScope: "public" };

  it("accepts a modern page carrying the caching attributes", () => {
    const parsed = ModernListSkillsResultSchema.parse({
      ...envelope,
      skills: [ENTRY],
    });
    expect(parsed.skills).toHaveLength(1);
  });

  it("does not require resultType, which the SDK codec lifts before this schema runs (#2373)", () => {
    // Requiring it rejected every conforming modern page: the codec checks
    // `resultType` itself, then deletes it. An integration test proves the
    // lift against a real connection; this pins the schema's side of it.
    expect(
      ModernListSkillsResultSchema.safeParse({ ...envelope, skills: [] })
        .success,
    ).toBe(true);
  });

  it("rejects a modern page that omits the caching attributes", () => {
    // The whole reason for the era split: `skills/*` is consumer-owned, so the
    // SDK codec checks none of the caching attributes, and `{ skills: [] }`
    // would otherwise reach the conformance UI as a clean list.
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

describe("directory read schemas (#2248)", () => {
  const CHILD = {
    uri: "skill://demo/templates/invoice.md",
    name: "invoice.md",
    mimeType: "text/markdown",
  };

  it("names the method and the directory MIME type", () => {
    expect(RESOURCES_DIRECTORY_READ_METHOD).toBe("resources/directory/read");
    expect(DIRECTORY_MIME_TYPE).toBe("inode/directory");
  });

  it("parses the SEP's own worked example", () => {
    // Verbatim from SEP-2640's `resources/directory/read` example, including a
    // subdirectory child. If the schema cannot read the spec's own example it
    // is wrong whatever else it accepts.
    const example = {
      resultType: "complete",
      resources: [
        CHILD,
        {
          uri: "skill://demo/templates/regional",
          name: "regional",
          mimeType: "inode/directory",
        },
      ],
    };
    expect(DirectoryReadResultSchema.safeParse(example).success).toBe(true);
  });

  it("accepts an empty directory", () => {
    const parsed = DirectoryReadResultSchema.parse({ resources: [] });
    expect(parsed.resources).toEqual([]);
  });

  it("carries nextCursor through", () => {
    const parsed = DirectoryReadResultSchema.parse({
      resources: [CHILD],
      nextCursor: "7",
    });
    expect(parsed.nextCursor).toBe("7");
  });

  it("rejects a child that is not a base-protocol Resource", () => {
    // `name` is required on `Resource`, and the SEP says a directory child IS
    // one. Accepting a child here that `resources/list` would reject is the
    // inconsistency the shared SDK schema exists to prevent.
    expect(
      DirectoryReadResultSchema.safeParse({
        resources: [{ uri: "skill://demo/x.md" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a result whose resources member is not an array", () => {
    expect(
      DirectoryReadResultSchema.safeParse({ resources: "nope" }).success,
    ).toBe(false);
  });

  it("does NOT require the caching attributes, unlike a modern skills/list page", () => {
    // The deliberate asymmetry with `ModernListSkillsResultSchema`: SEP-2640
    // states `ttlMs`/`cacheScope` for a modern `skills/list` and says nothing
    // of the kind for this method, whose only worked example omits them.
    // Requiring them would fail a server that matched the spec's own example.
    expect(DirectoryReadResultSchema.safeParse({ resources: [] }).success).toBe(
      true,
    );
    expect(ModernListSkillsResultSchema.safeParse({ skills: [] }).success).toBe(
      false,
    );
  });

  it("still accepts the caching attributes when a server sends them", () => {
    // Permitted, not mandated — a schema is not the place to reject an extra
    // member the spec leaves open.
    expect(
      DirectoryReadResultSchema.safeParse({
        resources: [],
        ttlMs: 60,
        cacheScope: "public",
      }).success,
    ).toBe(true);
  });
});

describe("skills/get caching attributes (#2404)", () => {
  const CACHE = { ttlMs: 0, cacheScope: "public" } as const;

  it("the LEGACY schema accepts a result with the caching attributes and one without", () => {
    // They are 2026-era attributes: a legacy server must not be failed for
    // their absence, nor for sending them.
    expect(GetSkillEnvelopeSchema.safeParse({ skill: ENTRY }).success).toBe(
      true,
    );
    expect(
      GetSkillEnvelopeSchema.safeParse({ skill: ENTRY, ...CACHE }).success,
    ).toBe(true);
  });

  it("the MODERN schema requires ttlMs and cacheScope", () => {
    // The stable ext-skills spec: `GetSkillResult` extends `CacheableResult`,
    // so both are REQUIRED, as on `resources/read`.
    expect(
      ModernGetSkillEnvelopeSchema.safeParse({ skill: ENTRY }).success,
    ).toBe(false);
    expect(
      ModernGetSkillEnvelopeSchema.safeParse({ skill: ENTRY, ttlMs: 0 })
        .success,
    ).toBe(false);
    expect(
      ModernGetSkillEnvelopeSchema.safeParse({
        skill: ENTRY,
        cacheScope: "private",
      }).success,
    ).toBe(false);
  });

  it("the MODERN schema accepts a result as the SDK codec delivers it (#2373)", () => {
    // No `resultType`: the codec lifts it before any caller schema runs.
    const parsed = ModernGetSkillEnvelopeSchema.parse({
      skill: ENTRY,
      ttlMs: 60_000,
      cacheScope: "private",
    });
    expect(parsed.skill).toEqual(ENTRY);
    expect(parsed.ttlMs).toBe(60_000);
    expect(parsed.cacheScope).toBe("private");
  });

  it.each([-1, 0.5])(
    "the MODERN schema rejects ttlMs %s — not a non-negative integer",
    (ttlMs) => {
      expect(
        ModernGetSkillEnvelopeSchema.safeParse({
          skill: ENTRY,
          ttlMs,
          cacheScope: "public",
        }).success,
      ).toBe(false);
    },
  );

  it("the MODERN schema rejects a cacheScope outside public/private", () => {
    expect(
      ModernGetSkillEnvelopeSchema.safeParse({
        skill: ENTRY,
        ttlMs: 0,
        cacheScope: "shared",
      }).success,
    ).toBe(false);
  });

  it("the MODERN schema still requires the { skill } envelope", () => {
    expect(
      ModernGetSkillEnvelopeSchema.safeParse({ ...ENTRY, ...CACHE }).success,
    ).toBe(false);
  });
});
