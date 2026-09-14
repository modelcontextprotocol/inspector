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
  onChange: (next: T | ((prev: T) => T)) => void;
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
  const latestValuesRef = useRef<T | null>(null);

  // Seeded during render rather than in an effect, for the reason spelled
  // out on {@link useSettingsDraft}: an effect would paint the previous
  // session's draft for one frame before correcting itself. `seeded` is
  // tracked separately from `draft` so a `resolveInitial` that legitimately
  // returns `null` is not re-seeded on every render.
  const [seeded, setSeeded] = useState(false);
  if (seeded !== opened) {
    setSeeded(opened);
    setDraft(opened ? resolveInitial() : null);
  }

  const onPersistRef = useRef(onPersist);
  const onErrorRef = useRef(onError);
  const openedRef = useRef(opened);
  // Written in an effect rather than during render (`react-hooks/refs`).
  // Every reader — the debounce timer, `flush`, and `onChange` — runs after
  // a commit, so a post-commit write is what they need. `latestValuesRef`
  // mirrors `draft` here so it is re-seeded (and cleared on close) without a
  // second copy of the seeding rule; `onChange` still writes it
  // synchronously, because a functional update in the same tick has to see
  // the value the previous call produced.
  useEffect(() => {
    onPersistRef.current = onPersist;
    onErrorRef.current = onError;
    openedRef.current = opened;
    latestValuesRef.current = draft;
  });

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
    (next: T | ((prev: T) => T)) => {
      if (!opened) return;
      const prev = latestValuesRef.current;
      if (prev === null) return;
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
      latestValuesRef.current = resolved;
      setDraft(resolved);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        const value = latestValuesRef.current;
        if (value !== null) {
          persist(value);
        }
      }, debounceMs);
    },
    [opened, debounceMs, persist],
  );

  const flush = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const value = latestValuesRef.current;
    if (openedRef.current && value !== null) {
      persist(value);
    }
  }, [persist]);

  return { draft, onChange, flush };
}
