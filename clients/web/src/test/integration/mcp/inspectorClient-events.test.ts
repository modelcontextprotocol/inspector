import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  eraToVersionNegotiation,
  type FetchRequestEntry,
  type InspectorClientOptions,
} from "@inspector/core/mcp/types.js";
import { ManagedEventsState } from "@inspector/core/mcp/state/managedEventsState.js";
import { EVENTS_ERROR_CODES } from "@inspector/core/extension/events/constants.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  loadConfig,
  resolveConfig,
  EVENT_TYPE_NAMES,
  EVENTS_CONTROL_TOOL_NAMES,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * The Events core protocol layer against the phase 0 fixture (#3028, #3027),
 * over a real Streamable HTTP transport.
 *
 * The fixture enforces the routing headers — a named `events/*` request without
 * `Mcp-Name`, or with `Mcp-Param-Region` disagreeing with `arguments.region`, is
 * answered `400 HeaderMismatch` — so a successful poll of the annotated type is
 * itself the proof that both headers reach the wire. Both servers are built by
 * resolving the checked-in configs.
 */

const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);
const MODERN_CONFIG = path.join(configsDir, "events-modern-http.json");
const LEGACY_CONFIG = path.join(configsDir, "events-legacy-http.json");

interface Stats {
  requests: Record<string, number>;
  legacyRequests: number;
}

describe("Events core layer over a real transport (#3028)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    try {
      await client?.disconnect();
    } catch {
      // ignore
    }
    client = null;
    try {
      await server?.stop();
    } catch {
      // ignore
    }
    server = null;
  });

  async function start(configPath: string): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      ...resolveConfig(loadConfig(configPath)),
      port: undefined,
    });
    await started.start();
    server = started;
    return started;
  }

  async function connect(
    url: string,
    modern: boolean,
    options: Partial<InspectorClientOptions> = {},
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(
          modern ? "modern" : "legacy",
        ),
        ...options,
      },
    );
    client = connected;
    await connected.connect();
    expect(connected.getProtocolEra()).toBe(modern ? "modern" : "legacy");
    return connected;
  }

  async function tool(c: InspectorClient, name: string): Promise<Tool> {
    const found = (await c.listAllTools()).tools.find((t) => t.name === name);
    if (!found) throw new Error(`fixture tool ${name} not listed`);
    return found;
  }

  async function control(
    c: InspectorClient,
    name: string,
    args: Record<string, string | number> = {},
  ) {
    const result = await c.callTool(await tool(c, name), args);
    expect(result.success).toBe(true);
    return result.result;
  }

  async function stats(c: InspectorClient): Promise<Stats> {
    const result = await control(c, EVENTS_CONTROL_TOOL_NAMES.stats);
    return result?.structuredContent as unknown as Stats;
  }

  async function eventType(
    c: InspectorClient,
    name: string,
  ): Promise<EventType> {
    const found = (await c.listAllEvents()).events.find((e) => e.name === name);
    if (!found) throw new Error(`event type ${name} not listed`);
    return found;
  }

  describe("modern era", () => {
    it("lists every page and excludes the invalid x-mcp-header type", async () => {
      const started = await start(MODERN_CONFIG);
      const c = await connect(started.url, true);
      expect(c.getEventsExtension()).toEqual({ listChanged: true });

      const { events } = await c.listAllEvents();
      expect(events.map((e) => e.name)).toEqual([
        EVENT_TYPE_NAMES.pollOnly,
        EVENT_TYPE_NAMES.pushOnly,
        EVENT_TYPE_NAMES.allModes,
        EVENT_TYPE_NAMES.headerAnnotated,
      ]);
      expect(c.getExcludedEventTypes().map((x) => x.eventType.name)).toEqual([
        EVENT_TYPE_NAMES.invalidHeader,
      ]);
    });

    it("loads the managed store on connect", async () => {
      const started = await start(MODERN_CONFIG);
      const c = new InspectorClient(
        { type: "streamable-http", url: started.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
        },
      );
      client = c;
      const state = new ManagedEventsState(c, 0);
      const loaded = new Promise<EventType[]>((resolve) =>
        state.addEventListener("eventTypesChange", (e) => {
          if (e.detail.length > 0) resolve(e.detail);
        }),
      );
      await c.connect();
      expect((await loaded).length).toBe(4);
      state.destroy();
    });

    it("opts into eventsListChanged, reads the echo, and follows list_changed", async () => {
      const started = await start(MODERN_CONFIG);
      const c = await connect(started.url, true);
      // The listen stream opened on connect because the filter asked for it.
      expect(c.isEventsListChangedHonored()).toBe(true);

      const changed = new Promise<void>((resolve) =>
        c.addEventListener("eventsListChanged", () => resolve(), {
          once: true,
        }),
      );
      await control(c, EVENTS_CONTROL_TOOL_NAMES.addType, {
        name: "dynamic.added",
      });
      await changed;
      const { events } = await c.listAllEvents();
      expect(events.map((e) => e.name)).toContain("dynamic.added");
    });

    it("does not opt in when the config turns events list changes off", async () => {
      const started = await start(MODERN_CONFIG);
      const c = await connect(started.url, true, {
        listChangedNotifications: { events: false },
      });
      expect(c.isEventsListChangedHonored()).toBe(false);
    });

    it("polls with Mcp-Name and Mcp-Param-* the server checks", async () => {
      const started = await start(MODERN_CONFIG);
      const requests: FetchRequestEntry[] = [];
      const c = await connect(started.url, true);
      c.addEventListener("fetchRequest", (e) => requests.push(e.detail));
      const deploy = await eventType(c, EVENT_TYPE_NAMES.headerAnnotated);

      // A null cursor starts from now and returns a fresh cursor.
      const first = await c.pollEvents(deploy, {
        arguments: { region: "us-west1" },
      });
      expect(first.events).toEqual([]);
      expect(first.truncated).toBe(false);

      const poll = requests.find((r) =>
        (r.requestBody ?? "").includes('"events/poll"'),
      );
      expect(poll?.requestHeaders["mcp-name"]).toBe(
        EVENT_TYPE_NAMES.headerAnnotated,
      );
      expect(poll?.requestHeaders["mcp-param-region"]).toBe("us-west1");

      // events/list carries no Mcp-Name.
      const list = requests.find((r) =>
        (r.requestBody ?? "").includes('"events/list"'),
      );
      expect(list?.requestHeaders["mcp-name"]).toBeUndefined();
    });

    it("delivers an emitted occurrence to the next poll", async () => {
      const started = await start(MODERN_CONFIG);
      const c = await connect(started.url, true);
      const email = await eventType(c, EVENT_TYPE_NAMES.pollOnly);
      const first = await c.pollEvents(email);
      await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.pollOnly,
      });
      const next = await c.pollEvents(email, { cursor: first.cursor });
      expect(next.events).toHaveLength(1);
      expect(next.events[0].name).toBe(EVENT_TYPE_NAMES.pollOnly);
    });

    it("surfaces a SEP-3415 error code", async () => {
      const started = await start(MODERN_CONFIG);
      const c = await connect(started.url, true);
      const email = await eventType(c, EVENT_TYPE_NAMES.pollOnly);
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "error_forbidden",
      });
      await expect(c.pollEvents(email)).rejects.toMatchObject({
        code: EVENTS_ERROR_CODES.Forbidden,
      });
    });
  });

  describe("legacy era", () => {
    it("never sends events/* even though the server declares the key", async () => {
      const started = await start(LEGACY_CONFIG);
      const c = await connect(started.url, false);
      const state = new ManagedEventsState(c, 0);
      expect(c.getEventsExtension()).toBeUndefined();
      expect(await state.refresh()).toEqual([]);
      await expect(c.listEvents()).rejects.toThrow(/must not be sent/);
      const counts = await stats(c);
      expect(counts.legacyRequests).toBe(0);
      expect(Object.keys(counts.requests)).toEqual([]);
      state.destroy();
    });
  });
});
