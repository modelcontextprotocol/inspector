/**
 * The Events extension in the Node runners (#3032): the one-shot CLI's
 * `events/list` and `events/poll`, and the `events/stream` the connection CLI
 * runs through the same `runMethod`.
 *
 * Driven against the phase 0 fixture (`test-servers/configs/events-*.json`)
 * over a real Streamable HTTP transport. The fixture enforces the routing
 * headers — a named `events/*` request without `Mcp-Name`, or with a wrong
 * `Mcp-Param-Region`, is answered 400 — so a successful poll of the annotated
 * type is itself the proof that both reach the wire from the CLI path too.
 *
 * The protocol and the subscription engine are tested where they live (the web
 * suite's `inspectorClient-events` and `eventSubscriptions` tests); what these
 * pin is the CLI's framing of them.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/client";
import {
  createTestServerHttp,
  loadConfig,
  resolveConfig,
  EVENT_TYPE_NAMES,
  EVENTS_CONTROL_TOOL_NAMES,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import { runMethod } from "@inspector/core/cli/handlers/run-method.js";
import {
  eventStreamLine,
  eventsStreamOutcome,
} from "@inspector/core/cli/handlers/events.js";
import { EXIT_CODES } from "@inspector/core/cli/error-handler.js";
import {
  isOneShotMethod,
  CONNECTION_RPC_METHODS,
} from "@inspector/core/cli/handlers/method-types.js";
import type { EventLogEntry } from "@inspector/core/mcp/state/index.js";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliFailure, expectCliSuccess } from "./helpers/assertions.js";

const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test-servers/configs",
);
const MODERN_CONFIG = path.join(configsDir, "events-modern-http.json");
const LEGACY_CONFIG = path.join(configsDir, "events-legacy-http.json");

/** Every visible type, in the fixture's order; `invalid.header` is excluded. */
const LISTED = [
  EVENT_TYPE_NAMES.pollOnly,
  EVENT_TYPE_NAMES.pushOnly,
  EVENT_TYPE_NAMES.allModes,
  EVENT_TYPE_NAMES.headerAnnotated,
];

let server: TestServerHttp | null = null;
const clients: InspectorClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.disconnect().catch(() => {});
  }
  await server?.stop().catch(() => {});
  server = null;
});

async function startFixture(configPath = MODERN_CONFIG): Promise<string> {
  const started = createTestServerHttp({
    ...resolveConfig(loadConfig(configPath)),
    port: undefined,
  });
  await started.start();
  server = started;
  return started.url;
}

/** A modern-era client of the fixture, for driving its control tools. */
async function connect(url: string): Promise<InspectorClient> {
  const client = new InspectorClient(
    { type: "streamable-http", url },
    {
      environment: { transport: createTransportNode },
      versionNegotiation: eraToVersionNegotiation("modern"),
    },
  );
  clients.push(client);
  await client.connect();
  return client;
}

async function control(
  client: InspectorClient,
  name: string,
  args: Record<string, string | number> = {},
): Promise<void> {
  const tools = (await client.listAllTools()).tools;
  const tool = tools.find((t: Tool) => t.name === name);
  if (!tool) throw new Error(`fixture tool ${name} not listed`);
  const result = await client.callTool(tool, args);
  expect(result.success).toBe(true);
}

function cli(url: string, ...args: string[]) {
  return runCli([
    url,
    "--transport",
    "http",
    "--protocol-era",
    "modern",
    ...args,
  ]);
}

describe("method sets (#3032)", () => {
  it("admits events/list and events/poll to the one-shot CLI, not the stream", () => {
    expect(isOneShotMethod("events/list")).toBe(true);
    expect(isOneShotMethod("events/poll")).toBe(true);
    expect(isOneShotMethod("events/stream")).toBe(false);
  });

  it("offers all three to the connection CLI", () => {
    expect(CONNECTION_RPC_METHODS).toEqual(
      expect.arrayContaining(["events/list", "events/poll", "events/stream"]),
    );
  });
});

describe("one-shot CLI against the fixture (#3032)", () => {
  it("lists every page, with the excluded type and its reason", async () => {
    const url = await startFixture();
    const result = await cli(url, "--method", "events/list");
    expectCliSuccess(result);
    const json = JSON.parse(result.stdout) as {
      events: { name: string; delivery: string[] }[];
      excluded: { name: string; reason: string }[];
    };
    expect(json.events.map((e) => e.name)).toEqual(LISTED);
    expect(json.excluded).toEqual([
      { name: EVENT_TYPE_NAMES.invalidHeader, reason: expect.any(String) },
    ]);
  });

  it("polls from a cursor and prints the whole result, cursor included", async () => {
    const url = await startFixture();
    const control_ = await connect(url);
    await control(control_, EVENTS_CONTROL_TOOL_NAMES.emit, {
      name: EVENT_TYPE_NAMES.pollOnly,
      count: 2,
    });

    const result = await cli(
      url,
      "--method",
      "events/poll",
      "--event-name",
      EVENT_TYPE_NAMES.pollOnly,
      "--cursor",
      "cur_0",
    );
    expectCliSuccess(result);
    const json = JSON.parse(result.stdout) as {
      events: { name: string; data: Record<string, unknown> }[];
      cursor: string;
      hasMore: boolean;
      truncated: boolean;
      nextPollMs: number;
    };
    expect(json.events).toHaveLength(2);
    expect(json.events.every((e) => e.name === EVENT_TYPE_NAMES.pollOnly)).toBe(
      true,
    );
    expect(json.cursor).toBe("cur_2");
    expect(json.hasMore).toBe(false);
    expect(json.truncated).toBe(false);
    expect(json.nextPollMs).toBeTypeOf("number");

    // Passing the cursor back picks up where the last poll ended.
    const next = await cli(
      url,
      "--method",
      "events/poll",
      "--event-name",
      EVENT_TYPE_NAMES.pollOnly,
      "--cursor",
      json.cursor,
    );
    expectCliSuccess(next);
    expect((JSON.parse(next.stdout) as { events: unknown[] }).events).toEqual(
      [],
    );
  });

  it("sends --event-arg as the subscription arguments, mirrored into Mcp-Param-*", async () => {
    // The fixture answers 400 HeaderMismatch when `Mcp-Param-Region` and
    // `arguments.region` disagree, so a result proves both were sent.
    const url = await startFixture();
    const result = await cli(
      url,
      "--method",
      "events/poll",
      "--event-name",
      EVENT_TYPE_NAMES.headerAnnotated,
      "--event-arg",
      "region=us-west1",
      "env=prod",
    );
    expectCliSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({ events: [] });
  });

  it("refuses a type that does not advertise poll delivery", async () => {
    const url = await startFixture();
    const result = await cli(
      url,
      "--method",
      "events/poll",
      "--event-name",
      EVENT_TYPE_NAMES.pushOnly,
    );
    expectCliFailure(result);
    expect(result.stderr).toContain("does not advertise poll delivery");
  });

  it("names the reason when the type was excluded for its x-mcp-header", async () => {
    const url = await startFixture();
    const result = await cli(
      url,
      "--method",
      "events/poll",
      "--event-name",
      EVENT_TYPE_NAMES.invalidHeader,
    );
    expectCliFailure(result);
    expect(result.stderr).toContain("was excluded from events/list");
  });

  it("refuses an unknown type, and a poll with no name", async () => {
    const url = await startFixture();
    const unknown = await cli(
      url,
      "--method",
      "events/poll",
      "--event-name",
      "no.such.type",
    );
    expectCliFailure(unknown);
    expect(unknown.stderr).toContain("not found on server");

    const unnamed = await cli(url, "--method", "events/poll");
    expectCliFailure(unnamed);
    expect(unnamed.stderr).toContain("--event-name");
  });

  it("refuses events/* on a legacy-era connection without sending one", async () => {
    const url = await startFixture(LEGACY_CONFIG);
    const result = await runCli([
      url,
      "--transport",
      "http",
      "--method",
      "events/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("io.modelcontextprotocol/events");

    // The fixture counts every events/* request that arrived without a modern
    // envelope; the refusal happened before anything reached the wire.
    const stats = new InspectorClient(
      { type: "streamable-http", url },
      { environment: { transport: createTransportNode } },
    );
    clients.push(stats);
    await stats.connect();
    const tool = (await stats.listAllTools()).tools.find(
      (t) => t.name === EVENTS_CONTROL_TOOL_NAMES.stats,
    );
    const out = await stats.callTool(tool!, {});
    expect(
      (out.result?.structuredContent as { legacyRequests: number })
        .legacyRequests,
    ).toBe(0);
  });

  it("does not accept events/stream as a one-shot method", async () => {
    const url = await startFixture();
    const result = await cli(url, "--method", "events/stream");
    expectCliFailure(result);
    expect(result.stderr).toContain("Unsupported method: events/stream");
  });
});

describe("events/stream through runMethod (#3032)", () => {
  type Line = Record<string, unknown>;

  async function openStream(
    client: InspectorClient,
    eventName: string,
    cursor?: string,
  ) {
    const outcome = await runMethod(client, {
      method: "events/stream",
      eventName,
      ...(cursor !== undefined && { cursor }),
    });
    if (outcome.kind !== "stream") throw new Error("expected a stream");
    const lines: Line[] = [];
    const end = vi.fn();
    const stop = outcome.start((line) => lines.push(line as Line), end);
    return { lines, end, stop, label: outcome.label };
  }

  it("writes subscribed, active and each event, then stops on request", async () => {
    const url = await startFixture();
    const client = await connect(url);
    const { lines, end, stop, label } = await openStream(
      client,
      EVENT_TYPE_NAMES.allModes,
    );
    expect(label).toBe("events/stream");
    expect(lines[0]).toEqual({
      type: "subscribed",
      name: EVENT_TYPE_NAMES.allModes,
      mode: "push",
      arguments: {},
    });
    await vi.waitFor(() =>
      expect(lines.some((l) => l.type === "active")).toBe(true),
    );
    const active = lines.find((l) => l.type === "active")!;
    expect(active).toMatchObject({ name: EVENT_TYPE_NAMES.allModes });
    expect(active.heartbeatMs).toBeTypeOf("number");

    await control(client, EVENTS_CONTROL_TOOL_NAMES.emit, {
      name: EVENT_TYPE_NAMES.allModes,
      count: 2,
    });
    await vi.waitFor(() =>
      expect(lines.filter((l) => l.type === "event")).toHaveLength(2),
    );
    const event = lines.find((l) => l.type === "event")!;
    expect(event).toMatchObject({
      name: EVENT_TYPE_NAMES.allModes,
      eventId: expect.any(String),
      data: expect.any(Object),
      at: expect.any(String),
    });

    stop();
    stop(); // a second stop is a no-op
    expect(end).not.toHaveBeenCalled();
  });

  it("ends the stream on its own when the server terminates it", async () => {
    const url = await startFixture();
    const client = await connect(url);
    const { lines, end } = await openStream(client, EVENT_TYPE_NAMES.allModes);
    await vi.waitFor(() =>
      expect(lines.some((l) => l.type === "active")).toBe(true),
    );

    await control(client, EVENTS_CONTROL_TOOL_NAMES.removeType, {
      name: EVENT_TYPE_NAMES.allModes,
    });
    await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    expect(lines.at(-1)).toMatchObject({
      type: "terminated",
      reason: "removed",
      error: { code: -32023 },
    });
  });

  it("is not cancelled by another command's ambient request signal", async () => {
    // The mcpdo daemon scopes an ambient abort signal to each command (#1783).
    // A stream opened (or reconnecting) while one is set must not inherit it:
    // cancelling that unrelated command would otherwise abort the stream.
    const url = await startFixture();
    const client = await connect(url);
    const command = new AbortController();
    const clearScope = client.setAmbientRequestSignal(command.signal);
    const { lines, stop } = await openStream(client, EVENT_TYPE_NAMES.allModes);
    await vi.waitFor(() =>
      expect(lines.some((l) => l.type === "active")).toBe(true),
    );
    command.abort();
    clearScope();
    await control(client, EVENTS_CONTROL_TOOL_NAMES.emit, {
      name: EVENT_TYPE_NAMES.allModes,
    });
    await vi.waitFor(() =>
      expect(lines.some((l) => l.type === "event")).toBe(true),
    );
    expect(
      lines.some((l) => l.type === "reconnect" || l.type === "error"),
    ).toBe(false);
    stop();
  });

  it("refuses a type that does not advertise push delivery", async () => {
    const url = await startFixture();
    const client = await connect(url);
    await expect(
      runMethod(client, {
        method: "events/stream",
        eventName: EVENT_TYPE_NAMES.pollOnly,
      }),
    ).rejects.toMatchObject({
      exitCode: EXIT_CODES.USAGE,
      message: expect.stringContaining("does not advertise push delivery"),
    });
  });
});

describe("eventsStreamOutcome (#3032)", () => {
  it("rethrows a refused subscribe after releasing the engine", () => {
    // The connection stopped offering Events between resolving the type and
    // starting the stream: the engine's own gate refuses the subscribe.
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const client = {
      addEventListener,
      removeEventListener,
      getEventsExtension: () => undefined,
      // Double cast: a stub of the three members this path reads. The engine
      // and the outcome touch nothing else before the refusal, and a full
      // InspectorClient would need a live connection to reach this state.
    } as unknown as InspectorClient;
    const outcome = eventsStreamOutcome(
      client,
      { name: "x", delivery: ["push"], inputSchema: { type: "object" } },
      { cursor: "cur_0" },
    );
    if (outcome.kind !== "stream") throw new Error("expected a stream");
    const lines: unknown[] = [];
    expect(() => outcome.start((line) => lines.push(line))).toThrow(
      /does not offer the Events extension/,
    );
    expect(lines).toEqual([
      { type: "subscribed", name: "x", mode: "push", arguments: {} },
    ]);
    // Every listener the engine attached to the client was detached again.
    expect(removeEventListener).toHaveBeenCalledTimes(
      addEventListener.mock.calls.length,
    );
  });
});

describe("eventStreamLine (#3032)", () => {
  const at = new Date("2026-11-24T10:00:00.000Z");
  const base = { seq: 1, at, subscription: "key" };
  const error = { code: -32024, message: "Forbidden" };

  it.each<[EventLogEntry, Record<string, unknown>]>([
    [
      { ...base, kind: "gap", cursor: "cur_9" },
      { type: "gap", cursor: "cur_9", at: at.toISOString() },
    ],
    [
      { ...base, kind: "error", error },
      { type: "error", error, at: at.toISOString() },
    ],
    [
      { ...base, kind: "reconnect", reason: "stream ended" },
      { type: "reconnect", reason: "stream ended", at: at.toISOString() },
    ],
    [
      { ...base, kind: "terminated", reason: "forbidden", error },
      {
        type: "terminated",
        reason: "forbidden",
        error,
        at: at.toISOString(),
      },
    ],
  ])("frames a %#th marker entry", (entry, line) => {
    expect(eventStreamLine(entry)).toEqual(line);
  });

  it("keeps its own framing fields over an occurrence's extra ones", () => {
    // The occurrence schema is loose, so a server-sent `type` survives
    // parsing; it must not relabel the line.
    const line = eventStreamLine({
      ...base,
      kind: "event",
      occurrence: {
        eventId: "e1",
        name: "t",
        timestamp: at.toISOString(),
        data: {},
        type: "terminated",
        at: "spoofed",
        payloadError: "spoofed",
        payload: "invalid",
      },
      payload: "valid",
    });
    expect(line.type).toBe("event");
    expect(line.at).toBe(at.toISOString());
    // No validation failure was reported, so none is claimed.
    expect(JSON.parse(JSON.stringify(line))).not.toHaveProperty("payloadError");
    expect(line.payload).toBe("valid");
  });

  it("keeps a payload validation failure on the event line", () => {
    const occurrence = {
      eventId: "e1",
      name: "t",
      timestamp: at.toISOString(),
      data: { a: 1 },
    };
    expect(
      eventStreamLine({
        ...base,
        kind: "event",
        occurrence,
        payload: "invalid",
        payloadError: "missing a",
      }),
    ).toEqual({
      type: "event",
      ...occurrence,
      payload: "invalid",
      payloadError: "missing a",
      at: at.toISOString(),
    });
  });
});
