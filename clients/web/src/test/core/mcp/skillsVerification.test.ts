import { describe, it, expect, vi } from "vitest";
import type { InspectorClientProtocol } from "@inspector/core/mcp/inspectorClientProtocol.js";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import {
  SKILL_MAX_CATALOG_SKILLS,
  sha256Digest,
} from "@inspector/core/mcp/skills.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import {
  allSkillsVerified,
  anySkillFailed,
  utf8Length,
  verifySkills,
} from "@inspector/core/mcp/skillsVerification.js";

/**
 * `verifySkills` is the fetch-and-verify half of the SEP-2640 checks (#2248) —
 * the part the pure checkers in `skills.ts` deliberately do not do. What these
 * pin is the fetching policy and the failure handling, since the checks
 * themselves are covered in `skills.test.ts`.
 */

/**
 * A manifest big enough to be truncated, whose files all VERIFY — so the
 * report's outcome isolates "incomplete" instead of also tripping a real
 * failure. The entry's own SKILL.md carries frontmatter matching the listing,
 * since a body of "x" would be `frontmatter-absent` and so genuinely failed.
 */
async function truncatable(options: {
  name: string;
  count: number;
  body?: string;
}): Promise<{ skill: SkillEntry; client: InspectorClientProtocol }> {
  const { name, count, body = "x" } = options;
  const md = `---\nname: ${name}\ndescription: Big\n---\n\n# ${name}\n`;
  const enc = new TextEncoder();
  const selfDigest = await sha256Digest(enc.encode(md));
  const bodyDigest = await sha256Digest(enc.encode(body));
  const selfUri = `skill://${name}/SKILL.md`;
  const skill: SkillEntry = {
    uri: selfUri,
    frontmatter: { name, description: "Big" },
    resources: Array.from({ length: count }, (_, i) =>
      i === 0
        ? { uri: selfUri, digest: selfDigest, size: enc.encode(md).byteLength }
        : {
            uri: `skill://${name}/f${i}.md`,
            digest: bodyDigest,
            size: enc.encode(body).byteLength,
          },
    ),
  };
  const client = {
    readResource: async (uri: string) => ({
      result: { contents: [{ uri, text: uri === selfUri ? md : body }] },
    }),
  } as unknown as InspectorClientProtocol;
  return { skill, client };
}

describe("verifySkills (#2248)", () => {
  const SKILL_MD = "---\nname: demo\ndescription: A demo\n---\n\n# Demo\n";
  const REF = "# Reference\n";

  async function entry(
    overrides: Partial<SkillEntry> = {},
  ): Promise<SkillEntry> {
    return {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "A demo" },
      resources: [
        {
          uri: "skill://demo/SKILL.md",
          digest: await sha256Digest(new TextEncoder().encode(SKILL_MD)),
          size: new TextEncoder().encode(SKILL_MD).byteLength,
        },
        {
          uri: "skill://demo/ref.md",
          digest: await sha256Digest(new TextEncoder().encode(REF)),
          size: new TextEncoder().encode(REF).byteLength,
        },
      ],
      ...overrides,
    };
  }

  /** A client whose `resources/read` answers from a URI → text map. */
  function clientServing(files: Record<string, string | Error>): {
    client: InspectorClientProtocol;
    readResource: ReturnType<typeof vi.fn>;
  } {
    const readResource = vi.fn(async (uri: string) => {
      const served = files[uri];
      if (served === undefined) throw new Error(`unknown resource ${uri}`);
      if (served instanceof Error) throw served;
      return { result: { contents: [{ uri, text: served }] } };
    });
    return {
      client: { readResource } as unknown as InspectorClientProtocol,
      readResource,
    };
  }

  it("verifies a clean skill and reports ok", async () => {
    const skill = await entry();
    const { client } = clientServing({
      "skill://demo/SKILL.md": SKILL_MD,
      "skill://demo/ref.md": REF,
    });
    const [report] = await verifySkills(client, [skill]);
    expect(report.ok).toBe(true);
    expect(report.name).toBe("demo");
    expect(report.conformance).toEqual([]);
    expect(report.frontmatter).toEqual([]);
    expect(report.files.map((f) => f.status)).toEqual(["verified", "verified"]);
    expect(allSkillsVerified([report])).toBe(true);
  });

  it("reads each manifest file exactly once", async () => {
    // The entry's own SKILL.md is needed twice — for its digest and for the
    // frontmatter cross-check — and reading it twice would both double the
    // load and risk comparing two different snapshots.
    const skill = await entry();
    const { client, readResource } = clientServing({
      "skill://demo/SKILL.md": SKILL_MD,
      "skill://demo/ref.md": REF,
    });
    await verifySkills(client, [skill]);
    expect(readResource).toHaveBeenCalledTimes(2);
  });

  it("reports a digest mismatch and fails the skill", async () => {
    const skill = await entry();
    const { client } = clientServing({
      "skill://demo/SKILL.md": SKILL_MD,
      "skill://demo/ref.md": "different bytes entirely\n",
    });
    const [report] = await verifySkills(client, [skill]);
    expect(report.ok).toBe(false);
    expect(report.files[1].status).toBe("mismatch");
    expect(allSkillsVerified([report])).toBe(false);
  });

  it("catches a listing whose frontmatter differs from the served file", async () => {
    const skillMd = "---\nname: demo\ndescription: Something else\n---\n\n#\n";
    const bytes = new TextEncoder().encode(skillMd);
    const skill: SkillEntry = {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "A demo" },
      resources: [
        {
          uri: "skill://demo/SKILL.md",
          // The digest is over the bytes actually served, so it VERIFIES —
          // which is the whole reason this check has to exist separately.
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
    const { client } = clientServing({ "skill://demo/SKILL.md": skillMd });
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("verified");
    expect(report.frontmatter).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("records a read failure per file instead of aborting the report", async () => {
    // A report that stopped at the first unreadable file would hide every
    // finding after it, which defeats the point of running this in CI.
    const skill = await entry();
    const { client } = clientServing({
      "skill://demo/SKILL.md": new Error("boom"),
      "skill://demo/ref.md": REF,
    });
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0]).toMatchObject({
      status: "read-error",
      reason: "boom",
    });
    expect(report.files[1].status).toBe("verified");
    expect(report.ok).toBe(false);
  });

  it("refuses a block for a DIFFERENT uri rather than verifying it", async () => {
    // The dangerous shape, and the reason positional selection is wrong: these
    // bytes are about to be hashed against THIS file's advertised digest, so
    // accepting a block the server labelled something else verifies one file's
    // content against another file's digest — and can report that as
    // `verified`. A false pass is worse than a missing check.
    const skill = await entry();
    const readResource = vi.fn(async () => ({
      result: {
        contents: [{ uri: "skill://demo/unrelated.md", text: "other bytes" }],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files.every((f) => f.status === "read-error")).toBe(true);
    expect(report.files[0].reason).toMatch(/no content block for this URI/);
    expect(report.ok).toBe(false);
  });

  it("finds the matching block when it is not the first one", async () => {
    // A server may answer with more than one block, in any order; taking
    // `contents[0]` would hash the wrong file's bytes.
    const bytes = new TextEncoder().encode(REF);
    const skill: SkillEntry = {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "A demo" },
      resources: [
        {
          uri: "skill://demo/ref.md",
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
    const readResource = vi.fn(async () => ({
      result: {
        contents: [
          { uri: "skill://demo/decoy.md", text: "decoy" },
          { uri: "skill://demo/ref.md", text: REF },
        ],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("verified");
  });

  it("ignores a malformed block while still finding the real one", async () => {
    const bytes = new TextEncoder().encode(REF);
    const skill: SkillEntry = {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "A demo" },
      resources: [
        {
          uri: "skill://demo/ref.md",
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
    const readResource = vi.fn(async () => ({
      result: {
        contents: [
          null,
          { uri: 42 },
          { uri: "skill://demo/ref.md", text: REF },
        ],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("verified");
  });

  it("reports a response with no content blocks as a read failure", async () => {
    const skill = await entry();
    const readResource = vi.fn(async () => ({ result: { contents: [] } }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0]).toMatchObject({ status: "read-error" });
    expect(report.files[0].reason).toMatch(/no content block for this URI/);
  });

  it("reports a block carrying neither text nor blob as a read failure", async () => {
    // Never as an empty file: an empty Uint8Array has a perfectly good
    // SHA-256, so a silent fallback would report a confident, wrong mismatch.
    const skill = await entry();
    const readResource = vi.fn(async (uri: string) => ({
      result: { contents: [{ uri, mimeType: "text/markdown" }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("read-error");
    expect(report.files[0].reason).toMatch(/neither text nor blob/);
  });

  it("still runs the frontmatter check for a dynamic skill", async () => {
    // `"dynamic"` waives integrity, not the frontmatter identity requirement —
    // the SKILL.md is still served and still has to match what was listed.
    const skill: SkillEntry = {
      uri: "skill://gen/SKILL.md",
      frontmatter: { name: "gen", description: "Listed" },
      resources: "dynamic",
    };
    const { client, readResource } = clientServing({
      "skill://gen/SKILL.md":
        "---\nname: gen\ndescription: Served\n---\n\n# Gen\n",
    });
    const [report] = await verifySkills(client, [skill]);
    expect(report.files).toEqual([]);
    expect(readResource).toHaveBeenCalledWith(
      "skill://gen/SKILL.md",
      undefined,
    );
    expect(report.frontmatter).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("passes a dynamic skill whose served frontmatter agrees", async () => {
    // The `dynamic-resources` finding is a WARNING, and a warning must not fail
    // the report — a conforming generated skill would otherwise fail CI.
    const skill: SkillEntry = {
      uri: "skill://gen/SKILL.md",
      frontmatter: { name: "gen", description: "Same" },
      resources: "dynamic",
    };
    const { client } = clientServing({
      "skill://gen/SKILL.md":
        "---\nname: gen\ndescription: Same\n---\n\n# Gen\n",
    });
    const [report] = await verifySkills(client, [skill]);
    expect(report.conformance).toEqual([
      expect.objectContaining({
        code: "dynamic-resources",
        severity: "warning",
      }),
    ]);
    expect(report.ok).toBe(true);
  });

  const authError = () =>
    new AuthRecoveryRequiredError(new URL("https://auth.example/authorize"), {
      reason: "expired",
    } as never);

  it("runs the frontmatter check when the SKILL.md arrives as a blob", async () => {
    // A base64 `blob` is a legal `resources/read` shape, and this module
    // already decodes it for the digest. Reading `contents.text` skipped the
    // MANDATORY frontmatter comparison for such a server while still reporting
    // `ok` (Copilot).
    const skillMd = "---\nname: demo\ndescription: Served\n---\n\n# D\n";
    const bytes = new TextEncoder().encode(skillMd);
    const skill: SkillEntry = {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "Listed" },
      resources: [
        {
          uri: "skill://demo/SKILL.md",
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
    const readResource = vi.fn(async () => ({
      result: {
        contents: [
          {
            uri: "skill://demo/SKILL.md",
            blob: Buffer.from(skillMd, "utf8").toString("base64"),
          },
        ],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("verified");
    expect(report.frontmatter).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it("does not re-read a self-entry written in an equivalent URI form", async () => {
    // `checkSkillConformance` accepts a normalized-equivalent self-entry, so a
    // raw string comparison here would disagree with it and read the file twice.
    const skillMd = "---\nname: demo\ndescription: A demo\n---\n\n# D\n";
    const bytes = new TextEncoder().encode(skillMd);
    const skill: SkillEntry = {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "A demo" },
      resources: [
        {
          uri: "skill://demo/x/../SKILL.md",
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
    const readResource = vi.fn(async (uri: string) => ({
      result: { contents: [{ uri, text: skillMd }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(readResource).toHaveBeenCalledTimes(1);
    expect(report.frontmatter).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails a dynamic skill whose SKILL.md cannot be read", async () => {
    // A dynamic skill has no manifest rows, so `files` stayed empty and its
    // only static finding is a warning — an unreadable SKILL.md therefore
    // reported `ok: true` for a skill whose mandatory frontmatter check never
    // ran (Copilot).
    const skill: SkillEntry = {
      uri: "skill://gen/SKILL.md",
      frontmatter: { name: "gen", description: "Generated" },
      resources: "dynamic",
    };
    const readResource = vi.fn(async () => {
      throw new Error("gone");
    });
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files).toEqual([
      expect.objectContaining({
        uri: "skill://gen/SKILL.md",
        status: "read-error",
        reason: "gone",
      }),
    ]);
    expect(report.ok).toBe(false);
  });

  it("fails a dynamic skill whose SKILL.md answers with no matching block", async () => {
    const skill: SkillEntry = {
      uri: "skill://gen/SKILL.md",
      frontmatter: { name: "gen", description: "Generated" },
      resources: "dynamic",
    };
    const readResource = vi.fn(async () => ({
      result: { contents: [{ uri: "skill://gen/other.md", text: "x" }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("read-error");
    expect(report.ok).toBe(false);
  });

  it("does not read a failed manifest self-entry a second time", async () => {
    // Its failure is already recorded by the manifest loop; the fallback exists
    // for a skill whose manifest never listed the file at all.
    const skill = await entry();
    const readResource = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    // Two manifest entries, two reads — no third.
    expect(readResource).toHaveBeenCalledTimes(2);
    expect(report.files).toHaveLength(2);
  });

  it("stringifies a non-Error rejection rather than reading .message off it", async () => {
    // A `throw "string"` anywhere in a transport reaches here; reading
    // `.message` off one would put `undefined` where the diagnosis belongs.
    const skill = await entry();
    const readResource = vi.fn(() => {
      // A non-Error rejection is the point of the test.
      throw "plainstring";
    });
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0]).toMatchObject({
      status: "read-error",
      reason: "plainstring",
    });
  });

  it("treats a result whose contents is not an array as no content", async () => {
    // A server can return anything; `contents: "nope"` is not a block list, and
    // hashing nothing against a digest would be a confident wrong answer.
    const skill = await entry();
    const readResource = vi.fn(async () => ({
      result: { contents: "nope" },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files.every((f) => f.status === "read-error")).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("re-throws an auth-recovery error instead of recording it per file", async () => {
    // Not a property of the file in flight: the session's authorization
    // expired, so every remaining read fails the same way. Absorbing it would
    // produce N identical read failures AND swallow the one error a caller
    // keys off to start a reauthorization.
    const skill = await entry();
    const readResource = vi.fn(async () => {
      throw authError();
    });
    const client = { readResource } as unknown as InspectorClientProtocol;
    await expect(verifySkills(client, [skill])).rejects.toBeInstanceOf(
      AuthRecoveryRequiredError,
    );
    // Stops at the first read rather than walking the rest of the manifest.
    expect(readResource).toHaveBeenCalledTimes(1);
  });

  it("re-throws an auth-recovery error from a dynamic skill's SKILL.md read", async () => {
    // The other read site: a dynamic skill has no manifest, so its SKILL.md is
    // fetched by the fallback below the loop, which has its own catch.
    const skill: SkillEntry = {
      uri: "skill://gen/SKILL.md",
      frontmatter: { name: "gen" },
      resources: "dynamic",
    };
    const readResource = vi.fn(async () => {
      throw authError();
    });
    const client = { readResource } as unknown as InspectorClientProtocol;
    await expect(verifySkills(client, [skill])).rejects.toBeInstanceOf(
      AuthRecoveryRequiredError,
    );
  });

  it("skips the frontmatter check when the SKILL.md cannot be read", async () => {
    // The read failure is reported once, as a file result. Reporting it again
    // as a phantom `frontmatter-absent` would invent a second defect.
    const skill: SkillEntry = {
      uri: "skill://gen/SKILL.md",
      frontmatter: { name: "gen" },
      resources: "dynamic",
    };
    const readResource = vi.fn(async () => {
      throw new Error("unreachable");
    });
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.frontmatter).toEqual([]);
  });

  it("fails a skill whose static conformance has an error", async () => {
    const skill: SkillEntry = {
      uri: "skill://wrong/SKILL.md",
      frontmatter: { name: "right", description: "d" },
      resources: [],
    };
    const { client } = clientServing({
      "skill://wrong/SKILL.md":
        "---\nname: right\ndescription: d\n---\n\n# X\n",
    });
    const [report] = await verifySkills(client, [skill]);
    expect(report.conformance.map((i) => i.code)).toContain(
      "name-path-mismatch",
    );
    expect(report.ok).toBe(false);
  });

  it("accepts a canonicalized URI in the served content block", async () => {
    // A server may answer with an RFC-equivalent spelling of the URI asked
    // for; matching the block by URI would reject a conforming server.
    const bytes = new TextEncoder().encode(SKILL_MD);
    const skill: SkillEntry = {
      uri: "skill://demo/SKILL.md",
      frontmatter: { name: "demo", description: "A demo" },
      resources: [
        {
          uri: "skill://demo/SKILL.md",
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
    const readResource = vi.fn(async () => ({
      result: {
        contents: [{ uri: "skill://demo/%53KILL.md", text: SKILL_MD }],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0].status).toBe("verified");
  });

  it("bounds reads at the interoperability limit, not at the manifest length", async () => {
    // The 512-entry limit is CHECKED but constrains nothing, so a hostile
    // server advertising far more had the tool perform that many sequential
    // reads after the report already knew the manifest was over (Copilot).
    const { skill, client } = await truncatable({ name: "many", count: 900 });
    const readResource = vi.spyOn(
      client as unknown as { readResource: (u: string) => unknown },
      "readResource",
    );
    const [report] = await verifySkills(client, [skill]);
    expect(readResource).toHaveBeenCalledTimes(512);
    expect(report.files).toHaveLength(512);
    // Incomplete, not failed: every file it read verified.
    expect(report.outcome).toBe("incomplete");
    expect(report.conformance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "resource-limit-exceeded" }),
      ]),
    );
  });
  it("bounds reads by the total-byte limit, not only the entry count", async () => {
    // A manifest can sit at exactly 512 entries and declare a gigabyte each,
    // so bounding the count alone still let a server dictate unbounded
    // bandwidth after `size-limit-exceeded` had been reported (Copilot).
    const { skill, client } = await truncatable({
      name: "fat",
      count: 4,
      body: "y".repeat(7 * 1024 * 1024),
    });
    const readResource = vi.spyOn(
      client as unknown as { readResource: (u: string) => unknown },
      "readResource",
    );
    const [report] = await verifySkills(client, [skill]);
    // The SKILL.md is small; 7 MiB bodies then cross the 16 MiB bound.
    expect(readResource.mock.calls.length).toBeLessThan(4);
    expect(report.outcome).toBe("incomplete");
  });
  it("does not report success for a manifest it could not finish reading", async () => {
    // Entries past the cap are never fetched and `resource-limit-exceeded` is
    // only a warning, so a manifest whose 513th file is tampered with returned
    // `ok: true` and the CLI said the skill verified (Copilot).
    const { skill, client } = await truncatable({ name: "many", count: 600 });
    const [report] = await verifySkills(client, [skill]);
    expect(report.incomplete).toBeDefined();
    expect(report.outcome).toBe("incomplete");
    expect(allSkillsVerified([report])).toBe(false);
  });
  it("verifies the entry's own file even when the cap excluded it", async () => {
    // The fallback exists for the frontmatter check, but reading the file and
    // then skipping the digest its manifest advertised would leave the skill's
    // own SKILL.md the one file nobody verified (Copilot).
    const skill: SkillEntry = {
      uri: "skill://huge/SKILL.md",
      frontmatter: { name: "huge", description: "Listed" },
      resources: [
        ...Array.from({ length: 600 }, (_, i) => ({
          uri: `skill://huge/f${i}.md`,
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        })),
        {
          uri: "skill://huge/SKILL.md",
          digest: `sha256:${"b".repeat(64)}`,
          size: 1,
        },
      ],
    };
    const readResource = vi.fn(async (uri: string) => ({
      result: { contents: [{ uri, text: "x" }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    const self = report.files.find((f) => f.uri === "skill://huge/SKILL.md");
    // A real verdict on the advertised digest, not merely a read.
    expect(self?.status).toBe("mismatch");
    expect(self?.expectedDigest).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("stops on bytes ACTUALLY served, not the sizes the manifest declared", async () => {
    // The declared budget is server-controlled: advertising `size: 1` and then
    // serving megabytes sailed straight through it (Copilot). The fixture'"'"'s
    // digests are honest, so the only thing wrong is the unfinished walk.
    const { skill, client } = await truncatable({
      name: "liar",
      count: 10,
      body: "z".repeat(6 * 1024 * 1024),
    });
    // …and now understate every non-entry size, which the old budget trusted.
    for (const r of skill.resources as { size?: number }[]) r.size = 1;
    const readResource = vi.spyOn(
      client as unknown as { readResource: (u: string) => unknown },
      "readResource",
    );
    const [report] = await verifySkills(client, [skill]);
    expect(readResource.mock.calls.length).toBeLessThan(10);
    expect(report.incomplete).toMatch(/actually served/);
  });

  it("charges the budget for a response whose block never matched", async () => {
    // The budget was charged only after a matching block had been decoded, so
    // a server could answer every row with one enormous block labelled some
    // OTHER URI: `contentsFor` found nothing, zero was banked, and the walk
    // went on to issue up to 512 more of them (Copilot). The bytes crossed the
    // wire either way, so the transfer is what pays.
    const junk = "z".repeat(6 * 1024 * 1024);
    const { skill } = await truncatable({ name: "junk", count: 20 });
    const readResource = vi.fn(async () => ({
      // Labelled a URI nobody asked for — the whole point.
      result: { contents: [{ uri: "skill://elsewhere/huge.md", text: junk }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    // Three reads of 6 MiB crosses 16 MiB; without the fix all 20 were issued.
    expect(readResource.mock.calls.length).toBe(3);
    expect(report.incomplete).toMatch(/actually served/);
    expect(report.outcome).toBe("failed");
  });

  it("charges the budget for a response that could not be decoded", async () => {
    // The second free route: an enormous `blob` that is not valid base64, so
    // `skillFileBytes` throws before anything is counted.
    const junk = "!".repeat(6 * 1024 * 1024);
    const { skill } = await truncatable({ name: "junk", count: 20 });
    const readResource = vi.fn(async (uri: string) => ({
      result: { contents: [{ uri, blob: junk }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(readResource.mock.calls.length).toBe(3);
    expect(report.incomplete).toMatch(/actually served/);
  });

  it("charges non-ASCII text in UTF-8 bytes, not UTF-16 units", async () => {
    // `text.length` undercharged every non-ASCII payload by up to 3×, so a
    // decoy block of emoji kept the counter under 16 MiB while the wire
    // carried twice that, and the walk read on (Copilot). Each block below is
    // 3 MiB of UTF-16 units and 12 MiB of UTF-8 bytes, so two cross the limit
    // under correct accounting and six would be needed under the old one.
    const emoji = "🙂".repeat(1.5 * 1024 * 1024); // 2 units each, 4 bytes each
    const { skill } = await truncatable({ name: "emoji", count: 20 });
    const readResource = vi.fn(async () => ({
      result: {
        contents: [{ uri: "skill://elsewhere/decoy.md", text: emoji }],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(readResource.mock.calls.length).toBe(3);
    expect(report.incomplete).toMatch(/actually served/);
  });

  it("counts UTF-8 length exactly as TextEncoder does", async () => {
    // The counter is hand-rolled to avoid allocating a copy of a payload a
    // hostile server sized, so it is pinned against the reference encoder —
    // including the surrogate cases that are the only reason it is not a
    // one-liner.
    const cases = [
      "",
      "plain ascii",
      "café", // 2-byte
      "日本語", // 3-byte
      "🙂👍", // surrogate pairs, 4-byte
      "a🙂b",
      "\ud83d", // lone HIGH surrogate — U+FFFD, 3 bytes
      "\udc4d", // lone LOW surrogate
      "\ud83d\ud83d", // two highs in a row: neither pairs
      "end\ud83d", // unpaired high at the very end
    ];
    const encoder = new TextEncoder();
    for (const value of cases) {
      expect(utf8Length(value)).toBe(encoder.encode(value).byteLength);
    }
  });

  it("stops reading once the run's catalog budget is spent", async () => {
    // The per-skill caps bound what ONE entry costs; nothing bounded how many
    // entries there are, and SEP-2640 puts no ceiling on a catalog — so a
    // listing of a hundred thousand conforming skills made `--verify` run
    // indefinitely (Copilot).
    // Each skill carries its OWN SKILL.md, whose frontmatter matches its
    // listing entry — otherwise every report is `failed` on a frontmatter
    // mismatch and the budget is not what the test is measuring.
    const enc = new TextEncoder();
    const mdFor = (i: number) =>
      `---\nname: s${i}\ndescription: A demo\n---\n\n# s${i}\n`;
    const many = await Promise.all(
      Array.from(
        { length: SKILL_MAX_CATALOG_SKILLS + 5 },
        async (_, i): Promise<SkillEntry> => {
          const bytes = enc.encode(mdFor(i));
          return entry({
            uri: `skill://s${i}/SKILL.md`,
            frontmatter: { name: `s${i}`, description: "A demo" },
            resources: [
              {
                uri: `skill://s${i}/SKILL.md`,
                digest: await sha256Digest(bytes),
                size: bytes.byteLength,
              },
            ],
          });
        },
      ),
    );
    const readResource = vi.fn(async (uri: string) => ({
      result: {
        contents: [
          { uri, text: mdFor(Number(/s(\d+)/.exec(uri)?.[1] ?? "0")) },
        ],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const reports = await verifySkills(client, many);
    // Every entry is still REPORTED — the static checks cost no I/O, so a
    // skill past the budget is not silently dropped from the output.
    expect(reports).toHaveLength(SKILL_MAX_CATALOG_SKILLS + 5);
    expect(readResource.mock.calls.length).toBe(SKILL_MAX_CATALOG_SKILLS);
    // …and the remainder says so, rather than passing or failing.
    const past = reports.slice(SKILL_MAX_CATALOG_SKILLS);
    for (const report of past) {
      expect(report.outcome).toBe("incomplete");
      expect(report.incomplete).toMatch(/catalog budget/);
      expect(report.files).toHaveLength(0);
    }
    expect(reports[0].outcome).toBe("verified");
  });

  it("is not incomplete when the budget is crossed by the LAST entry", async () => {
    // Crossing the line on the final row stopped nothing: every manifest entry
    // was fetched and checked. Reporting "Stopped after 4 of 4" there both
    // reads as a contradiction and demotes a fully-read skill out of
    // `verified` (Copilot).
    //
    // The sizes are understated for the same reason as the test above — with
    // honest ones the *declared* prefilter stops first and the received-bytes
    // guard is never reached at all. That understatement is itself a size
    // mismatch, so this fixture is `failed`; what it pins is that the walk is
    // not ALSO reported as cut short.
    const { skill, client } = await truncatable({
      name: "edge",
      count: 4,
      body: "z".repeat(6 * 1024 * 1024),
    });
    for (const r of skill.resources as { size?: number }[]) r.size = 1;
    const readResource = vi.spyOn(
      client as unknown as { readResource: (u: string) => unknown },
      "readResource",
    );
    const [report] = await verifySkills(client, [skill]);
    // All four read — the fourth is what crosses the 16 MiB budget.
    expect(readResource.mock.calls.length).toBe(4);
    expect(report.files).toHaveLength(4);
    expect(report.incomplete).toBeUndefined();
    expect(report.outcome).toBe("failed");
  });
  it("still reports the file that crossed the byte budget", async () => {
    // The crossing file is verified before the walk stops, so its verdict is
    // not fetched and then thrown away.
    const big = "x".repeat(17 * 1024 * 1024);
    const skill: SkillEntry = {
      uri: "skill://liar/SKILL.md",
      frontmatter: { name: "liar", description: "One enormous file" },
      resources: [
        {
          uri: "skill://liar/SKILL.md",
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        },
        {
          uri: "skill://liar/b.md",
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        },
      ],
    };
    const readResource = vi.fn(async (uri: string) => ({
      result: { contents: [{ uri, text: big }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(readResource).toHaveBeenCalledTimes(1);
    expect(report.files).toHaveLength(1);
    expect(report.files[0].status).toBe("mismatch");
  });

  it("reports the capped self-entry under the URI the MANIFEST declared", async () => {
    // A manifest may write its self-entry in a normalized-equivalent form. The
    // fallback recorded `entry.uri`, so a consumer matching rows against the
    // manifest found nothing — while a normalized "extra files" filter
    // suppressed it as already covered. The verdict existed in the report and
    // appeared nowhere on screen (Copilot).
    const declaredSpelling = "skill://huge/x/../SKILL.md";
    const skill: SkillEntry = {
      uri: "skill://huge/SKILL.md",
      frontmatter: { name: "huge", description: "Listed" },
      resources: [
        ...Array.from({ length: 600 }, (_, i) => ({
          uri: `skill://huge/f${i}.md`,
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        })),
        { uri: declaredSpelling, digest: `sha256:${"b".repeat(64)}`, size: 1 },
      ],
    };
    const readResource = vi.fn(async (uri: string) => ({
      result: { contents: [{ uri, text: "x" }] },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    const self = report.files.find((f) => f.uri === declaredSpelling);
    expect(self?.status).toBe("mismatch");
    // …and NOT under the entry's own spelling, which no manifest row carries.
    expect(report.files.some((f) => f.uri === "skill://huge/SKILL.md")).toBe(
      false,
    );
  });

  it("runs the fallback when the byte budget broke the loop before the self row", async () => {
    // `manifestListsSelf` described the bounded SLICE, not the rows reached —
    // so a break on the byte budget left it true, suppressed the fallback, and
    // skipped the mandatory frontmatter check entirely (Copilot).
    const md = "---\nname: late\ndescription: Served\n---\n\n# late\n";
    const big = "z".repeat(9 * 1024 * 1024);
    const enc = new TextEncoder();
    const skill: SkillEntry = {
      uri: "skill://late/SKILL.md",
      frontmatter: { name: "late", description: "Listed" },
      resources: [
        // Two oversized files cross the budget before the self row is reached.
        {
          uri: "skill://late/a.md",
          digest: await sha256Digest(enc.encode(big)),
          size: 1,
        },
        {
          uri: "skill://late/b.md",
          digest: await sha256Digest(enc.encode(big)),
          size: 1,
        },
        {
          uri: "skill://late/SKILL.md",
          digest: await sha256Digest(enc.encode(md)),
          size: enc.encode(md).byteLength,
        },
      ],
    };
    const readResource = vi.fn(async (uri: string) => ({
      result: {
        contents: [{ uri, text: uri.endsWith("/SKILL.md") ? md : big }],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    // The self file was still fetched, and its frontmatter still compared.
    expect(readResource).toHaveBeenCalledWith(
      "skill://late/SKILL.md",
      undefined,
    );
    expect(report.frontmatter).toHaveLength(1);
    expect(report.frontmatter[0].code).toBe("frontmatter-mismatch");
  });

  it("does not truncate a conforming manifest", async () => {
    // A conforming skill totals at most 16 MiB by definition, so the bound
    // must never shorten one — otherwise it would trade a hostile-server
    // protection for a wrong answer about a good server.
    const skill = await entry();
    const { client, readResource } = clientServing({
      "skill://demo/SKILL.md": SKILL_MD,
      "skill://demo/ref.md": REF,
    });
    const [report] = await verifySkills(client, [skill]);
    expect(readResource).toHaveBeenCalledTimes(2);
    expect(report.files).toHaveLength(2);
    // Nothing was skipped, so nothing is reported as incomplete.
    expect(report.incomplete).toBeUndefined();
    expect(report.outcome).toBe("verified");
  });

  it("still reads the entry's own file when the cap would exclude it", async () => {
    // The frontmatter comparison is mandatory and must not be lost to a limit
    // that exists to bound *other* files — so a self-entry pushed past the cap
    // by a bloated manifest reaches the fallback read.
    const skillMd = "---\nname: huge\ndescription: Served\n---\n\n# H\n";
    const skill: SkillEntry = {
      uri: "skill://huge/SKILL.md",
      frontmatter: { name: "huge", description: "Listed" },
      resources: [
        ...Array.from({ length: 600 }, (_, i) => ({
          uri: `skill://huge/f${i}.md`,
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        })),
        // Beyond the 512 cap.
        {
          uri: "skill://huge/SKILL.md",
          digest: `sha256:${"a".repeat(64)}`,
          size: 1,
        },
      ],
    };
    const readResource = vi.fn(async (uri: string) => ({
      result: {
        contents: [{ uri, text: uri.endsWith("/SKILL.md") ? skillMd : "x" }],
      },
    }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(readResource).toHaveBeenCalledWith(
      "skill://huge/SKILL.md",
      undefined,
    );
    expect(report.frontmatter).toHaveLength(1);
  });

  it("reports every skill it was given, in order", async () => {
    const a = await entry();
    const b = await entry({ uri: "skill://demo/SKILL.md" });
    const { client } = clientServing({
      "skill://demo/SKILL.md": SKILL_MD,
      "skill://demo/ref.md": REF,
    });
    const reports = await verifySkills(client, [a, b]);
    expect(reports).toHaveLength(2);
  });

  it("forwards request metadata to every read", async () => {
    const skill = await entry();
    const { client, readResource } = clientServing({
      "skill://demo/SKILL.md": SKILL_MD,
      "skill://demo/ref.md": REF,
    });
    await verifySkills(client, [skill], { progressToken: "p" });
    expect(readResource).toHaveBeenCalledWith("skill://demo/SKILL.md", {
      progressToken: "p",
    });
  });

  it("allSkillsVerified is true for an empty report", async () => {
    expect(allSkillsVerified([])).toBe(true);
  });
});

describe("verification outcomes (#2248)", () => {
  const clean = async (): Promise<SkillEntry> => {
    const md = "---\nname: ok\ndescription: Fine\n---\n\n# ok\n";
    const bytes = new TextEncoder().encode(md);
    return {
      uri: "skill://ok/SKILL.md",
      frontmatter: { name: "ok", description: "Fine" },
      resources: [
        {
          uri: "skill://ok/SKILL.md",
          digest: await sha256Digest(bytes),
          size: bytes.byteLength,
        },
      ],
    };
  };

  function serving(text: string) {
    return {
      readResource: async (uri: string) => ({
        result: { contents: [{ uri, text }] },
      }),
    } as unknown as InspectorClientProtocol;
  }

  it("separates a broken MUST from an unfinished walk", async () => {
    // The distinction the tri-state exists for: both are non-zero outcomes,
    // but only one of them says the server did something wrong.
    const md = "---\nname: ok\ndescription: Fine\n---\n\n# ok\n";
    const good = await verifySkills(serving(md), [await clean()]);
    expect(good[0].outcome).toBe("verified");
    expect(allSkillsVerified(good)).toBe(true);
    expect(anySkillFailed(good)).toBe(false);

    const bad = await verifySkills(serving("tampered"), [await clean()]);
    expect(bad[0].outcome).toBe("failed");
    expect(allSkillsVerified(bad)).toBe(false);
    expect(anySkillFailed(bad)).toBe(true);
  });

  it("does not report an incomplete walk as a failure", async () => {
    // `anySkillFailed` selects the CLI exit code, so this is what keeps a
    // conforming-but-oversized server off exit 7.
    const { skill, client } = await truncatable({ name: "many", count: 600 });
    const reports = await verifySkills(client, [skill]);
    expect(reports[0].outcome).toBe("incomplete");
    expect(anySkillFailed(reports)).toBe(false);
    expect(allSkillsVerified(reports)).toBe(false);
  });
});
