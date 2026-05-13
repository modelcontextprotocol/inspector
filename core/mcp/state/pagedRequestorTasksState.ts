/**
 * PagedRequestorTasksState: holds an aggregated list of requestor tasks loaded
 * via loadPage(cursor). Subscribes to tasksListChanged (refetch first page),
 * taskStatusChange, requestorTaskUpdated, and taskCancelled. Clears on disconnect.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type {
  InspectorClientEventMap,
  TaskWithOptionalCreatedAt,
} from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";

export interface PagedRequestorTasksStateEventMap {
  tasksChange: Task[];
}

export interface LoadPageResult {
  tasks: Task[];
  nextCursor?: string;
}

function mergeTaskIntoList(
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

export class PagedRequestorTasksState extends TypedEventTarget<PagedRequestorTasksStateEventMap> {
  private tasks: Task[] = [];
  private nextCursor: string | undefined = undefined;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onStatusChange = (): void => {
      if (this.client?.getStatus() === "disconnected") {
        this.tasks = [];
        this.nextCursor = undefined;
        this.dispatchTypedEvent("tasksChange", []);
      }
    };
    const onTasksListChanged = (): void => {
      void this.loadPage(undefined);
    };
    const onTaskStatusChange = (
      e: TypedEventGeneric<InspectorClientEventMap, "taskStatusChange">,
    ): void => {
      const { taskId, task } = e.detail;
      this.tasks = mergeTaskIntoList(this.tasks, taskId, task);
      this.dispatchTypedEvent("tasksChange", this.tasks);
    };
    const onRequestorTaskUpdated = (
      e: TypedEventGeneric<InspectorClientEventMap, "requestorTaskUpdated">,
    ): void => {
      const { taskId, task } = e.detail;
      this.tasks = mergeTaskIntoList(this.tasks, taskId, task);
      this.dispatchTypedEvent("tasksChange", this.tasks);
    };
    const onTaskCancelled = (
      e: TypedEventGeneric<InspectorClientEventMap, "taskCancelled">,
    ): void => {
      const { taskId } = e.detail;
      const idx = this.tasks.findIndex((t) => t.taskId === taskId);
      if (idx >= 0) {
        const next = [...this.tasks];
        const prev = next[idx]!;
        next[idx] = { ...prev, status: "cancelled" as const };
        this.tasks = next;
        this.dispatchTypedEvent("tasksChange", this.tasks);
      }
    };
    this.client.addEventListener("statusChange", onStatusChange);
    this.client.addEventListener("tasksListChanged", onTasksListChanged);
    this.client.addEventListener("taskStatusChange", onTaskStatusChange);
    this.client.addEventListener(
      "requestorTaskUpdated",
      onRequestorTaskUpdated,
    );
    this.client.addEventListener("taskCancelled", onTaskCancelled);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("statusChange", onStatusChange);
        this.client.removeEventListener("tasksListChanged", onTasksListChanged);
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

  getNextCursor(): string | undefined {
    return this.nextCursor;
  }

  clear(): void {
    this.tasks = [];
    this.nextCursor = undefined;
    this.dispatchTypedEvent("tasksChange", this.tasks);
  }

  async loadPage(cursor?: string): Promise<LoadPageResult> {
    const c = this.client;
    if (!c || c.getStatus() !== "connected") {
      return { tasks: [], nextCursor: undefined };
    }
    const result = await c.listRequestorTasks(cursor);
    this.tasks =
      cursor === undefined
        ? [...result.tasks]
        : [...this.tasks, ...result.tasks];
    this.nextCursor = result.nextCursor;
    this.dispatchTypedEvent("tasksChange", this.tasks);
    return { tasks: result.tasks, nextCursor: result.nextCursor };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tasks = [];
    this.nextCursor = undefined;
  }
}
