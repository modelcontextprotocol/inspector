import { useState, useCallback, useEffect } from "react";
import { ResourceReference, PromptReference } from "@modelcontextprotocol/sdk/types.js";

interface CompletionState {
  completions: Record<string, string[]>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
}

export function useCompletionState(
  handleCompletion: (
    ref: ResourceReference | PromptReference,
    argName: string,
    value: string,
  ) => Promise<string[]>,
  completionsSupported: boolean = true,
) {
  const [state, setState] = useState<CompletionState>({
    completions: {},
    loading: {},
    error: {},
  });

  const clearCompletions = useCallback(() => {
    setState({
      completions: {},
      loading: {},
      error: {},
    });
  }, []);

  const requestCompletions = useCallback(
    async (ref: ResourceReference | PromptReference, argName: string, value: string) => {
      if (!completionsSupported) {
        return;
      }

      setState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [argName]: true },
        error: { ...prev.error, [argName]: null },
      }));

      try {
        const values = await handleCompletion(ref, argName, value);
        setState((prev) => ({
          ...prev,
          completions: { ...prev.completions, [argName]: values },
          loading: { ...prev.loading, [argName]: false },
        }));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          loading: { ...prev.loading, [argName]: false },
          error: { ...prev.error, [argName]: error },
        }));
      }
    },
    [handleCompletion, completionsSupported],
  );

  // Clear completions when support status changes
  useEffect(() => {
    if (!completionsSupported) {
      clearCompletions();
    }
  }, [completionsSupported, clearCompletions]);

  return {
    ...state,
    clearCompletions,
    requestCompletions,
    completionsSupported,
  };
}
