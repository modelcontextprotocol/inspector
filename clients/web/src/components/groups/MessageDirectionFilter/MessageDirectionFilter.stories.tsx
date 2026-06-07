import { Stack } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import {
  MessageDirectionFilter,
  type MessageDirectionFilterProps,
} from "./MessageDirectionFilter";

function Wrapped(args: MessageDirectionFilterProps) {
  return (
    <Stack gap="md" w={320}>
      <MessageDirectionFilter {...args} />
    </Stack>
  );
}

const meta: Meta<typeof MessageDirectionFilter> = {
  title: "Groups/MessageDirectionFilter",
  component: MessageDirectionFilter,
  render: Wrapped,
  args: {
    onToggleDirection: fn(),
    onToggleAllDirections: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof MessageDirectionFilter>;

export const AllVisible: Story = {
  args: { visibleDirections: { client: true, server: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("button", { name: "client → server" }),
    ).toBeInTheDocument();
    expect(
      canvas.getByRole("button", { name: "Deselect All" }),
    ).toBeInTheDocument();
  },
};

export const OnlyOutgoing: Story = {
  args: { visibleDirections: { client: true, server: false } },
};
