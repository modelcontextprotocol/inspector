import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  PagedPromptsState,
  PagedPromptsStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedPromptsState.js";
import type { Prompt } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UsePagedPromptsResult {
  prompts: Prompt[];
  /** The server's `nextCursor` from the last page (undefined = at the end). */
  nextCursor?: string;
  /** Pages loaded since the last reset (page 1 = 1). */
  pageCount: number;
  loadPage: (
    cursor?: string,
    metadata?: Record<string, string>,
  ) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedPromptsState and returns prompts +
 * pagination progress + loadPage. The state store owns loading; this mirrors
 * its observable state.
 */
export function usePagedPrompts(
  client: InspectorClientProtocol | null,
  pagedPromptsState: PagedPromptsState | null,
): UsePagedPromptsResult {
  const [prompts, setPrompts] = useState<Prompt[]>(
    pagedPromptsState?.getPrompts() ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>(
    pagedPromptsState?.getPagination().nextCursor,
  );
  const [pageCount, setPageCount] = useState<number>(
    pagedPromptsState?.getPagination().pageCount ?? 0,
  );

  useEffect(() => {
    if (!pagedPromptsState) {
      setPrompts([]);
      setNextCursor(undefined);
      setPageCount(0);
      return;
    }
    setPrompts(pagedPromptsState.getPrompts());
    setNextCursor(pagedPromptsState.getPagination().nextCursor);
    setPageCount(pagedPromptsState.getPagination().pageCount);
    const onPromptsChange = (
      event: TypedEventGeneric<PagedPromptsStateEventMap, "promptsChange">,
    ) => {
      setPrompts(event.detail);
    };
    const onPaginationChange = (
      event: TypedEventGeneric<PagedPromptsStateEventMap, "paginationChange">,
    ) => {
      setNextCursor(event.detail.nextCursor);
      setPageCount(event.detail.pageCount);
    };
    pagedPromptsState.addEventListener("promptsChange", onPromptsChange);
    pagedPromptsState.addEventListener("paginationChange", onPaginationChange);
    return () => {
      pagedPromptsState.removeEventListener("promptsChange", onPromptsChange);
      pagedPromptsState.removeEventListener(
        "paginationChange",
        onPaginationChange,
      );
    };
  }, [pagedPromptsState]);

  const loadPage = useCallback(
    async (
      cursor?: string,
      metadata?: Record<string, string>,
    ): Promise<LoadPageResult> => {
      if (!pagedPromptsState || !client) {
        return { prompts: [], nextCursor: undefined };
      }
      return pagedPromptsState.loadPage(cursor, metadata);
    },
    [client, pagedPromptsState],
  );

  const clear = useCallback(() => {
    pagedPromptsState?.clear();
  }, [pagedPromptsState]);

  return { prompts, nextCursor, pageCount, loadPage, clear };
}
