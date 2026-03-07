import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { PagedResourceTemplatesState } from "../mcp/state/pagedResourceTemplatesState.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type {
  PagedResourceTemplatesStateEventMap,
  LoadPageResult,
} from "../mcp/state/pagedResourceTemplatesState.js";

export interface UsePagedResourceTemplatesResult {
  resourceTemplates: ResourceTemplate[];
  loadPage: (
    cursor?: string,
    metadata?: Record<string, string>,
  ) => Promise<LoadPageResult>;
  clear: () => void;
}

export function usePagedResourceTemplates(
  client: InspectorClient | null,
  pagedResourceTemplatesState: PagedResourceTemplatesState | null,
): UsePagedResourceTemplatesResult {
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >(pagedResourceTemplatesState?.getResourceTemplates() ?? []);

  useEffect(() => {
    if (!pagedResourceTemplatesState) {
      setResourceTemplates([]);
      return;
    }
    setResourceTemplates(pagedResourceTemplatesState.getResourceTemplates());
    const onResourceTemplatesChange = (
      event: TypedEventGeneric<
        PagedResourceTemplatesStateEventMap,
        "resourceTemplatesChange"
      >,
    ) => setResourceTemplates(event.detail);
    pagedResourceTemplatesState.addEventListener(
      "resourceTemplatesChange",
      onResourceTemplatesChange,
    );
    return () => {
      pagedResourceTemplatesState.removeEventListener(
        "resourceTemplatesChange",
        onResourceTemplatesChange,
      );
    };
  }, [pagedResourceTemplatesState]);

  const loadPage = useCallback(
    async (
      cursor?: string,
      metadata?: Record<string, string>,
    ): Promise<LoadPageResult> => {
      if (!pagedResourceTemplatesState || !client) {
        return { resourceTemplates: [], nextCursor: undefined };
      }
      const result = await pagedResourceTemplatesState.loadPage(
        cursor,
        metadata,
      );
      setResourceTemplates(pagedResourceTemplatesState.getResourceTemplates());
      return result;
    },
    [client, pagedResourceTemplatesState],
  );

  const clear = useCallback(() => {
    pagedResourceTemplatesState?.clear();
  }, [pagedResourceTemplatesState]);

  return { resourceTemplates, loadPage, clear };
}
