import { describe, it, expect, vi } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { ModernGetTaskResultSchema } from "@inspector/core/mcp/modernTaskSchemas.js";

/**
 * Unit coverage for the raw-wire request channel (#1631) that drives the modern
 * tasks/* methods the SDK v2 era gate refuses to send. Exercised directly (with
 * a fake transport) so the defensive branches — transport-null guard, send
 * rejection, timeout, error response, and disconnect cleanup — are deterministic
 * rather than dependent on server timing.
 */
describe("InspectorClient raw-wire channel (#1631)", () => {
  function makeClient(): InspectorClient {
    return new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      // environment.transport is only used on connect(); these tests never
      // connect, they poke the private raw-wire methods directly.
      { environment: { transport: () => ({}) as never } },
    );
  }

  interface RawWireInternals {
    transport: { send: (m: unknown) => Promise<void> } | null;
    requestTimeout?: number;
    rawWireRequest: (
      method: string,
      params: Record<string, unknown>,
      schema: { parse: (v: unknown) => unknown },
    ) => Promise<unknown>;
    consumeRawWireResponse: (message: unknown) => boolean;
    rejectPendingRawWireRequests: (reason: string) => void;
  }

  function internals(client: InspectorClient): RawWireInternals {
    return client as unknown as RawWireInternals;
  }

  it("throws when there is no transport", async () => {
    const client = makeClient();
    internals(client).transport = null;
    await expect(
      internals(client).rawWireRequest(
        "tasks/get",
        {},
        ModernGetTaskResultSchema,
      ),
    ).rejects.toThrow(/not connected/i);
  });

  it("resolves when a matching response is consumed", async () => {
    const client = makeClient();
    let sent: { id: string } | undefined;
    internals(client).transport = {
      send: vi.fn(async (m: unknown) => {
        sent = m as { id: string };
      }),
    };
    const promise = internals(client).rawWireRequest(
      "tasks/get",
      { taskId: "x" },
      ModernGetTaskResultSchema,
    );
    // Let the send microtask register the pending entry.
    await Promise.resolve();
    expect(sent?.id).toMatch(/^inspector-ext-/);
    const consumed = internals(client).consumeRawWireResponse({
      id: sent!.id,
      result: {
        taskId: "x",
        status: "completed",
        createdAt: "a",
        lastUpdatedAt: "b",
        ttlMs: null,
        result: { content: [] },
      },
    });
    expect(consumed).toBe(true);
    const result = (await promise) as { taskId: string };
    expect(result.taskId).toBe("x");
  });

  it("ignores a response id it does not own", () => {
    const client = makeClient();
    expect(
      internals(client).consumeRawWireResponse({ id: 42, result: {} }),
    ).toBe(false);
  });

  it("rejects when the response is an error", async () => {
    const client = makeClient();
    let sent: { id: string } | undefined;
    internals(client).transport = {
      send: vi.fn(async (m: unknown) => {
        sent = m as { id: string };
      }),
    };
    const promise = internals(client).rawWireRequest(
      "tasks/cancel",
      { taskId: "x" },
      ModernGetTaskResultSchema,
    );
    await Promise.resolve();
    internals(client).consumeRawWireResponse({
      id: sent!.id,
      error: { code: -32602, message: "Unknown taskId" },
    });
    await expect(promise).rejects.toThrow(/Unknown taskId/);
  });

  it("rejects when the transport send fails", async () => {
    const client = makeClient();
    internals(client).transport = {
      send: vi.fn().mockRejectedValue(new Error("socket closed")),
    };
    await expect(
      internals(client).rawWireRequest(
        "tasks/get",
        {},
        ModernGetTaskResultSchema,
      ),
    ).rejects.toThrow(/socket closed/);
  });

  it("rejects on timeout when no response arrives", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      internals(client).requestTimeout = 10;
      internals(client).transport = {
        send: vi.fn().mockResolvedValue(undefined),
      };
      const promise = internals(client).rawWireRequest(
        "tasks/get",
        {},
        ModernGetTaskResultSchema,
      );
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects all pending requests on teardown", async () => {
    const client = makeClient();
    internals(client).transport = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    const promise = internals(client).rawWireRequest(
      "tasks/get",
      {},
      ModernGetTaskResultSchema,
    );
    await Promise.resolve();
    internals(client).rejectPendingRawWireRequests("Disconnected");
    await expect(promise).rejects.toThrow(/Disconnected/);
  });
});
