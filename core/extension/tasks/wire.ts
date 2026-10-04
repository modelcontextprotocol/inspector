/**
 * Pure conversions between the Inspector's SDK-typed values and the JSON
 * shapes ext-tasks takes and returns: the tool-result codec, JSON-object
 * projection, related-task `_meta` stamping, the task view the UI renders, and
 * the pending-request origin for an input exchange. No state, no I/O — each is
 * input → output, which is what lets the session wiring in `InspectorClient`
 * stay a thin composition of them.
 */
import { CallToolResultSchema } from "@modelcontextprotocol/core";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { withRelatedTaskMetadata } from "@modelcontextprotocol/ext-tasks/client";
import type {
  ResolvedInputExchangeContext,
  TaskView,
} from "@modelcontextprotocol/ext-tasks/client";
import {
  runtimeCodecFromStandardSchema,
  taskId as extTaskId,
  toJsonValue,
} from "@modelcontextprotocol/ext-tasks/core";
import type { JsonValue as TasksJsonValue } from "@modelcontextprotocol/ext-tasks/core";
import type { InspectorTask, PendingRequestOrigin } from "../../mcp/types.js";

export type TasksJsonObject = Readonly<Record<string, TasksJsonValue>>;

/** Validates a task's terminal `tools/call` payload with the SDK's own schema. */
export const taskToolResultCodec =
  runtimeCodecFromStandardSchema<CallToolResult>({
    "~standard": {
      version: 1,
      vendor: "mcp-inspector",
      validate(value) {
        const result = CallToolResultSchema.safeParse(value);
        return result.success
          ? { value: result.data as CallToolResult }
          : {
              issues: result.error.issues.map(({ message }) => ({ message })),
            };
      },
    },
  });

/** Project a value to a JSON object, throwing when it is not one. */
export function jsonObject(value: unknown): TasksJsonObject {
  const json = toJsonValue(value);
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    throw new TypeError("Expected a JSON object");
  }
  const object: Record<string, TasksJsonValue> = {};
  for (const [key, member] of Object.entries(json)) object[key] = member;
  return object;
}

/** Stamp `io.modelcontextprotocol/related-task` onto request params, keeping
 * any existing `_meta`, so the pending-request UI can tag it with its task. */
export function paramsWithRelatedTask(
  params: TasksJsonObject,
  taskId: string,
): TasksJsonObject {
  const rawMetadata = params._meta;
  const metadata =
    rawMetadata !== null &&
    !Array.isArray(rawMetadata) &&
    typeof rawMetadata === "object"
      ? (rawMetadata as TasksJsonObject)
      : undefined;
  return {
    ...params,
    _meta: withRelatedTaskMetadata(metadata, { taskId: extTaskId(taskId) }),
  };
}

/** The generation-neutral task view, with the timestamps the UI sorts on
 * always present (a modern task may omit either). */
export function toInspectorTask(view: TaskView): InspectorTask {
  const timestamp = view.createdAt ?? view.lastUpdatedAt ?? "";
  return {
    ...view,
    createdAt: timestamp,
    lastUpdatedAt: view.lastUpdatedAt ?? timestamp,
  };
}

/** Which pending-request origin an ext-tasks input exchange surfaces as, so
 * the UI can show era-accurate semantics. */
export function taskInputOrigin(
  delivery: ResolvedInputExchangeContext["delivery"],
): PendingRequestOrigin {
  if (delivery === "task-update") return "task-input-required";
  if (delivery === "request-retry") return "input-required";
  return "server-request";
}
