import { describe, it, expect, vi } from "vitest";
import {
  ProtocolError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import {
  DispatchError,
  JsonRpcResponseError,
} from "@modelcontextprotocol/ext-tasks/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { TaskWithOptionalCreatedAt } from "@inspector/core/mcp/inspectorClientEventTarget.js";
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
    transport: {
      send: (
        message: unknown,
        options?: {
          headers?: Readonly<Record<string, string>>;
          requestSignal?: AbortSignal;
        },
      ) => Promise<void>;
    } | null;
    requestTimeout?: number;
    dispatchTaskRequest: (
      request: unknown,
      options?: {
        signal?: AbortSignal;
        context?: {
          headers?: Readonly<Record<string, string>>;
          requestTimeoutMs?: number;
        };
      },
    ) => Promise<unknown>;
    rawWireRequest: (
      method: string,
      params: Record<string, unknown>,
      schema: { parse: (v: unknown) => unknown },
    ) => Promise<unknown>;
    consumeRawWireResponse: (message: unknown) => boolean;
    rejectPendingRawWireRequests: (reason: string) => void;
  }

  interface TaskSessionCallOptions {
    requestTimeoutMs?: number;
    metadata?: Readonly<Record<string, unknown>>;
    task: { preference: "allow" | "prefer"; retentionMs?: number };
  }

  interface TaskExecutionSettleOptions {
    signal?: AbortSignal;
    onEvent: (event: unknown) => void;
  }

  interface TaskBoundaryInternals {
    client: object | null;
    protocolEra?: "legacy" | "modern";
    taskSession: {
      callTool: (
        name: string,
        args: Readonly<Record<string, unknown>>,
        options: TaskSessionCallOptions,
      ) => Promise<{
        settle: (
          options: TaskExecutionSettleOptions,
        ) => Promise<{ outcome: unknown; lastTask?: unknown }>;
      }>;
    } | null;
    taskInputOrigin: (
      delivery: "peer-request" | "request-retry" | "task-update",
    ) => "server-request" | "input-required" | "task-input-required";
    emitTaskExecutionEvent: (event: unknown) => unknown;
    emitTaskError: (lastTask: unknown, reason: unknown) => void;
    dispatchTaskProgress: (notification: unknown) => void;
  }

  function internals(client: InspectorClient): RawWireInternals {
    return client as unknown as RawWireInternals;
  }

  function taskInternals(client: InspectorClient): TaskBoundaryInternals {
    // Private session fields deliberately have no public mutation API; this narrow
    // structurally matching cast injects only the ext-tasks boundary under test.
    return client as unknown as TaskBoundaryInternals;
  }

  const taskTool: Tool = {
    name: "boundary_task",
    description: "Exercises the Inspector/ext-tasks boundary",
    inputSchema: { type: "object" },
  };

  const successfulResult: CallToolResult = {
    content: [{ type: "text", text: "done" }],
  };

  function attachTaskBoundary(
    client: InspectorClient,
    callTool: NonNullable<TaskBoundaryInternals["taskSession"]>["callTool"],
  ): void {
    const boundary = taskInternals(client);
    boundary.client = {};
    boundary.protocolEra = "modern";
    boundary.taskSession = { callTool };
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
        resultType: "complete",
        taskId: "x",
        status: "completed",
        createdAt: "a",
        lastUpdatedAt: "b",
        ttlMs: null,
        result: { resultType: "complete", content: [] },
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

  it("honors the ext-tasks operation timeout context", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      internals(client).requestTimeout = 10_000;
      internals(client).transport = {
        send: vi.fn().mockResolvedValue(undefined),
      };
      const promise = internals(client).dispatchTaskRequest(
        { method: "tasks/get" },
        { context: { requestTimeoutMs: 25 } },
      );
      const assertion = expect(promise).rejects.toThrow(/25 ms/);
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the SDK 60-second default when no timeout is configured", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      internals(client).transport = {
        send: vi.fn().mockResolvedValue(undefined),
      };
      const promise = internals(client).dispatchTaskRequest({
        method: "tasks/get",
      });
      let settled = false;
      void promise.catch(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      const assertion = expect(promise).rejects.toThrow(/60000 ms/);
      await vi.advanceTimersByTimeAsync(30_000);
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

  it.each([
    [null, /JSON object/],
    ["not-an-object", /JSON object/],
    [7, /JSON object/],
    [[], /JSON object/],
    [{ method: 42 }, /method must be a string/],
    [{ method: "tasks/get", params: null }, /params must be a JSON object/],
    [{ method: "tasks/get", params: [] }, /params must be a JSON object/],
    [{ method: "tasks/get", params: "bad" }, /params must be a JSON object/],
    [{ method: "tasks/get", params: 7 }, /params must be a JSON object/],
  ])("validates ext-tasks dispatch input %#", async (request, message) => {
    const client = makeClient();
    internals(client).transport = {
      send: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      internals(client).dispatchTaskRequest(request),
    ).rejects.toThrow(message);
  });

  it("rejects a dispatch that is already aborted without sending", async () => {
    const client = makeClient();
    const send = vi.fn().mockResolvedValue(undefined);
    internals(client).transport = { send };
    const controller = new AbortController();
    controller.abort(new Error("stop before dispatch"));

    await expect(
      internals(client).dispatchTaskRequest(
        { method: "tasks/get", params: { taskId: "x" } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/stop before dispatch/);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the standard abort error for a non-Error reason", async () => {
    const client = makeClient();
    const send = vi.fn().mockResolvedValue(undefined);
    internals(client).transport = { send };
    const controller = new AbortController();
    controller.abort("stop");

    await expect(
      internals(client).dispatchTaskRequest(
        { method: "tasks/get" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(send).not.toHaveBeenCalled();
  });

  it("frames an omitted-params dispatch and forwards headers and its signal", async () => {
    const client = makeClient();
    let sent: { id: string; method: string; params?: unknown } | undefined;
    let sendOptions:
      | {
          headers?: Readonly<Record<string, string>>;
          requestSignal?: AbortSignal;
        }
      | undefined;
    internals(client).transport = {
      send: vi.fn(async (message, options) => {
        sent = message as { id: string; method: string; params?: unknown };
        sendOptions = options;
      }),
    };
    const controller = new AbortController();
    const promise = internals(client).dispatchTaskRequest(
      { method: "tasks/list" },
      {
        signal: controller.signal,
        context: { headers: { "x-route": "blue" } },
      },
    );
    await Promise.resolve();

    expect(sent).toEqual({
      jsonrpc: "2.0",
      id: expect.stringMatching(/^inspector-ext-/),
      method: "tasks/list",
    });
    expect(sendOptions).toEqual({
      headers: { "x-route": "blue" },
      requestSignal: controller.signal,
    });
    internals(client).consumeRawWireResponse({ id: sent!.id, result: {} });
    await expect(promise).resolves.toEqual({ kind: "result", result: {} });
  });

  it("aborts an in-flight dispatch and ignores its late response", async () => {
    const client = makeClient();
    let sentId = "";
    internals(client).transport = {
      send: vi.fn(async (message) => {
        sentId = (message as { id: string }).id;
      }),
    };
    const controller = new AbortController();
    const promise = internals(client).dispatchTaskRequest(
      { method: "tasks/get", params: { taskId: "x" } },
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort(new Error("stop in flight"));

    await expect(promise).rejects.toThrow(/stop in flight/);
    expect(
      internals(client).consumeRawWireResponse({ id: sentId, result: {} }),
    ).toBe(false);
  });

  it("ignores a transport rejection after abort already settled the dispatch", async () => {
    const client = makeClient();
    let rejectSend: ((reason: unknown) => void) | undefined;
    internals(client).transport = {
      send: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSend = reject;
          }),
      ),
    };
    const controller = new AbortController();
    const promise = internals(client).dispatchTaskRequest(
      { method: "tasks/get" },
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort(new Error("caller stopped"));
    await expect(promise).rejects.toThrow("caller stopped");

    rejectSend?.(new Error("late socket failure"));
    await Promise.resolve();
  });

  it("normalizes a non-Error transport rejection", async () => {
    const client = makeClient();
    internals(client).transport = {
      send: vi.fn().mockRejectedValue("socket vanished"),
    };
    await expect(
      internals(client).dispatchTaskRequest({ method: "tasks/get" }),
    ).rejects.toThrow("socket vanished");
  });

  it.each([
    [{ retryAfter: 5 }, { retryAfter: 5 }],
    [10n, undefined],
  ])("projects serializable error data %#", async (data, expectedData) => {
    const client = makeClient();
    let sentId = "";
    internals(client).transport = {
      send: vi.fn(async (message) => {
        sentId = (message as { id: string }).id;
      }),
    };
    const promise = internals(client).dispatchTaskRequest({
      method: "tasks/get",
    });
    await Promise.resolve();
    internals(client).consumeRawWireResponse({
      id: sentId,
      error: { code: -32001, message: "task failed", data },
    });

    await expect(promise).resolves.toEqual({
      kind: "error",
      error: {
        code: -32001,
        message: "task failed",
        ...(expectedData === undefined ? {} : { data: expectedData }),
      },
    });
  });

  it("rejects a non-JSON raw result", async () => {
    const client = makeClient();
    let sentId = "";
    internals(client).transport = {
      send: vi.fn(async (message) => {
        sentId = (message as { id: string }).id;
      }),
    };
    const promise = internals(client).dispatchTaskRequest({
      method: "tasks/get",
    });
    await Promise.resolve();
    internals(client).consumeRawWireResponse({ id: sentId, result: 10n });

    await expect(promise).rejects.toThrow(/non-JSON result/);
  });

  it.each([
    [undefined, "allow", undefined],
    [{ ttl: 2500 }, "prefer", 2500],
  ] as const)(
    "maps %s task options to the ext-tasks preference contract",
    async (taskOptions, expectedPreference, expectedRetention) => {
      const client = makeClient();
      internals(client).requestTimeout = 12_345;
      const settle = vi.fn(async (options: TaskExecutionSettleOptions) => {
        options.onEvent({
          type: "task",
          task: {
            taskId: "task-preference",
            status: "working",
            lastUpdatedAt: "2026-01-02T03:04:05.000Z",
          },
        });
        options.onEvent({
          type: "outcome",
          outcome: {
            status: "completed",
            result: successfulResult,
            task: {
              taskId: "task-preference",
              status: "completed",
              createdAt: "2026-01-02T03:04:05.000Z",
            },
          },
        });
        return {
          outcome: { status: "completed", result: successfulResult },
        };
      });
      const callTool = vi.fn(async () => ({ settle }));
      attachTaskBoundary(client, callTool);
      const updates: Array<{
        task: TaskWithOptionalCreatedAt;
        result?: CallToolResult;
      }> = [];
      client.addEventListener("requestorTaskUpdated", (event) => {
        updates.push(event.detail);
      });

      const invocation = await client.callTool(
        taskTool,
        {},
        undefined,
        undefined,
        taskOptions,
      );

      expect(invocation.result).toEqual(successfulResult);
      expect(callTool).toHaveBeenCalledWith(
        taskTool.name,
        {},
        expect.objectContaining({
          requestTimeoutMs: 12_345,
          task: {
            preference: expectedPreference,
            retentionMs: expectedRetention,
          },
        }),
      );
      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({
          onEvent: expect.any(Function),
        }),
      );
      expect(updates).toEqual([
        {
          taskId: "task-preference",
          task: expect.objectContaining({
            createdAt: "2026-01-02T03:04:05.000Z",
            lastUpdatedAt: "2026-01-02T03:04:05.000Z",
          }),
        },
        {
          taskId: "task-preference",
          task: expect.objectContaining({
            createdAt: "2026-01-02T03:04:05.000Z",
            lastUpdatedAt: "2026-01-02T03:04:05.000Z",
          }),
          result: successfulResult,
        },
      ]);
    },
  );

  it("delivers raw-call progress before a task snapshot and releases the token", async () => {
    const client = makeClient();
    const progress: unknown[] = [];
    client.addEventListener("progressNotification", (event) => {
      progress.push(event.detail);
    });
    let progressToken: string | number | undefined;
    attachTaskBoundary(
      client,
      vi.fn(async (_name, _args, options) => {
        progressToken = options.metadata?.progressToken as
          | string
          | number
          | undefined;
        taskInternals(client).dispatchTaskProgress({
          method: "notifications/progress",
          params: { progressToken, progress: 1, total: 2 },
        });
        return {
          settle: vi.fn(async () => ({
            outcome: { status: "completed", result: successfulResult },
          })),
        };
      }),
    );

    const invocation = await client.callTool(taskTool, {});

    expect(invocation.metadata?.progressToken).toBe(progressToken);
    expect(progress).toEqual([{ progressToken, progress: 1, total: 2 }]);
    taskInternals(client).dispatchTaskProgress({
      method: "notifications/progress",
      params: { progressToken, progress: 2, total: 2 },
    });
    expect(progress).toHaveLength(1);
  });

  const makeBoundaryClient = (
    options?: ConstructorParameters<typeof InspectorClient>[1],
  ): InspectorClient =>
    new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      options ?? { environment: { transport: () => ({}) as never } },
    );

  it("omits the progress token when progress is disabled", async () => {
    const client = makeBoundaryClient({
      environment: { transport: () => ({}) as never },
      progress: false,
    });
    let sentMetadata: Readonly<Record<string, unknown>> | undefined;
    attachTaskBoundary(
      client,
      vi.fn(async (_name, _args, options) => {
        sentMetadata = options.metadata;
        return {
          settle: vi.fn(async () => ({
            outcome: { status: "completed", result: successfulResult },
          })),
        };
      }),
    );

    const invocation = await client.callTool(taskTool, {});

    expect(sentMetadata?.progressToken).toBeUndefined();
    expect(invocation.metadata?.progressToken).toBeUndefined();
  });

  it("reuses a caller progress token across concurrent raw calls", async () => {
    const client = makeBoundaryClient();
    let releaseSettle: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSettle = resolve;
    });
    const callTool = vi.fn(async () => ({
      settle: vi.fn(async (options: TaskExecutionSettleOptions) => {
        options.onEvent({
          type: "task",
          task: {
            taskId: "shared-token",
            status: "working",
            lastUpdatedAt: "2026-01-02T03:04:05.000Z",
          },
        });
        await gate;
        return {
          outcome: { status: "completed", result: successfulResult },
        };
      }),
    }));
    attachTaskBoundary(client, callTool);
    const progresses: unknown[] = [];
    client.addEventListener("progressNotification", (event) => {
      progresses.push(event.detail);
    });

    const sharedToken = "caller-token";
    const first = client.callTool(
      taskTool,
      {},
      {
        progressToken: sharedToken,
      },
    );
    const second = client.callTool(
      taskTool,
      {},
      {
        progressToken: sharedToken,
      },
    );
    await vi.waitFor(() => expect(callTool).toHaveBeenCalledTimes(2));
    taskInternals(client).dispatchTaskProgress({
      method: "notifications/progress",
      params: { progressToken: sharedToken, progress: 1 },
    });
    expect(progresses).toHaveLength(1);

    releaseSettle?.();
    const [firstDone, secondDone] = await Promise.all([first, second]);
    expect(firstDone.metadata?.progressToken).toBe(sharedToken);
    expect(secondDone.metadata?.progressToken).toBe(sharedToken);

    taskInternals(client).dispatchTaskProgress({
      method: "notifications/progress",
      params: { progressToken: sharedToken, progress: 2 },
    });
    expect(progresses).toHaveLength(1);
  });

  it("projects a task-scoped failure onto the public task event", async () => {
    const client = makeClient();
    attachTaskBoundary(
      client,
      vi.fn(async () => ({
        settle: vi.fn(async (options: TaskExecutionSettleOptions) => {
          options.onEvent({
            type: "task",
            task: {
              taskId: "task-failed",
              status: "working",
              createdAt: "2026-01-02T03:04:05.000Z",
              lastUpdatedAt: "2026-01-02T03:04:06.000Z",
            },
          });
          throw new Error("worker exploded");
        }),
      })),
    );
    const updates: Array<{ error?: Error }> = [];
    client.addEventListener("requestorTaskUpdated", (event) => {
      updates.push(event.detail);
    });

    await expect(client.callTool(taskTool, {})).rejects.toThrow(
      "worker exploded",
    );
    expect(updates.at(-1)?.error?.message).toBe("worker exploded");
  });

  it("enforces and can explicitly bypass output validation on task results", async () => {
    const client = makeClient();
    const invalidResult: CallToolResult = {
      content: [],
      structuredContent: { count: "not-a-number" },
    };
    attachTaskBoundary(
      client,
      vi.fn(async () => ({
        settle: vi.fn(async () => ({
          outcome: { status: "completed", result: invalidResult },
        })),
      })),
    );
    const toolWithOutput: Tool = {
      ...taskTool,
      outputSchema: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      },
    };

    await expect(client.callTool(toolWithOutput, {})).rejects.toThrow(
      /output schema|must be number/i,
    );
    const advisory = await client.callTool(
      toolWithOutput,
      {},
      undefined,
      undefined,
      undefined,
      { skipOutputValidation: true },
    );
    expect(advisory.success).toBe(true);
    expect(advisory.outputValidationError).toMatch(
      /output schema|must be number/i,
    );
  });

  it("projects every ext-tasks event and input-origin boundary", () => {
    const client = makeClient();
    const boundary = taskInternals(client);
    expect(
      ["peer-request", "request-retry", "task-update"].map((delivery) =>
        boundary.taskInputOrigin(
          delivery as "peer-request" | "request-retry" | "task-update",
        ),
      ),
    ).toEqual(["server-request", "input-required", "task-input-required"]);

    const updates: Array<{
      task: TaskWithOptionalCreatedAt;
      result?: CallToolResult;
      error?: Error;
    }> = [];
    client.addEventListener("requestorTaskUpdated", (event) => {
      updates.push(event.detail);
    });

    expect(
      boundary.emitTaskExecutionEvent({
        type: "outcome",
        outcome: { status: "cancelled" },
      }),
    ).toBeUndefined();
    boundary.emitTaskError(undefined, "ignored without a task");

    const emptyTimestampTask = {
      taskId: "task-projection",
      status: "working",
    };
    expect(
      boundary.emitTaskExecutionEvent({
        type: "task",
        task: emptyTimestampTask,
      }),
    ).toEqual({
      ...emptyTimestampTask,
      createdAt: "",
      lastUpdatedAt: "",
    });
    boundary.emitTaskExecutionEvent({
      type: "outcome",
      outcome: {
        status: "failed",
        error: "string failure",
        task: { ...emptyTimestampTask, status: "failed" },
      },
    });
    boundary.emitTaskExecutionEvent({
      type: "outcome",
      outcome: {
        status: "cancelled",
        task: { ...emptyTimestampTask, status: "cancelled" },
      },
    });

    expect(updates).toHaveLength(3);
    expect(updates[1]?.error?.message).toBe("string failure");
    expect(updates[2]?.result).toBeUndefined();
    expect(updates[2]?.error).toBeUndefined();
  });

  it("restores DispatchError cause identity from ext-tasks", async () => {
    const client = makeClient();
    const cause = new Error("host transport failed");
    attachTaskBoundary(
      client,
      vi.fn(async () => ({
        settle: vi.fn(async () => {
          throw new DispatchError("dispatch policy wrapper", false, { cause });
        }),
      })),
    );

    await expect(client.callTool(taskTool, {})).rejects.toBe(cause);
  });

  it("preserves ext-tasks protocol error code and data", async () => {
    const client = makeClient();
    const errorData = { reason: "task rejected" };
    attachTaskBoundary(
      client,
      vi.fn(async () => ({
        settle: vi.fn(async (options: TaskExecutionSettleOptions) => {
          options.onEvent({
            type: "task",
            task: {
              taskId: "task-protocol-error",
              status: "working",
              createdAt: "2026-01-02T03:04:05.000Z",
              lastUpdatedAt: "2026-01-02T03:04:05.000Z",
            },
          });
          throw new JsonRpcResponseError({
            code: -32099,
            message: "Task protocol failure",
            data: errorData,
          });
        }),
      })),
    );
    const taskErrors: ProtocolError[] = [];
    client.addEventListener("requestorTaskUpdated", (event) => {
      if (event.detail.error) taskErrors.push(event.detail.error);
    });

    const rejection = client.callTool(taskTool, {});

    await expect(rejection).rejects.toMatchObject({
      code: -32099,
      data: errorData,
    });
    expect(taskErrors.at(-1)).toMatchObject({
      code: -32099,
      data: errorData,
    });
  });
  it("validates output from the public streaming task path", async () => {
    const client = makeClient();
    const invalidResult: CallToolResult = {
      content: [],
      structuredContent: { count: "not-a-number" },
    };
    attachTaskBoundary(
      client,
      vi.fn(async () => ({
        settle: vi.fn(async () => ({
          outcome: { status: "completed", result: invalidResult },
        })),
      })),
    );
    const toolWithOutput: Tool = {
      ...taskTool,
      outputSchema: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      },
    };

    await expect(client.callToolStream(toolWithOutput, {})).rejects.toThrow(
      /output schema|must be number/i,
    );
    const advisory = await client.callToolStream(
      toolWithOutput,
      {},
      undefined,
      undefined,
      undefined,
      { skipOutputValidation: true },
    );
    expect(advisory.outputValidationError).toMatch(
      /output schema|must be number/i,
    );
  });

  it("stringifies a non-Error streaming task failure", async () => {
    const client = makeClient();
    attachTaskBoundary(
      client,
      vi.fn(async () => {
        throw "worker vanished";
      }),
    );
    const invocations: Array<{ error?: string }> = [];
    client.addEventListener("toolCallResultChange", (event) => {
      invocations.push(event.detail);
    });

    await expect(client.callToolStream(taskTool, {})).rejects.toBe(
      "worker vanished",
    );
    expect(invocations.at(-1)?.error).toBe("worker vanished");
  });
});
