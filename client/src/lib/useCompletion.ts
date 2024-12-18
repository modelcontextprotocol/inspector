import { useState, useCallback, useRef, useEffect } from "react";
import {
  ResourceReference,
  PromptReference,
} from "@modelcontextprotocol/sdk/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => PromiseLike<void>>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function (...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

interface UseCompletionsOptions<T extends ResourceReference | PromptReference> {
  onComplete: (
    ref: T,
    argName: string,
    value: string,
    signal?: AbortSignal,
  ) => Promise<string[]>;
  debounceMs?: number;
}

interface CompletionState {
  completions: Record<string, string[]>;
  loading: Record<string, boolean>;
  error: Record<string, string | null>;
}

export function useCompletions<T extends ResourceReference | PromptReference>({
  onComplete,
  debounceMs = 300,
}: UseCompletionsOptions<T>) {
  const [state, setState] = useState<CompletionState>({
    completions: {},
    loading: {},
    error: {},
  });

  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const abortControllerRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const requestCompletions = useCallback(
    debounce(async (ref: T, argName: string, value: string) => {
      // Abort any pending request
      cleanup();

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [argName]: true },
        error: { ...prev.error, [argName]: null },
      }));

      try {
        const values = await completeRef.current(
          ref,
          argName,
          value,
          abortController.signal,
        );

        // Check if this request was aborted
        if (!abortController.signal.aborted) {
          setState((prev) => ({
            ...prev,
            completions: { ...prev.completions, [argName]: values },
            loading: { ...prev.loading, [argName]: false },
          }));
        }
      } catch (err) {
        // Only update state if the request wasn't aborted
        if (!abortController.signal.aborted) {
          const error = err instanceof Error ? err.message : String(err);
          setState((prev) => ({
            ...prev,
            loading: { ...prev.loading, [argName]: false },
            error: { ...prev.error, [argName]: error },
          }));
        }
      } finally {
        // Clear the abort controller if it's still the current one
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    }, debounceMs),
    [cleanup, debounceMs],
  );

  const clearCompletions = useCallback(() => {
    cleanup();
    setState({
      completions: {},
      loading: {},
      error: {},
    });
  }, [cleanup]);

  return {
    requestCompletions,
    clearCompletions,
    ...state,
  };
}
