import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  LoadEventsPageResult,
  PagedEventsState,
} from "../mcp/state/pagedEventsState.js";
import type { PagePaginationState } from "../mcp/state/pagedToolsState.js";
import type { EventType } from "../extension/events/schemas.js";
import type { ExcludedEventType } from "../extension/events/headers.js";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";
import { NO_PAGINATION } from "./pagination.js";

/** Stable empty lists for the no-server case — see `useStoreSnapshot`. */
const NO_EVENT_TYPES: EventType[] = [];
const NO_EXCLUDED: ExcludedEventType[] = [];

const readEventTypes = (state: PagedEventsState): EventType[] =>
  state.getEventTypes();
const readExcluded = (state: PagedEventsState): ExcludedEventType[] =>
  state.getExcludedEventTypes();
const readPagination = (state: PagedEventsState): PagePaginationState =>
  state.getPagination();

export interface UsePagedEventsResult {
  eventTypes: EventType[];
  /** Event types the loaded pages excluded for invalid `x-mcp-header`s. */
  excluded: ExcludedEventType[];
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
  /** The last page load's failure, or `null`. */
  error: Error | null;
  loadPage: (cursor?: string) => Promise<LoadEventsPageResult>;
}

/**
 * React hook over `PagedEventsState` (#3030): the event types loaded so far
 * in paginated mode, their exclusions, and the page progress. The store owns
 * loading; this mirrors it, like `usePagedTools`.
 */
export function usePagedEvents(
  client: InspectorClientProtocol | null,
  pagedEventsState: PagedEventsState | null,
): UsePagedEventsResult {
  const eventTypes = useStoreSnapshot(
    pagedEventsState,
    "eventTypesChange",
    readEventTypes,
    NO_EVENT_TYPES,
  );
  const excluded = useStoreSnapshot(
    pagedEventsState,
    "excludedEventTypesChange",
    readExcluded,
    NO_EXCLUDED,
  );
  const { nextCursor, pageCount } = useStoreSnapshot(
    pagedEventsState,
    "paginationChange",
    readPagination,
    NO_PAGINATION,
  );
  const error = useListError(pagedEventsState);

  const loadPage = useCallback(
    async (cursor?: string): Promise<LoadEventsPageResult> => {
      if (!pagedEventsState || !client) {
        return { events: NO_EVENT_TYPES, nextCursor: undefined };
      }
      return pagedEventsState.loadPage(cursor);
    },
    [client, pagedEventsState],
  );

  return { eventTypes, excluded, nextCursor, pageCount, error, loadPage };
}
