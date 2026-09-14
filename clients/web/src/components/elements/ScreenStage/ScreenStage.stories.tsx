import { Box } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ScreenStage } from "./ScreenStage";

const meta: Meta<typeof ScreenStage> = {
  title: "Elements/ScreenStage",
  component: ScreenStage,
};

export default meta;
type Story = StoryObj<typeof ScreenStage>;

// ScreenStage positions its screen absolutely, so it must be rendered inside a
// `position: relative` host. A fixed width lets the play function assert layout.
const HOST_WIDTH = 600;

// A stage child with negligible intrinsic width (a single "x") — like
// ServerListScreen's `container`-typed grid, whose inline size is computed
// without regard to its contents. In a *row* flex such a child collapses to its
// content width; only a column flex (align-items: stretch) makes it fill. So its
// rendered width is the direct tell for the #1762 `Box → Flex` regression.
const narrowChild = (
  <Box data-testid="stage-child" bg="var(--inspector-surface-card)">
    x
  </Box>
);

/**
 * Regression guard for the ScreenStage `Box → Flex` conversion (#1762): the
 * child screen must fill the stage's width the way it did under the old
 * block-level `Box`. A row flex would content-size it (a few px wide here); the
 * `direction: "column"` on `StageLayer` puts the width on the stretch axis so it
 * fills. Play functions run in real Chromium, so this measures actual layout —
 * unlike happy-dom, which does none.
 */
export const FillsHostWidth: Story = {
  render: () => (
    <Box pos="relative" w={HOST_WIDTH} h={160}>
      <ScreenStage active>{narrowChild}</ScreenStage>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const child = await canvas.findByTestId("stage-child");
    // The child fills its stage layer — asserted relative to the layer's actual
    // width, not a literal, so it can't break on host-sizing quirks (and is a
    // sharper discriminator: a row flex leaves the layer full-width while
    // collapsing the child to the single "x").
    const layer = child.parentElement as HTMLElement;
    await expect(child.getBoundingClientRect().width).toBeCloseTo(
      layer.getBoundingClientRect().width,
      0,
    );
  },
};

/**
 * The `fill` variant additionally anchors `bottom: 0`, stretching the *stage
 * layer* to the host's full height (so a screen that relies on the parent for
 * height — e.g. an inner ScrollArea with `flex: 1` — has a definite-height box to
 * fill). Note this stretches the layer, not the plain child: `align-items:
 * stretch` fills the cross axis (width), while the main axis (height) stays
 * content-sized unless the child itself grows.
 */
export const FillVariant: Story = {
  render: () => (
    <Box pos="relative" w={HOST_WIDTH} h={160}>
      <ScreenStage active fill>
        {narrowChild}
      </ScreenStage>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const child = await canvas.findByTestId("stage-child");
    // Width still stretches onto the child (relative to the layer, as above);
    // the `fill` height comes from `bottom: 0` making the layer span the host.
    const layer = child.parentElement as HTMLElement;
    await expect(child.getBoundingClientRect().width).toBeCloseTo(
      layer.getBoundingClientRect().width,
      0,
    );
    await expect(layer.getBoundingClientRect().height).toBeGreaterThan(160 - 4);
  },
};

/**
 * Inactive stages are unmounted (Transition's default `keepMounted={false}`), so
 * the screen — and its local state — is gone until it becomes active again.
 */
export const Inactive: Story = {
  render: () => (
    <Box pos="relative" w={HOST_WIDTH} h={160}>
      <ScreenStage active={false}>{narrowChild}</ScreenStage>
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("stage-child")).not.toBeInTheDocument();
  },
};
