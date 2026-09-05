import { describe, it, expect, vi } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { ServerCapabilities } from "@modelcontextprotocol/client";
import { SKILLS_EXTENSION_KEY } from "@inspector/core/mcp/skillsSchemas.js";

/**
 * Unit coverage for the Skills extension methods (#2234, SEP-2640).
 *
 * The SDK client is stubbed rather than connected: what these assert is the
 * shape of the outbound request and the normalization of the result, both of
 * which are decided entirely in `InspectorClient` — and the point worth pinning
 * is that `skills/*` go out through the ordinary `client.request` path with an
 * explicit result schema, NOT through the raw-wire channel modern `tasks/*`
 * needs.
 */
describe("InspectorClient skills methods (#2234)", () => {
  const ENTRY = {
    uri: "skill://demo/SKILL.md",
    frontmatter: { name: "demo", description: "A demo skill" },
    resources: [
      {
        uri: "skill://demo/ref.md",
        digest: `sha256:${"a".repeat(64)}`,
        size: 3,
      },
    ],
  };

  interface SkillsInternals {
    client: {
      request: (
        req: { method: string; params: Record<string, unknown> },
        schema: { parse: (value: unknown) => unknown },
      ) => Promise<unknown>;
    } | null;
    capabilities: ServerCapabilities | undefined;
  }

  function makeClient(): InspectorClient {
    return new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      // `environment.transport` is only used on connect(); these tests never
      // connect, they stub the SDK client directly.
      { environment: { transport: () => ({}) as never } },
    );
  }

  /**
   * A structural view onto two private fields, so the tests can stub the SDK
   * client and set `capabilities` without connecting.
   *
   * The double cast is justified rather than incidental: `InspectorClient`
   * declares both members `private`, so no single `as` relates it to a type
   * that exposes them, and there is no public setter for either — the public
   * path is `connect()`, which needs a transport, a live server and a
   * handshake to reach the same state. It is safe because the shape asserted
   * here is exactly the shape the class declares (`client` is the SDK client;
   * `capabilities` is `ServerCapabilities | undefined`), so a rename or a type
   * change on either field breaks these tests at the first use rather than
   * silently passing. The same seam is used by
   * `inspectorClient-raw-wire.test.ts`.
   */
  function internals(client: InspectorClient): SkillsInternals {
    return client as unknown as SkillsInternals;
  }

  /** Stub the SDK client so `request` parses through the supplied schema. */
  function stubRequest(client: InspectorClient, result: unknown) {
    const request = vi.fn(
      async (
        _req: { method: string; params: Record<string, unknown> },
        schema: { parse: (value: unknown) => unknown },
      ) => schema.parse(result),
    );
    internals(client).client = { request };
    return request;
  }

  it("getSkillsExtension reads the server's declaration", () => {
    const client = makeClient();
    expect(client.getSkillsExtension()).toBeUndefined();
    internals(client).capabilities = {
      extensions: { [SKILLS_EXTENSION_KEY]: { directoryRead: true } },
    } as ServerCapabilities;
    expect(client.getSkillsExtension()).toEqual({ directoryRead: true });
  });

  it("listSkills throws when not connected", async () => {
    await expect(makeClient().listSkills()).rejects.toThrow(/not connected/i);
  });

  it("getSkill throws when not connected", async () => {
    await expect(makeClient().getSkill("skill://x/SKILL.md")).rejects.toThrow(
      /not connected/i,
    );
  });

  it("sends skills/list with no cursor on the first page", async () => {
    const client = makeClient();
    const request = stubRequest(client, { skills: [ENTRY] });
    const page = await client.listSkills();
    expect(request.mock.calls[0][0].method).toBe("skills/list");
    expect(request.mock.calls[0][0].params).not.toHaveProperty("cursor");
    expect(page.skills).toEqual([ENTRY]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("forwards a cursor and returns the server's nextCursor", async () => {
    const client = makeClient();
    const request = stubRequest(client, { skills: [], nextCursor: "4" });
    const page = await client.listSkills("2");
    expect(request.mock.calls[0][0].params.cursor).toBe("2");
    expect(page.nextCursor).toBe("4");
  });

  it("stamps call metadata onto skills/list as _meta", async () => {
    const client = makeClient();
    const request = stubRequest(client, { skills: [] });
    await client.listSkills(undefined, { trace: "abc" });
    expect(request.mock.calls[0][0].params._meta).toMatchObject({
      trace: "abc",
    });
  });

  it("sends skills/get with the requested uri", async () => {
    const client = makeClient();
    const request = stubRequest(client, { skill: ENTRY });
    await client.getSkill("skill://demo/SKILL.md");
    expect(request.mock.calls[0][0].method).toBe("skills/get");
    expect(request.mock.calls[0][0].params.uri).toBe("skill://demo/SKILL.md");
  });

  it("unwraps the skills/get envelope to the entry", async () => {
    const client = makeClient();
    stubRequest(client, { skill: ENTRY });
    expect(await client.getSkill("skill://demo/SKILL.md")).toEqual(ENTRY);
  });

  it("rejects a skills/get result returned without its envelope", async () => {
    // Normalizing it would let a non-conforming server through the one place
    // that could have reported it.
    const client = makeClient();
    stubRequest(client, ENTRY);
    await expect(
      client.getSkill("skill://demo/SKILL.md"),
    ).rejects.toBeDefined();
  });

  it("rejects a skills/list result that is not a skills page", async () => {
    // The explicit result schema is the whole client-side mechanism for a
    // consumer-owned extension method, so a nonconforming result must fail
    // here rather than reaching the UI as a half-parsed shape.
    const client = makeClient();
    stubRequest(client, { notSkills: true });
    await expect(client.listSkills()).rejects.toBeDefined();
  });
});
