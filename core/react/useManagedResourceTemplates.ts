import { useState, useEffect, useCallback } from "react";
import type { InspectorClient } from "../mcp/inspectorClient.js";
import type { ManagedResourceTemplatesState } from "../mcp/state/managedResourceTemplatesState.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type { ManagedResourceTemplatesStateEventMap } from "../mcp/state/managedResourceTemplatesState.js";

export interface UseManagedResourceTemplatesResult {
  resourceTemplates: ResourceTemplate[];
  refresh: () => Promise<ResourceTemplate[]>;
}

/**
 * React hook that subscribes to ManagedResourceTemplatesState and returns resourceTemplates + refresh.
 */
export function useManagedResourceTemplates(
  client: InspectorClient | null,
  managedResourceTemplatesState: ManagedResourceTemplatesState | null,
): UseManagedResourceTemplatesResult {
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >(managedResourceTemplatesState?.getResourceTemplates() ?? []);

  useEffect(() => {
    if (!managedResourceTemplatesState) {
      setResourceTemplates([]);
      return;
    }
    setResourceTemplates(managedResourceTemplatesState.getResourceTemplates());
    const onResourceTemplatesChange = (
      event: TypedEventGeneric<
        ManagedResourceTemplatesStateEventMap,
        "resourceTemplatesChange"
      >,
    ) => {
      setResourceTemplates(event.detail);
    };
    managedResourceTemplatesState.addEventListener(
      "resourceTemplatesChange",
      onResourceTemplatesChange,
    );
    return () => {
      managedResourceTemplatesState.removeEventListener(
        "resourceTemplatesChange",
        onResourceTemplatesChange,
      );
    };
  }, [managedResourceTemplatesState]);

  const refresh = useCallback(async (): Promise<ResourceTemplate[]> => {
    if (!managedResourceTemplatesState || !client) return [];
    const next = await managedResourceTemplatesState.refresh();
    setResourceTemplates(next);
    return next;
  }, [client, managedResourceTemplatesState]);

  return { resourceTemplates, refresh };
}
