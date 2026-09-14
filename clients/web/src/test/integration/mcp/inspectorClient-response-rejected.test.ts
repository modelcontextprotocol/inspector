import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { MessageLogState } from "@inspector/core/mcp/state/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import type { MessageEntry } from "@inspector/core/mcp/types.js";

/**
 * `markResponseRejected` correlation (#1953).
 *
 * A response the server answered successfully but the client then refused (the
 * SDK codec rejecting the result for the negotiated era) carries no request id
 * in the SDK's error, so the client recovers it from the last response received
 * for that method. These tests drive a REAL connection so the correlation runs
 * against real JSON-RPC ids assigned by the SDK, not hand-built fixtures.
 */
describe("InspectorClient.markResponseRejected", () => {
  let client: InspectorClient | null = null;
  let log: MessageLogState | null = null;

  beforeEach(async () => {
    const serverCommand = getTestMcpServerCommand();
    client = new InspectorClient(
      {
        type: "stdio",
        command: serverCommand.command,
        args: serverCommand.args,
      },
      { environment: { transport: createTransportNode } },
    );
    log = new MessageLogState(client);
    await client.connect();
  });

  afterEach(async () => {
    log?.destroy();
    log = null;
    try {
      await client?.disconnect();
    } catch {
      // Ignore teardown failures — the assertion already ran.
    }
    client = null;
  });

  function entriesFor(method: string): MessageEntry[] {
    return (log?.getMessages() ?? []).filter(
      (entry) => "method" in entry.message && entry.message.method === method,
    );
  }

  it("annotates the entry for the method's most recent response", async () => {
    await client!.listTools();
    const before = entriesFor("tools/list");
    expect(before).toHaveLength(1);
    expect(before[0]?.clientError).toBeUndefined();

    client!.markResponseRejected("tools/list", "ttlMs required");

    expect(entriesFor("tools/list")[0]?.clientError).toBe("ttlMs required");
  });

  it("annotates only the latest call, leaving earlier ones untouched", async () => {
    await client!.listTools();
    await client!.listTools();
    const entries = entriesFor("tools/list");
    expect(entries).toHaveLength(2);

    client!.markResponseRejected("tools/list", "second one failed");

    expect(entries[0]?.clientError).toBeUndefined();
    expect(entries[1]?.clientError).toBe("second one failed");
  });

  it("does not cross method boundaries", async () => {
    await client!.listTools();
    await client!.listPrompts();

    client!.markResponseRejected("tools/list", "tools failed");

    expect(entriesFor("tools/list")[0]?.clientError).toBe("tools failed");
    expect(entriesFor("prompts/list")[0]?.clientError).toBeUndefined();
  });

  it("is a no-op for a method nothing has answered", () => {
    // No throw, and nothing annotated — a list that never reached the wire
    // (e.g. a capability-gated one) must not mislabel some other entry.
    expect(() =>
      client!.markResponseRejected("resources/list", "never happened"),
    ).not.toThrow();
    expect((log?.getMessages() ?? []).some((entry) => entry.clientError)).toBe(
      false,
    );
  });
});
