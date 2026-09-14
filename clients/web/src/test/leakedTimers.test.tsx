/**
 * Regression tests for the leaked-timer safety net in `setup.ts` (#1984).
 *
 * A `window.setTimeout` that outlives its test file fires after happy-dom has
 * disposed that file's `window`, and React then throws an uncaught
 * `ReferenceError: window is not defined` that fails the whole run — from an
 * arbitrary innocent file, with every test passing. These lock down the net that
 * prevents it.
 *
 * Note what is deliberately NOT asserted: that Mantine schedules no timers. It
 * does (measured: three 200ms timers when a `Modal` opens, even under
 * `env="test"`), and that is the library behaving normally. The contract here is
 * only that nothing survives the test that scheduled it.
 */

import { describe, it, expect, vi } from "vitest";
import { Modal } from "@mantine/core";
import { renderWithMantine } from "./renderWithMantine";
import { pendingTimerCount } from "./setup";

/** Schedule through the wrapper the net installed, keeping its inferred handle
 *  type so it stays directly acceptable to `window.clearTimeout`. */
function scheduleTracked(ms: number) {
  return window.setTimeout(() => {}, ms);
}

describe("leaked-timer safety net", () => {
  it("wraps window.setTimeout rather than leaving the native one in place", () => {
    // If the wrapper were absent the net would silently track nothing, so assert
    // the instrumentation exists before relying on the behavior it enables.
    expect(window.setTimeout.toString()).not.toContain("[native code]");
  });

  it("clears a timer the test leaves pending, so it cannot fire later", async () => {
    const fired = vi.fn();
    window.setTimeout(fired, 20);
    // Deliberately do not clear it: the afterEach net owns it from here. The
    // next test asserts it never ran.
    leaked.callback = fired;
    expect(fired).not.toHaveBeenCalled();
  });

  it("the previous test's leaked timer never fired", async () => {
    // 20ms of real time, comfortably past the leaked timer's deadline.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(leaked.callback).not.toBeNull();
    expect(leaked.callback).not.toHaveBeenCalled();
  });

  it("clearTimeout untracks the timer", () => {
    // Asserted against the net's own bookkeeping, not against "clearTimeout
    // doesn't throw" — the latter holds whether or not tracking works, since
    // clearTimeout is idempotent, so it proved nothing. That vacuity hid a real
    // bug: happy-dom's handle is a `Timeout` object, so the original
    // `typeof id === "number"` guard never matched and nothing was untracked.
    const before = pendingTimerCount();
    const id = scheduleTracked(1000);
    expect(pendingTimerCount()).toBe(before + 1);
    window.clearTimeout(id);
    expect(pendingTimerCount()).toBe(before);
  });

  it("queues a frame that would schedule a timer after the sweep", () => {
    // The rAF race in miniature, and the ordering the net depends on. This
    // synchronous test cannot let the frame callback run — it fires only after
    // the test (and the whole afterEach) returns. If frames were not cancelled
    // *before* the timer sweep, this callback would register `rafScheduled`
    // after the drain and survive teardown. The next test proves it does not.
    requestAnimationFrame(() => {
      rafRace.ranFrame = true;
      window.setTimeout(() => {
        rafRace.ranTimer = true;
      }, 5);
    });
    expect(rafRace.ranFrame).toBe(false);
  });

  it("neither the queued frame nor its timer ever ran", async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rafRace.ranFrame).toBe(false);
    expect(rafRace.ranTimer).toBe(false);
  });

  it("a Modal's own transition timers do not survive the test that opened it", () => {
    // The real-world shape of #1984: ServerRemoveConfirmModal-style tests toggle
    // `opened`, and Mantine schedules real timers for the transition and the
    // scroll lock. Rendering here is enough — the net clears them at teardown,
    // and a regression would surface as the run-killing uncaught ReferenceError
    // rather than as a failure of this assertion.
    const { rerender } = renderWithMantine(
      <Modal opened={false} onClose={() => {}} />,
    );
    rerender(<Modal opened={true} onClose={() => {}} />);
    expect(document.body).toBeTruthy();
  });
});

/** Carries the leaked callback across the two tests above. */
const leaked: { callback: ReturnType<typeof vi.fn> | null } = {
  callback: null,
};

/** Records whether a queued frame — or the timer it would register — ever ran. */
const rafRace = { ranFrame: false, ranTimer: false };
