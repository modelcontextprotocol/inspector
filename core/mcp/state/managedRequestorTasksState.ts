/**
 * ManagedRequestorTasksState: holds full requestor task list, syncs on
 * tasksListChanged. Subscribes to taskStatusChange (server) and
 * requestorTaskUpdated (client) to merge per-task updates.
 *
 * Ported from v1.5/main. v2 substitutes `InspectorClientProtocol` for the
 * concrete `InspectorClient` since the runtime class is not yet ported.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { InspectorClientEventMap } from "../inspectorClientEventTarget.js";
import {
  TypedEventTarget,
  type TypedEventGeneric,
} from "../typedEventTarget.js";
import { mergeTaskIntoList } from "./mergeTaskIntoList.js";

const MAX_PAGES = 100;

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
      if (this.client?.getStatus() === "disconnected") {
        this.tasks = [];
        this.dispatchTypedEvent("tasksChange", []);
      }
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
    this.tasks = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const result = await client.listRequestorTasks(cursor);
      this.tasks = cursor
        ? [...this.tasks, ...result.tasks]
        : result.tasks;
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

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.tasks = [];
  }
}
