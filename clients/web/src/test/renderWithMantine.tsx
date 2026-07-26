import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MantineProvider, type MantineColorScheme } from "@mantine/core";
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
// leaves no DOM signal to `waitFor`, so tests that open a transition they can't
// observe closing should flush pending timers against the still-mounted tree
// before ending (see `settleTransitions` in ViewHeader.test.tsx, #1786).
export function renderWithMantineTransitions(
  ui: ReactElement,
  options?: MantineRenderOptions,
) {
  const { colorScheme = "light", ...rest } = options ?? {};
  return render(ui, { wrapper: makeWrapper("default", colorScheme), ...rest });
}

export * from "@testing-library/react";
