import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { RequestMetadata } from "../mcp/types.js";
import type {
  PagedResourceTemplatesState,
  LoadPageResult,
} from "../mcp/state/pagedResourceTemplatesState.js";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_RESOURCE_TEMPLATES: ResourceTemplate[] = [];

const readResourceTemplates = (
  state: PagedResourceTemplatesState,
): ResourceTemplate[] => state.getResourceTemplates();

export interface UsePagedResourceTemplatesResult {
  resourceTemplates: ResourceTemplate[];
  loadPage: (
    cursor?: string,
    metadata?: RequestMetadata,
  ) => Promise<LoadPageResult>;
  clear: () => void;
}

/**
 * React hook that subscribes to PagedResourceTemplatesState and returns
 * resource templates + loadPage.
 */
export function usePagedResourceTemplates(
  client: InspectorClientProtocol | null,
  pagedResourceTemplatesState: PagedResourceTemplatesState | null,
): UsePagedResourceTemplatesResult {
  const resourceTemplates = useStoreSnapshot(
    pagedResourceTemplatesState,
    "resourceTemplatesChange",
    readResourceTemplates,
    NO_RESOURCE_TEMPLATES,
  );

  const loadPage = useCallback(
    async (
      cursor?: string,
      metadata?: RequestMetadata,
    ): Promise<LoadPageResult> => {
      if (!pagedResourceTemplatesState || !client) {
        return {
          resourceTemplates: NO_RESOURCE_TEMPLATES,
          nextCursor: undefined,
        };
      }
      // The store dispatches `resourceTemplatesChange` as it commits the page,
      // so the snapshot above updates on its own.
      return pagedResourceTemplatesState.loadPage(cursor, metadata);
    },
    [client, pagedResourceTemplatesState],
  );

  const clear = useCallback(() => {
    pagedResourceTemplatesState?.clear();
  }, [pagedResourceTemplatesState]);

  return { resourceTemplates, loadPage, clear };
}
