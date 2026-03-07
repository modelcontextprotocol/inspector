import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { ManagedRequestorTasksState } from "../mcp/state/managedRequestorTasksState.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type { ManagedRequestorTasksStateEventMap } from "../mcp/state/managedRequestorTasksState.js";

export interface UseManagedRequestorTasksResult {
  tasks: Task[];
  refresh: () => Promise<Task[]>;
}

/**
 * React hook that subscribes to ManagedRequestorTasksState and returns tasks + refresh.
 */
export function useManagedRequestorTasks(
  client: InspectorClient | null,
  managedRequestorTasksState: ManagedRequestorTasksState | null,
): UseManagedRequestorTasksResult {
  const [tasks, setTasks] = useState<Task[]>(
    managedRequestorTasksState?.getTasks() ?? [],
  );

  useEffect(() => {
    if (!managedRequestorTasksState) {
      setTasks([]);
      return;
    }
    setTasks(managedRequestorTasksState.getTasks());
    const onTasksChange = (
      event: TypedEventGeneric<
        ManagedRequestorTasksStateEventMap,
        "tasksChange"
      >,
    ) => {
      setTasks(event.detail);
    };
    managedRequestorTasksState.addEventListener("tasksChange", onTasksChange);
    return () => {
      managedRequestorTasksState.removeEventListener(
        "tasksChange",
        onTasksChange,
      );
    };
  }, [managedRequestorTasksState]);

  const refresh = useCallback(async (): Promise<Task[]> => {
    if (!managedRequestorTasksState || !client) return [];
    const next = await managedRequestorTasksState.refresh();
    setTasks(next);
    return next;
  }, [client, managedRequestorTasksState]);

  return { tasks, refresh };
}
