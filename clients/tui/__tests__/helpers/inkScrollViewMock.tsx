import React from "react";
import { Box } from "ink";

/**
 * Test double for `ink-scroll-view`.
 *
 * The real ScrollView measures the TTY viewport and virtualizes its
 * children; under ink-testing-library there is no real terminal, so it
 * renders a placeholder minimap and never mounts its children — which both
 * hides inner content from `lastFrame()` and skips the inner JSX for
 * coverage. This passthrough renders children directly inside a Box and
 * stubs the imperative ref API (scrollBy / scrollTo / getViewportHeight)
 * that components call from their useInput handlers.
 *
 * Usage in a test file:
 *   vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
 */
export interface ScrollViewRef {
  scrollBy: (delta: number) => void;
  scrollTo: (offset: number) => void;
  getViewportHeight: () => number;
}

export const ScrollView = React.forwardRef<
  ScrollViewRef,
  { children?: React.ReactNode; height?: number }
>(function ScrollView({ children }, ref) {
  React.useImperativeHandle(ref, () => ({
    scrollBy: () => {},
    scrollTo: () => {},
    getViewportHeight: () => 10,
  }));
  return <Box flexDirection="column">{children}</Box>;
});
