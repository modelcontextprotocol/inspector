import type { ReactElement, ReactNode } from "react";
import { act, render, type RenderOptions } from "@testing-library/react";
import { MantineProvider, type MantineColorScheme } from "@mantine/core";
import { vi } from "vitest";
import { theme } from "../theme/theme";

// Options accepted by both render helpers: the standard RTL options (minus
// `wrapper`, which we own) plus an optional forced `colorScheme`. The default
// is "light"; pass "dark" to exercise `useComputedColorScheme` dark branches
// without hand-rolling a bare `MantineProvider` (the #1760 anti-pattern).
type MantineRenderOptions = Omit<RenderOptions, "wrapper"> & {
  colorScheme?: MantineColorScheme;
};

// Build a MantineProvider wrapper for the given `env` + forced color scheme.
// `env="test"` makes Mantine render transitions synchronously (no internal
// `setTimeout`). Without it, a `Transition`/`Modal` open/close timer can fire
// after happy-dom tears down `window` at the end of the run, throwing an
// uncaught `ReferenceError: window is not defined` that fails the whole run
// even when every assertion passed (#1760). This is the right default for the
// vast majority of tests, which don't assert on mid-transition state.
function makeWrapper(env: "test" | "default", colorScheme: MantineColorScheme) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider theme={theme} defaultColorScheme={colorScheme} env={env}>
        {children}
      </MantineProvider>
    );
  };
}

export function renderWithMantine(
  ui: ReactElement,
  options?: MantineRenderOptions,
) {
  const { colorScheme = "light", ...rest } = options ?? {};
  return render(ui, { wrapper: makeWrapper("test", colorScheme), ...rest });
}

// Opt-in variant that keeps Mantine's timer-driven transitions enabled, for the
// few tests that assert on transition/animation state that only exists mid-flight
// (e.g. a `data-anim="out"` cell during an exit crossfade). Such a test MUST
// drive every transition to completion so no rAF→`setTimeout` chain is still
// pending at teardown; otherwise it reintroduces the #1760 leak. A settled enter
// leaves no DOM signal to `waitFor`, so a test that opens a transition it can't
// observe closing should call `settleTransitions()` before ending (#1786).
export function renderWithMantineTransitions(
  ui: ReactElement,
  options?: MantineRenderOptions,
) {
  const { colorScheme = "light", ...rest } = options ?? {};
  return render(ui, { wrapper: makeWrapper("default", colorScheme), ...rest });
}

// Fallback settle window: Mantine's default header transitions run ~300ms, so
// 500ms clears them plus the two-frame rAF scheduling slack. Callers that know
// their component's animation duration should pass it (duration + slack) rather
// than rely on this.
const DEFAULT_SETTLE_MS = 500;

// Flush any in-flight `renderWithMantineTransitions` animation before the test
// ends. Mantine's `useTransition` cancels its own timers on unmount (its
// `useEffect` cleanup clears the rAF + `setTimeout`), so the hazard isn't a
// timer surviving unmount — it's the React state update that Mantine's inner
// rAF schedules *outside* `act` (`setStatus("entering"/"exiting")` → the
// terminal `setStatus`). Left in flight, that work resolves after happy-dom
// tears down `window` and throws `ReferenceError: window is not defined` from
// react-dom's `dispatchSetState → resolveUpdatePriority`, failing the whole run
// even when every assertion passed (#1760/#1786). This awaits a real timer
// inside `act` so those queued rAF callbacks and the React updates they schedule
// run and flush against the still-mounted tree — the ordering that keeps the
// settling `setState` on a live component. Because it awaits a *real*
// `setTimeout`, it deadlocks under fake timers, so guard against that with a
// clear message rather than a 5s test-timeout hang.
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

export * from "@testing-library/react";
