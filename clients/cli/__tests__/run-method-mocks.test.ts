import { describe, it, expect, vi } from "vitest";
import { runMethod } from "../src/handlers/run-method.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

function mockClient(overrides: Partial<InspectorClient> = {}): InspectorClient {
  const base = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    subscribeToResource: vi.fn().mockResolvedValue(undefined),
    unsubscribeFromResource: vi.fn().mockResolvedValue(undefined),
    getCompletions: vi.fn().mockResolvedValue({ values: ["a"] }),
    getRequestorTask: vi.fn().mockResolvedValue({ taskId: "t1" }),
    cancelRequestorTask: vi.fn().mockResolvedValue(undefined),
    getRequestorTaskResult: vi.fn().mockResolvedValue({ content: [] }),
    updateRequestorTask: vi.fn().mockResolvedValue(undefined),
    getRoots: vi.fn().mockReturnValue([]),
    setRoots: vi.fn().mockResolvedValue(undefined),
    setLoggingLevel: vi.fn().mockResolvedValue(undefined),
    getServerInfo: vi.fn().mockReturnValue({ name: "t" }),
    getProtocolVersion: vi.fn().mockReturnValue("1"),
    getCapabilities: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(undefined),
    callTool: vi.fn(),
    callToolStream: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
  };
  return { ...base, ...overrides } as unknown as InspectorClient;
}

vi.mock("@inspector/core/mcp/state/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/mcp/state/index.js")>();
  class FakeManaged {
    setMetadata = vi.fn();
    refresh = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn();
    getTools = vi
      .fn()
      .mockReturnValue([
        { name: "echo", description: "e", inputSchema: { type: "object" } },
      ]);
    getResources = vi.fn().mockReturnValue([]);
    getResourceTemplates = vi.fn().mockReturnValue([]);
    getPrompts = vi.fn().mockReturnValue([{ name: "p" }]);
    getTasks = vi.fn().mockReturnValue([{ taskId: "t1" }]);
  }
  class FakeLog {
    static last: FakeLog | undefined;
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    destroy = vi.fn();
    constructor() {
      FakeLog.last = this;
    }
  }
  return {
    ...actual,
    ManagedToolsState: FakeManaged,
    ManagedResourcesState: FakeManaged,
    ManagedResourceTemplatesState: FakeManaged,
    ManagedPromptsState: FakeManaged,
    ManagedRequestorTasksState: FakeManaged,
    MessageLogState: FakeLog,
  };
});

describe("runMethod (mocked client)", () => {
  it("reference-counts same-URI subscribe streams", async () => {
    const client = mockClient();
    const s1 = await runMethod(client, {
      method: "resources/subscribe",
      uri: "test://x",
    });
    const s2 = await runMethod(client, {
      method: "resources/subscribe",
      uri: "test://x",
    });
    // Both streams share one core subscription.
    expect(client.subscribeToResource).toHaveBeenCalledTimes(1);
    expect(s1.kind).toBe("stream");
    expect(s2.kind).toBe("stream");
    if (s1.kind === "stream" && s2.kind === "stream") {
      const stop1 = s1.start(() => {});
      const stop2 = s2.start(() => {});
      stop1();
      // The survivor keeps the subscription alive.
      expect(client.unsubscribeFromResource).not.toHaveBeenCalled();
      stop2();
      expect(client.unsubscribeFromResource).toHaveBeenCalledTimes(1);
    }

    // A rejected unsubscribe (e.g. after daemon disconnectAll) is caught at
    // the source instead of surfacing as an unhandled rejection.
    const failing = mockClient({
      unsubscribeFromResource: vi
        .fn()
        .mockRejectedValue(new Error("client closed")),
    } as Partial<InspectorClient>);
    const s3 = await runMethod(failing, {
      method: "resources/subscribe",
      uri: "test://y",
    });
    if (s3.kind === "stream") {
      s3.start(() => {})();
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(failing.unsubscribeFromResource).toHaveBeenCalledTimes(1);
  });

  it("rejects explicit unsubscribe while subscribe streams share the URI", async () => {
    const client = mockClient();
    const sub = await runMethod(client, {
      method: "resources/subscribe",
      uri: "test://shared",
    });
    expect(sub.kind).toBe("stream");
    const stop = sub.kind === "stream" ? sub.start(() => {}) : () => {};

    // Tearing down the shared subscription out from under the open stream
    // (and double-unsubscribing later) is refused with guidance.
    await expect(
      runMethod(client, {
        method: "resources/unsubscribe",
        uri: "test://shared",
      }),
    ).rejects.toThrow(/active resources\/subscribe stream/);
    expect(client.unsubscribeFromResource).not.toHaveBeenCalled();

    // Once the last stream closes, its cleanup unsubscribes and an explicit
    // unsubscribe is allowed again.
    stop();
    expect(client.unsubscribeFromResource).toHaveBeenCalledTimes(1);
    const out = await runMethod(client, {
      method: "resources/unsubscribe",
      uri: "test://shared",
    });
    expect(out.kind).toBe("result");
    expect(client.unsubscribeFromResource).toHaveBeenCalledTimes(2);
  });

  it("covers subscribe stream, tasks, complete, and app-info call", async () => {
    const client = mockClient({
      callTool: vi.fn().mockResolvedValue({
        result: { content: [{ type: "text", text: "ok" }] },
        toolName: "echo",
        params: {},
        timestamp: new Date(),
        success: true,
      }),
      callToolStream: vi.fn().mockResolvedValue({
        result: { content: [] },
        toolName: "echo",
        params: {},
        timestamp: new Date(),
        success: true,
      }),
      readResource: vi.fn().mockResolvedValue({
        result: { contents: [] },
      }),
    });

    const sub = await runMethod(client, {
      method: "resources/subscribe",
      uri: "test://x",
    });
    expect(sub.kind).toBe("stream");
    if (sub.kind === "stream") {
      const lines: unknown[] = [];
      const stop = sub.start((o) => lines.push(o));
      expect(lines[0]).toMatchObject({ type: "subscribed" });
      // Simulate update event
      const listener = (
        client.addEventListener as ReturnType<typeof vi.fn>
      ).mock.calls.find((c) => c[0] === "resourceUpdated")?.[1] as (
        ev: Event,
      ) => void;
      listener?.(
        new CustomEvent("resourceUpdated", { detail: { uri: "test://x" } }),
      );
      // Updates for other URIs on the same connection are filtered out.
      listener?.(
        new CustomEvent("resourceUpdated", { detail: { uri: "test://other" } }),
      );
      const updated = lines.filter(
        (l) => (l as { type?: string }).type === "resources/updated",
      );
      expect(updated).toEqual([{ type: "resources/updated", uri: "test://x" }]);
      stop();
    }

    const tasks = await runMethod(client, { method: "tasks/list" });
    expect(tasks.kind).toBe("result");

    const got = await runMethod(client, {
      method: "tasks/get",
      taskId: "t1",
    });
    expect(got.kind).toBe("result");

    const cancelled = await runMethod(client, {
      method: "tasks/cancel",
      taskId: "t1",
    });
    expect(cancelled.kind).toBe("result");

    const result = await runMethod(client, {
      method: "tasks/result",
      taskId: "t1",
    });
    expect(result.kind).toBe("result");

    const updated = await runMethod(client, {
      method: "tasks/update",
      taskId: "t1",
      inputResponsesJson: '{"confirm":{"approved":true}}',
    });
    expect(updated.kind).toBe("result");
    if (updated.kind === "result") {
      expect(updated.result).toMatchObject({ updated: true, taskId: "t1" });
    }
    expect(client.updateRequestorTask).toHaveBeenCalledWith("t1", {
      confirm: { approved: true },
    });

    const complete = await runMethod(client, {
      method: "prompts/complete",
      completeRefType: "ref/prompt",
      completeRef: "p",
      completeArgName: "a",
      completeArgValue: "x",
    });
    expect(complete.kind).toBe("result");

    const completeRes = await runMethod(client, {
      method: "prompts/complete",
      completeRefType: "ref/resource",
      completeRef: "test://x",
      completeArgName: "a",
    });
    expect(completeRes.kind).toBe("result");

    const appOnly = await runMethod(client, {
      method: "tools/call",
      toolName: "echo",
      appInfo: true,
    });
    expect(appOnly.kind).toBe("result");

    const tasked = await runMethod(client, {
      method: "tools/call",
      toolName: "echo",
      task: true,
      toolArg: { message: "x" },
    });
    expect(tasked.kind).toBe("result");
    expect(client.callToolStream).toHaveBeenCalled();

    vi.mocked(client.callTool).mockResolvedValueOnce({
      result: null,
      error: "Tool call failed hard",
      toolName: "echo",
      params: {},
      timestamp: new Date(),
      success: false,
    } as never);
    const nullResult = await runMethod(client, {
      method: "tools/call",
      toolName: "echo",
      toolArg: { message: "x" },
    });
    expect(nullResult.kind).toBe("result");
    if (nullResult.kind === "result") {
      expect(nullResult.result).toMatchObject({ isError: true });
    }

    await expect(runMethod(client, { method: "tasks/cancel" })).rejects.toThrow(
      /tasks\/cancel/,
    );
    await expect(runMethod(client, { method: "tasks/result" })).rejects.toThrow(
      /tasks\/result/,
    );

    await expect(runMethod(client, { method: "tasks/update" })).rejects.toThrow(
      /tasks\/update/,
    );
    await expect(
      runMethod(client, { method: "tasks/update", taskId: "t1" }),
    ).rejects.toThrow(/--input-responses/);
    await expect(
      runMethod(client, {
        method: "tasks/update",
        taskId: "t1",
        inputResponsesJson: "not-json",
      }),
    ).rejects.toThrow(/--input-responses is invalid/);
    await expect(
      runMethod(client, {
        method: "tasks/update",
        taskId: "t1",
        inputResponsesJson: "[1,2,3]",
      }),
    ).rejects.toThrow(/--input-responses is invalid/);
    // 1e999 parses as Infinity, which serialization would silently send as
    // null — reject it instead of answering with a different value.
    await expect(
      runMethod(client, {
        method: "tasks/update",
        taskId: "t1",
        inputResponsesJson: '{"a":{"b":[1e999]}}',
      }),
    ).rejects.toThrow(/no JSON representation/);

    await expect(
      runMethod(client, {
        method: "roots/set",
        rootsJson: "not-json",
      }),
    ).rejects.toThrow(/roots-json is invalid/);

    const tail = await runMethod(client, { method: "logging/tail" });
    expect(tail.kind).toBe("stream");
    if (tail.kind === "stream") {
      const lines: unknown[] = [];
      const stop = tail.start((o) => lines.push(o));
      const logMod = await import("@inspector/core/mcp/state/index.js");
      const FakeLog = logMod.MessageLogState as unknown as {
        last?: {
          addEventListener: ReturnType<typeof vi.fn>;
        };
      };
      const listener = FakeLog.last?.addEventListener.mock.calls[0]?.[1] as
        | ((ev: Event) => void)
        | undefined;
      listener?.(
        new CustomEvent("message", {
          detail: {
            direction: "notification",
            message: { method: "notifications/message" },
          },
        }),
      );
      listener?.(
        new CustomEvent("message", {
          detail: { direction: "request", message: { method: "tools/list" } },
        }),
      );
      expect(lines).toHaveLength(1);
      stop();
    }
  });
});
