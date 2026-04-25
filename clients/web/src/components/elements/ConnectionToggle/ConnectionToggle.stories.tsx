import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ConnectionToggle } from "./ConnectionToggle";

const meta: Meta<typeof ConnectionToggle> = {
  title: "Elements/ConnectionToggle",
  component: ConnectionToggle,
  args: {
    onToggle: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ConnectionToggle>;

export const Connected: Story = {
  args: {
    status: "connected",
  },
};

export const Disconnected: Story = {
  args: {
    status: "disconnected",
  },
};

export const Connecting: Story = {
  args: {
    status: "connecting",
  },
};

export const Disabled: Story = {
  args: {
    status: "disconnected",
    disabled: true,
  },
};

export const Error: Story = {
  args: {
    status: "error",
  },
};
