import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  ManagedPromptsState,
  ManagedPromptsStateEventMap,
} from "../mcp/state/managedPromptsState.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseManagedPromptsResult {
  prompts: Prompt[];
  refresh: () => Promise<Prompt[]>;
}

/**
 * React hook that subscribes to ManagedPromptsState and returns prompts + refresh.
 */
export function useManagedPrompts(
  client: InspectorClientProtocol | null,
  managedPromptsState: ManagedPromptsState | null,
): UseManagedPromptsResult {
  const [prompts, setPrompts] = useState<Prompt[]>(
    managedPromptsState?.getPrompts() ?? [],
  );

  useEffect(() => {
    if (!managedPromptsState) {
      setPrompts([]);
      return;
    }
    setPrompts(managedPromptsState.getPrompts());
    const onPromptsChange = (
      event: TypedEventGeneric<ManagedPromptsStateEventMap, "promptsChange">,
    ) => {
      setPrompts(event.detail);
    };
    managedPromptsState.addEventListener("promptsChange", onPromptsChange);
    return () => {
      managedPromptsState.removeEventListener(
        "promptsChange",
        onPromptsChange,
      );
    };
  }, [managedPromptsState]);

  const refresh = useCallback(async (): Promise<Prompt[]> => {
    if (!managedPromptsState || !client) return [];
    const next = await managedPromptsState.refresh();
    setPrompts(next);
    return next;
  }, [client, managedPromptsState]);

  return { prompts, refresh };
}
