import { useCallback, useRef, useState } from "react";
import type { RemoteSessionSummary } from "@inspector/core/mcp/remote/index.js";
import {
  listActiveSessions,
  terminateActiveSession,
  type ActiveSessionsApiOptions,
} from "../lib/activeSessions";
import { errorMessage } from "../utils/errorFormat";

/**
 * State behind the Active Sessions modal (#2831): whether it is open, the
 * backend's session list as last fetched, and the terminate action.
 *
 * Fetching is driven by the actions themselves — opening the modal, the
 * refresh button, a completed terminate — never by an effect keyed on
 * `opened`, so nothing re-syncs state from a prop and a closed modal makes no
 * requests. A response that lands after a newer request was issued is
 * dropped, so a slow list can never overwrite a fresher one.
 *
 * `api` is read through a callback each time rather than captured once, so a
 * token recovered after mount (see `getAuthToken`) is the one sent.
 */
export interface UseActiveSessionsResult {
  opened: boolean;
  open: () => void;
  close: () => void;
  sessions: RemoteSessionSummary[];
  /** `Date.now()` when the shown list was fetched; ages are measured from it. */
  capturedAt: number;
  loading: boolean;
  error: string | undefined;
  /** The session a terminate is in flight for, if any. */
  terminatingId: string | undefined;
  refresh: () => Promise<void>;
  terminate: (sessionId: string) => Promise<void>;
}

export function useActiveSessions(
  getApiOptions: () => ActiveSessionsApiOptions,
): UseActiveSessionsResult {
  const [opened, setOpened] = useState(false);
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [capturedAt, setCapturedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [terminatingId, setTerminatingId] = useState<string | undefined>(
    undefined,
  );
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    try {
      const list = await listActiveSessions(getApiOptions());
      if (request !== latestRequest.current) return;
      setSessions(list);
      setCapturedAt(Date.now());
      setError(undefined);
    } catch (err) {
      if (request !== latestRequest.current) return;
      setError(errorMessage(err));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [getApiOptions]);

  const terminate = useCallback(
    async (sessionId: string) => {
      setTerminatingId(sessionId);
      try {
        await terminateActiveSession(sessionId, getApiOptions());
      } catch (err) {
        // Not re-listed: a successful list clears `error`, which would hide
        // this one. The refresh button is there to re-read the list.
        setError(errorMessage(err));
        return;
      } finally {
        setTerminatingId(undefined);
      }
      await refresh();
    },
    [getApiOptions, refresh],
  );

  const open = useCallback(() => {
    setOpened(true);
    // The handler owns its failures (`refresh` catches into `error`).
    void refresh();
  }, [refresh]);

  const close = useCallback(() => setOpened(false), []);

  return {
    opened,
    open,
    close,
    sessions,
    capturedAt,
    loading,
    error,
    terminatingId,
    refresh,
    terminate,
  };
}
