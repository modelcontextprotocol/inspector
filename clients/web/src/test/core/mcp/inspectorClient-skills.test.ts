import { describe, it, expect, vi } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { ServerCapabilities } from "@modelcontextprotocol/client";
import { SKILLS_EXTENSION_KEY } from "@inspector/core/mcp/skillsSchemas.js";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";

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
    protocolEra: string | undefined;
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

  it("requires the modern list envelope on a modern connection", async () => {
    // SEP-2640: "In protocol versions 2026-07-28 and later, the result also
    // carries … `ttlMs` and `cacheScope`." Nothing else validates it —
    // `skills/*` is consumer-owned, so the SDK codec never sees it.
    const client = makeClient();
    internals(client).protocolEra = "modern";
    stubRequest(client, { skills: [] });
    await expect(client.listSkills()).rejects.toBeDefined();
  });

  it("accepts a modern result that carries the envelope", async () => {
    const client = makeClient();
    internals(client).protocolEra = "modern";
    stubRequest(client, {
      resultType: "complete",
      ttlMs: 0,
      cacheScope: "public",
      skills: [ENTRY],
    });
    await expect(client.listSkills()).resolves.toMatchObject({
      skills: [ENTRY],
    });
  });

  it("does NOT require the envelope on a legacy connection", async () => {
    // Those are 2026-era attributes; failing a legacy server for their absence
    // would reject a conforming server.
    const client = makeClient();
    stubRequest(client, { skills: [ENTRY] });
    await expect(client.listSkills()).resolves.toMatchObject({
      skills: [ENTRY],
    });
  });

  it("attributes a rejected skills/get envelope to its Protocol entry", async () => {
    // Without this the Skills screen shows an error while the Protocol tab
    // renders the same exchange as a clean success. Done in the client rather
    // than a store because `skills/get` has none — the screen calls it.
    const client = makeClient();
    const marked: [string, string][] = [];
    (
      client as unknown as {
        markResponseRejected: (m: string, r: string) => void;
      }
    ).markResponseRejected = (method, reason) => {
      marked.push([method, reason]);
    };
    internals(client).client = {
      request: async () => {
        throw new SdkError(
          SdkErrorCode.InvalidResult,
          "Invalid result for skills/get",
        );
      },
    };
    await expect(client.getSkill("skill://demo/SKILL.md")).rejects.toThrow();
    expect(marked).toEqual([["skills/get", "Invalid result for skills/get"]]);
  });

  it("does NOT attribute a transport failure on skills/get", async () => {
    // No response frame arrived, so the last-answered id still points at an
    // earlier, successful exchange; marking it would stamp that one.
    const client = makeClient();
    const marked: string[] = [];
    (
      client as unknown as {
        markResponseRejected: (m: string, r: string) => void;
      }
    ).markResponseRejected = (method) => {
      marked.push(method);
    };
    internals(client).client = {
      request: async () => {
        throw new SdkError(SdkErrorCode.ConnectionClosed, "Connection closed");
      },
    };
    await expect(client.getSkill("skill://demo/SKILL.md")).rejects.toThrow();
    expect(marked).toEqual([]);
  });

  /** Declare the extension with (or without) the `directoryRead` sub-flag. */
  function declareSkills(client: InspectorClient, directoryRead: boolean) {
    internals(client).capabilities = {
      extensions: { [SKILLS_EXTENSION_KEY]: { directoryRead } },
    } as ServerCapabilities;
  }

  describe("readResourceDirectory (#2248)", () => {
    const CHILD = {
      uri: "skill://demo/ref.md",
      name: "ref.md",
      mimeType: "text/markdown",
    };

    it("throws when not connected, before the capability gate", async () => {
      // The order matters: a disconnected client has no capabilities either,
      // so checking the extension first would report every disconnected call
      // as a missing `directoryRead` declaration.
      const client = makeClient();
      declareSkills(client, true);
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).rejects.toThrow(/not connected/i);
    });

    it("refuses the call when the server did not declare directoryRead", async () => {
      // SEP-2640 makes this a MUST NOT for the client, so it is refused
      // locally rather than sent and answered -32601. A request we were never
      // allowed to make must not appear in the Protocol log as a server fault.
      const client = makeClient();
      const request = stubRequest(client, { resources: [] });
      declareSkills(client, false);
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).rejects.toThrow(/directoryRead/);
      expect(request).not.toHaveBeenCalled();
    });

    it("refuses the call when the extension is absent entirely", async () => {
      const client = makeClient();
      stubRequest(client, { resources: [] });
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).rejects.toThrow(/directoryRead/);
    });

    it("sends the uri and no cursor on the first page", async () => {
      const client = makeClient();
      const request = stubRequest(client, { resources: [CHILD] });
      declareSkills(client, true);
      const page = await client.readResourceDirectory("skill://demo");
      expect(request.mock.calls[0][0].method).toBe("resources/directory/read");
      expect(request.mock.calls[0][0].params.uri).toBe("skill://demo");
      expect(request.mock.calls[0][0].params).not.toHaveProperty("cursor");
      expect(page.resources).toEqual([CHILD]);
    });

    it("forwards a cursor and returns the server's nextCursor", async () => {
      const client = makeClient();
      const request = stubRequest(client, {
        resources: [],
        nextCursor: "3",
      });
      declareSkills(client, true);
      const page = await client.readResourceDirectory("skill://demo", "2");
      expect(request.mock.calls[0][0].params.cursor).toBe("2");
      expect(page.nextCursor).toBe("3");
    });

    it("forwards an empty-string cursor, which is a legal opaque value", async () => {
      const client = makeClient();
      const request = stubRequest(client, { resources: [] });
      declareSkills(client, true);
      await client.readResourceDirectory("skill://demo", "");
      expect(request.mock.calls[0][0].params.cursor).toBe("");
    });

    it("stamps call metadata as _meta", async () => {
      const client = makeClient();
      const request = stubRequest(client, { resources: [] });
      declareSkills(client, true);
      await client.readResourceDirectory("skill://demo", undefined, {
        progressToken: "p",
      });
      expect(request.mock.calls[0][0].params._meta).toMatchObject({
        progressToken: "p",
      });
    });

    it("requires resultType on a modern connection", async () => {
      const client = makeClient();
      internals(client).protocolEra = "modern";
      stubRequest(client, { resources: [] });
      declareSkills(client, true);
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).rejects.toBeDefined();
    });

    it("accepts a legacy result without resultType", async () => {
      const client = makeClient();
      stubRequest(client, { resources: [CHILD] });
      declareSkills(client, true);
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).resolves.toMatchObject({ resources: [CHILD] });
    });

    it("attributes a rejected decode to the exchange it came from", async () => {
      const client = makeClient();
      const marked: string[] = [];
      (
        client as unknown as {
          markResponseRejected: (m: string, r: string) => void;
        }
      ).markResponseRejected = (method) => {
        marked.push(method);
      };
      internals(client).client = {
        request: async () => {
          throw new SdkError(
            SdkErrorCode.InvalidResult,
            "Invalid result for resources/directory/read",
          );
        },
      };
      declareSkills(client, true);
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).rejects.toBeDefined();
      expect(marked).toEqual(["resources/directory/read"]);
    });

    it("does NOT attribute a request that never produced a response", async () => {
      // Marking here would stamp an earlier, successful exchange.
      const client = makeClient();
      const marked: string[] = [];
      (
        client as unknown as {
          markResponseRejected: (m: string, r: string) => void;
        }
      ).markResponseRejected = (method) => {
        marked.push(method);
      };
      internals(client).client = {
        request: async () => {
          throw new SdkError(
            SdkErrorCode.ConnectionClosed,
            "Connection closed",
          );
        },
      };
      declareSkills(client, true);
      await expect(
        client.readResourceDirectory("skill://demo"),
      ).rejects.toThrow();
      expect(marked).toEqual([]);
    });
  });

  it("requires resultType on a modern skills/get", async () => {
    // Base-protocol (SEP-2322) and present in SEP-2640's own example, unlike
    // the caching attributes the SEP leaves open.
    const client = makeClient();
    internals(client).protocolEra = "modern";
    stubRequest(client, { skill: ENTRY });
    await expect(
      client.getSkill("skill://demo/SKILL.md"),
    ).rejects.toBeDefined();
  });

  it("accepts a modern skills/get without the caching attributes", async () => {
    const client = makeClient();
    internals(client).protocolEra = "modern";
    stubRequest(client, { skill: ENTRY, resultType: "complete" });
    await expect(client.getSkill("skill://demo/SKILL.md")).resolves.toEqual(
      ENTRY,
    );
  });

  it("accepts a legacy skills/get without resultType", async () => {
    const client = makeClient();
    stubRequest(client, { skill: ENTRY });
    await expect(client.getSkill("skill://demo/SKILL.md")).resolves.toEqual(
      ENTRY,
    );
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
