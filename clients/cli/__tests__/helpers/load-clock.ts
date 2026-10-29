import type { LoadClock } from "@inspector/core/cli/handlers/load-test.js";

/**
 * A clock that only moves when told to, with a timer queue: each `sleep`
 * wakes at an absolute time, and timers fire one at a time in wake order,
 * each on its own macrotask so the woken worker runs (up to its next await)
 * before the clock moves again — as real timers behave. A rate-limited run
 * therefore completes instantly while keeping the schedule it would in real
 * time.
 */
export function fakeClock(
  options: { lateUntil?: number; jitter?: number } = {},
): LoadClock & { advance: (ms: number) => void; sleeps: () => number } {
  let t = 1000;
  // A stalled event loop: no timer fires before this many ms into the run.
  const earliestWake = 1000 + (options.lateUntil ?? 0);
  const timers: { wakeAt: number; resolve: () => void }[] = [];
  let pumping = false;
  let sleepCount = 0;
  const pump = (): void => {
    timers.sort((a, b) => a.wakeAt - b.wakeAt);
    const next = timers.shift();
    if (!next) {
      pumping = false;
      return;
    }
    t = Math.max(t, next.wakeAt);
    next.resolve();
    setImmediate(pump);
  };
  return {
    now: () => t,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        sleepCount++;
        timers.push({
          wakeAt: Math.max(t + ms + (options.jitter ?? 0), earliestWake),
          resolve,
        });
        if (!pumping) {
          pumping = true;
          setImmediate(pump);
        }
      }),
    advance: (ms) => {
      t += ms;
    },
    sleeps: () => sleepCount,
  };
}
