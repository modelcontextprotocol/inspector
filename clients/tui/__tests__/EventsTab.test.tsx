/**
 * The Events tab (#3032): rendering and keys against static props, then the
 * same tab fed by the real stores over a real connection to the phase 0
 * Events fixture — poll and push subscriptions started, delivering, and
 * stopped from the keyboard.
 *
 * Every wait is on an observable condition (`vi.waitFor` on the frame or a
 * spy), never a fixed sleep.
 */
import React from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "./helpers/renderTui";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import type {
  EventLogEntry,
  EventSubscription,
} from "@inspector/core/mcp/state/index.js";
import {
  EventSubscriptionsState,
  ManagedEventsState,
} from "@inspector/core/mcp/state/index.js";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import {
  useEventLog,
  useEventSubscriptions,
} from "@inspector/core/react/useEventSubscriptions.js";
import { useStoreSnapshot } from "@inspector/core/react/useStoreSnapshot.js";

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { EventsTab } from "../src/components/EventsTab.js";

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const type = (name: string, delivery = ["poll", "push"]): EventType => ({
  name,
  description: `${name} happened`,
  delivery,
  inputSchema: { type: "object" },
});

const NO_COUNTS = {
  events: 0,
  duplicates: 0,
  invalidPayloads: 0,
  gaps: 0,
  errors: 0,
  reconnects: 0,
};

const sub = (
  id: string,
  name: string,
  status: EventSubscription["status"],
): EventSubscription => ({
  id,
  name,
  mode: "poll",
  arguments: {},
  eventType: type(name),
  status,
  cursor: null,
  startedAt: new Date(0),
  counts: NO_COUNTS,
});

function renderTab(
  props: Partial<React.ComponentProps<typeof EventsTab>> = {},
) {
  const onSubscribe = vi.fn();
  const onStop = vi.fn();
  const onClearLog = vi.fn();
  const api = render(
    <EventsTab
      eventTypes={[type("a.first"), type("b.second")]}
      subscriptions={[]}
      log={[]}
      width={120}
      height={30}
      focusedPane="list"
      onSubscribe={onSubscribe}
      onStop={onStop}
      onClearLog={onClearLog}
      {...props}
    />,
  );
  return { ...api, onSubscribe, onStop, onClearLog };
}

describe("EventsTab (static props)", () => {
  it("lists the types and details the selected one", () => {
    const { lastFrame } = renderTab();
    const frame = lastFrame()!;
    expect(frame).toContain("Event types (2)");
    expect(frame).toContain("▶ a.first");
    expect(frame).toContain("a.first happened");
    expect(frame).toContain("Delivery: poll, push");
    expect(frame).toContain("Subscriptions (0):");
    expect(frame).toContain("None — press Enter to subscribe");
    expect(frame).toContain("Nothing delivered yet");
    expect(frame).toContain("Input Schema:");
  });

  it("moves the selection, and opens the dialog for it on Enter", async () => {
    const { stdin, lastFrame, onSubscribe } = renderTab();
    stdin.write(DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ b.second"));
    stdin.write(UP);
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ a.first"));
    stdin.write(UP); // already at the top
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(onSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ name: "a.first" }),
      ),
    );
  });

  it("stops only the selected type's live subscriptions on x", async () => {
    const { stdin, onStop } = renderTab({
      subscriptions: [
        sub("live", "a.first", "active"),
        sub("old", "a.first", "stopped"),
        sub("other", "b.second", "active"),
      ],
    });
    stdin.write("x");
    await vi.waitFor(() => expect(onStop).toHaveBeenCalledWith(["live"]));
  });

  it("does nothing on x when nothing is live, and clears the log on l", async () => {
    const { stdin, onStop, onClearLog } = renderTab({
      subscriptions: [sub("old", "a.first", "stopped")],
    });
    stdin.write("x");
    stdin.write("l");
    await vi.waitFor(() => expect(onClearLog).toHaveBeenCalledTimes(1));
    expect(onStop).not.toHaveBeenCalled();
  });

  it("marks a type with a live subscription and shows its log lines", () => {
    const at = new Date("2026-11-24T10:11:12.000Z");
    const log: EventLogEntry[] = [
      {
        seq: 1,
        at,
        subscription: "live",
        kind: "event",
        occurrence: {
          eventId: "e1",
          name: "a.first",
          timestamp: "t",
          data: {},
        },
      },
      {
        seq: 2,
        at,
        subscription: "other",
        kind: "gap",
        cursor: null,
      },
      {
        seq: 3,
        at,
        subscription: "live",
        kind: "terminated",
        reason: "forbidden",
        error: { code: -32024, message: "nope" },
      },
    ];
    const ended: EventSubscription = {
      ...sub("live", "a.first", "terminated"),
      termination: {
        reason: "forbidden",
        error: { code: -32024, message: "nope" },
        at,
        relist: "skipped",
        canResubscribe: false,
      },
    };
    const { lastFrame } = renderTab({
      subscriptions: [ended, sub("other", "b.second", "active")],
      log,
    });
    const frame = lastFrame()!;
    expect(frame).toContain("b.second ●");
    expect(frame).not.toContain("a.first ●");
    expect(frame).toContain("Occurrences (2):");
    expect(frame).toContain("10:11:12 e1 {}");
    expect(frame).toContain("Terminated (forbidden): nope");
    // The other type's gap is not this type's.
    expect(frame).not.toContain("gap:");
  });

  it("keeps a removed type listed, with its history, and does not resubscribe it", async () => {
    const { stdin, lastFrame, onSubscribe, onClearLog } = renderTab({
      eventTypes: [type("a.first")],
      subscriptions: [sub("old", "gone.type", "terminated")],
    });
    expect(lastFrame()).toContain("Event types (1)");
    expect(lastFrame()).toContain("gone.type (removed)");
    stdin.write(DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ gone.type"));
    expect(lastFrame()).toContain("no longer listed by the server");
    expect(lastFrame()).toContain("poll · terminated");
    stdin.write("\r");
    stdin.write("l"); // a key it does take, proving Enter was delivered first
    await vi.waitFor(() => expect(onClearLog).toHaveBeenCalled());
    expect(onSubscribe).not.toHaveBeenCalled();
  });

  it("scrolls the details pane without moving the selection", async () => {
    const { stdin, lastFrame } = renderTab({ focusedPane: "details" });
    for (const key of [DOWN, UP, PAGE_DOWN, PAGE_UP]) stdin.write(key);
    stdin.write("q"); // not a key the tab binds
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ a.first"));
  });

  it("says why the list is empty, or why it failed", () => {
    expect(renderTab({ eventTypes: [] }).lastFrame()).toContain(
      "No event types available",
    );
    expect(renderTab({ eventTypes: [] }).lastFrame()).toContain(
      "Select an event type to view details",
    );
    expect(
      renderTab({ loadError: new Error("events/list failed") }).lastFrame(),
    ).toContain("events/list failed");
  });

  it("ignores keys while a dialog is open or the tab is unfocused", async () => {
    const open = renderTab({ modalOpen: true });
    open.stdin.write("\r");
    const unfocused = renderTab({ focusedPane: null });
    unfocused.stdin.write("\r");
    // A third render that does take the key proves the writes were delivered.
    const live = renderTab();
    live.stdin.write("\r");
    await vi.waitFor(() => expect(live.onSubscribe).toHaveBeenCalled());
    expect(open.onSubscribe).not.toHaveBeenCalled();
    expect(unfocused.onSubscribe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Against the fixture
// ---------------------------------------------------------------------------

/**
 * The slice of the test-server package this file uses. The TUI's test
 * tsconfig does not compile that package's source — it needs Express's types,
 * which this install does not carry — so the package is loaded at run time,
 * through the alias `vitest.shared.mts` gives every client, and typed here.
 */
interface TestServerHttp {
  url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}
interface TestServerPackage {
  createTestServerHttp(config: object): TestServerHttp;
  loadConfig(configPath: string): object;
  resolveConfig(config: object): object;
}
const TEST_SERVER_PACKAGE = "@modelcontextprotocol/inspector-test-server";
async function loadTestServers(): Promise<TestServerPackage> {
  const loaded: unknown = await import(/* @vite-ignore */ TEST_SERVER_PACKAGE);
  return loaded as TestServerPackage;
}

/** The fixture's stable names (`EVENT_TYPE_NAMES` / control tool names). */
const POLL_ONLY = "email.received";
const PUSH_ONLY = "build.finished";
const EMIT_TOOL = "emit_event";

const MODERN_CONFIG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test-servers/configs/events-modern-http.json",
);

const NO_TYPES: EventType[] = [];
const readTypes = (state: ManagedEventsState) => state.getEventTypes();

/** The tab as `App` feeds it: real stores, read through the real hooks. */
function Harness({
  types,
  engine,
}: {
  types: ManagedEventsState;
  engine: EventSubscriptionsState;
}) {
  const eventTypes = useStoreSnapshot(
    types,
    "eventTypesChange",
    readTypes,
    NO_TYPES,
  );
  const subscriptions = useEventSubscriptions(engine);
  const log = useEventLog(engine);
  return (
    <EventsTab
      eventTypes={eventTypes}
      subscriptions={subscriptions}
      log={log}
      width={160}
      height={40}
      focusedPane="list"
      onSubscribe={(eventType) =>
        engine.subscribe(eventType, {
          mode: eventType.delivery.includes("poll") ? "poll" : "push",
        })
      }
      onStop={(ids) => ids.forEach((id) => engine.stop(id))}
      onClearLog={() => engine.clearLog()}
    />
  );
}

describe("EventsTab against the Events fixture", () => {
  let server: TestServerHttp | null = null;
  let client: InspectorClient | null = null;
  let stores: {
    types: ManagedEventsState;
    engine: EventSubscriptionsState;
  } | null = null;

  afterEach(async () => {
    stores?.engine.destroy();
    stores?.types.destroy();
    stores = null;
    await client?.disconnect().catch(() => {});
    client = null;
    await server?.stop().catch(() => {});
    server = null;
  });

  async function start() {
    const fixtures = await loadTestServers();
    server = fixtures.createTestServerHttp({
      ...fixtures.resolveConfig(fixtures.loadConfig(MODERN_CONFIG)),
      port: undefined,
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
      },
    );
    const types = new ManagedEventsState(client);
    const engine = new EventSubscriptionsState(client, {
      relist: () => types.refresh(),
    });
    stores = { types, engine };
    await client.connect();
    return { client, types, engine };
  }

  async function emit(c: InspectorClient, name: string) {
    const tool = (await c.listAllTools()).tools.find(
      (t) => t.name === EMIT_TOOL,
    );
    if (!tool) throw new Error("emit_event not listed");
    const result = await c.callTool(tool, { name });
    expect(result.success).toBe(true);
  }

  it("runs a poll and a push subscription from the keyboard", async () => {
    const { client: c, types, engine } = await start();
    const { stdin, lastFrame } = render(
      <Harness types={types} engine={engine} />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("Event types (4)"));

    // email.received (poll only) is first: Enter subscribes, then an emitted
    // occurrence reaches the log on the next poll.
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(lastFrame()).toMatch(/poll · active · cursor cur_\d+/),
    );
    await emit(c, POLL_ONLY);
    await vi.waitFor(() => expect(lastFrame()).toContain("Occurrences (1):"), {
      timeout: 5000,
    });
    expect(lastFrame()).toContain("email.received ●");

    // x stops it; it stays listed as stopped.
    stdin.write("x");
    await vi.waitFor(() => expect(lastFrame()).toContain("poll · stopped"));
    expect(lastFrame()).not.toContain("email.received ●");

    // build.finished (push only) is second: the stream is confirmed active,
    // then an occurrence arrives live.
    stdin.write(DOWN);
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ build.finished"));
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(lastFrame()).toMatch(/push · active · cursor null · heartbeat/),
    );
    await emit(c, PUSH_ONLY);
    await vi.waitFor(() => expect(lastFrame()).toContain("Occurrences (1):"));
    expect(lastFrame()).toMatch(/\d\d:\d\d:\d\d \S+ \{"buildId":/);

    stdin.write("x");
    await vi.waitFor(() => expect(lastFrame()).toContain("push · stopped"));
  });
});
