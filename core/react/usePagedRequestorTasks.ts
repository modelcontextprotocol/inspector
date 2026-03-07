import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { PagedRequestorTasksState } from "../mcp/state/pagedRequestorTasksState.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type {
  PagedRequestorTasksStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedRequestorTasksState.js";

export interface UsePagedRequestorTasksResult {
  tasks: Task[];
  loadPage: (cursor?: string) => Promise<LoadPageResult>;
  clear: () => void;
  nextCursor: string | undefined;
}

/**
 * React hook that subscribes to PagedRequestorTasksState and returns tasks, loadPage, clear, and nextCursor.
 */
export function usePagedRequestorTasks(
  client: InspectorClient | null,
  pagedRequestorTasksState: PagedRequestorTasksState | null,
): UsePagedRequestorTasksResult {
  const [tasks, setTasks] = useState<Task[]>(
    pagedRequestorTasksState?.getTasks() ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>(
    pagedRequestorTasksState?.getNextCursor?.() ?? undefined,
  );

  useEffect(() => {
    if (!pagedRequestorTasksState) {
      setTasks([]);
      setNextCursor(undefined);
      return;
    }
    setTasks(pagedRequestorTasksState.getTasks());
    setNextCursor(pagedRequestorTasksState.getNextCursor?.() ?? undefined);
    const onTasksChange = (
      event: TypedEventGeneric<PagedRequestorTasksStateEventMap, "tasksChange">,
    ) => {
      setTasks(event.detail);
      setNextCursor(pagedRequestorTasksState.getNextCursor?.() ?? undefined);
    };
    pagedRequestorTasksState.addEventListener("tasksChange", onTasksChange);
    return () => {
      pagedRequestorTasksState.removeEventListener(
        "tasksChange",
        onTasksChange,
      );
    };
  }, [pagedRequestorTasksState]);

  const loadPage = useCallback(
    async (cursor?: string): Promise<LoadPageResult> => {
      if (!pagedRequestorTasksState || !client) {
        return { tasks: [], nextCursor: undefined };
      }
      const result = await pagedRequestorTasksState.loadPage(cursor);
      setTasks(pagedRequestorTasksState.getTasks());
      setNextCursor(pagedRequestorTasksState.getNextCursor?.() ?? undefined);
      return result;
    },
    [client, pagedRequestorTasksState],
  );

  const clear = useCallback(() => {
    pagedRequestorTasksState?.clear();
  }, [pagedRequestorTasksState]);

  return { tasks, loadPage, clear, nextCursor };
}
