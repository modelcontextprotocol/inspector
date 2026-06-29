/**
 * Tests for `useClientSettingsDraft` — the install-level (client.json)
 * variant of the settings-draft hook. Mirrors `useSettingsDraft` but keys
 * on the modal's `opened` boolean rather than a server id: client config
 * is install-level, not per-server. Pins the seed-on-open, debounced
 * persist, synchronous flush-on-close, and reset-on-close behaviors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClientSettingsDraft } from "@inspector/core/react/useClientSettingsDraft";

interface SettingsShape {
  text: string;
  rows: string[];
}

const EMPTY: SettingsShape = { text: "", rows: [] };

describe("useClientSettingsDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with a null draft when the modal is closed", () => {
    const resolveInitial = vi.fn(() => EMPTY);
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: false,
        resolveInitial,
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(result.current.draft).toBe(null);
    expect(resolveInitial).not.toHaveBeenCalled();
  });

  it("seeds the draft via resolveInitial when the modal opens", () => {
    const resolveInitial = vi.fn(() => ({ text: "seed", rows: [] }));
    const { result, rerender } = renderHook(
      ({ opened }: { opened: boolean }) =>
        useClientSettingsDraft<SettingsShape>({
          opened,
          resolveInitial,
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { opened: false } },
    );
    expect(resolveInitial).not.toHaveBeenCalled();

    rerender({ opened: true });
    expect(resolveInitial).toHaveBeenCalledTimes(1);
    expect(result.current.draft).toEqual({ text: "seed", rows: [] });
  });

  it("nulls the draft when the modal closes", () => {
    const { result, rerender } = renderHook(
      ({ opened }: { opened: boolean }) =>
        useClientSettingsDraft<SettingsShape>({
          opened,
          resolveInitial: () => EMPTY,
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { opened: true } },
    );
    expect(result.current.draft).not.toBe(null);

    rerender({ opened: false });
    expect(result.current.draft).toBe(null);
  });

  it("onChange updates draft synchronously", () => {
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(result.current.draft).toEqual(EMPTY);

    act(() => {
      result.current.onChange({ text: "a", rows: [] });
    });
    expect(result.current.draft).toEqual({ text: "a", rows: [] });

    act(() => {
      result.current.onChange({ text: "ab", rows: [] });
    });
    expect(result.current.draft).toEqual({ text: "ab", rows: [] });
  });

  it("applies a functional updater against the latest draft", () => {
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => ({ text: "seed", rows: ["a"] }),
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.onChange((prev) => ({ ...prev, text: prev.text + "!" }));
    });
    expect(result.current.draft).toEqual({ text: "seed!", rows: ["a"] });
  });

  it("ignores a stale onChange captured before the modal closed", () => {
    // Capture the onChange created while open (its closure still sees
    // opened === true), then close the modal — which nulls latestValuesRef.
    // Invoking the stale handler must short-circuit on the `prev === null`
    // guard rather than scheduling a persist of nothing.
    const onPersist = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ opened }: { opened: boolean }) =>
        useClientSettingsDraft<SettingsShape>({
          opened,
          resolveInitial: () => EMPTY,
          onPersist,
          onError: vi.fn(),
        }),
      { initialProps: { opened: true } },
    );
    const staleOnChange = result.current.onChange;
    rerender({ opened: false });
    act(() => {
      staleOnChange({ text: "stale", rows: [] });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("skips the debounced persist when the modal closed before the timer fired", () => {
    // A persist is scheduled while open; the modal then closes (nulling
    // latestValuesRef) without unmounting, so the pending timer still fires.
    // The `value !== null` guard inside the timer must suppress the persist.
    const onPersist = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ opened }: { opened: boolean }) =>
        useClientSettingsDraft<SettingsShape>({
          opened,
          resolveInitial: () => EMPTY,
          onPersist,
          onError: vi.fn(),
        }),
      { initialProps: { opened: true } },
    );
    act(() => {
      result.current.onChange({ text: "pending", rows: [] });
    });
    rerender({ opened: false });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("debounces onPersist by the configured window", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
        debounceMs: 300,
      }),
    );
    act(() => {
      result.current.onChange({ text: "a", rows: [] });
    });
    expect(onPersist).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onPersist).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onPersist).toHaveBeenCalledExactlyOnceWith({ text: "a", rows: [] });
  });

  it("uses the default 300ms debounce when none is configured", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.onChange({ text: "x", rows: [] });
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onPersist).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onPersist).toHaveBeenCalledExactlyOnceWith({ text: "x", rows: [] });
  });

  it("collapses a burst of onChange calls into one persist with the final value", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.onChange({ text: "a", rows: [] });
      vi.advanceTimersByTime(100);
      result.current.onChange({ text: "ab", rows: [] });
      vi.advanceTimersByTime(100);
      result.current.onChange({ text: "abc", rows: [] });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onPersist).toHaveBeenCalledExactlyOnceWith({
      text: "abc",
      rows: [],
    });
  });

  it("ignores onChange when the modal is closed", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: false,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.onChange({ text: "stray", rows: [] });
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPersist).not.toHaveBeenCalled();
    expect(result.current.draft).toBe(null);
  });

  it("flush() fires the pending persist synchronously and clears the timer", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.onChange({ text: "almost", rows: [] });
    });
    act(() => {
      result.current.flush();
    });
    expect(onPersist).toHaveBeenCalledExactlyOnceWith({
      text: "almost",
      rows: [],
    });
    // The timer is cleared — advancing past the debounce window must not
    // produce a second persist.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it("flush() is a no-op when nothing is pending", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.flush();
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("flush() does not persist when the modal has since closed (opened ref false)", () => {
    // A debounce is scheduled while open; the modal closes (which nulls
    // the draft and flips the opened ref) and THEN flush is invoked.
    // The guard `openedRef.current && value !== null` must suppress the
    // persist on both counts.
    const onPersist = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ opened }: { opened: boolean }) =>
        useClientSettingsDraft<SettingsShape>({
          opened,
          resolveInitial: () => EMPTY,
          onPersist,
          onError: vi.fn(),
        }),
      { initialProps: { opened: true } },
    );
    act(() => {
      result.current.onChange({ text: "pending", rows: [] });
    });
    // Capture flush before close — onChange/setDraft churn does not
    // re-create it, and after close the hook returns the same identity.
    const flush = result.current.flush;
    rerender({ opened: false });
    act(() => {
      flush();
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("invokes onError when onPersist rejects (debounced persist failure path)", async () => {
    const err = new Error("kaboom");
    const onPersist = vi.fn(async () => {
      throw err;
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError,
      }),
    );
    act(() => {
      result.current.onChange({ text: "x", rows: [] });
      vi.advanceTimersByTime(300);
    });
    // Let the rejected promise propagate to the .catch handler.
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith(err);
  });

  it("invokes onError when flush()'s persist rejects", async () => {
    const err = new Error("flush-boom");
    const onPersist = vi.fn(async () => {
      throw err;
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError,
      }),
    );
    act(() => {
      result.current.onChange({ text: "y", rows: [] });
    });
    act(() => {
      result.current.flush();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith(err);
  });

  it("unmount clears the debounce timer — no persist after the component is gone", () => {
    const onPersist = vi.fn(async () => {});
    const { result, unmount } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist,
        onError: vi.fn(),
      }),
    );
    act(() => {
      result.current.onChange({ text: "doomed", rows: [] });
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("flush identity is stable across keystrokes (no churn on consumer's onClose)", () => {
    const { result } = renderHook(() =>
      useClientSettingsDraft<SettingsShape>({
        opened: true,
        resolveInitial: () => EMPTY,
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    );
    const flushAfterMount = result.current.flush;
    act(() => {
      result.current.onChange({ text: "a", rows: [] });
    });
    act(() => {
      result.current.onChange({ text: "ab", rows: [] });
    });
    expect(result.current.flush).toBe(flushAfterMount);
  });
});
