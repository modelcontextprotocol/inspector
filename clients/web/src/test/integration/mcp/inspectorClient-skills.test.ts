import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { getSkillsExtension } from "@inspector/core/mcp/skills.js";
import { ManagedSkillsState } from "@inspector/core/mcp/state/managedSkillsState.js";
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

  async function startSkillsServer(modern: boolean): Promise<TestServerHttp> {
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
      ...(modern && { modern: {} }),
    });
    await started.start();
    servers.push(started);
    return started;
  }

  async function connect(
    url: string,
    modern: boolean,
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      {
        type: "streamable-http",
        url,
        ...(modern && { protocolEra: "modern" as const }),
      },
      { environment: { transport: createTransportNode } },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  for (const modern of [false, true]) {
    const era = modern ? "modern" : "legacy";

    describe(`on the ${era} era`, () => {
      it("advertises the extension in its capabilities", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);
        // Bare, per the fixture: no `directoryRead` until phase 3 serves it.
        expect(getSkillsExtension(connected.getCapabilities())).toEqual({
          directoryRead: false,
        });
      });

      it("serves skills/list as a paged walk", async () => {
        const started = await startSkillsServer(modern);
        const connected = await connect(started.url, modern);

        const first = await connected.listSkills();
        // On the modern leg this call resolving is itself the envelope
        // assertion: `listSkills` selects `ModernListSkillsResultSchema` from
        // the negotiated era, and that schema rejects a page without
        // `resultType` / `ttlMs` / `cacheScope`. It cannot be asserted on the
        // returned value — `listSkills` narrows its result to the two fields
        // below — so a modern page missing the envelope surfaces here as a
        // rejection rather than as a missing property.
        //
        // The fixture pages at two, so a client that stops here sees half.
        expect(first.skills).toHaveLength(2);
        expect(first.nextCursor).toBeDefined();

        const second = await connected.listSkills(first.nextCursor);
        expect(second.skills).toHaveLength(2);
        expect(second.nextCursor).toBeUndefined();
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
            "right-name",
          ]);
          expect(store.getPagination()).toEqual({ pageCount: 2 });
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
