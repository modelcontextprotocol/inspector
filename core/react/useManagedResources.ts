import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  ManagedResourcesState,
  ManagedResourcesStateEventMap,
} from "../mcp/state/managedResourcesState.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseManagedResourcesResult {
  resources: Resource[];
  refresh: () => Promise<Resource[]>;
}

/**
 * React hook that subscribes to ManagedResourcesState and returns resources + refresh.
 */
export function useManagedResources(
  client: InspectorClientProtocol | null,
  managedResourcesState: ManagedResourcesState | null,
): UseManagedResourcesResult {
  const [resources, setResources] = useState<Resource[]>(
    managedResourcesState?.getResources() ?? [],
  );

  useEffect(() => {
    if (!managedResourcesState) {
      setResources([]);
      return;
    }
    setResources(managedResourcesState.getResources());
    const onResourcesChange = (
      event: TypedEventGeneric<
        ManagedResourcesStateEventMap,
        "resourcesChange"
      >,
    ) => {
      setResources(event.detail);
    };
    managedResourcesState.addEventListener(
      "resourcesChange",
      onResourcesChange,
    );
    return () => {
      managedResourcesState.removeEventListener(
        "resourcesChange",
        onResourcesChange,
      );
    };
  }, [managedResourcesState]);

  const refresh = useCallback(async (): Promise<Resource[]> => {
    if (!managedResourcesState || !client) return [];
    const next = await managedResourcesState.refresh();
    setResources(next);
    return next;
  }, [client, managedResourcesState]);

  return { resources, refresh };
}
