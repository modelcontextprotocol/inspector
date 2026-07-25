import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { theme } from "../theme/theme";

// `env="test"` makes Mantine render transitions synchronously (no internal
// `setTimeout`). Without it, a `Transition`/`Modal` open/close timer can fire
// after happy-dom tears down `window` at the end of the run, throwing an
// uncaught `ReferenceError: window is not defined` that fails the whole run
// even when every assertion passed (#1760). This is the right default for the
// vast majority of tests, which don't assert on mid-transition state.
function TestEnvWrapper({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light" env="test">
      {children}
    </MantineProvider>
  );
}

// Opt-in wrapper that keeps Mantine's timer-driven transitions enabled, for the
// few tests that assert on transition/animation state that only exists mid-flight
// (e.g. a `data-anim="out"` cell during an exit crossfade). Such a test MUST
// drive the transition to completion (`await waitFor`/`findBy`) so its timer
// resolves before teardown; otherwise it reintroduces the #1760 leak.
function TransitionsWrapper({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="light" env="default">
      {children}
    </MantineProvider>
  );
}

export function renderWithMantine(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: TestEnvWrapper, ...options });
}

export function renderWithMantineTransitions(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: TransitionsWrapper, ...options });
}

export * from "@testing-library/react";
