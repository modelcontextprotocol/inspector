import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedRequestorTasksState } from "../mcp/state/managedRequestorTasksState.js";
import type { Task } from "@modelcontextprotocol/client";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_TASKS: Task[] = [];

const readTasks = (state: ManagedRequestorTasksState): Task[] =>
  state.getTasks();

export interface UseManagedRequestorTasksResult {
  tasks: Task[];
  refresh: () => Promise<Task[]>;
  clearCompleted: () => void;
}

/**
 * React hook that subscribes to ManagedRequestorTasksState and returns
 * requestor tasks + refresh.
 */
export function useManagedRequestorTasks(
  client: InspectorClientProtocol | null,
  managedRequestorTasksState: ManagedRequestorTasksState | null,
): UseManagedRequestorTasksResult {
  const tasks = useStoreSnapshot(
    managedRequestorTasksState,
    "tasksChange",
    readTasks,
    NO_TASKS,
  );

  const refresh = useCallback(async (): Promise<Task[]> => {
    if (!managedRequestorTasksState || !client) return NO_TASKS;
    // The store dispatches `tasksChange` as it commits the new list, so the
    // snapshot above updates on its own — nothing local to push it into.
    return managedRequestorTasksState.refresh();
  }, [client, managedRequestorTasksState]);

  const clearCompleted = useCallback((): void => {
    managedRequestorTasksState?.clearCompleted();
  }, [managedRequestorTasksState]);

  return { tasks, refresh, clearCompleted };
}
