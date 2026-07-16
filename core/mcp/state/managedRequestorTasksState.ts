/**
 * ManagedRequestorTasksState: holds full requestor task list, syncs on
 * tasksListChanged. Subscribes to taskStatusChange (server) and
 * requestorTaskUpdated (client) to merge per-task updates.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Task } from "@modelcontextprotocol/client";
import { isTerminalStatus } from "../types.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";
import { mergeTaskIntoList } from "./mergeTaskIntoList.js";

const MAX_PAGES = 100;

// Terminal task states — a task in one of these can no longer change, so
// "Clear Completed" targets exactly these.
const TERMINAL_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export interface ManagedRequestorTasksStateEventMap {
  tasksChange: Task[];
}

/**
 * State manager that keeps the full requestor task list in sync with the
 * server. Subscribes to connect, tasksListChanged, statusChange,
 * taskStatusChange (server), requestorTaskUpdated (client), and taskCancelled.
 */
export class ManagedRequestorTasksState extends TypedEventTarget<ManagedRequestorTasksStateEventMap> {
  private tasks: Task[] = [];
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  // Task ids the user dismissed via clearCompleted(). Sticky for the session:
  // these are filtered out of refresh() results and ignored by the live-merge
  // handlers so a late status update (or a server that still lists the task)
  // can't resurrect a cleared task. Reset on disconnect / destroy.
  private dismissedTaskIds = new Set<string>();

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      void this.refresh();
    };
    const onTasksListChanged = (): void => {
      void this.refresh();
    };
    const onStatusChange = (): void => {
      if (isTerminalStatus(this.client?.getStatus())) {
        this.tasks = [];
        this.dismissedTaskIds.clear();
        this.dispatchTypedEvent("tasksChange", []);
      }
    };
    const onTaskStatusChange = (
      e: TypedEventGeneric<InspectorClientEventMap, "taskStatusChange">,
    ): void => {
      const { taskId, task } = e.detail;
      if (this.dismissedTaskIds.has(taskId)) return;
      this.tasks = mergeTaskIntoList(this.tasks, taskId, task);
      this.dispatchTypedEvent("tasksChange", this.tasks);
    };
    const onRequestorTaskUpdated = (
      e: TypedEventGeneric<InspectorClientEventMap, "requestorTaskUpdated">,
    ): void => {
      const { taskId, task } = e.detail;
      if (this.dismissedTaskIds.has(taskId)) return;
      this.tasks = mergeTaskIntoList(this.tasks, taskId, task);
      this.dispatchTypedEvent("tasksChange", this.tasks);
    };
    const onTaskCancelled = (
      e: TypedEventGeneric<InspectorClientEventMap, "taskCancelled">,
    ): void => {
      const { taskId } = e.detail;
      if (this.dismissedTaskIds.has(taskId)) return;
      const idx = this.tasks.findIndex((t) => t.taskId === taskId);
      if (idx >= 0) {
        const next = [...this.tasks];
        const prev = next[idx]!;
        next[idx] = { ...prev, status: "cancelled" as const };
        this.tasks = next;
        this.dispatchTypedEvent("tasksChange", this.tasks);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener("tasksListChanged", onTasksListChanged);
    this.client.addEventListener("statusChange", onStatusChange);
    this.client.addEventListener("taskStatusChange", onTaskStatusChange);
    this.client.addEventListener(
      "requestorTaskUpdated",
      onRequestorTaskUpdated,
    );
    this.client.addEventListener("taskCancelled", onTaskCancelled);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener("tasksListChanged", onTasksListChanged);
        this.client.removeEventListener("statusChange", onStatusChange);
        this.client.removeEventListener("taskStatusChange", onTaskStatusChange);
        this.client.removeEventListener(
          "requestorTaskUpdated",
          onRequestorTaskUpdated,
        );
        this.client.removeEventListener("taskCancelled", onTaskCancelled);
      }
      this.client = null;
    };
  }

  getTasks(): Task[] {
    return [...this.tasks];
  }

  async refresh(): Promise<Task[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") {
      return this.getTasks();
    }
    // Gate on the server's `tasks` capability — calling tasks/list against a
    // server that doesn't advertise it returns -32601 "Method not found",
    // which then surfaces in the console for every connect against any
    // server that doesn't implement task tracking. Empty list is the right
    // semantics for "this server doesn't support tasks."
    if (!client.getCapabilities()?.tasks) {
      this.tasks = [];
      this.dispatchTypedEvent("tasksChange", this.tasks);
      return this.getTasks();
    }
    this.tasks = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listRequestorTasks(cursor);
      // Filter out tasks the user dismissed via clearCompleted() so a server
      // that still lists them (or an in-flight refresh) can't resurrect them.
      const page = result.tasks.filter(
        (t) => !this.dismissedTaskIds.has(t.taskId),
      );
      this.tasks = cursor ? [...this.tasks, ...page] : page;
      cursor = result.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing requestor tasks`,
        );
      }
    } while (cursor);
    this.dispatchTypedEvent("tasksChange", this.tasks);
    return this.getTasks();
  }

  /**
   * Drop terminal-state tasks (completed / failed / cancelled) from the list.
   * Their ids are remembered in `dismissedTaskIds` so they stay gone for the
   * rest of the session — a subsequent refresh() or live update won't bring
   * them back. No-op (and no event) when there's nothing terminal to clear.
   */
  clearCompleted(): void {
    const remaining: Task[] = [];
    let dismissedAny = false;
    for (const task of this.tasks) {
      if (TERMINAL_STATUSES.has(task.status)) {
        this.dismissedTaskIds.add(task.taskId);
        dismissedAny = true;
      } else {
        remaining.push(task);
      }
    }
    if (!dismissedAny) return;
    this.tasks = remaining;
    this.dispatchTypedEvent("tasksChange", this.tasks);
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tasks = [];
    this.dismissedTaskIds.clear();
  }
}
