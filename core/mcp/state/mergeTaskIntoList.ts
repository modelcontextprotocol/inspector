import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { TaskWithOptionalCreatedAt } from "../inspectorClientEventTarget.js";

/**
 * Insert or replace a task in a list keyed by `taskId`. Inserts at the front
 * when the id is new (so most-recent updates surface first); replaces in place
 * when the id is already present.
 *
 * The SDK `Task` requires `createdAt`, but client-origin task updates
 * (`requestorTaskUpdated`) carry `TaskWithOptionalCreatedAt` — fall back to
 * `lastUpdatedAt` so synthetic updates still satisfy the `Task` shape.
 */
export function mergeTaskIntoList(
  tasks: Task[],
  taskId: string,
  task: Task | TaskWithOptionalCreatedAt,
): Task[] {
  const normalized: Task = {
    ...task,
    taskId,
    createdAt:
      (task as Task).createdAt ??
      (task as TaskWithOptionalCreatedAt).lastUpdatedAt ??
      "",
  };
  const idx = tasks.findIndex((t) => t.taskId === taskId);
  if (idx < 0) {
    return [normalized, ...tasks];
  }
  const next = [...tasks];
  next[idx] = normalized;
  return next;
}
