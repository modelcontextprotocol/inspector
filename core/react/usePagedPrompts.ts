import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { PagedPromptsState } from "../mcp/state/pagedPromptsState.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type {
  PagedPromptsStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedPromptsState.js";

export interface UsePagedPromptsResult {
  prompts: Prompt[];
  loadPage: (
    cursor?: string,
    metadata?: Record<string, string>,
  ) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedPromptsState and returns prompts + loadPage.
 */
export function usePagedPrompts(
  client: InspectorClient | null,
  pagedPromptsState: PagedPromptsState | null,
): UsePagedPromptsResult {
  const [prompts, setPrompts] = useState<Prompt[]>(
    pagedPromptsState?.getPrompts() ?? [],
  );

  useEffect(() => {
    if (!pagedPromptsState) {
      setPrompts([]);
      return;
    }
    setPrompts(pagedPromptsState.getPrompts());
    const onPromptsChange = (
      event: TypedEventGeneric<PagedPromptsStateEventMap, "promptsChange">,
    ) => {
      setPrompts(event.detail);
    };
    pagedPromptsState.addEventListener("promptsChange", onPromptsChange);
    return () => {
      pagedPromptsState.removeEventListener("promptsChange", onPromptsChange);
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
      const result = await pagedPromptsState.loadPage(cursor, metadata);
      setPrompts(pagedPromptsState.getPrompts());
      return result;
    },
    [client, pagedPromptsState],
  );

  const clear = useCallback(() => {
    pagedPromptsState?.clear();
  }, [pagedPromptsState]);

  return { prompts, loadPage, clear };
}
