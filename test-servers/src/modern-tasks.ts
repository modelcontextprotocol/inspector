/**
 * Modern (2026-07-28) Tasks extension server — SEP-2663
 * (`io.modelcontextprotocol/tasks`).
 *
 * SDK v2 removed all built-in tasks support, and the redesigned extension is a
 * different wire shape than the deleted 2025-11-25 runtime (`ttlMs`/`pollIntervalMs`,
 * a polymorphic `DetailedTask` inlining `result`/`error`/`inputRequests`,
 * `tasks/get` polling, a new `tasks/update`, no `tasks/list`, no blocking
 * `tasks/result`). This module wires a minimal, poll-driven modern task runtime
 * by hand so an Inspector connecting with **Protocol Era = Modern** can exercise
 * the full flow: a task-augmented `tools/call` returns a `CreateTaskResult`
 * (`resultType: "task"`); the client polls `tasks/get`; an `input_required` task
 * surfaces an embedded elicitation the client answers via `tasks/update`; and
 * the completed task inlines its `CallToolResult`.
 *
 * The runtime is a single shared `Map` so it survives across the stateless
 * modern leg's per-request server instances (each `createMcpHandler` request
 * builds a fresh `McpServer`, but they share one runtime via the config).
 */

import * as z from "zod/v4";
import type { RequestHandler } from "express";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolDefinition } from "./composable-test-server.js";

/** SEP-2133 extension identifier for the redesigned Tasks extension. */
export const TASKS_EXTENSION_KEY = "io.modelcontextprotocol/tasks";

/** Names of the modern task-augmented tools whose `tools/call` returns a task. */
export const MODERN_TASK_TOOL_NAMES = new Set([
  "modern_task",
  "modern_input_task",
]);

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
/** `modern_task` reports `working` for this many `tasks/get` polls before completing. */
const SIMPLE_WORKING_POLLS = 2;

type ModernTaskStatus =
  "working" | "input_required" | "completed" | "failed" | "cancelled";

interface ModernTaskEntry {
  taskId: string;
  kind: "simple" | "input";
  status: ModernTaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  args: Record<string, unknown>;
  /** Remaining `working` polls for the simple task before it completes. */
  pollsRemaining: number;
  /** Set once the client answered the embedded elicitation via `tasks/update`. */
  inputSatisfied?: boolean;
  /** The `inputResponses` the client submitted, echoed back in the result. */
  inputResponses?: Record<string, unknown>;
}

/** The embedded elicitation an `input_required` modern task surfaces. Shaped as
 * a standalone `elicitation/create` request so the client's pending-request UI
 * (reused from the MRTR path) renders it and returns an `ElicitResult`. */
function confirmInputRequests(): Record<string, unknown> {
  return {
    confirm: {
      method: "elicitation/create",
      params: {
        message: "Approve this task before it continues?",
        requestedSchema: {
          type: "object",
          properties: {
            approved: {
              type: "boolean",
              title: "Approved",
              description: "Whether to proceed with the task",
            },
          },
          required: ["approved"],
        },
      },
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function newTaskId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  );
}

/**
 * Shared, in-memory modern task runtime. One instance is created per modern
 * server config and reused across the stateless leg's per-request servers, so a
 * task created by one `tools/call` request is visible to a later `tasks/get`.
 */
export class ModernTaskRuntime {
  private tasks = new Map<string, ModernTaskEntry>();

  /** Handle a task-augmented `tools/call`: durably create the task and return a
   * `CreateTaskResult` (`resultType: "task"`) seed. */
  createTask(
    toolName: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const now = nowIso();
    const entry: ModernTaskEntry = {
      taskId: newTaskId(),
      kind: toolName === "modern_input_task" ? "input" : "simple",
      status: "working",
      createdAt: now,
      lastUpdatedAt: now,
      args,
      pollsRemaining: SIMPLE_WORKING_POLLS,
    };
    this.tasks.set(entry.taskId, entry);
    return {
      resultType: "task",
      ...this.project(entry),
      statusMessage: "The operation is now in progress.",
    };
  }

  /** Serve `tasks/get`: advance the scripted lifecycle and return a
   * `DetailedTask` (`resultType: "complete"`). Throws on an unknown id. */
  getTask(taskId: string): Record<string, unknown> {
    const entry = this.requireTask(taskId);
    this.advance(entry);
    return { resultType: "complete", ...this.project(entry) };
  }

  /** Serve `tasks/update`: record the answered `inputResponses` and ack empty. */
  updateTask(
    taskId: string,
    inputResponses: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const entry = this.requireTask(taskId);
    entry.inputSatisfied = true;
    if (inputResponses) entry.inputResponses = inputResponses;
    this.touch(entry);
    return { resultType: "complete" };
  }

  /** Serve `tasks/cancel`: move the task to `cancelled` and ack empty. */
  cancelTask(taskId: string): Record<string, unknown> {
    const entry = this.requireTask(taskId);
    if (
      entry.status !== "completed" &&
      entry.status !== "failed" &&
      entry.status !== "cancelled"
    ) {
      entry.status = "cancelled";
      this.touch(entry);
    }
    return { resultType: "complete" };
  }

  private requireTask(taskId: string): ModernTaskEntry {
    const entry = this.tasks.get(taskId);
    if (!entry) throw new Error(`Unknown taskId: ${taskId}`);
    return entry;
  }

  private touch(entry: ModernTaskEntry): void {
    entry.lastUpdatedAt = nowIso();
  }

  /** Move a task one step along its scripted lifecycle on each poll. */
  private advance(entry: ModernTaskEntry): void {
    if (
      entry.status === "completed" ||
      entry.status === "failed" ||
      entry.status === "cancelled"
    ) {
      return;
    }
    if (entry.kind === "simple") {
      if (entry.pollsRemaining > 0) {
        entry.pollsRemaining -= 1;
      } else {
        entry.status = "completed";
      }
    } else {
      // input task: request input, then complete once the client has answered.
      entry.status = entry.inputSatisfied ? "completed" : "input_required";
    }
    this.touch(entry);
  }

  /** Project the internal entry onto the wire `DetailedTask`, inlining the
   * status-specific member (`result` / `inputRequests`). */
  private project(entry: ModernTaskEntry): Record<string, unknown> {
    const base: Record<string, unknown> = {
      taskId: entry.taskId,
      status: entry.status,
      createdAt: entry.createdAt,
      lastUpdatedAt: entry.lastUpdatedAt,
      ttlMs: DEFAULT_TTL_MS,
    };
    // The simple task advertises a poll interval; the input task omits it so a
    // client falls back to its own default cadence (both paths exercised).
    if (entry.kind === "simple") {
      base.pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    }
    if (entry.status === "input_required") {
      base.inputRequests = confirmInputRequests();
    }
    if (entry.status === "completed") {
      base.result = this.completedResult(entry);
    }
    return base;
  }

  /** The `CallToolResult` a completed task inlines (SEP-2663: no `tasks/result`). */
  private completedResult(entry: ModernTaskEntry): Record<string, unknown> {
    const detail =
      entry.kind === "input"
        ? `input=${JSON.stringify(entry.inputResponses ?? {})}`
        : `args=${JSON.stringify(entry.args ?? {})}`;
    return {
      content: [
        {
          type: "text",
          text: `Modern task ${entry.taskId} completed (${detail}).`,
        },
      ],
      isError: false,
    };
  }
}

/** The two plain tools whose `tools/call` the modern task handlers intercept.
 * Their handlers are placeholders — {@link wireModernTaskHandlers} routes these
 * names to the runtime before the SDK handler runs. */
export function createModernTaskTools(): ToolDefinition[] {
  const placeholder: ToolDefinition["handler"] = async () => ({
    content: [
      { type: "text" as const, text: "Task tool must be invoked as a task." },
    ],
    isError: true,
  });
  return [
    {
      name: "modern_task",
      description:
        "Create a modern (SEP-2663) task that reports progress over a few polls then completes.",
      inputSchema: {
        message: z
          .string()
          .optional()
          .describe("Text echoed back in the completed task result."),
      },
      handler: placeholder,
    },
    {
      name: "modern_input_task",
      description:
        "Create a modern task that pauses at input_required and completes after tasks/update.",
      inputSchema: {},
      handler: placeholder,
    },
  ];
}

interface RawHandlerHost {
  _requestHandlers: Map<
    string,
    (request: unknown, ctx: unknown) => Promise<unknown>
  >;
}

interface ToolsCallRequest {
  params: { name: string; arguments?: Record<string, unknown> };
}

interface TaskMethodRequest {
  params: {
    taskId: string;
    inputResponses?: Record<string, unknown>;
  };
}

/**
 * Wire the modern task methods by hand onto an `McpServer`:
 *  - override `tools/call` so a modern task tool returns a `CreateTaskResult`
 *    (`resultType: "task"`) and durably creates the task; ordinary tools fall
 *    through to the SDK handler;
 *  - register raw `tasks/get` / `tasks/update` / `tasks/cancel` handlers backed
 *    by the shared runtime. There is deliberately **no** `tasks/list` and **no**
 *    `tasks/result` (SEP-2663 removed both).
 *
 * The `tools/call` override is installed into the private handler registry (not
 * via `setRequestHandler`) so the `CreateTaskResult` skips the `Server`'s
 * `tools/call` result-schema validation — the same seam the legacy task server
 * uses. This goes away when the SDK models the tasks extension natively.
 */
export function wireModernTaskHandlers(
  mcpServer: McpServer,
  runtime: ModernTaskRuntime,
): void {
  const lowLevel = mcpServer.server;
  const registry = (lowLevel as unknown as RawHandlerHost)._requestHandlers;
  const sdkToolsCall = registry.get("tools/call");

  registry.set("tools/call", async (request, ctx) => {
    const req = request as ToolsCallRequest;
    if (MODERN_TASK_TOOL_NAMES.has(req.params.name)) {
      return runtime.createTask(req.params.name, req.params.arguments ?? {});
    }
    if (!sdkToolsCall) {
      throw new Error("tools/call handler is not initialized");
    }
    return sdkToolsCall(request, ctx);
  });

  registry.set("tasks/get", async (request) => {
    const req = request as TaskMethodRequest;
    return runtime.getTask(req.params.taskId);
  });

  registry.set("tasks/update", async (request) => {
    const req = request as TaskMethodRequest;
    return runtime.updateTask(req.params.taskId, req.params.inputResponses);
  });

  registry.set("tasks/cancel", async (request) => {
    const req = request as TaskMethodRequest;
    return runtime.cancelTask(req.params.taskId);
  });
}

const MODERN_TASK_METHODS = new Set([
  "tasks/get",
  "tasks/update",
  "tasks/cancel",
]);

interface TaskRpcBody {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { taskId?: string; inputResponses?: Record<string, unknown> };
}

/**
 * Express middleware that answers modern `tasks/get` / `tasks/update` /
 * `tasks/cancel` POSTs DIRECTLY, before the SDK's `createMcpHandler` sees them.
 * SDK v2's modern leg era-gates inbound spec methods, so `tasks/*` (spec-method
 * names removed from the 2026-07-28 era) would be answered `-32601 Method not
 * found` by the handler — a conformant server can't serve the extension through
 * the SDK. Intercepting at the HTTP layer is how the test server serves the
 * extension anyway (mirrors the `specErrorInjector` seam). `tasks` task
 * creation still flows through `tools/call` (a modern method) inside the handler.
 */
export function createModernTaskInterceptor(
  getRuntime: () => ModernTaskRuntime,
): RequestHandler {
  return (req, res, next) => {
    const body = req.body as TaskRpcBody | undefined;
    const method = body?.method;
    if (!method || !MODERN_TASK_METHODS.has(method)) {
      next();
      return;
    }
    const runtime = getRuntime();
    const id = body?.id ?? null;
    const taskId = body?.params?.taskId ?? "";
    try {
      let result: Record<string, unknown>;
      if (method === "tasks/get") {
        result = runtime.getTask(taskId);
      } else if (method === "tasks/update") {
        result = runtime.updateTask(taskId, body?.params?.inputResponses);
      } else {
        result = runtime.cancelTask(taskId);
      }
      res.json({ jsonrpc: "2.0", id, result });
    } catch (err) {
      res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: (err as Error).message },
      });
    }
  };
}
