import type { Task } from "@modelcontextprotocol/client";

// A task cancellation is a one-shot confirmation (unlike the live status toast,
// which stays open while the task runs), so it auto-dismisses after a moment.
export const TASK_CANCELLED_TOAST_AUTOCLOSE_MS = 5000;

// Terminal task states — once a task reaches one of these it can't change, so
// its toast is dismissed and its per-task progress entry is pruned.
export const TERMINAL_TASK_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalTaskStatus(status: Task["status"]): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

// Stable toast id per task so live status updates replace one toast rather than
// stacking a fresh one per `notifications/tasks/status` tick.
export function taskToastId(taskId: string): string {
  return `task-${taskId}`;
}

// Toast color per task status — mirrors TaskStatusBadge's mapping so the toast
// and the Tasks-screen badge read consistently.
export function taskToastColor(status: Task["status"]): string {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "cancelled":
      return "gray";
    case "input_required":
      return "yellow";
    default:
      return "blue";
  }
}

// The subset of Task fields the toast layer reads. Both task-event payloads —
// the server `taskStatusChange` (full Task) and the client-origin
// `requestorTaskUpdated` (Task with optional createdAt) — satisfy this.
export type TaskToastInput = Pick<Task, "status"> & { statusMessage?: string };

// One-line toast body: the task's `statusMessage` when present, else a short
// fallback naming the status. The title carries the status itself.
export function formatTaskToastMessage(task: TaskToastInput): string {
  return task.statusMessage ?? `Task ${task.status}`;
}
