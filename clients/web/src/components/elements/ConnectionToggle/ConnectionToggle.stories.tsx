import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ConnectionToggle } from "./ConnectionToggle";

const meta: Meta<typeof ConnectionToggle> = {
  title: "Elements/ConnectionToggle",
  component: ConnectionToggle,
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ConnectionToggle>;

export const Connected: Story = {
  args: {
    checked: true,
    loading: false,
    disabled: false,
  },
};

export const Disconnected: Story = {
  args: {
    checked: false,
    loading: false,
    disabled: false,
  },
};

export const Loading: Story = {
  args: {
    checked: false,
    loading: true,
    disabled: false,
  },
};

export const Disabled: Story = {
  args: {
    checked: false,
    loading: false,
    disabled: true,
  },
};
