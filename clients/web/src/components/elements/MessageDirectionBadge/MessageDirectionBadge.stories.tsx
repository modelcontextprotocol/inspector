import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MessageDirectionBadge } from "./MessageDirectionBadge";

const meta: Meta<typeof MessageDirectionBadge> = {
  title: "Elements/MessageDirectionBadge",
  component: MessageDirectionBadge,
};

export default meta;
type Story = StoryObj<typeof MessageDirectionBadge>;

export const Outgoing: Story = {
  args: { direction: "outgoing" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("client → server")).toBeInTheDocument();
  },
};

export const Incoming: Story = {
  args: { direction: "incoming" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("server → client")).toBeInTheDocument();
  },
};
