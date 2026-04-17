import type { Meta, StoryObj } from "@storybook/react-vite";
import { InlineError } from "./InlineError";

const meta: Meta<typeof InlineError> = {
  title: "Elements/InlineError",
  component: InlineError,
};

export default meta;
type Story = StoryObj<typeof InlineError>;

export const ShortError: Story = {
  args: {
    error: { message: "Connection timeout after 20s" },
  },
};

export const WithRetryCount: Story = {
  args: {
    error: { message: "Connection failed" },
    retryCount: 3,
    maxRetries: 5,
  },
};

export const WithDetails: Story = {
  args: {
    error: {
      message: "Connection refused",
      data: "Error: ECONNREFUSED 127.0.0.1:3000\n  at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1494:16)",
    },
  },
};

export const WithDocLink: Story = {
  args: {
    error: { message: "Connection failed" },
    docLink: "https://example.com/troubleshooting",
  },
};

export const FullError: Story = {
  args: {
    error: {
      message: "Connection refused",
      data: "Error: ECONNREFUSED 127.0.0.1:3000\n  at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1494:16)",
    },
    retryCount: 3,
    maxRetries: 5,
    docLink: "https://example.com/troubleshooting",
  },
};
