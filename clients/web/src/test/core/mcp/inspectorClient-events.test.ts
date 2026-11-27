import { describe, it, expect, vi } from "vitest";
import {
  SdkError,
  SdkErrorCode,
  type ServerCapabilities,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { EVENTS_EXTENSION_KEY } from "@inspector/core/extension/events/constants.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { ExcludedEventType } from "@inspector/core/extension/events/headers.js";
import { LIST_MAX_PAGES } from "@inspector/core/mcp/listSalvage.js";

/**
 * Unit coverage for the Events extension methods on `InspectorClient`
 * (#3028, SEP-3415). The SDK client is stubbed rather than connected, as the
 * Skills unit tests do: what is asserted here — the gate, the outbound request,
 * the per-request headers and the exclusion — is decided entirely in
 * `InspectorClient`. The live round trip is the integration test.
 */

interface RequestCall {
  req: { method: string; params: Record<string, unknown> };
  options: {
    headers?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
  };
}

interface EventsInternals {
  protocolEra: string | undefined;
  capabilities: ServerCapabilities | undefined;
  client: {
    request: (
      req: { method: string; params: Record<string, unknown> },
      schema: { parse: (value: unknown) => unknown },
      options: RequestCall["options"],
    ) => Promise<unknown>;
  } | null;
  listChangedNotifications: { events: boolean };
  ambientRequestSignal: AbortSignal | undefined;
  noteSubscriptionAck: (message: { method: string; params?: unknown }) => void;
  buildSubscriptionFilter: () => Record<string, unknown>;
  wantsModernStream: () => boolean;
  resetSubscriptionStream: () => void;
  invokeMcpClient: (
    operation: (attempt: number) => Promise<unknown>,
    context: { method: string },
  ) => Promise<unknown>;
}

/**
 * A structural view onto private members, so the tests can stub the SDK client
 * and set the negotiated state without connecting. Justified the way
 * `inspectorClient-skills.test.ts` justifies the same seam: the members are
 * `private`, so no single `as` relates the class to a type that exposes them,
 * and the public path to this state is `connect()` against a live server. A
 * rename or a type change breaks these tests at first use.
 */
function internals(client: InspectorClient): EventsInternals {
  return client as unknown as EventsInternals;
}

const HTTP: MCPServerConfig = {
  type: "streamable-http",
  url: "http://127.0.0.1:1/mcp",
};
const STDIO: MCPServerConfig = { type: "stdio", command: "noop", args: [] };

function makeClient(
  config: MCPServerConfig = HTTP,
  options: { listChangedEvents?: boolean } = {},
): InspectorClient {
  return new InspectorClient(config, {
    // Only used on connect(); these tests never connect.
    environment: { transport: () => ({}) as never },
    ...(options.listChangedEvents === false && {
      listChangedNotifications: { events: false },
    }),
  });
}

/** Put the client in "modern, server advertised events" state. */
function advertise(
  client: InspectorClient,
  settings: Record<string, unknown> = { listChanged: true },
  era = "modern",
): void {
  internals(client).protocolEra = era;
  internals(client).capabilities = {
    extensions: { [EVENTS_EXTENSION_KEY]: settings },
  } as ServerCapabilities;
}

/** Stub `request` to answer each call with the next queued result. */
function stubRequest(client: InspectorClient, ...results: unknown[]) {
  const calls: RequestCall[] = [];
  const request = vi.fn(
    async (
      req: RequestCall["req"],
      schema: { parse: (value: unknown) => unknown },
      options: RequestCall["options"],
    ) => {
      calls.push({ req, options });
      const next = results.shift();
      if (next instanceof Error) throw next;
      return schema.parse(next);
    },
  );
  internals(client).client = { request };
  return { request, calls };
}

function eventType(name: string, properties: Record<string, unknown> = {}) {
  return {
    name,
    delivery: ["poll"],
    inputSchema: { type: "object", properties },
  } satisfies EventType;
}

const REGION = eventType("incident.created", {
  region: { type: "string", "x-mcp-header": "Region" },
});
const INVALID = eventType("bad", {
  score: { type: "number", "x-mcp-header": "Score" },
});

const POLL_RESULT = {
  events: [],
  cursor: "c1",
  truncated: false,
  hasMore: false,
  nextPollMs: 1000,
};

describe("InspectorClient events (#3028)", () => {
  describe("getEventsExtension", () => {
    it("requires the advertisement on a modern era", () => {
      const client = makeClient();
      expect(client.getEventsExtension()).toBeUndefined();
      advertise(client, {}, "legacy");
      expect(client.getEventsExtension()).toBeUndefined();
      advertise(client, {});
      expect(client.getEventsExtension()).toEqual({ listChanged: false });
    });
  });

  describe("the never-send gate", () => {
    it("throws when not connected", async () => {
      // A stdio client has no SDK client before connect().
      const client = makeClient(STDIO);
      internals(client).client = null;
      await expect(client.listEvents()).rejects.toThrow(/not connected/i);
    });

    it("refuses locally, sending nothing, when the server did not advertise", async () => {
      const client = makeClient();
      const { request } = stubRequest(client, { events: [] });
      internals(client).protocolEra = "modern";
      await expect(client.listEvents()).rejects.toThrow(
        /did not advertise io\.modelcontextprotocol\/events/,
      );
      await expect(client.pollEvents(REGION)).rejects.toThrow(
        /events\/poll must not be sent/,
      );
      expect(request).not.toHaveBeenCalled();
    });

    it("refuses on a legacy connection even when the key is declared", async () => {
      const client = makeClient();
      const { request } = stubRequest(client, { events: [] });
      advertise(client, {}, "legacy");
      await expect(client.listAllEvents()).rejects.toThrow(/modern-era/);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe("the gate on an auth-recovery retry", () => {
    /**
     * `invokeMcpClient` runs its callback again after an auth-recovery
     * reconnect. Simulate that: the first attempt fails, the "reconnect" lands
     * on a connection without Events, and the retry must be refused locally.
     */
    function retryOntoLegacy(client: InspectorClient): void {
      internals(client).invokeMcpClient = async (operation) => {
        await operation(0).catch(() => {});
        internals(client).protocolEra = "legacy";
        return operation(1);
      };
    }

    it("re-gates events/list on the retry", async () => {
      const client = makeClient();
      advertise(client);
      const { request } = stubRequest(client, new Error("401"));
      retryOntoLegacy(client);
      await expect(client.listEvents()).rejects.toThrow(/must not be sent/);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it("re-gates a named events/* request on the retry", async () => {
      const client = makeClient();
      advertise(client);
      const { request } = stubRequest(client, new Error("401"));
      retryOntoLegacy(client);
      await expect(client.pollEvents(REGION)).rejects.toThrow(
        /events\/poll must not be sent/,
      );
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("listEvents", () => {
    it("sends events/list with no cursor on the first page", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(client, { events: [REGION] });
      const page = await client.listEvents();
      expect(calls[0].req.method).toBe("events/list");
      expect(calls[0].req.params).not.toHaveProperty("cursor");
      expect(calls[0].req.params).not.toHaveProperty("name");
      expect(page).toEqual({ events: [REGION], excluded: [] });
    });

    it("forwards an empty-string cursor and the call's _meta", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(client, { events: [], nextCursor: "n" });
      const page = await client.listEvents("", { trace: "t" });
      expect(calls[0].req.params.cursor).toBe("");
      expect(calls[0].req.params._meta).toMatchObject({ trace: "t" });
      expect(page.nextCursor).toBe("n");
    });

    it("excludes event types with invalid x-mcp-header annotations over HTTP", async () => {
      const client = makeClient();
      advertise(client);
      stubRequest(client, { events: [INVALID, REGION] });
      const page = await client.listEvents();
      expect(page.events.map((e) => e.name)).toEqual(["incident.created"]);
      expect(page.excluded).toHaveLength(1);
      expect(page.excluded[0].eventType.name).toBe("bad");
    });

    it("keeps them on stdio, where the annotation does not apply", async () => {
      const client = makeClient(STDIO);
      advertise(client);
      stubRequest(client, { events: [INVALID] });
      const page = await client.listEvents();
      expect(page.events.map((e) => e.name)).toEqual(["bad"]);
      expect(page.excluded).toEqual([]);
    });

    it("attributes a rejected decode to its Protocol entry", async () => {
      const client = makeClient();
      advertise(client);
      const marked: string[] = [];
      const rejected = vi
        .spyOn(client, "markResponseRejected")
        .mockImplementation((method) => {
          marked.push(method);
        });
      stubRequest(
        client,
        new SdkError(SdkErrorCode.InvalidResult, "bad result"),
      );
      await expect(client.listEvents()).rejects.toThrow("bad result");
      expect(marked).toEqual(["events/list"]);

      stubRequest(client, new Error("network"));
      await expect(client.listEvents()).rejects.toThrow("network");
      expect(rejected).toHaveBeenCalledTimes(1);
    });

    it("refuses a malformed result through the schema", async () => {
      const client = makeClient();
      advertise(client);
      stubRequest(client, { events: [{ name: "x" }] });
      await expect(client.listEvents()).rejects.toThrow();
    });
  });

  describe("listAllEvents", () => {
    it("walks every page and commits the excluded set", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(
        client,
        { events: [REGION], nextCursor: "2" },
        { events: [INVALID] },
      );
      const seen: ExcludedEventType[][] = [];
      client.addEventListener("excludedEventTypesChange", (e) =>
        seen.push(e.detail),
      );
      const result = await client.listAllEvents({ metadata: { a: "1" } });
      expect(result.events.map((e) => e.name)).toEqual(["incident.created"]);
      expect(calls[1].req.params.cursor).toBe("2");
      expect(
        client.getExcludedEventTypes().map((x) => x.eventType.name),
      ).toEqual(["bad"]);
      expect(seen).toHaveLength(1);
    });

    it("stops on a repeated cursor without committing", async () => {
      const client = makeClient();
      advertise(client);
      stubRequest(
        client,
        { events: [INVALID], nextCursor: "x" },
        { events: [], nextCursor: "x" },
      );
      await expect(client.listAllEvents()).rejects.toThrow(
        /repeated a pagination cursor in events\/list/,
      );
      expect(client.getExcludedEventTypes()).toEqual([]);
    });

    it("stops at the page cap", async () => {
      const client = makeClient();
      advertise(client);
      const pages = Array.from({ length: LIST_MAX_PAGES + 1 }, (_, i) => ({
        events: [],
        nextCursor: `c${i}`,
      }));
      stubRequest(client, ...pages);
      await expect(client.listAllEvents()).rejects.toThrow(/events\/list/);
    });
  });

  describe("pollEvents / sendEventsRequest", () => {
    it("sends events/poll with name, arguments, a null cursor and Mcp-Param headers", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(client, POLL_RESULT);
      const result = await client.pollEvents(REGION, {
        arguments: { region: "us-west1" },
      });
      expect(result.cursor).toBe("c1");
      expect(calls[0].req).toMatchObject({
        method: "events/poll",
        params: {
          name: "incident.created",
          arguments: { region: "us-west1" },
          cursor: null,
        },
      });
      expect(calls[0].req.params).not.toHaveProperty("maxEvents");
      expect(calls[0].options.headers).toEqual({
        "Mcp-Param-Region": "us-west1",
      });
    });

    it("forwards cursor, maxAgeMs and maxEvents, and sends no headers without an annotated value", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(client, POLL_RESULT);
      await client.pollEvents(REGION, {
        cursor: "c0",
        maxAgeMs: 300000,
        maxEvents: 50,
      });
      expect(calls[0].req.params).toMatchObject({
        arguments: {},
        cursor: "c0",
        maxAgeMs: 300000,
        maxEvents: 50,
      });
      expect(calls[0].options.headers).toBeUndefined();
    });

    it("takes params.name from the event type and merges caller options", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(client, POLL_RESULT, POLL_RESULT);
      await client.sendEventsRequest(
        "events/poll",
        REGION,
        { name: "spoofed", arguments: { region: "eu" } },
        (await import("@inspector/core/extension/events/schemas.js"))
          .PollEventsResultSchema,
        {
          metadata: { m: "1" },
          requestOptions: { timeout: 5, headers: { "X-Caller": "y" } },
        },
      );
      expect(calls[0].req.params.name).toBe("incident.created");
      expect(calls[0].req.params._meta).toMatchObject({ m: "1" });
      expect(calls[0].options.timeout).toBe(5);
      expect(calls[0].options.headers).toEqual({
        "X-Caller": "y",
        "Mcp-Param-Region": "eu",
      });

      // Non-object arguments mirror nothing.
      await client.sendEventsRequest(
        "events/poll",
        REGION,
        { arguments: ["eu"] },
        (await import("@inspector/core/extension/events/schemas.js"))
          .PollEventsResultSchema,
      );
      expect(calls[1].options.headers).toBeUndefined();
    });

    it("combines a caller's signal with the ambient one instead of replacing it", async () => {
      const client = makeClient();
      advertise(client);
      const { calls } = stubRequest(client, POLL_RESULT);
      const ambient = new AbortController();
      internals(client).ambientRequestSignal = ambient.signal;
      const caller = new AbortController();
      await client.sendEventsRequest(
        "events/poll",
        REGION,
        {},
        (await import("@inspector/core/extension/events/schemas.js"))
          .PollEventsResultSchema,
        { requestOptions: { signal: caller.signal } },
      );
      const sent = calls[0].options.signal;
      expect(sent?.aborted).toBe(false);
      // Aborting the ambient (command-scoped) signal still reaches the request.
      ambient.abort();
      expect(sent?.aborted).toBe(true);
    });

    it("attributes a rejected poll decode, and only a decode", async () => {
      const client = makeClient();
      advertise(client);
      const rejected = vi
        .spyOn(client, "markResponseRejected")
        .mockImplementation(() => {});
      stubRequest(
        client,
        new SdkError(SdkErrorCode.InvalidResult, "bad"),
        new Error("down"),
      );
      await expect(client.pollEvents(REGION)).rejects.toThrow("bad");
      await expect(client.pollEvents(REGION)).rejects.toThrow("down");
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(rejected.mock.calls[0][0]).toBe("events/poll");
    });
  });

  describe("list_changed opt-in on the listen filter", () => {
    it("adds eventsListChanged when the server declared listChanged", () => {
      const client = makeClient();
      advertise(client, { listChanged: true });
      expect(internals(client).buildSubscriptionFilter()).toMatchObject({
        eventsListChanged: true,
      });
      expect(internals(client).wantsModernStream()).toBe(true);
    });

    it("omits it when the server did not, or the config opted out", () => {
      const client = makeClient();
      advertise(client, {});
      expect(internals(client).buildSubscriptionFilter()).not.toHaveProperty(
        "eventsListChanged",
      );
      expect(internals(client).wantsModernStream()).toBe(false);

      const optedOut = makeClient(HTTP, { listChangedEvents: false });
      advertise(optedOut, { listChanged: true });
      expect(internals(optedOut).buildSubscriptionFilter()).not.toHaveProperty(
        "eventsListChanged",
      );
    });

    it("reads the echo from the raw acknowledgement and resets with the stream", () => {
      const client = makeClient();
      expect(client.isEventsListChangedHonored()).toBe(false);
      const ack = (filter: Record<string, unknown>) => ({
        method: "notifications/subscriptions/acknowledged",
        params: { notifications: filter },
      });
      internals(client).noteSubscriptionAck(ack({ eventsListChanged: true }));
      expect(client.isEventsListChangedHonored()).toBe(true);
      // Some other notification leaves it alone.
      internals(client).noteSubscriptionAck({
        method: "notifications/tools/list_changed",
      });
      expect(client.isEventsListChangedHonored()).toBe(true);
      internals(client).noteSubscriptionAck(ack({ toolsListChanged: true }));
      expect(client.isEventsListChangedHonored()).toBe(false);
      internals(client).noteSubscriptionAck(ack({ eventsListChanged: true }));
      internals(client).resetSubscriptionStream();
      expect(client.isEventsListChangedHonored()).toBe(false);
    });
  });
});
