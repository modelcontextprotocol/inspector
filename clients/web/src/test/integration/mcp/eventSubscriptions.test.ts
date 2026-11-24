import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import {
  EventSubscriptionsState,
  type EventLogEntry,
  type EventSubscription,
} from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { EVENTS_ERROR_CODES } from "@inspector/core/extension/events/constants.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type { JsonValue } from "@inspector/core/json/jsonUtils.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  loadConfig,
  resolveConfig,
  EVENT_TYPE_NAMES,
  EVENTS_CONTROL_TOOL_NAMES,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * The Events subscription engine (#3029) end to end against the phase 0
 * fixture over a real Streamable HTTP transport: poll and push runners, the
 * registry, and the fixture's failure presets — backlog, gap, error, both
 * kinds of termination, heartbeat timeout and reconnect, and cancellation.
 *
 * Every wait is a condition wait on the store (or the fixture's own counters),
 * bounded well inside the integration budget, never a fixed sleep.
 */

const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);
const MODERN_CONFIG = path.join(configsDir, "events-modern-http.json");

/** Inner condition-wait budget; strictly below the 30 s test budget. */
const WAIT = { timeout: 10_000, interval: 20 };

interface Stats {
  requests: Record<string, number>;
  openStreams: number;
}

describe("Events subscription engine over a real transport (#3029)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: EventSubscriptionsState | null = null;

  afterEach(async () => {
    state?.destroy();
    state = null;
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

  async function setup(): Promise<{
    c: InspectorClient;
    s: EventSubscriptionsState;
    types: Map<string, EventType>;
  }> {
    const started = createTestServerHttp({
      ...resolveConfig(loadConfig(MODERN_CONFIG)),
      port: undefined,
    });
    await started.start();
    server = started;
    const c = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
      },
    );
    client = c;
    await c.connect();
    expect(c.getProtocolEra()).toBe("modern");
    const s = new EventSubscriptionsState(c, {
      pollFloorMs: 50,
      reconnectJitterMs: 20,
    });
    state = s;
    const { events } = await c.listAllEvents();
    return { c, s, types: new Map(events.map((e) => [e.name, e])) };
  }

  async function control(
    c: InspectorClient,
    name: string,
    args: Record<string, JsonValue> = {},
  ): Promise<Record<string, unknown>> {
    const tools: Tool[] = (await c.listAllTools()).tools;
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`fixture tool ${name} not listed`);
    const result = await c.callTool(tool, args);
    expect(result.success).toBe(true);
    return (result.result?.structuredContent ?? {}) as Record<string, unknown>;
  }

  async function stats(c: InspectorClient): Promise<Stats> {
    const raw = await control(c, EVENTS_CONTROL_TOOL_NAMES.stats);
    return {
      requests: raw.requests as Record<string, number>,
      openStreams: raw.openStreams as number,
    };
  }

  function sub(s: EventSubscriptionsState, id: string): EventSubscription {
    const found = s.getSubscription(id);
    if (!found) throw new Error(`no subscription ${id}`);
    return found;
  }

  const eventIds = (log: EventLogEntry[]) =>
    log.flatMap((e) => (e.kind === "event" ? [e.occurrence.eventId] : []));

  async function activePush(
    s: EventSubscriptionsState,
    type: EventType,
    options: { heartbeatMs?: number; arguments?: Record<string, unknown> } = {},
  ): Promise<EventSubscription> {
    const created = s.subscribe(type, { mode: "push", ...options });
    await vi.waitFor(
      () => expect(sub(s, created.id).status).toBe("active"),
      WAIT,
    );
    return sub(s, created.id);
  }

  describe("poll", () => {
    it("drains a backlog through hasMore and dedups nothing that is new", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const created = s.subscribe(incident, { mode: "poll", maxEvents: 10 });
      await vi.waitFor(
        () => expect(sub(s, created.id).status).toBe("active"),
        WAIT,
      );
      const before = (await stats(c)).requests["events/poll"] ?? 0;

      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "backlog",
        count: 25,
      });
      await vi.waitFor(
        () => expect(sub(s, created.id).counts.events).toBe(25),
        WAIT,
      );
      // 25 at 10 per poll: at least three polls, the last two back to back.
      expect(
        (await stats(c)).requests["events/poll"]! - before,
      ).toBeGreaterThanOrEqual(3);
      const current = sub(s, created.id);
      expect(current.cursor).toMatch(/^cur_\d+$/);
      expect(current.nextPollMs).toBe(1000);
      expect(current.counts.duplicates).toBe(0);
      expect(eventIds(s.getLog(created.id))).toHaveLength(25);
    });

    it("dedups a repeated eventId within the subscription", async () => {
      const { c, s, types } = await setup();
      const email = types.get(EVENT_TYPE_NAMES.pollOnly)!;
      const created = s.subscribe(email, { mode: "poll" });
      await vi.waitFor(
        () => expect(sub(s, created.id).status).toBe("active"),
        WAIT,
      );
      for (let i = 0; i < 2; i++) {
        await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
          name: EVENT_TYPE_NAMES.pollOnly,
          eventId: "evt_same",
        });
      }
      await vi.waitFor(
        () => expect(sub(s, created.id).counts.duplicates).toBe(1),
        WAIT,
      );
      expect(eventIds(s.getLog(created.id))).toEqual(["evt_same"]);
    });

    it("marks a gap when the cursor fell behind retention", async () => {
      const { c, s, types } = await setup();
      const email = types.get(EVENT_TYPE_NAMES.pollOnly)!;
      await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.pollOnly,
        count: 3,
      });
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "gap",
      });
      const created = s.subscribe(email, { mode: "poll", cursor: "cur_0" });
      await vi.waitFor(
        () => expect(sub(s, created.id).counts.gaps).toBe(1),
        WAIT,
      );
      expect(s.getLog(created.id).map((e) => e.kind)).toEqual(["gap"]);
    });

    it("ends on the next poll after a Forbidden termination", async () => {
      const { c, s, types } = await setup();
      const email = types.get(EVENT_TYPE_NAMES.pollOnly)!;
      const created = s.subscribe(email, { mode: "poll" });
      await vi.waitFor(
        () => expect(sub(s, created.id).status).toBe("active"),
        WAIT,
      );
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "terminate_forbidden",
        name: EVENT_TYPE_NAMES.pollOnly,
      });
      await vi.waitFor(
        () => expect(sub(s, created.id).status).toBe("terminated"),
        WAIT,
      );
      expect(sub(s, created.id).termination).toMatchObject({
        reason: "forbidden",
        relist: "skipped",
        canResubscribe: false,
        error: { code: EVENTS_ERROR_CODES.Forbidden },
      });
    });
  });

  describe("push", () => {
    it("streams with no request timeout, advances the cursor on heartbeat, and is cancelled by stop", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const active = await activePush(s, incident, { heartbeatMs: 100 });
      expect(active.grantedHeartbeatMs).toBe(100);
      expect(active.subscriptionId).toBeDefined();

      await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.allModes,
        count: 2,
      });
      await vi.waitFor(
        () => expect(sub(s, active.id).counts.events).toBe(2),
        WAIT,
      );
      const afterEvents = sub(s, active.id).lastMessageAt!;
      // Heartbeats keep arriving, each one proof of life.
      await vi.waitFor(
        () =>
          expect(sub(s, active.id).lastMessageAt!.getTime()).toBeGreaterThan(
            afterEvents.getTime(),
          ),
        WAIT,
      );
      expect(sub(s, active.id).status).toBe("active");
      expect(sub(s, active.id).cursor).toMatch(/^cur_\d+$/);
      expect((await stats(c)).openStreams).toBe(1);

      s.stop(active.id);
      expect(sub(s, active.id).status).toBe("stopped");
      await vi.waitFor(
        async () => expect((await stats(c)).openStreams).toBe(0),
        WAIT,
      );
    });

    it("holds concurrent streams and routes each one's notifications to it", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const build = types.get(EVENT_TYPE_NAMES.pushOnly)!;
      const a = await activePush(s, incident);
      const b = await activePush(s, build);
      expect(a.subscriptionId).not.toBe(b.subscriptionId);
      expect((await stats(c)).openStreams).toBe(2);

      await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.pushOnly,
      });
      await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.allModes,
        count: 2,
      });
      await vi.waitFor(() => {
        expect(sub(s, a.id).counts.events).toBe(2);
        expect(sub(s, b.id).counts.events).toBe(1);
      }, WAIT);
      // The emit-only type has no replay: nothing to persist.
      expect(sub(s, b.id).cursor).toBeNull();
      for (const entry of s.getLog(b.id)) {
        expect(entry.kind === "event" && entry.occurrence.name).toBe(
          EVENT_TYPE_NAMES.pushOnly,
        );
      }
    });

    it("marks a gap and a transient error without ending the stream", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const active = await activePush(s, incident);
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "gap",
      });
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "stream_error",
      });
      await vi.waitFor(() => {
        expect(sub(s, active.id).counts.gaps).toBe(1);
        expect(sub(s, active.id).counts.errors).toBe(1);
      }, WAIT);
      expect(sub(s, active.id).status).toBe("active");
      expect(sub(s, active.id).lastError).toMatchObject({
        message: "UpstreamError",
      });
    });

    it("treats a stalled stream as dead after 3x the heartbeat and reconnects with the last cursor", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const active = await activePush(s, incident, { heartbeatMs: 100 });
      const firstId = active.subscriptionId;
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "stall_stream",
      });
      await vi.waitFor(() => {
        const current = sub(s, active.id);
        expect(current.counts.reconnects).toBeGreaterThanOrEqual(1);
        expect(current.status).toBe("active");
        expect(current.subscriptionId).not.toBe(firstId);
      }, WAIT);
      const reconnect = s.getLog(active.id).find((e) => e.kind === "reconnect");
      expect(reconnect).toMatchObject({
        reason: "no message on the stream for 300 ms",
      });
      // The stalled stream was aborted; only the new one is open.
      await vi.waitFor(async () => {
        const counts = await stats(c);
        expect(counts.openStreams).toBe(1);
        expect(counts.requests["events/stream"]).toBeGreaterThanOrEqual(2);
      }, WAIT);
    });

    it("re-lists after NotFound on removal and offers no resubscribe for a type that is gone", async () => {
      const { c, s, types } = await setup();
      const deploy = types.get(EVENT_TYPE_NAMES.headerAnnotated)!;
      const active = await activePush(s, deploy, {
        arguments: { region: "us-west1" },
      });
      await control(c, EVENTS_CONTROL_TOOL_NAMES.removeType, {
        name: EVENT_TYPE_NAMES.headerAnnotated,
      });
      await vi.waitFor(
        () => expect(sub(s, active.id).termination?.relist).toBe("done"),
        WAIT,
      );
      expect(sub(s, active.id).termination).toMatchObject({
        reason: "removed",
        canResubscribe: false,
        error: { code: EVENTS_ERROR_CODES.NotFound },
      });
      expect(s.getLog(active.id).at(-1)).toMatchObject({
        kind: "terminated",
        reason: "removed",
      });
    });

    it("re-lists after schema_changed and resubscribes from the last cursor", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const active = await activePush(s, incident);
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "terminate_schema_changed",
        name: EVENT_TYPE_NAMES.allModes,
      });
      await vi.waitFor(
        () => expect(sub(s, active.id).termination?.canResubscribe).toBe(true),
        WAIT,
      );
      expect(sub(s, active.id).termination?.reason).toBe("schema_changed");
      const cursor = sub(s, active.id).cursor;
      expect(cursor).toMatch(/^cur_\d+$/);

      s.resubscribe(active.id);
      await vi.waitFor(
        () => expect(sub(s, active.id).status).toBe("active"),
        WAIT,
      );
      await control(c, EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.allModes,
      });
      await vi.waitFor(
        () => expect(sub(s, active.id).counts.events).toBe(1),
        WAIT,
      );
    });

    it("ends with no offer on Forbidden", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      const active = await activePush(s, incident);
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "terminate_forbidden",
        name: EVENT_TYPE_NAMES.allModes,
      });
      await vi.waitFor(
        () => expect(sub(s, active.id).status).toBe("terminated"),
        WAIT,
      );
      expect(sub(s, active.id).termination).toMatchObject({
        reason: "forbidden",
        relist: "skipped",
        canResubscribe: false,
      });
      expect(() => s.resubscribe(active.id)).toThrow(/cannot be resumed/);
      await vi.waitFor(
        async () => expect((await stats(c)).openStreams).toBe(0),
        WAIT,
      );
    });

    it("ends a subscription the server refuses outright", async () => {
      const { c, s, types } = await setup();
      const incident = types.get(EVENT_TYPE_NAMES.allModes)!;
      await control(c, EVENTS_CONTROL_TOOL_NAMES.injectFailure, {
        preset: "error_resource_exhausted",
        method: "events/stream",
      });
      const created = s.subscribe(incident, { mode: "push" });
      await vi.waitFor(
        () => expect(sub(s, created.id).status).toBe("terminated"),
        WAIT,
      );
      expect(sub(s, created.id).termination).toMatchObject({
        reason: "rejected",
        error: { code: EVENTS_ERROR_CODES.ResourceExhausted },
      });
    });
  });
});
