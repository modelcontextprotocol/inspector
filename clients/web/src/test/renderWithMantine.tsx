import type { ReactElement, ReactNode } from "react";
import { act, render, type RenderOptions } from "@testing-library/react";
import { MantineProvider, type MantineColorScheme } from "@mantine/core";
import { afterEach, expect, vi } from "vitest";
import { theme } from "../theme/theme";

// Options accepted by both render helpers: the standard RTL options (minus
// `wrapper`, which we own) plus an optional forced `colorScheme`. The default
// is "light"; pass "dark" to exercise `useComputedColorScheme` dark branches
// without hand-rolling a bare `MantineProvider` (the #1760 anti-pattern).
export type MantineRenderOptions = Omit<RenderOptions, "wrapper"> & {
  colorScheme?: MantineColorScheme;
};

// Options for the real-transitions variant. `settleMs` is the window the
// automatic post-test settle waits (see below); pass the component's longest JS
// timer chain — its `Transition` `duration`/`exitDuration` plus any
// `enterDelay`/`exitDelay` plus two-frame rAF slack. Omit to use the generic
// default. Pass `0` as a deliberate opt-out for a test that provably drove every
// transition to completion itself: the `act` flush still runs, but with no wait.
// Arming is per *test*, not per render: in a test that renders more than one
// tree the longest `settleMs` wins (so a `0` here is superseded by a longer
// sibling render).
export type MantineTransitionsRenderOptions = MantineRenderOptions & {
  settleMs?: number;
};

// Build a MantineProvider wrapper for the given Mantine `env` + forced color
// scheme. See the two render helpers below for what each `env` value is for.
function makeWrapper(env: "test" | "default", colorScheme: MantineColorScheme) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={theme} defaultColorScheme={colorScheme} env={env}>
        {children}
      </MantineProvider>
    );
  };
}

// Default render helper. `env="test"` makes Mantine render transitions
// synchronously (no internal `setTimeout`). Without it, a `Transition`/`Modal`
// open/close timer can fire after happy-dom tears down `window` at the end of
// the run, throwing an uncaught `ReferenceError: window is not defined` that
// fails the whole run even when every assertion passed (#1760). This is the
// right default for the vast majority of tests, which don't assert on
// mid-transition state.
export function renderWithMantine(
  ui: ReactElement,
  options?: MantineRenderOptions,
) {
  const { colorScheme = "light", ...rest } = options ?? {};
  return render(ui, { wrapper: makeWrapper("test", colorScheme), ...rest });
}

// Opt-in variant that keeps Mantine's timer-driven transitions enabled, for the
// few tests that assert on transition/animation state that only exists mid-flight
// (e.g. a `data-anim="out"` cell during an exit crossfade). Calling this **arms
// an automatic settle** (see `settleTransitions` / the `afterEach` below) so the
// test can't leak the #1760 class by forgetting to drain a concurrent enter that
// has no DOM signal to `waitFor`. Pass `settleMs` derived from the component's
// real animation duration so the settle window can't silently become
// insufficient if that duration changes.
export function renderWithMantineTransitions(
  ui: ReactElement,
  options?: MantineTransitionsRenderOptions,
) {
  const {
    colorScheme = "light",
    settleMs = DEFAULT_SETTLE_MS,
    ...rest
  } = options ?? {};
  // Keep the LONGEST armed window if a test renders more than one real-
  // transitions tree, so a later short-animation render can't under-settle an
  // earlier long one (last-write-wins would).
  armedSettleMs = Math.max(armedSettleMs ?? 0, settleMs);
  const result = render(ui, {
    wrapper: makeWrapper("default", colorScheme),
    ...rest,
  });
  liveArmedContainers.add(result.container);
  // If the test unmounts this tree itself, *downgrade* — don't disarm. The drain
  // still runs (it's mechanism-independent: flushing the queued rAF/`setTimeout`
  // while `window` is alive is what avoids the #1760 leak, and a `setState`
  // landing on the now-unmounted tree is a React no-op — this is exactly the
  // mid-flight-unmount case that most needs the drain). We only drop this
  // container from the liveness set, so the auto-settle's `isConnected` check
  // doesn't misread the test's own `unmount()` as a broken cleanup ordering, and
  // — because it's per-container — unmounting one tree doesn't cancel the settle
  // for another still-mounted one. Wrap rather than mutate RTL's result so
  // `rerender`/`container`/etc. pass through unchanged.
  const downgradingUnmount = () => {
    liveArmedContainers.delete(result.container);
    result.unmount();
  };
  return { ...result, unmount: downgradingUnmount };
}

// Fallback settle window: ≈500ms clears a typical few-hundred-millisecond
// transition plus the two-frame rAF scheduling slack. Callers that know their
// component's animation duration should pass `settleMs` (its longest JS timer
// chain — duration plus any `enterDelay`/`exitDelay` — plus slack) rather than
// rely on this default.
const DEFAULT_SETTLE_MS = 500;

// Set by `renderWithMantineTransitions`; consumed once by the `afterEach` below.
// `armedSettleMs === null` means no real-transitions render happened this test,
// so nothing to settle (every `renderWithMantine` / `env="test"` test skips the
// wait entirely). `liveArmedContainers` holds the containers this test rendered
// and did NOT unmount itself — the `afterEach` asserts each is still connected
// (a still-mounted tree that got detached means `cleanup()` ran too early). A
// test's own `unmount()` removes its container from the set (its detach is
// legitimate) but leaves `armedSettleMs` armed so the drain still runs. This
// module-level state assumes **sequential** tests: it isn't concurrency-safe, so
// don't use `renderWithMantineTransitions` under `test.concurrent` /
// `describe.concurrent` (two in-flight tests would share this arming).
let armedSettleMs: number | null = null;
const liveArmedContainers = new Set<HTMLElement>();

function resetArming() {
  armedSettleMs = null;
  liveArmedContainers.clear();
}

// Flush any in-flight `renderWithMantineTransitions` animation before the test
// ends. What's observed when it isn't flushed: an in-flight Mantine transition
// produces an uncaught, post-teardown `dispatchSetState` that throws
// `ReferenceError: window is not defined` from react-dom's
// `resolveUpdatePriority` (React 19 reads `window.event` there) — after
// happy-dom has torn down `window` — failing the whole run even though every
// assertion passed (#1760/#1786). What's known: Mantine's `useTransition` does
// have an unmount cleanup (`useEffect` clearing its rAF + `setTimeout`), yet the
// failing frame is an rAF callback executing *after* teardown, so the precise
// escape route (a cancelAnimationFrame that doesn't fully cancel under
// happy-dom, an rAF re-armed after cleanup, or a scheduler-flushed
// continuation) isn't pinned down. The fix doesn't depend on which: awaiting a
// real timer inside `act` drains the queued rAF callbacks, the terminal
// `setTimeout`, and the React work they schedule against the still-mounted tree
// — whichever is the actual escapee, it resolves on a live component before
// cleanup unmounts. Because it awaits a *real* `setTimeout`, it deadlocks under
// fake timers, so guard against that with a clear message rather than a 5s
// test-timeout hang.
export async function settleTransitions(ms: number = DEFAULT_SETTLE_MS) {
  if (vi.isFakeTimers()) {
    throw new Error(
      "settleTransitions() awaits a real setTimeout and cannot run under " +
        "vi.useFakeTimers(); call vi.useRealTimers() first, or advance the " +
        "faked timers manually to settle the transition.",
    );
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// Auto-settle any armed real transition. This must run — and *complete* — before
// `setup.ts`'s `cleanup()` unmounts the tree, so the settling `setState` targets
// a still-live component. That holds because `cleanup()` is a setupFile hook,
// which Vitest treats as *outer* relative to this import-registered inner hook:
// an inner afterEach runs to completion before an outer one, in *every*
// `sequence.hooks` mode. Verified — ViewHeader's real-transitions tests pass
// under "stack", "list", and "parallel" with neither check below tripping, and a
// same-suite `afterEach(cleanup)` probe (where the ordering *can* break) does
// trip them. So `sequence.hooks` isn't actually load-bearing here; the unit
// project still pins "stack" (conventional LIFO) as defense-in-depth.
// Enforcement is the `container.isConnected` checks over the still-live armed
// containers, which guard against a future regression that makes cleanup run
// before this settle finishes — e.g. cleanup moved to a *same-level* hook: the
// pre-settle check catches it running entirely first, the post-settle check
// catches it detaching the tree concurrently while this hook awaits — a race
// that can only arise if the unit project's `sequence.hooks` is changed from
// "stack" to "parallel" (same-level hooks run sequentially under "stack"/"list"),
// which is exactly why the pre-check can't see it. Neither fires in the current
// outer-cleanup setup. A container the test unmounted itself isn't in
// the set, so its legitimate detach is never mistaken for that regression.
afterEach(async () => {
  const ms = armedSettleMs;
  const liveContainers = [...liveArmedContainers];
  resetArming();
  if (ms === null) return;
  // A `renderWithMantineTransitions` test that also used fake timers can't be
  // drained by a real-timer wait; skip, but warn — silence here is how the leak
  // sneaks back (unlike the manual `settleTransitions`, which throws). No such
  // test exists today.
  if (vi.isFakeTimers()) {
    const testName = expect.getState().currentTestName ?? "(unknown test)";
    console.warn(
      `renderWithMantineTransitions auto-settle skipped for "${testName}": ` +
        "the test is under vi.useFakeTimers(). A real-transitions test should " +
        "not use fake timers — anything left pending on the real clock is then " +
        "unprotected (this settle can't drain it), so the test depends on which " +
        "clock was installed at teardown.",
    );
    return;
  }
  // Drain regardless of whether any tree is still mounted, and even if the
  // liveness check has already failed: a test that unmounted mid-transition still
  // needs the queued rAF/`setTimeout` flushed while `window` is alive (the #1760
  // case), and on the ordering regression the checks exist to catch, draining
  // best-effort keeps the explanatory error below from *also* racing an uncaught
  // post-teardown `window is not defined` in some unrelated file. So capture a
  // liveness failure, always drain, then throw. The pre-settle check catches
  // cleanup() running entirely first; the post-settle check (only meaningful if
  // the pre one passed) catches a same-level concurrent cleanup() detaching a
  // still-live tree mid-settle, which the pre-check can't see. Both apply only to
  // trees the test left mounted.
  let livenessError: unknown;
  const captureLiveness = (when: "before" | "after") => {
    try {
      assertLiveContainersConnected(liveContainers, when);
    } catch (error) {
      livenessError ??= error;
    }
  };
  captureLiveness("before");
  let drainError: unknown;
  try {
    await settleTransitions(ms);
  } catch (error) {
    drainError = error;
  }
  if (livenessError === undefined) captureLiveness("after");
  // A liveness error explains the actual regression; a drain-time throw is a
  // downstream symptom — so prefer the liveness error, else rethrow the drain's.
  if (livenessError !== undefined) {
    if (drainError !== undefined) {
      // Preserve the drain error rather than dropping it when both fire: attach
      // it as the liveness error's `cause` (when that's an Error) *and* log it,
      // so it's readable regardless of whether the reporter renders `cause` and
      // on the (currently unreachable) path where the liveness error isn't an
      // Error and no cause can be set.
      if (livenessError instanceof Error) livenessError.cause = drainError;
      console.error(
        "renderWithMantineTransitions auto-settle: the drain also threw:",
        drainError,
      );
    }
    throw livenessError;
  }
  if (drainError !== undefined) throw drainError;
});

// Throw if any still-live armed tree was detached at the given point relative to
// the settle — meaning something unmounted it before this settle finished, so it
// drained against a dead tree and the #1760 leak is reopened. Only trees the
// test left mounted are passed here; a tree the test unmounted itself (via the
// wrapped `unmount()`) is excluded, so its legitimate detach never lands here.
function assertLiveContainersConnected(
  containers: HTMLElement[],
  when: "before" | "after",
) {
  if (containers.some((c) => !c.isConnected)) {
    // The check observes only that a tree the test left mounted is no longer
    // connected — it can't identify *what* detached it — so state that
    // observation, then list the candidate causes rather than asserting one.
    throw new Error(
      `renderWithMantineTransitions auto-settle: a still-mounted armed tree was ` +
        `detached ${when === "before" ? "before the settle started" : "while the settle was in flight"}, ` +
        "so the settle drained against a dead tree and the #1760 leak is " +
        "reopened. Candidate causes: (a) a bare mid-body `cleanup()` in the test " +
        "— use the `unmount()` returned by renderWithMantineTransitions instead " +
        "(it drops the tree from the liveness set); or (b) `cleanup()` moved off " +
        "setup.ts's setupFile (outer) hook to a same-level afterEach, so it no " +
        "longer runs after this one (the `sequence.hooks` pin is defense-in-" +
        "depth, not the guarantee — see the auto-settle ordering note in " +
        "renderWithMantine.tsx).",
    );
  }
}

export * from "@testing-library/react";
