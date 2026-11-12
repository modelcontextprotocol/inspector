import { afterEach, describe, expect, it, vi } from "vitest";
import {
  animationFrameScheduler,
  coalesce,
  FRAME_FALLBACK_MS,
  type NotifyScheduler,
} from "@inspector/core/react/notifyScheduler";

/**
 * A scheduler the test drives by hand: `flushAll` runs whatever is pending,
 * so the assertions do not depend on a real frame or timer.
 */
function manualScheduler(): {
  schedule: NotifyScheduler;
  pending: () => number;
  flushAll: () => void;
} {
  const queue = new Set<() => void>();
  return {
    schedule: (flush) => {
      queue.add(flush);
      return () => queue.delete(flush);
    },
    pending: () => queue.size,
    flushAll: () => {
      const run = [...queue];
      queue.clear();
      run.forEach((flush) => flush());
    },
  };
}

describe("coalesce", () => {
  it("collapses any number of notifications before the flush into one call", () => {
    const onChange = vi.fn();
    const manual = manualScheduler();
    const { notify } = coalesce(onChange, manual.schedule);

    notify();
    notify();
    notify();
    expect(manual.pending()).toBe(1);
    expect(onChange).not.toHaveBeenCalled();

    manual.flushAll();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("schedules again for a notification after the flush", () => {
    const onChange = vi.fn();
    const manual = manualScheduler();
    const { notify } = coalesce(onChange, manual.schedule);

    notify();
    manual.flushAll();
    notify();
    manual.flushAll();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops a pending call on cancel", () => {
    const onChange = vi.fn();
    const manual = manualScheduler();
    const { notify, cancel } = coalesce(onChange, manual.schedule);

    notify();
    cancel();
    manual.flushAll();

    expect(onChange).not.toHaveBeenCalled();
    expect(manual.pending()).toBe(0);
  });

  it("is a no-op to cancel with nothing pending", () => {
    const { cancel } = coalesce(vi.fn(), manualScheduler().schedule);
    expect(() => cancel()).not.toThrow();
  });
});

describe("animationFrameScheduler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs the flush on the next animation frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => frames.push(cb)),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const flush = vi.fn();

    animationFrameScheduler(flush);
    expect(flush).not.toHaveBeenCalled();

    frames[0]?.(0);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancels the frame it requested", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 42),
    );
    const cancelFrame = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    animationFrameScheduler(vi.fn())();

    expect(cancelFrame).toHaveBeenCalledWith(42);
  });

  it("falls back to a frame-length timer where there are no animation frames", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    const flush = vi.fn();

    animationFrameScheduler(flush);
    vi.advanceTimersByTime(FRAME_FALLBACK_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancels the fallback timer", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    const flush = vi.fn();

    animationFrameScheduler(flush)();
    vi.advanceTimersByTime(FRAME_FALLBACK_MS);

    expect(flush).not.toHaveBeenCalled();
  });
});
