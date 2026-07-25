/**
 * Modern (2026-07-28) task extension wire schemas — SEP-2663
 * (`io.modelcontextprotocol/tasks`).
 *
 * SDK v2 removed all built-in tasks support: the `Task` / `GetTaskResultSchema`
 * / `CreateTaskResultSchema` it still exports are the **deprecated 2025-11-25**
 * vocabulary (`ttl` / `pollInterval`, blocking `tasks/result`, `tasks/list`).
 * The redesigned extension is a different wire shape — `ttlMs` / `pollIntervalMs`,
 * a polymorphic `DetailedTask` that inlines `result` / `error` / `inputRequests`
 * by status, `tasks/get` polling, a new `tasks/update`, no `tasks/list`, and no
 * blocking `tasks/result`. There is no SDK schema for it, so the Inspector drives
 * modern `tasks/*` as raw requests with these explicit schemas (the "explicit-
 * schema raw-request form" the SDK docs prescribe).
 *
 * Schemas are intentionally permissive (`looseObject`) so an unknown wire field
 * (e.g. a future status-specific member) passes through rather than failing the
 * parse — the Inspector is a debugging tool and should surface, not reject.
 */

import { z } from "zod/v4";
import type { InputRequests, Task } from "@modelcontextprotocol/client";

/** SEP-2133 extension identifier for the redesigned Tasks extension (SEP-2663). */
export const TASKS_EXTENSION_KEY = "io.modelcontextprotocol/tasks";

/** The modern protocol revision, used as the raw-request envelope's
 * `protocolVersion` when the negotiated version isn't otherwise available. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/** The `_meta` value stamped on modern task-eligible requests to declare the
 * client supports the tasks extension (per-request capability, SEP-2663). */
export const TASKS_EXTENSION_CLIENT_CAPABILITY = {
  extensions: { [TASKS_EXTENSION_KEY]: {} },
} as const;

/**
 * `_meta` key under which the transport-level rewriter stashes a modern task
 * handle. SDK v2's codec rejects a `resultType: "task"` result outright (tasks
 * were removed), so a task-creating `tools/call` response is rewritten to a
 * benign `CallToolResult` carrying the real `DetailedTask` here, where the task
 * poll driver reads it. See `MessageTrackingTransport`'s rewrite hook.
 */
export const MODERN_TASK_HANDLE_META =
  "io.modelcontextprotocol/inspector/modernTaskHandle";

/** True when a decoded wire result is a modern `CreateTaskResult`
 * (`resultType: "task"`) — the frame the SDK codec cannot handle. */
export function isModernCreateTaskResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { resultType?: unknown }).resultType === "task" &&
    typeof (result as { taskId?: unknown }).taskId === "string"
  );
}

const ModernTaskStatusSchema = z.enum([
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * `DetailedTask` (SEP-2663): the modern task shape returned by `tasks/get` and
 * carried by a `CreateTaskResult`. Status-specific members (`result`, `error`,
 * `inputRequests`) are optional here because a single loose schema stands in for
 * the wire union `Working | InputRequired | Completed | Failed | Cancelled`.
 */
export const ModernDetailedTaskSchema = z.looseObject({
  taskId: z.string(),
  status: ModernTaskStatusSchema,
  statusMessage: z.string().optional(),
  createdAt: z.string(),
  lastUpdatedAt: z.string(),
  ttlMs: z.number().nullable().optional(),
  pollIntervalMs: z.number().optional(),
  /** Present on `completed`: the original request's result (e.g. CallToolResult). */
  result: z.record(z.string(), z.unknown()).optional(),
  /** Present on `failed`: the JSON-RPC error that ended the task. */
  error: z.record(z.string(), z.unknown()).optional(),
  /** Present on `input_required`: embedded server→client requests, keyed by id. */
  inputRequests: z.record(z.string(), z.unknown()).optional(),
});

export type ModernDetailedTask = z.infer<typeof ModernDetailedTaskSchema>;

/** `GetTaskResult = Result & DetailedTask`. Same fields we need as the task itself. */
export const ModernGetTaskResultSchema = ModernDetailedTaskSchema;

/** `CreateTaskResult = Result & Task` (`resultType: "task"`). The seed task state. */
export const ModernCreateTaskResultSchema = ModernDetailedTaskSchema;

/** `UpdateTaskResult` — an empty acknowledgement (`resultType: "complete"`). */
export const ModernUpdateTaskResultSchema = z.looseObject({});

/** `CancelTaskResult` — modern cancel acks with an empty/loose result. */
export const ModernCancelTaskResultSchema = z.looseObject({});

/**
 * Normalize a modern `DetailedTask` onto the internal (SDK 2025-11-25) `Task`
 * shape the state store, events, and `TaskCard` consume: `ttlMs` → `ttl`,
 * `pollIntervalMs` → `pollInterval`. The status-specific members
 * (`result` / `error` / `inputRequests`) ride along structurally so the poll
 * driver can read them; they are not part of the `Task` type but are harmless
 * extra properties on the object (the card renders the full task JSON).
 */
export function normalizeModernTask(modern: ModernDetailedTask): Task {
  const { ttlMs, pollIntervalMs, ...rest } = modern;
  const normalized: Record<string, unknown> = { ...rest };
  // The internal Task requires `ttl: number | null`; map the modern `ttlMs`
  // (which is itself `number | null`) straight across, defaulting to null.
  normalized.ttl = ttlMs ?? null;
  if (pollIntervalMs != null) normalized.pollInterval = pollIntervalMs;
  // The loose modern schema is a structural superset of the internal Task
  // (taskId/status/statusMessage/createdAt/lastUpdatedAt present; ttl/pollInterval
  // mapped above). No SDK schema relates the two nominal types, so a single
  // narrowing cast bridges the structurally-identical shape.
  return normalized as unknown as Task;
}

/** Read the embedded `inputRequests` map off a modern task, typed for
 * {@link fulfilInputRequests}. The loose parse yields `unknown` values; the
 * per-request `fulfilEmbeddedInputRequest` switch validates each by method. */
export function readInputRequests(
  modern: ModernDetailedTask,
): InputRequests | undefined {
  // Structural bridge: the loose record parse cannot express the InputRequests
  // union, but fulfilEmbeddedInputRequest validates each entry by its `method`.
  return modern.inputRequests as InputRequests | undefined;
}
