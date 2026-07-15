import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  ManagedPromptsState,
  ManagedPromptsStateEventMap,
} from "../mcp/state/managedPromptsState.js";
import type { Prompt } from "@modelcontextprotocol/client";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";

export interface UseManagedPromptsResult {
  prompts: Prompt[];
  /** True when a `prompts/list_changed` arrived since the last user refresh. */
  listChanged: boolean;
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
  const [listChanged, setListChanged] = useState<boolean>(
    managedPromptsState?.getListChanged() ?? false,
  );

  useEffect(() => {
    if (!managedPromptsState) {
      setPrompts([]);
      setListChanged(false);
      return;
    }
    setPrompts(managedPromptsState.getPrompts());
    setListChanged(managedPromptsState.getListChanged());
    const onPromptsChange = (
      event: TypedEventGeneric<ManagedPromptsStateEventMap, "promptsChange">,
    ) => {
      setPrompts(event.detail);
    };
    const onListChangedChange = (
      event: TypedEventGeneric<
        ManagedPromptsStateEventMap,
        "listChangedChange"
      >,
    ) => {
      setListChanged(event.detail);
    };
    managedPromptsState.addEventListener("promptsChange", onPromptsChange);
    managedPromptsState.addEventListener(
      "listChangedChange",
      onListChangedChange,
    );
    return () => {
      managedPromptsState.removeEventListener("promptsChange", onPromptsChange);
      managedPromptsState.removeEventListener(
        "listChangedChange",
        onListChangedChange,
      );
    };
  }, [managedPromptsState]);

  const refresh = useCallback(async (): Promise<Prompt[]> => {
    if (!managedPromptsState || !client) return [];
    // A user-initiated refresh acknowledges the change — clear the indicator
    // BEFORE awaiting the fetch, not after. If a `prompts/list_changed` arrives
    // mid-fetch, the state re-sets the flag (and auto-refreshes); clearing
    // afterward would wipe that genuinely-new signal and the user would miss
    // it. Clearing up front acknowledges only the change in hand.
    managedPromptsState.clearListChanged();
    const next = await managedPromptsState.refresh();
    setPrompts(next);
    return next;
  }, [client, managedPromptsState]);

  return { prompts, listChanged, refresh };
}
