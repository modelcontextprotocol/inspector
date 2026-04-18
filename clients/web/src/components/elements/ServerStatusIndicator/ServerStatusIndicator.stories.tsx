import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerStatusIndicator } from "./ServerStatusIndicator";

const meta: Meta<typeof ServerStatusIndicator> = {
  title: "Elements/ServerStatusIndicator",
  component: ServerStatusIndicator,
};

export default meta;
type Story = StoryObj<typeof ServerStatusIndicator>;

export const Connected: Story = {
  args: {
    status: "connected",
    latencyMs: 23,
  },
};

export const Connecting: Story = {
  args: {
    status: "connecting",
  },
};

export const Disconnected: Story = {
  args: {
    status: "disconnected",
  },
};

export const Error: Story = {
  args: {
    status: "error",
  },
};

export const ErrorWithRetries: Story = {
  args: {
    status: "error",
    retryCount: 3,
  },
};
