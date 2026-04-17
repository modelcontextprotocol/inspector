import type { Meta, StoryObj } from "@storybook/react-vite";
import { TransportBadge } from "./TransportBadge";

const meta: Meta<typeof TransportBadge> = {
  title: "Elements/TransportBadge",
  component: TransportBadge,
};

export default meta;
type Story = StoryObj<typeof TransportBadge>;

export const Stdio: Story = {
  args: {
    transport: "stdio",
  },
};

export const Sse: Story = {
  args: {
    transport: "sse",
  },
};

export const StreamableHttp: Story = {
  args: {
    transport: "streamable-http",
  },
};
