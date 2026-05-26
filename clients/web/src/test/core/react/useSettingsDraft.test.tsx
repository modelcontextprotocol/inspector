/**
 * Tests for `useSettingsDraft` — the draft-state hook the settings
 * modal in App.tsx is built on top of. The behavior we pin here is the
 * regression that #1361 fixed: every `onChange` must update the
 * displayed value synchronously so a controlled `<input>` doesn't
 * appear to eat keystrokes. The PUT itself debounces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSettingsDraft } from "@inspector/core/react/useSettingsDraft";

interface SettingsShape {
  text: string;
  rows: string[];
}

const EMPTY: SettingsShape = { text: "", rows: [] };

describe("useSettingsDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with a null draft when no target id is set", () => {
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: undefined,
        resolveInitial: () => EMPTY,
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(result.current.draft).toBe(null);
  });

  it("seeds the draft via resolveInitial when target id appears", () => {
    const resolveInitial = vi.fn((id: string) => ({
      text: `seed-${id}`,
      rows: [],
    }));
    const { result, rerender } = renderHook(
      ({ targetId }: { targetId: string | undefined }) =>
        useSettingsDraft<SettingsShape>({
          targetId,
          resolveInitial,
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { targetId: undefined as string | undefined } },
    );
    expect(resolveInitial).not.toHaveBeenCalled();

    rerender({ targetId: "alpha" });
    expect(resolveInitial).toHaveBeenCalledExactlyOnceWith("alpha");
    expect(result.current.draft).toEqual({ text: "seed-alpha", rows: [] });
  });

  it("re-seeds when the target id changes (modal reopens to a different server)", () => {
    const resolveInitial = vi.fn((id: string) => ({
      text: `seed-${id}`,
      rows: [],
    }));
    const { result, rerender } = renderHook(
      ({ targetId }: { targetId: string | undefined }) =>
        useSettingsDraft<SettingsShape>({
          targetId,
          resolveInitial,
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { targetId: "alpha" as string | undefined } },
    );
    expect(result.current.draft?.text).toBe("seed-alpha");

    rerender({ targetId: "beta" });
    expect(result.current.draft?.text).toBe("seed-beta");
  });

  it("does NOT re-seed when only resolveInitial's closure changes mid-edit (no clobber on background refresh)", () => {
    // This is the regression case the bug fix relies on: a background
    // refresh of the server list re-renders the parent with a new
    // `resolveInitial` closure (because `servers` changed), but the
    // user's in-progress draft must not be reset.
    let serversSnapshot: Record<string, SettingsShape> = {
      alpha: { text: "from-server", rows: [] },
    };
    const { result, rerender } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
        resolveInitial: (id) => serversSnapshot[id] ?? EMPTY,
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    );
    expect(result.current.draft?.text).toBe("from-server");

    // User types — draft diverges from server.
    act(() => {
      result.current.onChange({ text: "user-edit", rows: [] });
    });
    expect(result.current.draft?.text).toBe("user-edit");

    // Background refresh: server's snapshot changes, parent re-renders.
    serversSnapshot = { alpha: { text: "server-changed", rows: [] } };
    rerender();
    expect(result.current.draft?.text).toBe("user-edit");
  });

  it("nulls the draft when the target id clears (modal closed)", () => {
    const { result, rerender } = renderHook(
      ({ targetId }: { targetId: string | undefined }) =>
        useSettingsDraft<SettingsShape>({
          targetId,
          resolveInitial: () => EMPTY,
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { targetId: "alpha" as string | undefined } },
    );
    expect(result.current.draft).not.toBe(null);

    rerender({ targetId: undefined });
    expect(result.current.draft).toBe(null);
  });

  it("onChange updates draft synchronously (the regression #1361 was about)", () => {
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
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

  it("debounces onPersist by the configured window", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
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
    expect(onPersist).toHaveBeenCalledExactlyOnceWith("alpha", {
      text: "a",
      rows: [],
    });
  });

  it("collapses a burst of onChange calls into one persist with the final value", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
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
    expect(onPersist).toHaveBeenCalledExactlyOnceWith("alpha", {
      text: "abc",
      rows: [],
    });
  });

  it("ignores onChange when no target id is set", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: undefined,
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
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
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
    expect(onPersist).toHaveBeenCalledExactlyOnceWith("alpha", {
      text: "almost",
      rows: [],
    });
    // The timer should be cleared — advancing past the debounce window
    // must not produce a second persist.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it("flush() is a no-op when nothing is pending", () => {
    const onPersist = vi.fn(async () => {});
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
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

  it("invokes onError when onPersist rejects (modal-close failure path)", async () => {
    const err = new Error("kaboom");
    const onPersist = vi.fn(async () => {
      throw err;
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSettingsDraft<SettingsShape>({
        targetId: "alpha",
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
    expect(onError).toHaveBeenCalledExactlyOnceWith("alpha", err);
  });

  it("a pending PUT for the previous target id still goes to that target after a switch", () => {
    // setTimeout closes over `id` at schedule time, so an in-flight
    // debounce for `alpha` resolves to `alpha` even if the user has
    // since switched to `beta`. (Switching is fired from
    // `onSettingsModalClose` which calls `flush()` first — but the
    // contract should hold for any pending closure either way.)
    const onPersist = vi.fn(async () => {});
    const { result, rerender } = renderHook(
      ({ targetId }: { targetId: string | undefined }) =>
        useSettingsDraft<SettingsShape>({
          targetId,
          resolveInitial: () => EMPTY,
          onPersist,
          onError: vi.fn(),
        }),
      { initialProps: { targetId: "alpha" as string | undefined } },
    );
    act(() => {
      result.current.onChange({ text: "alpha-edit", rows: [] });
    });
    rerender({ targetId: "beta" });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onPersist).toHaveBeenCalledExactlyOnceWith("alpha", {
      text: "alpha-edit",
      rows: [],
    });
  });
});
