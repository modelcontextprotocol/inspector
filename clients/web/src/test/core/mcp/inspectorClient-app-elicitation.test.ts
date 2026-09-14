import { describe, it, expect, vi } from "vitest";
import type {
  ClientCapabilities,
  ElicitResult,
  JSONRPCMessage,
  ServerCapabilities,
  Transport,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type {
  AppElicitationRenderer,
  AppElicitationRequest,
} from "@inspector/core/mcp/appElicitation.js";
import {
  MCP_APP_MIME_TYPE,
  UI_EXTENSION_KEY,
} from "@inspector/core/mcp/extensions.js";

/**
 * Routing coverage for app-rendered form elicitations (#1854).
 *
 * Everything here drives the REAL inbound `elicitation/create` handler over a
 * fake transport, because the whole feature is a decision made inside that
 * handler: which of two user interfaces answers a server's request. Asserting
 * on the reply frame — rather than on an internal — is what proves the server
 * gets the app's standard `ElicitResult` unchanged.
 */

const APP_URI = "ui://demo/choose-option.html";

const REQUESTED_SCHEMA = {
  type: "object" as const,
  properties: { choice: { type: "string" as const } },
  required: ["choice"],
};

/** Server capabilities advertising the nested MCP Apps elicitation setting. */
const APP_SERVER_CAPABILITIES: ServerCapabilities = {
  extensions: { [UI_EXTENSION_KEY]: { elicitation: {} } },
};

class ElicitTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private readonly waiters = new Map<
    string | number,
    (m: JSONRPCMessage) => void
  >();

  private readonly serverCapabilities: ServerCapabilities;

  constructor(
    serverCapabilities: ServerCapabilities = APP_SERVER_CAPABILITIES,
  ) {
    this.serverCapabilities = serverCapabilities;
  }

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (
      "method" in message &&
      message.method === "initialize" &&
      "id" in message
    ) {
      const params = message.params as { protocolVersion: string };
      this.deliver({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: this.serverCapabilities,
          serverInfo: { name: "app-elicit-server", version: "1.0.0" },
        },
      });
      return;
    }
    // A reply to something we injected.
    if (
      "id" in message &&
      message.id !== undefined &&
      ("result" in message || "error" in message)
    ) {
      this.waiters.get(message.id)?.(message);
      this.waiters.delete(message.id);
    }
  }

  /** Send an `elicitation/create` and resolve with the client's reply frame. */
  elicit(
    id: number,
    params: Record<string, unknown>,
    timeoutMs = 2000,
  ): Promise<JSONRPCMessage> {
    return this.sendRequest(id, "elicitation/create", params, timeoutMs);
  }

  /**
   * Deliver any server→client request and resolve with the client's reply.
   * NOT named `send` — that is the Transport method the client calls.
   */
  sendRequest(
    id: number,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 2000,
  ): Promise<JSONRPCMessage> {
    const reply = new Promise<JSONRPCMessage>((resolve) => {
      this.waiters.set(id, resolve);
    });
    this.deliver({ jsonrpc: "2.0", id, method, ...(params && { params }) });
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      reply,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No reply to elicitation ${id}`)),
          timeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Deliver a server→client notification (no reply expected). */
  notify(method: string, params?: Record<string, unknown>): void {
    this.deliver({
      jsonrpc: "2.0",
      method,
      ...(params && { params }),
    } as unknown as JSONRPCMessage);
  }

  private deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

function appParams(overrides: Record<string, unknown> = {}) {
  return {
    message: "Choose an option",
    requestedSchema: REQUESTED_SCHEMA,
    _meta: { ui: { resourceUri: APP_URI } },
    ...overrides,
  };
}

/** The receiver tasks the client reports over `tasks/list`, by status. */
async function taskStatuses(
  transport: ElicitTransport,
  id: number,
): Promise<string[]> {
  const reply = (await transport.sendRequest(id, "tasks/list")) as {
    result?: { tasks?: { status?: string }[] };
  };
  return (reply.result?.tasks ?? []).map((t) => t.status ?? "");
}

async function connectClient(options: {
  transport: ElicitTransport;
  appElicitation?: AppElicitationRenderer;
  elicit?: boolean | { form?: boolean; url?: boolean };
}) {
  const client = new InspectorClient(
    { type: "stdio", command: "noop", args: [] },
    {
      environment: { transport: () => ({ transport: options.transport }) },
      elicit: options.elicit ?? { form: true },
      ...(options.appElicitation && { appElicitation: options.appElicitation }),
    },
  );
  await client.connect();
  return client;
}

/** The `io.modelcontextprotocol/ui` block the client advertised. */
function advertisedUi(client: InspectorClient) {
  const capabilities = (
    client as unknown as { clientCapabilities: ClientCapabilities }
  ).clientCapabilities;
  return capabilities.extensions?.[UI_EXTENSION_KEY] as
    | { mimeTypes?: string[]; elicitation?: object }
    | undefined;
}

describe("app-rendered elicitation routing (#1854)", () => {
  describe("capability advertisement", () => {
    it("advertises the nested elicitation setting when a renderer is supplied", async () => {
      const client = await connectClient({
        transport: new ElicitTransport(),
        appElicitation: async () => ({ action: "cancel" }),
      });
      expect(advertisedUi(client)).toEqual({
        mimeTypes: [MCP_APP_MIME_TYPE],
        elicitation: {},
      });
      await client.disconnect();
    });

    it("does not advertise it on a client with no renderer (CLI/TUI)", async () => {
      // The MIME type alone is what CLI and TUI advertise, and it must stay
      // that way: they know the type but cannot host an app.
      const client = await connectClient({ transport: new ElicitTransport() });
      expect(advertisedUi(client)).toEqual({ mimeTypes: [MCP_APP_MIME_TYPE] });
      await client.disconnect();
    });

    it("omits both capabilities when form elicitation is disabled", async () => {
      const client = await connectClient({
        transport: new ElicitTransport(),
        appElicitation: async () => ({ action: "cancel" }),
        elicit: { url: true },
      });
      const capabilities = (
        client as unknown as { clientCapabilities: ClientCapabilities }
      ).clientCapabilities;
      expect(capabilities.elicitation?.form).toBeUndefined();
      expect(advertisedUi(client)?.elicitation).toBeUndefined();
      await client.disconnect();
    });
  });

  describe("negotiated happy path", () => {
    it("returns the app's accept result to the server, without queueing a native request", async () => {
      const transport = new ElicitTransport();
      const seen: AppElicitationRequest[] = [];
      const client = await connectClient({
        transport,
        appElicitation: async (request) => {
          seen.push(request);
          return { action: "accept", content: { choice: "option-a" } };
        },
      });

      const reply = await transport.elicit(1, appParams());

      expect(reply).toMatchObject({
        id: 1,
        result: { action: "accept", content: { choice: "option-a" } },
      });
      // Request-scoped: the renderer is told exactly which resource and which
      // params, and gets a distinct id per request.
      expect(seen).toHaveLength(1);
      expect(seen[0].resourceUri).toBe(APP_URI);
      expect(seen[0].params.message).toBe("Choose an option");
      // The native queue was never opened — the whole point of the routing.
      expect(client.getPendingElicitations()).toHaveLength(0);
      await client.disconnect();
    });

    it.each([["decline"], ["cancel"]] as const)(
      "returns an explicit %s without opening the native UI",
      async (action) => {
        const transport = new ElicitTransport();
        const client = await connectClient({
          transport,
          appElicitation: async () => ({ action }) as ElicitResult,
        });
        const reply = await transport.elicit(2, appParams());
        expect(reply).toMatchObject({ id: 2, result: { action } });
        expect(client.getPendingElicitations()).toHaveLength(0);
        await client.disconnect();
      },
    );

    it("gives concurrent requests distinct ids and never crosses their results", async () => {
      const transport = new ElicitTransport();
      const settle = new Map<string, (r: ElicitResult) => void>();
      const byUri = new Map<string, string>();
      const client = await connectClient({
        transport,
        appElicitation: (request) =>
          new Promise<ElicitResult>((resolve) => {
            byUri.set(request.resourceUri, request.requestId);
            settle.set(request.requestId, resolve);
          }),
      });

      const first = transport.elicit(
        10,
        appParams({ _meta: { ui: { resourceUri: "ui://demo/first.html" } } }),
      );
      const second = transport.elicit(
        11,
        appParams({ _meta: { ui: { resourceUri: "ui://demo/second.html" } } }),
      );
      await vi.waitFor(() => expect(settle.size).toBe(2));

      const firstId = byUri.get("ui://demo/first.html")!;
      const secondId = byUri.get("ui://demo/second.html")!;
      expect(firstId).not.toBe(secondId);
      // Answer them out of order: an implementation keyed on "the active app"
      // rather than on the request would hand each answer to the wrong request.
      settle.get(secondId)!({ action: "accept", content: { choice: "b" } });
      settle.get(firstId)!({ action: "accept", content: { choice: "a" } });

      expect(await first).toMatchObject({
        id: 10,
        result: { content: { choice: "a" } },
      });
      expect(await second).toMatchObject({
        id: 11,
        result: { content: { choice: "b" } },
      });
      await client.disconnect();
    });
  });

  describe("native fallback", () => {
    /**
     * Every fallback case asserts the same shape: the renderer is not used (or
     * fails), and the request lands in the native pending queue instead, which
     * we then answer to keep the server from waiting.
     */
    async function expectNativeFallback(
      transport: ElicitTransport,
      client: InspectorClient,
      id: number,
      params: Record<string, unknown>,
    ) {
      const reply = transport.elicit(id, params);
      await vi.waitFor(() =>
        expect(client.getPendingElicitations()).toHaveLength(1),
      );
      // `respond` settles the queued request; its own send is fire-and-forget.
      void client
        .getPendingElicitations()[0]
        .respond({ action: "accept", content: { choice: "native" } });
      expect(await reply).toMatchObject({
        id,
        result: { content: { choice: "native" } },
      });
    }

    it("falls back when the server did not advertise the capability", async () => {
      const transport = new ElicitTransport({});
      const renderer = vi.fn();
      const client = await connectClient({
        transport,
        appElicitation: renderer as unknown as AppElicitationRenderer,
      });
      await expectNativeFallback(transport, client, 20, appParams());
      expect(renderer).not.toHaveBeenCalled();
      await client.disconnect();
    });

    it("falls back when the request names no app", async () => {
      const transport = new ElicitTransport();
      const renderer = vi.fn();
      const client = await connectClient({
        transport,
        appElicitation: renderer as unknown as AppElicitationRenderer,
      });
      await expectNativeFallback(
        transport,
        client,
        21,
        appParams({ _meta: undefined }),
      );
      expect(renderer).not.toHaveBeenCalled();
      await client.disconnect();
    });

    it("falls back on malformed metadata", async () => {
      const transport = new ElicitTransport();
      const renderer = vi.fn();
      const client = await connectClient({
        transport,
        appElicitation: renderer as unknown as AppElicitationRenderer,
      });
      await expectNativeFallback(
        transport,
        client,
        22,
        appParams({ _meta: { ui: { resourceUri: "not-a-ui-uri" } } }),
      );
      expect(renderer).not.toHaveBeenCalled();
      await client.disconnect();
    });

    it("falls back for a url-mode elicitation", async () => {
      const transport = new ElicitTransport();
      const renderer = vi.fn();
      const client = await connectClient({
        transport,
        appElicitation: renderer as unknown as AppElicitationRenderer,
        elicit: { form: true, url: true },
      });
      // A url-mode request carries no `requestedSchema` — it is a different
      // params shape, and only `form` is app-renderable.
      await expectNativeFallback(transport, client, 23, {
        mode: "url",
        message: "Sign in to continue",
        url: "https://example.com/form",
        elicitationId: "url-1",
        _meta: { ui: { resourceUri: APP_URI } },
      });
      expect(renderer).not.toHaveBeenCalled();
      await client.disconnect();
    });

    it("falls back when the renderer rejects (resource/sandbox/bridge failure, timeout)", async () => {
      const transport = new ElicitTransport();
      const client = await connectClient({
        transport,
        appElicitation: async () => {
          throw new Error("App did not initialize in time");
        },
      });
      await expectNativeFallback(transport, client, 24, appParams());
      await client.disconnect();
    });

    it("falls back when the app returns an invalid result", async () => {
      const transport = new ElicitTransport();
      const client = await connectClient({
        transport,
        appElicitation: async () =>
          ({ action: "sure" }) as unknown as ElicitResult,
      });
      await expectNativeFallback(transport, client, 25, appParams());
      await client.disconnect();
    });

    it("falls back when accepted content fails the requested schema", async () => {
      const transport = new ElicitTransport();
      const client = await connectClient({
        transport,
        appElicitation: async () => ({
          action: "accept",
          content: { choice: 7 } as unknown as Record<string, never>,
        }),
      });
      await expectNativeFallback(transport, client, 26, appParams());
      await client.disconnect();
    });
  });

  describe("task-augmented inbound requests", () => {
    /**
     * A `params.task` elicitation answers the server immediately with a
     * `CreateTaskResult` and settles the TASK when the user answers, so it
     * cannot ride `enqueuePendingElicitation`. It is still an
     * `elicitation/create`, so the app-rendering contract applies to it too.
     */
    async function connectWithTasks(
      transport: ElicitTransport,
      renderer?: AppElicitationRenderer,
    ) {
      const client = new InspectorClient(
        { type: "stdio", command: "noop", args: [] },
        {
          environment: { transport: () => ({ transport }) },
          elicit: { form: true },
          receiverTasks: true,
          ...(renderer && { appElicitation: renderer }),
        },
      );
      await client.connect();
      return client;
    }

    const taskParams = () => appParams({ task: { ttl: 60_000 } });

    it("renders the app and completes the task with its result", async () => {
      const transport = new ElicitTransport();
      const seen: AppElicitationRequest[] = [];
      const client = await connectWithTasks(transport, async (request) => {
        seen.push(request);
        return { action: "accept", content: { choice: "option-a" } };
      });

      // The immediate response is the task handle, not the answer.
      const reply = await transport.elicit(50, taskParams());
      expect(reply).toMatchObject({
        id: 50,
        result: { task: { taskId: expect.any(String) } },
      });

      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0].resourceUri).toBe(APP_URI);
      // The app answered, so the native queue never opened and the task
      // completed on its own — read back the way a server reads it, over
      // `tasks/list`.
      expect(client.getPendingElicitations()).toHaveLength(0);
      await vi.waitFor(async () =>
        expect(await taskStatuses(transport, 60)).toContain("completed"),
      );
      await client.disconnect();
    });

    it("tears the app down on tasks/cancel and keeps the task cancelled", async () => {
      // `tasks/cancel` is the server changing its mind. Without an abort the
      // modal stayed live, and a later answer overwrote `cancelled` with
      // `completed` — a task the server was told it had cancelled.
      const transport = new ElicitTransport();
      let aborted = false;
      let settle: ((r: ElicitResult) => void) | undefined;
      const client = await connectWithTasks(
        transport,
        (request) =>
          new Promise<ElicitResult>((resolve) => {
            settle = resolve;
            request.signal.addEventListener("abort", () => (aborted = true));
          }),
      );

      const created = (await transport.elicit(52, taskParams())) as {
        result?: { task?: { taskId?: string } };
      };
      const taskId = created.result?.task?.taskId;
      expect(taskId).toBeDefined();
      await vi.waitFor(() => expect(settle).toBeDefined());

      await transport.sendRequest(53, "tasks/cancel", { taskId });
      expect(aborted).toBe(true);
      expect(await taskStatuses(transport, 54)).toContain("cancelled");

      // An answer that lands after the cancel must not resurrect the task.
      settle?.({ action: "accept", content: { choice: "too-late" } });
      await vi.waitFor(async () =>
        expect(await taskStatuses(transport, 55)).toEqual(["cancelled"]),
      );
      await client.disconnect();
    });

    it("falls back to the native queue when the app cannot answer", async () => {
      const transport = new ElicitTransport();
      const client = await connectWithTasks(transport, async () => {
        throw new Error("sandbox unavailable");
      });
      await transport.elicit(51, taskParams());
      await vi.waitFor(() =>
        expect(client.getPendingElicitations()).toHaveLength(1),
      );
      await client
        .getPendingElicitations()[0]
        .respond({ action: "accept", content: { choice: "native" } });
      await vi.waitFor(async () =>
        expect(await taskStatuses(transport, 61)).toContain("completed"),
      );
      await client.disconnect();
    });
  });

  describe("request-scoped ids", () => {
    it("mints ids that are unique across client instances, not just within one", async () => {
      // A host may hold ONE renderer across replacement clients (the web client
      // rebuilds its InspectorClient on a settings change). A per-client
      // counter alone would give each new client's first request the same id,
      // and settling it would resolve the wrong server's request.
      const ids: string[] = [];
      const renderer: AppElicitationRenderer = async (request) => {
        ids.push(request.requestId);
        return { action: "cancel" };
      };
      const first = new ElicitTransport();
      const clientA = await connectClient({
        transport: first,
        appElicitation: renderer,
      });
      await first.elicit(40, appParams());
      await clientA.disconnect();

      const second = new ElicitTransport();
      const clientB = await connectClient({
        transport: second,
        appElicitation: renderer,
      });
      await second.elicit(41, appParams());
      await clientB.disconnect();

      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("teardown", () => {
    it("aborts a pending app elicitation on disconnect", async () => {
      const transport = new ElicitTransport();
      let aborted = false;
      const client = await connectClient({
        transport,
        appElicitation: (request) =>
          new Promise<ElicitResult>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      });
      void transport.elicit(30, appParams()).catch(() => {});
      await vi.waitFor(() => expect(aborted).toBe(false));
      await client.disconnect();
      await vi.waitFor(() => expect(aborted).toBe(true));
      // An aborted request must NOT resurface in the native queue: the user
      // abandoned it, and the connection it belonged to is gone.
      expect(client.getPendingElicitations()).toHaveLength(0);
    });

    it("tears the app down when the server cancels the request", async () => {
      // A direct server→client `elicitation/create` can be cancelled with
      // `notifications/cancelled`; the SDK aborts `ctx.mcpReq.signal` for it.
      // Without that signal threaded through, the modal and its bridge outlive
      // the request and could answer work the server abandoned.
      const transport = new ElicitTransport();
      let aborted = false;
      const client = await connectClient({
        transport,
        appElicitation: (request) =>
          new Promise<ElicitResult>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      });

      void transport.elicit(32, appParams()).catch(() => {});
      await vi.waitFor(() => expect(aborted).toBe(false));

      transport.notify("notifications/cancelled", {
        requestId: 32,
        reason: "server changed its mind",
      });

      await vi.waitFor(() => expect(aborted).toBe(true));
      // Not reopened natively: the request the user was answering is gone.
      expect(client.getPendingElicitations()).toHaveLength(0);
      await client.disconnect();
    });

    it("aborts a pending app elicitation on a mid-session transport close", async () => {
      // The `onclose` route reaches teardown only through
      // `clearAndAnnouncePendingPeerRequests`, whose emptiness check used to
      // look at the native queues alone — so a lone app elicitation survived a
      // dropped connection and left its modal on screen.
      const transport = new ElicitTransport();
      let aborted = false;
      const client = await connectClient({
        transport,
        appElicitation: (request) =>
          new Promise<ElicitResult>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      });
      void transport.elicit(31, appParams()).catch(() => {});
      await vi.waitFor(() => expect(aborted).toBe(false));

      transport.onclose?.();

      await vi.waitFor(() => expect(aborted).toBe(true));
      expect(client.getPendingElicitations()).toHaveLength(0);
    });
  });
});
