import type { ReactNode } from "react";
import { Box, Transition } from "@mantine/core";

/** Screen enter / exit durations for the shared `fade-up` stage transition. */
export const SCREEN_ENTER_MS = 350;
export const SCREEN_EXIT_MS = 250;

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
        <Box
          style={styles}
          pos="absolute"
          top={0}
          left={0}
          right={0}
          bottom={fill ? 0 : undefined}
        >
          {children}
        </Box>
      )}
    </Transition>
  );
}
