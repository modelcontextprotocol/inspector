import type { ReactNode } from "react";
import { Flex, Transition } from "@mantine/core";

/** Screen enter / exit durations for the shared `fade-up` stage transition. */
export const SCREEN_ENTER_MS = 350;
export const SCREEN_EXIT_MS = 250;

// A single absolutely-positioned layer, so a Flex primitive (Box can't use
// `.withProps()`). `direction: "column"` is load-bearing: the child screen must
// fill the layer's width the way it did under the old block-level `Box`. A
// column flex puts the width on the cross axis, where Mantine's default
// `align-items: stretch` makes the single child fill it (a row flex would size
// the child to its content, collapsing screens whose width is content-agnostic —
// e.g. ServerListScreen's `container`-typed grid). The dynamic transition
// `style` and the `bottom` anchor are passed at the call site.
const StageLayer = Flex.withProps({
  direction: "column",
  pos: "absolute",
  top: 0,
  left: 0,
  right: 0,
});

export interface ScreenStageProps {
  /** True when this stage's screen is the active one. */
  active: boolean;
  children: ReactNode;
  /**
   * Stretch the stage to fill its relative-positioned parent (adds `bottom: 0`).
   * Needed where the screen relies on the parent for height (e.g. an inner
   * ScrollArea in the monitoring sidebar). Off by default so callers whose
   * screens size themselves keep the top/left/right anchoring.
   */
  fill?: boolean;
}

/**
 * Wraps a screen in a Mantine `fade-up` Transition so that, on switch, the
 * incoming screen slides up and fades in while the outgoing one fades down and
 * out — both mounted at once via absolute positioning. With Transition's default
 * (`keepMounted={false}`) the outgoing screen unmounts after its exit animation,
 * resetting any local screen state (search filters, scroll, expanded sections).
 *
 * Shared by the primary InspectorView pane and the pinned monitoring sidebar so
 * both use identical enter/exit motion (#1639-follow-up). Must be rendered
 * inside a `position: relative` container.
 */
export function ScreenStage({
  active,
  children,
  fill = false,
}: ScreenStageProps) {
  return (
    // Stays inline: Transition is a headless, non-`factory()` Mantine component,
    // so it has no `.withProps` static at all (same tooling limit as Box).
    <Transition
      mounted={active}
      transition="fade-up"
      duration={SCREEN_ENTER_MS}
      exitDuration={SCREEN_EXIT_MS}
      timingFunction="ease"
    >
      {(styles) => (
        // `style={styles}` is the runtime transition state from Mantine's
        // Transition API — interpolated values, not static styling.
        <StageLayer style={styles} bottom={fill ? 0 : undefined}>
          {children}
        </StageLayer>
      )}
    </Transition>
  );
}
