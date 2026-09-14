import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  PagedRequestorTasksState,
  LoadPageResult,
} from "../mcp/state/pagedRequestorTasksState.js";
import type { Task } from "@modelcontextprotocol/client";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_TASKS: Task[] = [];

const readTasks = (state: PagedRequestorTasksState): Task[] => state.getTasks();
// This store has no dedicated pagination event — the cursor advances with the
// page, so it rides `tasksChange` like the list does.
const readNextCursor = (state: PagedRequestorTasksState): string | undefined =>
  state.getNextCursor() ?? undefined;

export interface UsePagedRequestorTasksResult {
  tasks: Task[];
  loadPage: (cursor?: string) => Promise<LoadPageResult>;
  clear: () => void;
  nextCursor: string | undefined;
}

/**
 * React hook that subscribes to PagedRequestorTasksState and returns tasks,
 * loadPage, clear, and nextCursor.
 */
export function usePagedRequestorTasks(
  client: InspectorClientProtocol | null,
  pagedRequestorTasksState: PagedRequestorTasksState | null,
): UsePagedRequestorTasksResult {
  const tasks = useStoreSnapshot(
    pagedRequestorTasksState,
    "tasksChange",
    readTasks,
    NO_TASKS,
  );
  const nextCursor = useStoreSnapshot(
    pagedRequestorTasksState,
    "tasksChange",
    readNextCursor,
    undefined,
  );

  const loadPage = useCallback(
    async (cursor?: string): Promise<LoadPageResult> => {
      if (!pagedRequestorTasksState || !client) {
        return { tasks: NO_TASKS, nextCursor: undefined };
      }
      // The store dispatches `tasksChange` as it commits the page, so both
      // snapshots above update on their own.
      return pagedRequestorTasksState.loadPage(cursor);
    },
    [client, pagedRequestorTasksState],
  );

  const clear = useCallback(() => {
    pagedRequestorTasksState?.clear();
  }, [pagedRequestorTasksState]);

  return { tasks, loadPage, clear, nextCursor };
}
