import { useState, useEffect } from "react";
import type { FetchRequestEntry } from "../mcp/types.js";
import type { FetchRequestLogState } from "../mcp/state/fetchRequestLogState.js";
import type { TypedEventGeneric } from "../mcp/typedEventTarget.js";
import type { FetchRequestLogStateEventMap } from "../mcp/state/fetchRequestLogState.js";

export interface UseFetchRequestLogResult {
  fetchRequests: FetchRequestEntry[];
}

/**
 * React hook that subscribes to FetchRequestLogState and returns the fetch request list.
 */
export function useFetchRequestLog(
  fetchRequestLogState: FetchRequestLogState | null,
): UseFetchRequestLogResult {
  const [fetchRequests, setFetchRequests] = useState<FetchRequestEntry[]>(
    fetchRequestLogState?.getFetchRequests() ?? [],
  );

  useEffect(() => {
    if (!fetchRequestLogState) {
      setFetchRequests([]);
      return;
    }
    setFetchRequests(fetchRequestLogState.getFetchRequests());
    const onFetchRequestsChange = (
      event: TypedEventGeneric<
        FetchRequestLogStateEventMap,
        "fetchRequestsChange"
      >,
    ) => {
      setFetchRequests(event.detail);
    };
    fetchRequestLogState.addEventListener(
      "fetchRequestsChange",
      onFetchRequestsChange,
    );
    return () => {
      fetchRequestLogState.removeEventListener(
        "fetchRequestsChange",
        onFetchRequestsChange,
      );
    };
  }, [fetchRequestLogState]);

  return { fetchRequests };
}
