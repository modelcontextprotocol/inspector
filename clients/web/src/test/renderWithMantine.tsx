import type { ReactElement, ReactNode } from "react";
import { act, render, type RenderOptions } from "@testing-library/react";
import { MantineProvider, type MantineColorScheme } from "@mantine/core";
import { afterEach, vi } from "vitest";
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
  armedContainer = result.container;
  return result;
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
// wait entirely). `armedContainer` is the most recent such render's container,
// used by the `afterEach` to assert it settles *before* cleanup unmounts.
let armedSettleMs: number | null = null;
let armedContainer: HTMLElement | null = null;

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

// Auto-settle any armed real transition. This runs *before* `setup.ts`'s
// setupFile `cleanup()` unmounts the tree — the ordering the fix depends on, so
// the settling `setState` targets a still-live component. setupFile afterEach
// hooks are outer relative to this import-registered inner hook, so this runs
// first in every `sequence.hooks` mode (verified across stack/list/parallel);
// the unit project additionally pins "stack" as defense-in-depth. The
// `container.isConnected` check below is the actual enforcement — it turns a
// broken ordering into a loud failure rather than a silently-reopened leak,
// regardless of what guarantees it.
afterEach(async () => {
  const ms = armedSettleMs;
  const container = armedContainer;
  armedSettleMs = null;
  armedContainer = null;
  if (ms === null) return;
  // A `renderWithMantineTransitions` test that also used fake timers can't be
  // drained by a real-timer wait; skip, but warn — silence here is how the leak
  // sneaks back (unlike the manual `settleTransitions`, which throws). No such
  // test exists today.
  if (vi.isFakeTimers()) {
    console.warn(
      "renderWithMantineTransitions auto-settle skipped: the test is under " +
        "vi.useFakeTimers(). A real-transitions test should not use fake " +
        "timers — the #1760 leak is unprotected once the settle no-ops.",
    );
    return;
  }
  // If the tree is already detached, cleanup() ran first — the afterEach
  // ordering this depends on broke, and the settle would drain nothing,
  // silently reopening the #1760 leak. Fail loudly instead.
  if (container && !container.isConnected) {
    throw new Error(
      "renderWithMantineTransitions auto-settle ran after cleanup() unmounted " +
        "the tree — the afterEach ordering it depends on broke, so the settle " +
        "drained nothing and the #1760 leak is reopened. This hook must run " +
        "before setup.ts's cleanup (see the ordering note here and the " +
        '`sequence.hooks: "stack"` pin in vite.config.ts).',
    );
  }
  await settleTransitions(ms);
});

export * from "@testing-library/react";
