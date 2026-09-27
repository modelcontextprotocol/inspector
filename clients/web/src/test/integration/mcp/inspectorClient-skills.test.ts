import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import { getSkillsExtension } from "@inspector/core/mcp/skills.js";
import { ManagedSkillsState } from "@inspector/core/mcp/state/managedSkillsState.js";
import {
  allSkillsVerified,
  verifySkills,
} from "@inspector/core/mcp/skillsVerification.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of the Skills extension (SEP-2640, #2234) over a real
 * transport against the real fixture.
 *
 * Everything else that covers this feature stubs the seam it is about: the
 * client unit tests replace `client.request`, the screen tests mock the
 * callbacks, and the store tests use a fake client. That leaves precisely the
 * integration-sensitive claims unguarded — that `skills/list` and `skills/get`
 * can be served through the SDK's **public** `setRequestHandler` for a
 * consumer-owned method, that the fixture's `resources/read` wrapper answers
 * `skill://` URIs while leaving other URIs to the SDK, that the cursor walk
 * actually pages, and that all of it works on **both** protocol eras. Each of
 * those is an assertion about the SDK's behavior, so only a real connection
 * can check it.
 *
 * The era coverage is the point of the parameterization: `skills/*` are in
 * neither era codec, which is *why* one fixture is expected to serve both
 * legs — and that expectation had no test until this one.
 */
describe("Skills extension over a real transport (#2234)", () => {
  let client: InspectorClient | null = null;
  const servers: TestServerHttp[] = [];

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    while (servers.length) {
      const s = servers.pop();
      try {
        await s?.stop();
      } catch {
        // ignore
      }
    }
  });

  async function startSkillsServer(
    modern: boolean,
    requireClientExtension = false,
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("skills-integration", "1.0.0"),
      // An ordinary resource alongside the skills, so the fixture's
      // `resources/read` wrapper is proven to DELEGATE rather than swallow.
      resources: [
        {
          name: "plain",
          uri: "foobar://plain",
          mimeType: "text/plain",
          text: "plain",
        },
      ],
      skills: true,
      ...(requireClientExtension && { skillsRequireClientExtension: true }),
      ...(modern && { modern: {} }),
    });
    await started.start();
    servers.push(started);
    return started;
  }

  async function connect(
    url: string,
    modern: boolean,
    advertisedExtensions?: Record<string, boolean>,
  ): Promise<InspectorClient> {
    // The era is chosen by `versionNegotiation`. This helper used to set
    // `protocolEra` on the transport config instead, which `InspectorClient`
    // does not read — so every "modern" case below connected on legacy and
    // passed without exercising the modern leg at all (#2373). The assertion
    // after connect is what keeps that from recurring silently.
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(
          modern ? "modern" : "legacy",
        ),
        advertisedExtensions,
      },
    );
    await connected.connect();
    client = connected;
    expect(connected.getProtocolEra()).toBe(modern ? "modern" : "legacy");
    return connected;
  }

  /**
   * #2373: SEP-2133 negotiates an extension from both sides, and a strict
   * server refuses `skills/*` to a client that did not declare
   * `io.modelcontextprotocol/skills` itself. The Inspector never declared it,
   * and every test above passed anyway because the default fixture serves any
   * client. These run against the strict fixture on both eras — the legacy leg
   * reads the declaration from `initialize`, the modern leg from each
   * request's `_meta` envelope, so each is a separate path to prove.
   */
  for (const modern of [false, true]) {
    const era = modern ? "modern" : "legacy";

    describe(`against a server that requires the client's declaration (${era})`, () => {
      it("is served, because the Inspector declares the extension by default", async () => {
        const started = await startSkillsServer(modern, true);
        const connected = await connect(started.url, modern);
        const first = await connected.listSkills();
        expect(first.skills).toHaveLength(2);
        const entry = await connected.getSkill(
          "skill://data-analysis/SKILL.md",
        );
        expect(entry.frontmatter.name).toBe("data-analysis");
        const page = await connected.readResourceDirectory(
          "skill://data-analysis",
        );
        expect(page.resources).toHaveLength(1);
      });

      it("is refused once the declaration is turned off", async () => {
        // The negative control: without it the test above could pass against
        // a fixture that stopped checking. It is also the Server Settings
        // toggle's whole purpose — reproducing a strict server's refusal.
        const started = await startSkillsServer(modern, true);
        const connected = await connect(started.url, modern, {
          "io.modelcontextprotocol/skills": false,
        });
        // The wire code is the assertion, not just the message: the two eras
        // name this refusal differently, and a fixture sliding back to a
        // semantically different error must fail here. Modern is SEP-2575's
        // `-32021` MissingRequiredClientCapability listing the missing
        // extension; legacy has no such code and stays `-32601`.
        const expected = modern
          ? {
              code: -32021,
              data: {
                requiredCapabilities: {
                  extensions: { "io.modelcontextprotocol/skills": {} },
                },
              },
            }
          : { code: -32601 };
        // Thunks, not promises: starting all three up front leaves the later
        // rejections unhandled while the first is awaited, which fails the
        // run even though every assertion passes.
        const refusals = [
          () => connected.listSkills(),
          () => connected.getSkill("skill://data-analysis/SKILL.md"),
          () => connected.readResourceDirectory("skill://data-analysis"),
        ];
        for (const refusal of refusals) {
          await expect(refusal()).rejects.toMatchObject({
            ...expected,
            message: expect.stringMatching(
              /requires the client to declare io\.modelcontextprotocol\/skills/,
            ),
          });
        }
        // A skill file is an ordinary resource and stays readable.
        const read = await connected.readResource(
          "skill://data-analysis/reference.md",
        );
        expect(read.result.contents[0].uri).toBe(
          "skill://data-analysis/reference.md",
        );
      });
    });
  }

  for (const modern of [false, true]) {
    const era = modern ? "modern" : "legacy";

    describe(`on the ${era} era`, () => {
      it("advertises the extension in its capabilities", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        // `directoryRead` is declared because the fixture now serves the
        // method (#2248) — the declaration and the handler are one switch, so
        // this can never report a sub-option the server does not answer.
        expect(getSkillsExtension(connected.getCapabilities())).toEqual({
          directoryRead: true,
        });
      });

      it("serves skills/list as a paged walk", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);

        const first = await connected.listSkills();
        // On the modern leg this call resolving is itself the envelope
        // assertion, in two halves: the SDK codec rejects a result without
        // `resultType` (and lifts it off), and `listSkills` then selects
        // `ModernListSkillsResultSchema`, which rejects a page without
        // `ttlMs` / `cacheScope`. It cannot be asserted on the returned value
        // — `listSkills` narrows its result to the two fields below — so a
        // modern page missing the envelope surfaces here as a rejection
        // rather than as a missing property.
        //
        // The fixture pages at two over eight skills, so a client that stops
        // here sees a quarter of the catalog.
        expect(first.skills).toHaveLength(2);
        expect(first.nextCursor).toBeDefined();

        // Walked to the end rather than asserting a fixed page count, so
        // adding a fixture does not require editing this test — what it pins
        // is that the cursor terminates and every page is full but the last.
        let cursor = first.nextCursor;
        let pages = 1;
        let total = first.skills.length;
        while (cursor !== undefined) {
          const page = await connected.listSkills(cursor);
          total += page.skills.length;
          pages += 1;
          cursor = page.nextCursor;
        }
        expect(pages).toBe(4);
        expect(total).toBe(8);
      });

      it("walks every page through the managed store", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const store = new ManagedSkillsState(connected);
        try {
          const skills = await store.refresh();
          expect(skills.map((s) => s.frontmatter.name)).toEqual([
            "data-analysis",
            "tampered-notes",
            "dynamic-report",
            "stale-manifest",
            "lying-listing",
            // Two skills, one name — the collision case. The walk must keep
            // both; collapsing them is the thing SEP-2640 forbids.
            "reports",
            "reports",
            "right-name",
          ]);
          expect(store.getPagination()).toEqual({ pageCount: 4 });
        } finally {
          store.destroy();
        }
      });

      it("serves skills/get for one entry", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const entry = await connected.getSkill(
          "skill://data-analysis/SKILL.md",
        );
        expect(entry.frontmatter.name).toBe("data-analysis");
        expect(Array.isArray(entry.resources)).toBe(true);
      });

      it("carries the caching attributes on skills/get (#2404)", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        // On the modern leg `getSkillResult` selects
        // `ModernGetSkillEnvelopeSchema`, so this resolving is itself the
        // requirement; the fixture stamps both eras alike.
        const result = await connected.getSkillResult(
          "skill://data-analysis/SKILL.md",
        );
        expect(result).toMatchObject({ ttlMs: 0, cacheScope: "public" });
      });

      it("answers -32602 for an unknown skill uri", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        await expect(
          connected.getSkill("skill://nope/SKILL.md"),
        ).rejects.toThrow(/Unknown skill uri/);
      });

      it("reads a skill file through resources/read", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const read = await connected.readResource(
          "skill://data-analysis/reference.md",
        );
        const block = read.result.contents[0];
        expect(block.uri).toBe("skill://data-analysis/reference.md");
        expect("text" in block && block.text).toContain("Column rules");
      });

      it("reads a directory and pages through its children", async () => {
        // The whole `resources/directory/read` round trip against a real
        // server: the client's `directoryRead` gate, the era-selected result
        // schema, and the fixture's cursor.
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const first = await connected.readResourceDirectory(
          "skill://data-analysis",
        );
        // Pages at one child, so a client ignoring `nextCursor` is visibly
        // wrong here rather than merely lucky.
        expect(first.resources).toHaveLength(1);
        expect(first.nextCursor).toBeDefined();
        const second = await connected.readResourceDirectory(
          "skill://data-analysis",
          first.nextCursor,
        );
        expect(second.nextCursor).toBeUndefined();
        expect(
          [...first.resources, ...second.resources].map((r) => r.uri).sort(),
        ).toEqual([
          "skill://data-analysis/SKILL.md",
          "skill://data-analysis/reference.md",
        ]);
      });

      it("lists a dynamic skill's files, which is what the method is for", async () => {
        // `dynamic-report` advertises no manifest, so a directory read is the
        // only way its files are discoverable at all — the case SEP-2640 says
        // directory reading earns its place for.
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const page = await connected.readResourceDirectory(
          "skill://dynamic-report",
        );
        expect(page.resources[0].uri).toBe("skill://dynamic-report/SKILL.md");
      });

      it("lists a file the entry's manifest does not declare", async () => {
        // The stale-snapshot case SEP-2640 governs: a directory read is "a
        // live observation" that may run ahead of the held entry, and hosts
        // MUST NOT treat it as extending the manifest. The entry itself is
        // fully conforming — only the two views disagree — so nothing but this
        // comparison can surface it.
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const entry = await connected.getSkill(
          "skill://stale-manifest/SKILL.md",
        );
        const declared = new Set(
          (entry.resources === "dynamic" ? [] : entry.resources).map(
            (r) => r.uri,
          ),
        );
        expect(declared).toEqual(new Set(["skill://stale-manifest/SKILL.md"]));

        const first = await connected.readResourceDirectory(
          "skill://stale-manifest",
        );
        const second = await connected.readResourceDirectory(
          "skill://stale-manifest",
          first.nextCursor,
        );
        const children = [...first.resources, ...second.resources].map(
          (r) => r.uri,
        );
        expect(children).toContain("skill://stale-manifest/added-later.md");
        expect(declared.has("skill://stale-manifest/added-later.md")).toBe(
          false,
        );

        // And the entry still verifies clean — the disagreement is the whole
        // defect, and no digest check can see it.
        const [report] = await verifySkills(connected, [entry]);
        expect(report.ok).toBe(true);
      });

      it("reports a name collision without failing either skill", async () => {
        // Both entries are fully conforming: SEP-2640 requires only that the
        // segment before /SKILL.md equal the name, which multi-segment paths
        // satisfy while sharing a final segment. The obligation is on the
        // consumer, so this is a warning and `ok` stays true.
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const store = new ManagedSkillsState(connected);
        try {
          const skills = await store.refresh();
          const colliding = skills.filter(
            (s) => s.frontmatter.name === "reports",
          );
          expect(colliding.map((s) => s.uri).sort()).toEqual([
            "skill://acme/reports/SKILL.md",
            "skill://globex/reports/SKILL.md",
          ]);

          const reports = await verifySkills(connected, skills);
          for (const uri of colliding.map((s) => s.uri)) {
            const report = reports.find((r) => r.uri === uri)!;
            expect(report.conformance).toEqual([
              expect.objectContaining({
                code: "duplicate-name",
                severity: "warning",
              }),
            ]);
            expect(report.ok).toBe(true);
          }
        } finally {
          store.destroy();
        }
      });

      it("answers -32602 for a URI that is not a directory resource", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        await expect(
          connected.readResourceDirectory("skill://data-analysis/SKILL.md"),
        ).rejects.toThrow(/Not a directory resource/);
      });

      it("verifies the whole catalog, failing exactly the three bad skills", async () => {
        // End to end against the fixture: conformance, digests and the
        // frontmatter cross-check, over a real transport. The three failures
        // are one per violation class, and `dynamic-report` passing is the
        // assertion that a warning does not fail a report.
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const store = new ManagedSkillsState(connected);
        try {
          const skills = await store.refresh();
          const reports = await verifySkills(connected, skills);
          expect(reports.filter((r) => !r.ok).map((r) => r.name)).toEqual([
            "tampered-notes",
            "lying-listing",
            "right-name",
          ]);
          expect(allSkillsVerified(reports)).toBe(false);

          const tampered = reports.find((r) => r.name === "tampered-notes")!;
          expect(tampered.files.some((f) => f.status === "mismatch")).toBe(
            true,
          );

          // The one violation only the frontmatter check can catch: its digest
          // verifies, because the digest is over the bytes the server served.
          const lying = reports.find((r) => r.name === "lying-listing")!;
          expect(lying.files.every((f) => f.status === "verified")).toBe(true);
          expect(lying.frontmatter[0].code).toBe("frontmatter-mismatch");

          const dynamic = reports.find((r) => r.name === "dynamic-report")!;
          expect(dynamic.ok).toBe(true);
          expect(dynamic.outcome).toBe("unverifiable");
        } finally {
          store.destroy();
        }
      });

      it("still serves an ordinary resource — the wrapper delegates", async () => {
        // The one thing the `resources/read` wrap must not break.
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        const read = await connected.readResource("foobar://plain");
        expect(read.result.contents[0].uri).toBe("foobar://plain");
      });
    });
  }
});
