import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SubscribeButton } from "./SubscribeButton";

const meta: Meta<typeof SubscribeButton> = {
  title: "Atoms/SubscribeButton",
  component: SubscribeButton,
  args: {
    onToggle: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SubscribeButton>;

export const Subscribed: Story = {
  args: {
    subscribed: true,
  },
};

export const Unsubscribed: Story = {
  args: {
    subscribed: false,
  },
};
