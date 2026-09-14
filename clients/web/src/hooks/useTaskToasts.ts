import { useCallback, useEffect, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import type { InspectorClientEventMap } from "@inspector/core/mcp/index.js";
import type { TypedEventGeneric } from "@inspector/core/mcp/typedEventTarget.js";
import type { InspectorClientEventSource } from "./useProgressToasts";
import type { TaskProgress } from "../components/groups/TaskCard/TaskCard";
import {
  formatTaskToastMessage,
  isTerminalTaskStatus,
  TASK_CANCELLED_TOAST_AUTOCLOSE_MS,
  taskToastColor,
  taskToastId,
  type TaskToastInput,
} from "../utils/toasts/taskToasts";

export interface TaskToasts {
  /**
   * Per-task progress, keyed by taskId. Fed to the Tasks screen so
   * `TaskCard`'s progress bar renders for active tasks. Entries are pruned on
   * terminal status and on cancel.
   */
  progressByTaskId: Record<string, TaskProgress>;
  /** Drop every progress entry. Stable; called from the session reset. */
  resetTaskProgress: () => void;
  /**
   * The taskId of the in-flight task-augmented tool call, captured from the
   * `toolCallTaskUpdated` event `callToolStream` dispatches. Lets the Tool
   * detail panel's Cancel button cancel the underlying task on the server
   * (#1455) instead of no-op'ing. `onCallTool` clears it at the start of every
   * call, so an ordinary (non-task) call leaves it undefined and its Cancel
   * doesn't fire a stray task cancellation. A ref (not state) because it is
   * only read at the moment Cancel is clicked and must not re-render.
   */
  activeToolCallTaskIdRef: React.RefObject<string | undefined>;
}

/**
 * Surface live task status as per-task toasts — the v2 replacement for
 * v1/v1.5's inline "Task status: … Polling…" line under the Tool Result
 * (#1422, consistent with #1414) — and maintain the taskId → progress map the
 * Tasks screen renders from.
 *
 * One toast per taskId, replaced per tick, dismissed on terminal status (which
 * also prunes the task's progress entry) and on client teardown. The full
 * status history still lives in the Protocol view.
 */
export function useTaskToasts(
  inspectorClient: InspectorClientEventSource | null,
): TaskToasts {
  // One live task-status toast per taskId, so each `notifications/tasks/status`
  // tick replaces the existing toast rather than stacking a fresh one.
  const taskToastIdsRef = useRef<Set<string>>(new Set());
  const activeToolCallTaskIdRef = useRef<string | undefined>(undefined);
  const [progressByTaskId, setProgressByTaskId] = useState<
    Record<string, TaskProgress>
  >({});

  const resetTaskProgress = useCallback(() => {
    setProgressByTaskId({});
  }, []);

  // Correlate task-call progress to the task it belongs to. `callToolStream`
  // emits `requestorTaskProgress` tagged with the taskId it owns (the generic
  // `progressNotification` carries only the caller's progressToken), so we
  // build a taskId → progress map the Tasks screen reads to render each active
  // task's progress bar.
  useEffect(() => {
    if (!inspectorClient) return;
    const onTaskProgress = (
      event: TypedEventGeneric<
        InspectorClientEventMap,
        "requestorTaskProgress"
      >,
    ) => {
      const { taskId, progress } = event.detail;
      setProgressByTaskId((prev) => ({
        ...prev,
        [taskId]: {
          progress: progress.progress,
          total: progress.total,
          message: progress.message,
        },
      }));
    };
    inspectorClient.addEventListener("requestorTaskProgress", onTaskProgress);
    return () => {
      inspectorClient.removeEventListener(
        "requestorTaskProgress",
        onTaskProgress,
      );
    };
  }, [inspectorClient]);

  // Capture the in-flight task-augmented tool call's taskId so the detail
  // panel's Cancel button can cancel the task on the server (#1455). The id
  // only becomes known mid-call, when `callToolStream` dispatches
  // `toolCallTaskUpdated`, so we stash the latest into the ref the cancel
  // handler reads.
  useEffect(() => {
    if (!inspectorClient) return;
    const onToolCallTaskUpdated = (
      event: TypedEventGeneric<InspectorClientEventMap, "toolCallTaskUpdated">,
    ) => {
      activeToolCallTaskIdRef.current = event.detail.taskId;
    };
    inspectorClient.addEventListener(
      "toolCallTaskUpdated",
      onToolCallTaskUpdated,
    );
    return () => {
      inspectorClient.removeEventListener(
        "toolCallTaskUpdated",
        onToolCallTaskUpdated,
      );
    };
  }, [inspectorClient]);

  // Subscribes to `taskStatusChange` (server `notifications/tasks/status`) and
  // `requestorTaskUpdated` (client-origin updates from `callToolStream`) — the
  // same sources the managed task store consumes; `toolCallTaskUpdated` is
  // redundant with `requestorTaskUpdated` so we skip it to avoid double-firing.
  useEffect(() => {
    if (!inspectorClient) return;
    const liveToastIds = taskToastIdsRef.current;
    const handleTaskUpdate = (taskId: string, task: TaskToastInput) => {
      const id = taskToastId(taskId);
      const terminal = isTerminalTaskStatus(task.status);
      const title = `Task ${task.status}`;
      const message = formatTaskToastMessage(task);
      const color = taskToastColor(task.status);
      if (terminal) {
        // Drop the task's progress entry now that it can't change.
        setProgressByTaskId((prev) => {
          if (!(taskId in prev)) return prev;
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
      }
      if (liveToastIds.has(id)) {
        notifications.update({ id, title, message, color });
        if (terminal) {
          notifications.hide(id);
          liveToastIds.delete(id);
        }
        return;
      }
      // A first sighting that's already terminal needs no toast at all.
      if (terminal) return;
      liveToastIds.add(id);
      notifications.show({
        id,
        title,
        message,
        color,
        autoClose: false,
        onClose: () => liveToastIds.delete(id),
      });
    };
    const onTaskStatusChange = (
      event: TypedEventGeneric<InspectorClientEventMap, "taskStatusChange">,
    ) => {
      handleTaskUpdate(event.detail.taskId, event.detail.task);
    };
    const onRequestorTaskUpdated = (
      event: TypedEventGeneric<InspectorClientEventMap, "requestorTaskUpdated">,
    ) => {
      handleTaskUpdate(event.detail.taskId, event.detail.task);
    };
    // A cancel goes out as `taskCancelled` (dispatched by cancelRequestorTask),
    // not as a status notification, so it would otherwise leave the running
    // task's live "Task <status>" toast hanging with no confirmation. Replace
    // that toast (or show a fresh one) with a short "Task cancelled" toast, and
    // prune the now-dead progress entry. Covers both cancel paths — the Tasks
    // screen and the Tool detail panel — since both route through
    // cancelRequestorTask (#1455).
    const onTaskCancelled = (
      event: TypedEventGeneric<InspectorClientEventMap, "taskCancelled">,
    ) => {
      const { taskId } = event.detail;
      setProgressByTaskId((prev) => {
        if (!(taskId in prev)) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      const id = taskToastId(taskId);
      const toast = {
        id,
        title: "Task cancelled",
        message: "The task was cancelled.",
        color: taskToastColor("cancelled"),
        autoClose: TASK_CANCELLED_TOAST_AUTOCLOSE_MS,
      };
      if (liveToastIds.has(id)) {
        // Convert the open status toast into the auto-closing confirmation; drop
        // it from the live set so a trailing "cancelled" status tick (if the
        // server sends one) doesn't re-show it.
        notifications.update(toast);
        liveToastIds.delete(id);
      } else {
        notifications.show(toast);
      }
    };
    inspectorClient.addEventListener("taskStatusChange", onTaskStatusChange);
    inspectorClient.addEventListener(
      "requestorTaskUpdated",
      onRequestorTaskUpdated,
    );
    inspectorClient.addEventListener("taskCancelled", onTaskCancelled);
    return () => {
      inspectorClient.removeEventListener(
        "taskStatusChange",
        onTaskStatusChange,
      );
      inspectorClient.removeEventListener(
        "requestorTaskUpdated",
        onRequestorTaskUpdated,
      );
      inspectorClient.removeEventListener("taskCancelled", onTaskCancelled);
      // Hide any still-visible task toasts on client swap so they don't linger
      // into the next session, then drop the bookkeeping (mirrors the progress-
      // toast teardown). As there, the drop is a **swap to a fresh Set** rather
      // than `liveToastIds.clear()`: `hide()` defers `onClose` until the exit
      // transition ends, and those callbacks close over this Set object, so
      // clearing in place would let a late `onClose` delete the *next*
      // session's entry for the same task id and freeze that task's toast
      // (#2219). See `useProgressToasts` for the full reasoning.
      liveToastIds.forEach((id) => notifications.hide(id));
      taskToastIdsRef.current = new Set();
    };
  }, [inspectorClient]);

  return { progressByTaskId, resetTaskProgress, activeToolCallTaskIdRef };
}
