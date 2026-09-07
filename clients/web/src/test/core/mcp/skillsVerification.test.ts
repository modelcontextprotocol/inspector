import { describe, it, expect, vi } from "vitest";
import type { InspectorClientProtocol } from "@inspector/core/mcp/inspectorClientProtocol.js";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import { sha256Digest } from "@inspector/core/mcp/skills.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import {
  allSkillsVerified,
  verifySkills,
} from "@inspector/core/mcp/skillsVerification.js";

/**
 * `verifySkills` is the fetch-and-verify half of the SEP-2640 checks (#2248) —
 * the part the pure checkers in `skills.ts` deliberately do not do. What these
 * pin is the fetching policy and the failure handling, since the checks
 * themselves are covered in `skills.test.ts`.
 */
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

  it("reports a response with no content blocks as a read failure", async () => {
    const skill = await entry();
    const readResource = vi.fn(async () => ({ result: { contents: [] } }));
    const client = { readResource } as unknown as InspectorClientProtocol;
    const [report] = await verifySkills(client, [skill]);
    expect(report.files[0]).toMatchObject({ status: "read-error" });
    expect(report.files[0].reason).toMatch(/no content blocks/);
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
