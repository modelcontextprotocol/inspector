import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { ManagedResourceTemplatesState } from "../mcp/state/managedResourceTemplatesState.js";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty list for the no-server case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_RESOURCE_TEMPLATES: ResourceTemplate[] = [];

const readResourceTemplates = (
  state: ManagedResourceTemplatesState,
): ResourceTemplate[] => state.getResourceTemplates();

export interface UseManagedResourceTemplatesResult {
  /**
   * The last fetch's failure (transport error, or a result the SDK codec
   * rejected), or `null` when it succeeded. Includes the connect-time load,
   * whose failure has no caller to surface it (#1953).
   */
  error: Error | null;
  resourceTemplates: ResourceTemplate[];
  refresh: () => Promise<ResourceTemplate[]>;
}

/**
 * React hook that subscribes to ManagedResourceTemplatesState and returns
 * resource templates + refresh.
 */
export function useManagedResourceTemplates(
  client: InspectorClientProtocol | null,
  managedResourceTemplatesState: ManagedResourceTemplatesState | null,
): UseManagedResourceTemplatesResult {
  const resourceTemplates = useStoreSnapshot(
    managedResourceTemplatesState,
    "resourceTemplatesChange",
    readResourceTemplates,
    NO_RESOURCE_TEMPLATES,
  );

  const error = useListError(managedResourceTemplatesState);

  const refresh = useCallback(async (): Promise<ResourceTemplate[]> => {
    if (!managedResourceTemplatesState || !client) {
      return NO_RESOURCE_TEMPLATES;
    }
    // A user-initiated refresh forces a cache-bypassing round trip
    // (`cacheMode: "refresh"`) so a modern server's `ttlMs`-cached list can't
    // return stale — and re-stores the fresh aggregate. The store dispatches
    // `resourceTemplatesChange` as it commits, so the snapshot updates on its
    // own.
    return managedResourceTemplatesState.refresh(undefined, "refresh");
  }, [client, managedResourceTemplatesState]);

  return { resourceTemplates, error, refresh };
}
