import { describe, it, expect, vi } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

/**
 * Unit coverage for the pagination cursor every list adapter — `tools/list`,
 * `prompts/list`, `resources/list`, `resources/templates/list`, `tasks/list` —
 * puts on the wire (#2220).
 *
 * An MCP cursor is an **opaque string**: the spec places no constraint on its
 * content, so `""` is a `nextCursor` a server may legitimately hand back and
 * the client is required to send verbatim. Four adapters used to build their
 * params with a truthiness check, which cannot distinguish "no cursor" from
 * "the cursor is the empty string" — so they dropped `""` and silently
 * re-requested page one. Nothing surfaced an error, because the request was
 * well-formed; it just asked the wrong question.
 *
 * The outbound params are therefore the whole assertion here: what each case
 * pins is that `""` survives and that a genuinely absent cursor still sends no
 * `cursor` key at all. The SDK client is stubbed rather than connected — the
 * decision under test is made entirely in `InspectorClient`.
 *
 * `listRequestorTasks` is asserted against the ext-tasks session instead of
 * the SDK client because this branch routes it through
 * `runTaskSessionOperation`; the session owns the wire params, and its own
 * suite pins the verbatim-cursor behavior there. The Inspector-side property
 * is that the cursor reaches `session.listTasks` unchanged.
 */
describe("InspectorClient list cursor handling (#2220)", () => {
  /**
   * The one SDK call these tests care about. Named rather than inlined so the
   * `vi.fn` stub can be typed by it — that is what puts the request shape on
   * `request.mock.calls`, so each assertion reads `params` without a cast.
   */
  type SdkRequest = (
    req: { method: string; params: Record<string, unknown> },
    schema: unknown,
  ) => Promise<unknown>;

  interface ClientInternals {
    client: { request: SdkRequest } | null;
  }

  /**
   * A structural view onto the private `client` field so a test can stub the
   * SDK client without connecting.
   *
   * The double cast is justified rather than incidental: `InspectorClient`
   * declares `client` `private`, so no single `as` relates it to a type that
   * exposes it, and there is no public setter — the public path is `connect()`,
   * which needs a transport, a live server and a handshake. It is safe because
   * the shape asserted is exactly the shape the class declares, so a rename or
   * a type change breaks these tests at the first use rather than silently
   * passing. The same seam is used by `inspectorClient-skills.test.ts`.
   */
  function internals(client: InspectorClient): ClientInternals {
    return client as unknown as ClientInternals;
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
   * Stub the SDK client so `request` resolves with a fixed result.
   *
   * Typed by {@link SdkRequest} rather than inferred, so `request.mock.calls`
   * carries the request shape.
   */
  function stubRequest(client: InspectorClient, result: unknown) {
    const request = vi.fn<SdkRequest>(async () => result);
    internals(client).client = { request };
    return request;
  }

  /**
   * The five adapters, each with the method it emits and an empty result of the
   * right shape. `listTools` was always correct and is included as the control:
   * if the guard it has always used ever regressed, these cases go red too.
   */
  const ADAPTERS: {
    name: string;
    method: string;
    result: Record<string, unknown>;
    call: (client: InspectorClient, cursor?: string) => Promise<unknown>;
  }[] = [
    {
      name: "listTools",
      method: "tools/list",
      result: { tools: [] },
      call: (client, cursor) => client.listTools(cursor),
    },
    {
      name: "listPrompts",
      method: "prompts/list",
      result: { prompts: [] },
      call: (client, cursor) => client.listPrompts(cursor),
    },
    {
      name: "listResources",
      method: "resources/list",
      result: { resources: [] },
      call: (client, cursor) => client.listResources(cursor),
    },
    {
      name: "listResourceTemplates",
      method: "resources/templates/list",
      result: { resourceTemplates: [] },
      call: (client, cursor) => client.listResourceTemplates(cursor),
    },
  ];

  it.each(ADAPTERS)(
    "$name sends an empty-string cursor verbatim",
    async ({ method, result, call }) => {
      const client = makeClient();
      const request = stubRequest(client, result);

      await call(client, "");

      const sent = request.mock.calls[0][0];
      expect(sent.method).toBe(method);
      expect(sent.params.cursor).toBe("");
    },
  );

  it.each(ADAPTERS)(
    "$name sends no cursor key when there is no cursor",
    async ({ method, result, call }) => {
      const client = makeClient();
      const request = stubRequest(client, result);

      await call(client);

      const sent = request.mock.calls[0][0];
      expect(sent.method).toBe(method);
      expect(sent.params).not.toHaveProperty("cursor");
    },
  );

  it.each(ADAPTERS)(
    "$name forwards a non-empty cursor unchanged",
    async ({ result, call }) => {
      const client = makeClient();
      const request = stubRequest(client, result);

      await call(client, "page-2");

      const sent = request.mock.calls[0][0];
      expect(sent.params.cursor).toBe("page-2");
    },
  );

  it.each([[""], [undefined], ["page-2"]])(
    "listRequestorTasks forwards cursor %j to the ext-tasks session unchanged",
    async (cursor) => {
      const client = makeClient();
      const listTasks = vi.fn(async (received?: string) => {
        // The session owns the wire params; the Inspector-side property is
        // that the cursor arrives here verbatim.
        void received;
        return { tasks: [] };
      });
      (
        client as unknown as {
          taskSession: { listTasks: typeof listTasks } | null;
        }
      ).taskSession = { listTasks };

      await client.listRequestorTasks(cursor);

      expect(listTasks).toHaveBeenCalledTimes(1);
      expect(listTasks.mock.calls[0][0]).toBe(cursor);
    },
  );
});
