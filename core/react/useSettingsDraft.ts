/**
 * Draft state for the per-server "settings" modal.
 *
 * `ServerSettingsModal` is a fully controlled component: every input
 * change fires back up to the parent, which must re-render with the new
 * value or the input's `value` prop goes stale and characters appear to
 * be eaten. We can't drive that re-render from the server-list state
 * alone — the PUT round-trip is too slow for per-keystroke updates, and
 * background refreshes of the server list would clobber in-progress
 * edits.
 *
 * This hook holds the draft locally, debounces the PUT, and exposes a
 * synchronous `flush` for the caller to invoke on modal close so the
 * final keystrokes always land. Extracted out of `App.tsx` so the
 * behavior is unit-testable in isolation (the App.tsx wiring is hard
 * to drive from a React Testing Library harness because of its many
 * Mantine + state-manager dependencies).
 *
 * Initialization is `targetId`-keyed by design: the draft only resets
 * when the modal opens to a *different* server, not on every change to
 * the underlying entry. That's what lets a background refresh of the
 * server list run without losing the user's in-progress edits.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseSettingsDraftOptions<T> {
  /** The id of the server whose settings are being edited, or `undefined` when the modal is closed. */
  targetId: string | undefined;
  /**
   * Resolves the initial draft for a given server id at the moment the
   * modal opens. Called once per target — must be stable enough that
   * the caller doesn't accidentally provoke re-initialization while
   * the user is editing. (We do not include this function in the
   * effect deps; it's read through a ref so callers don't have to
   * `useCallback` it.)
   */
  resolveInitial: (id: string) => T;
  /** Persist the draft. Called from the debounced flush and from `flush`. */
  onPersist: (id: string, value: T) => Promise<void>;
  /** Invoked when `onPersist` rejects. */
  onError: (id: string, err: unknown) => void;
  /** Debounce window in ms between the last `onChange` and the PUT. Defaults to 300. */
  debounceMs?: number;
}

export interface UseSettingsDraftResult<T> {
  /** Current draft, or `null` when no target is selected (modal closed). */
  draft: T | null;
  /** Update the draft. Schedules a debounced PUT. */
  onChange: (next: T) => void;
  /**
   * Flush any pending PUT synchronously (before yielding to the event
   * loop). Use from the modal's close handler so a user-dismiss
   * doesn't drop edits whose debounce timer hadn't fired yet.
   */
  flush: () => void;
}

/**
 * @param targetId the currently selected server id; the draft re-initializes when this changes
 * @param resolveInitial called once per `targetId` change to seed the draft
 * @param onPersist invoked after the debounce window (and from `flush`) with the latest draft
 * @param onError invoked when `onPersist` rejects
 * @param debounceMs window between the last onChange and the PUT (default 300)
 */
export function useSettingsDraft<T>({
  targetId,
  resolveInitial,
  onPersist,
  onError,
  debounceMs = 300,
}: UseSettingsDraftOptions<T>): UseSettingsDraftResult<T> {
  const [draft, setDraft] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Read callbacks through refs so the consumer doesn't have to
  // `useCallback` them. The effect that re-initializes the draft must
  // depend on `targetId` only — anything else in its deps risks
  // resetting an in-progress edit when the parent re-renders for
  // unrelated reasons (e.g. a background server-list refresh).
  const resolveInitialRef = useRef(resolveInitial);
  const onPersistRef = useRef(onPersist);
  const onErrorRef = useRef(onError);
  resolveInitialRef.current = resolveInitial;
  onPersistRef.current = onPersist;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!targetId) {
      setDraft(null);
      return;
    }
    setDraft(resolveInitialRef.current(targetId));
  }, [targetId]);

  // Unmount cleanup — a stale timer firing after unmount is harmless
  // today (the persist call still goes through to the backend) but
  // belt-and-suspenders prevents an extra PUT on route change / HMR.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, []);

  const persist = useCallback((id: string, value: T) => {
    onPersistRef.current(id, value).catch((err) => {
      onErrorRef.current(id, err);
    });
  }, []);

  const onChange = useCallback(
    (next: T) => {
      if (!targetId) return;
      // Synchronous setState so the modal re-renders this tick — the
      // bug this hook was extracted to fix was the input's controlled
      // `value` prop going stale until the round-trip completed.
      setDraft(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = targetId;
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        persist(id, next);
      }, debounceMs);
    },
    [targetId, debounceMs, persist],
  );

  const flush = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (targetId && draft !== null) {
      persist(targetId, draft);
    }
  }, [targetId, draft, persist]);

  return { draft, onChange, flush };
}
