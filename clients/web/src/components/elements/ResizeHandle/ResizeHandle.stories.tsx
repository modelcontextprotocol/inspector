import { useState } from "react";
import { Box, Group, Text } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ResizeHandle } from "./ResizeHandle";

const meta: Meta<typeof ResizeHandle> = {
  title: "Elements/ResizeHandle",
  component: ResizeHandle,
};

export default meta;
type Story = StoryObj<typeof ResizeHandle>;

// A minimal split so the handle has a panel to resize in the docs view. The
// panel sits to the right; dragging the handle left widens it.
function ResizeDemo() {
  const [width, setWidth] = useState(320);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  return (
    <Group h={200} gap={0} wrap="nowrap">
      <Box flex={1} bg="var(--inspector-surface-subtle)" p="md">
        <Text>Primary</Text>
      </Box>
      <ResizeHandle
        value={dragWidth ?? width}
        min={200}
        max={520}
        onChange={setDragWidth}
        onCommit={(next) => {
          setWidth(next);
          setDragWidth(null);
        }}
        aria-label="Resize demo panel"
      />
      <Box w={dragWidth ?? width} p="md" bg="var(--inspector-surface-card)">
        <Text>Column ({dragWidth ?? width}px)</Text>
      </Box>
    </Group>
  );
}

export const Default: Story = {
  render: () => <ResizeDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("separator", { name: "Resize demo panel" }),
    ).toBeInTheDocument();
  },
};
