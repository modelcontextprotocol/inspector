import { describe, it, expect, vi } from "vitest";
import { runMethod } from "../src/handlers/run-method.js";
import { summarizeSkillVerification } from "../src/handlers/skills-verify.js";
import { EXIT_CODES } from "../src/error-handler.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import { sha256Digest } from "@inspector/core/mcp/skills.js";
import type { SkillVerifyReport } from "@inspector/core/mcp/skillsVerification.js";

/**
 * The three SEP-2640 methods the CLI gained in #2248, plus `--verify`.
 *
 * The store's cursor walk and the verification checks are covered where they
 * live (`managedSkillsState.test.ts`, `skillsVerification.test.ts`); what these
 * pin is the dispatcher's own decisions — which method reaches which client
 * call, what shape leaves as a result, and when the report sets a non-zero exit
 * code.
 */
const SKILL_MD = "---\nname: demo\ndescription: A demo\n---\n\n# Demo\n";

async function cleanEntry(): Promise<SkillEntry> {
  const bytes = new TextEncoder().encode(SKILL_MD);
  return {
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
}

function mockClient(overrides: Record<string, unknown> = {}): InspectorClient {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getStatus: vi.fn().mockReturnValue("connected"),
    getSkillsExtension: vi.fn().mockReturnValue({ directoryRead: true }),
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    getSkill: vi.fn(),
    readResourceDirectory: vi.fn(),
    readResource: vi.fn().mockResolvedValue({
      result: { contents: [{ uri: "skill://demo/SKILL.md", text: SKILL_MD }] },
    }),
    ...overrides,
  } as unknown as InspectorClient;
}

describe("runMethod skills dispatch (#2248)", () => {
  it("returns the walked list for skills/list", async () => {
    const entry = await cleanEntry();
    const client = mockClient({
      listSkills: vi.fn().mockResolvedValue({ skills: [entry] }),
    });
    const outcome = await runMethod(client, { method: "skills/list" });
    expect(outcome).toEqual({
      kind: "result",
      result: { skills: [entry] },
      appInfo: undefined,
    });
  });

  it("rejects skills/list with a usage exit code when the server declares no extension", async () => {
    // The store answers "no extension" with an empty list, which is right for
    // a UI that must render something and wrong for a CLI: "no skills" and
    // "does not serve skills" are answers a script has to tell apart.
    const client = mockClient({
      getSkillsExtension: vi.fn().mockReturnValue(undefined),
    });
    await expect(runMethod(client, { method: "skills/list" })).rejects.toThrow(
      /does not declare/i,
    );
    await expect(
      runMethod(client, { method: "skills/list" }),
    ).rejects.toMatchObject({ exitCode: EXIT_CODES.USAGE });
  });

  it("keeps the { skill } envelope on skills/get", async () => {
    // The client unwraps it for callers that want the entry; a CLI whose
    // contract is "print the result" must not quietly reshape the wire form.
    const entry = await cleanEntry();
    const client = mockClient({ getSkill: vi.fn().mockResolvedValue(entry) });
    const outcome = await runMethod(client, {
      method: "skills/get",
      uri: entry.uri,
    });
    expect(outcome).toMatchObject({ result: { skill: entry } });
  });

  it("requires --uri for skills/get", async () => {
    await expect(
      runMethod(mockClient(), { method: "skills/get" }),
    ).rejects.toThrow(/URI is required/);
  });

  it("requires --uri for resources/directory/read", async () => {
    await expect(
      runMethod(mockClient(), { method: "resources/directory/read" }),
    ).rejects.toThrow(/URI is required/);
  });

  it("returns one page of resources/directory/read and forwards the cursor", async () => {
    // One page, not a walk: the SEP says the listing is not recursive and the
    // client descends, so aggregating here would present a subtree as a
    // directory.
    const page = { resources: [], nextCursor: "2" };
    const readResourceDirectory = vi.fn().mockResolvedValue(page);
    const client = mockClient({ readResourceDirectory });
    const outcome = await runMethod(client, {
      method: "resources/directory/read",
      uri: "skill://demo",
      cursor: "1",
    });
    expect(readResourceDirectory).toHaveBeenCalledWith(
      "skill://demo",
      "1",
      undefined,
    );
    expect(outcome).toMatchObject({ result: page });
  });

  it("--verify emits one NDJSON report per skill with no exit code when clean", async () => {
    const entry = await cleanEntry();
    const client = mockClient({
      listSkills: vi.fn().mockResolvedValue({ skills: [entry] }),
    });
    const outcome = await runMethod(client, {
      method: "skills/list",
      verify: true,
    });
    expect(outcome.kind).toBe("ndjson");
    if (outcome.kind !== "ndjson") throw new Error("unreachable");
    expect(outcome.lines).toHaveLength(1);
    expect((outcome.lines[0] as SkillVerifyReport).ok).toBe(true);
    expect(outcome.summary).toMatch(/no conformance errors/);
    expect(outcome.exitCode).toBeUndefined();
  });

  it("--verify sets the skills exit code when a skill fails", async () => {
    const entry = await cleanEntry();
    const client = mockClient({
      listSkills: vi.fn().mockResolvedValue({ skills: [entry] }),
      readResource: vi.fn().mockResolvedValue({
        result: {
          contents: [{ uri: entry.uri, text: "totally different bytes" }],
        },
      }),
    });
    const outcome = await runMethod(client, {
      method: "skills/list",
      verify: true,
    });
    if (outcome.kind !== "ndjson") throw new Error("unreachable");
    expect(outcome.exitCode).toBe(EXIT_CODES.SKILL_NONCONFORMANT);
    // Its own code, not SCHEMA_UNPORTABLE — an unportable tool schema and a
    // tampered skill digest are different CI failures.
    expect(EXIT_CODES.SKILL_NONCONFORMANT).not.toBe(
      EXIT_CODES.SCHEMA_UNPORTABLE,
    );
  });

  it("--verify works on a single skills/get", async () => {
    const entry = await cleanEntry();
    const client = mockClient({ getSkill: vi.fn().mockResolvedValue(entry) });
    const outcome = await runMethod(client, {
      method: "skills/get",
      uri: entry.uri,
      verify: true,
    });
    expect(outcome.kind).toBe("ndjson");
    if (outcome.kind !== "ndjson") throw new Error("unreachable");
    expect(outcome.lines).toHaveLength(1);
  });
});

describe("summarizeSkillVerification (#2248)", () => {
  const report = (
    over: Partial<SkillVerifyReport> = {},
  ): SkillVerifyReport => ({
    uri: "skill://demo/SKILL.md",
    name: "demo",
    conformance: [],
    frontmatter: [],
    files: [{ uri: "skill://demo/SKILL.md", status: "verified" }],
    ok: true,
    ...over,
  });

  it("reports a clean run with singular wording for one skill", () => {
    expect(summarizeSkillVerification([report()])).toBe(
      "Verified 1 skill and 1 file: no conformance errors.",
    );
  });

  it("pluralizes for more than one", () => {
    expect(summarizeSkillVerification([report(), report()])).toBe(
      "Verified 2 skills and 2 files: no conformance errors.",
    );
  });

  it("counts failures and digest mismatches separately", () => {
    // A skill can fail on a conformance error with no mismatched file at all,
    // so collapsing the two counts would misreport the cause.
    const failed = report({
      ok: false,
      files: [{ uri: "skill://demo/SKILL.md", status: "mismatch" }],
    });
    expect(summarizeSkillVerification([report(), failed])).toBe(
      "1 of 2 skills failed verification (1 digest/size mismatch across 2 files).",
    );
  });

  it("reports a failure with no mismatched file", () => {
    const failed = report({ ok: false, files: [] });
    expect(summarizeSkillVerification([failed])).toBe(
      "1 of 1 skill failed verification (0 digest/size mismatch across 0 files).",
    );
  });
});
