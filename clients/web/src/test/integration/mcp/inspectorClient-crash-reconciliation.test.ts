/**
 * Mid-session crash reconciliation (#2437), driven by a real server process
 * that dies at a point the test picks.
 *
 * `InspectorClient` has a whole teardown route for a connection that ends
 * without `disconnect()` — the transport `onclose` in
 * `attachTransportListeners`: settle the status, drop the server's queued
 * sampling/elicitation requests before announcing the `disconnect`, reject
 * what we had asked the server, fire `disconnect` exactly once. Until this
 * file, that route was only reached by unit tests calling `onclose` on a fake
 * transport, so nothing checked it against what a real transport does when
 * the process at the other end goes away.
 *
 * The server is the stdio test server started with `--crashable`, which adds
 * a `crash_server` tool (see `createCrashServerTool`): `respond: false` exits
 * with the call still in flight, `respond: true` answers first and exits on an
 * idle session. It runs as its own process, so the exit is a real one.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import type {
  ConnectionStatus,
  InspectorClientOptions,
} from "@inspector/core/mcp/types.js";
import {
  CRASH_SERVER_TOOL_NAME,
  getCrashableTestMcpServerCommand,
  waitForEvent,
} from "@modelcontextprotocol/inspector-test-server";

/** One entry per teardown-relevant event, in dispatch order. */
type RecordedEvent =
  | { type: "statusChange"; status: ConnectionStatus }
  | { type: "disconnect"; pendingSamples: number; pendingElicitations: number }
  | { type: "pendingSamplesChange"; count: number }
  | { type: "pendingElicitationsChange"; count: number };

let client: InspectorClient | null = null;

function createCrashableClient(
  options: Partial<InspectorClientOptions> = {},
): InspectorClient {
  const { command, args } = getCrashableTestMcpServerCommand();
  return new InspectorClient(
    { type: "stdio", command, args },
    { environment: { transport: createTransportNode }, ...options },
  );
}

/**
 * Record the events the crash route dispatches, in order. The `disconnect`
 * entry snapshots both peer-request queues *as its listener sees them*, which
 * is the ordering guarantee under test: a consumer handling `disconnect`
 * already sees the queues empty.
 */
function recordEvents(target: InspectorClient): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  target.addEventListener("statusChange", (e) =>
    events.push({ type: "statusChange", status: e.detail }),
  );
  target.addEventListener("disconnect", () =>
    events.push({
      type: "disconnect",
      pendingSamples: target.getPendingSamples().length,
      pendingElicitations: target.getPendingElicitations().length,
    }),
  );
  target.addEventListener("pendingSamplesChange", (e) =>
    events.push({ type: "pendingSamplesChange", count: e.detail.length }),
  );
  target.addEventListener("pendingElicitationsChange", (e) =>
    events.push({ type: "pendingElicitationsChange", count: e.detail.length }),
  );
  return events;
}

async function getTool(target: InspectorClient, name: string): Promise<Tool> {
  const { tools } = await target.listTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

function countOf(events: RecordedEvent[], type: RecordedEvent["type"]) {
  return events.filter((e) => e.type === type).length;
}

/**
 * Exit with the `crash_server` call itself still in flight, handing back that
 * call's (rejecting) promise with its rejection already handled — so it
 * cannot surface as an unhandled rejection if an assertion fails first.
 *
 * Wrapped in an object because an `async` function returning a promise
 * adopts it: returned bare, awaiting this helper would rethrow the crash.
 */
async function crashWithCallInFlight(
  target: InspectorClient,
): Promise<{ call: Promise<unknown> }> {
  const crashTool = await getTool(target, CRASH_SERVER_TOOL_NAME);
  const call = target.callTool(crashTool, { respond: false });
  call.catch(() => {});
  return { call };
}

afterEach(async () => {
  // A crashed client is already torn down, but a test that failed before its
  // crash leaves a live process behind; `disconnect()` is safe either way.
  await client?.disconnect().catch(() => {});
  client = null;
});

describe("InspectorClient mid-session crash reconciliation (#2437)", () => {
  it("settles to disconnected and fires disconnect once when an idle session's server exits", async () => {
    client = createCrashableClient();
    await client.connect();
    const events = recordEvents(client);

    const disconnected = waitForEvent(client, "disconnect");
    const crashTool = await getTool(client, CRASH_SERVER_TOOL_NAME);
    const result = await client.callTool(crashTool, {
      respond: true,
      delayMs: 20,
    });
    expect(result.success).toBe(true);
    await disconnected;

    expect(client.getStatus()).toBe("disconnected");
    expect(events).toEqual([
      { type: "statusChange", status: "disconnected" },
      { type: "disconnect", pendingSamples: 0, pendingElicitations: 0 },
    ]);

    // An explicit disconnect() after the crash must not announce the
    // teardown a second time: the crash route already did.
    await client.disconnect();
    expect(countOf(events, "disconnect")).toBe(1);
    expect(client.getStatus()).toBe("disconnected");
  });

  it("rejects the call in flight when the server exits without answering it", async () => {
    client = createCrashableClient();
    await client.connect();
    const events = recordEvents(client);

    const disconnected = waitForEvent(client, "disconnect");
    const { call } = await crashWithCallInFlight(client);

    await expect(call).rejects.toThrow(/closed/i);
    await disconnected;
    expect(client.getStatus()).toBe("disconnected");
    expect(countOf(events, "disconnect")).toBe(1);
  });

  it("drops a pending elicitation and announces it before the disconnect", async () => {
    client = createCrashableClient({ elicit: true });
    await client.connect();

    const pendingArrived = waitForEvent(client, "newPendingElicitation");
    const elicitTool = await getTool(client, "collect_elicitation");
    const elicitCall = client.callTool(elicitTool, {
      message: "Never answered",
      schema: { type: "object", properties: { name: { type: "string" } } },
    });
    elicitCall.catch(() => {});
    await pendingArrived;
    expect(client.getPendingElicitations()).toHaveLength(1);

    const events = recordEvents(client);
    const disconnected = waitForEvent(client, "disconnect");
    await crashWithCallInFlight(client);
    await disconnected;

    expect(client.getPendingElicitations()).toHaveLength(0);
    // Cleared *and announced* before `disconnect`: the web pending-request
    // modal tracks its own state off the change event, so a clear without it
    // would leave the modal up for a connection that is gone.
    const dropped = events.findIndex(
      (e) => e.type === "pendingElicitationsChange" && e.count === 0,
    );
    const disconnect = events.findIndex((e) => e.type === "disconnect");
    expect(dropped).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeLessThan(disconnect);
    expect(events[disconnect]).toEqual({
      type: "disconnect",
      pendingSamples: 0,
      pendingElicitations: 0,
    });
    // The tool call that raised the elicitation dies with the connection.
    await expect(elicitCall).rejects.toThrow();
  });

  it("drops a pending sampling request and announces it before the disconnect", async () => {
    client = createCrashableClient({ sample: true });
    await client.connect();

    const pendingArrived = waitForEvent(client, "newPendingSample");
    const sampleTool = await getTool(client, "collect_sample");
    const sampleCall = client.callTool(sampleTool, { text: "Never answered" });
    sampleCall.catch(() => {});
    await pendingArrived;
    expect(client.getPendingSamples()).toHaveLength(1);

    const events = recordEvents(client);
    const disconnected = waitForEvent(client, "disconnect");
    await crashWithCallInFlight(client);
    await disconnected;

    expect(client.getPendingSamples()).toHaveLength(0);
    const dropped = events.findIndex(
      (e) => e.type === "pendingSamplesChange" && e.count === 0,
    );
    const disconnect = events.findIndex((e) => e.type === "disconnect");
    expect(dropped).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeLessThan(disconnect);
    expect(events[disconnect]).toEqual({
      type: "disconnect",
      pendingSamples: 0,
      pendingElicitations: 0,
    });
    await expect(sampleCall).rejects.toThrow();
  });

  it("captures what the server wrote to stderr on its way down", async () => {
    client = createCrashableClient({ pipeStderr: true });
    await client.connect();

    const lines: string[] = [];
    client.addEventListener("stderrLog", (e) => lines.push(e.detail.message));
    const disconnected = waitForEvent(client, "disconnect");
    const dyingWords = `fatal: crash-${Date.now()}`;
    const crashTool = await getTool(client, CRASH_SERVER_TOOL_NAME);
    const call = client.callTool(crashTool, { stderr: dyingWords });
    call.catch(() => {});
    await disconnected;

    // The child's stderr is read out-of-band from its exit, so allow the
    // chunk a moment to land rather than asserting on a single sample.
    await expect
      .poll(() => lines.some((line) => line.includes(dyingWords)))
      .toBe(true);
    await expect(call).rejects.toThrow();
  });

  it("reconnects the same client after a crash, against a fresh server process", async () => {
    client = createCrashableClient();
    await client.connect();
    const disconnected = waitForEvent(client, "disconnect");
    await crashWithCallInFlight(client);
    await disconnected;

    // The crash route leaves the transport object cached; the next connect()
    // has to bring up a new process through it rather than fail on the dead
    // one.
    await client.connect();
    expect(client.getStatus()).toBe("connected");
    expect(client.getCapabilities()?.tools).toBeDefined();

    // And the new session is live end to end: it can itself be crashed, and
    // that second crash is reconciled the same way as the first.
    const events = recordEvents(client);
    const disconnectedAgain = waitForEvent(client, "disconnect");
    await crashWithCallInFlight(client);
    await disconnectedAgain;
    expect(client.getStatus()).toBe("disconnected");
    expect(countOf(events, "disconnect")).toBe(1);
  });
});
