import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  ManagedResourceTemplatesState,
  ManagedResourceTemplatesStateEventMap,
} from "../mcp/state/managedResourceTemplatesState.js";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseManagedResourceTemplatesResult {
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
    // A user-initiated refresh forces a cache-bypassing round trip
    // (`cacheMode: "refresh"`) so a modern server's `ttlMs`-cached list can't
    // return stale — and re-stores the fresh aggregate.
    const next = await managedResourceTemplatesState.refresh(
      undefined,
      "refresh",
    );
    setResourceTemplates(next);
    return next;
  }, [client, managedResourceTemplatesState]);

  return { resourceTemplates, refresh };
}
