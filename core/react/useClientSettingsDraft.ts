/**
 * Draft state for the install-level client settings modal (client.json).
 *
 * Same controlled-modal pattern as {@link useSettingsDraft}: local draft,
 * debounced persist, synchronous `flush` on close. Keyed on modal
 * open/close (`opened`) rather than a server id because client config is
 * install-level, not per-server.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseClientSettingsDraftOptions<T> {
  opened: boolean;
  resolveInitial: () => T;
  onPersist: (value: T) => Promise<void>;
  onError: (err: unknown) => void;
  debounceMs?: number;
}

export interface UseClientSettingsDraftResult<T> {
  draft: T | null;
  onChange: (next: T) => void;
  flush: () => void;
}

export function useClientSettingsDraft<T>({
  opened,
  resolveInitial,
  onPersist,
  onError,
  debounceMs = 300,
}: UseClientSettingsDraftOptions<T>): UseClientSettingsDraftResult<T> {
  const [draft, setDraft] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resolveInitialRef = useRef(resolveInitial);
  const onPersistRef = useRef(onPersist);
  const onErrorRef = useRef(onError);
  const draftRef = useRef<T | null>(null);
  const openedRef = useRef(opened);
  resolveInitialRef.current = resolveInitial;
  onPersistRef.current = onPersist;
  onErrorRef.current = onError;
  draftRef.current = draft;
  openedRef.current = opened;

  useEffect(() => {
    if (!opened) {
      setDraft(null);
      return;
    }
    setDraft(resolveInitialRef.current());
  }, [opened]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, []);

  const persist = useCallback((value: T) => {
    onPersistRef.current(value).catch((err) => {
      onErrorRef.current(err);
    });
  }, []);

  const onChange = useCallback(
    (next: T) => {
      if (!opened) return;
      setDraft(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        persist(next);
      }, debounceMs);
    },
    [opened, debounceMs, persist],
  );

  const flush = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const value = draftRef.current;
    if (openedRef.current && value !== null) {
      persist(value);
    }
  }, [persist]);

  return { draft, onChange, flush };
}
