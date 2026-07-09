import { createRef } from "react";
import { Stack, Text } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { EmbeddableScrollArea } from "./EmbeddableScrollArea";

const meta: Meta<typeof EmbeddableScrollArea> = {
  title: "Elements/EmbeddableScrollArea",
  component: EmbeddableScrollArea,
};

export default meta;
type Story = StoryObj<typeof EmbeddableScrollArea>;

const rows = Array.from({ length: 40 }, (_, i) => (
  <Text key={i}>Row {i + 1}</Text>
));

export const FullSize: Story = {
  render: () => (
    <EmbeddableScrollArea embedded={false} viewportRef={createRef()}>
      <Stack gap="xs">{rows}</Stack>
    </EmbeddableScrollArea>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Row 1")).toBeInTheDocument();
  },
};

export const Embedded: Story = {
  render: () => (
    <Stack h={240} gap={0}>
      <EmbeddableScrollArea embedded viewportRef={createRef()}>
        <Stack gap="xs">{rows}</Stack>
      </EmbeddableScrollArea>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Row 1")).toBeInTheDocument();
  },
};
