import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import type { ReactNode } from "react";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { AppRenderer, type BridgeFactory } from "./AppRenderer";

const PLACEHOLDER_SANDBOX = "data:text/html,<title>Mock%20Sandbox</title>";

const cohortTool: Tool = {
  name: "get-cohort-data",
  title: "Cohort Data",
  description: "Returns cohort retention heatmap data.",
  inputSchema: { type: "object" },
};

function createMockBridge(): AppBridge {
  return {
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  } as unknown as AppBridge;
}

const okFactory: BridgeFactory = () => createMockBridge();

const pendingFactory: BridgeFactory = () =>
  new Promise<AppBridge>(() => {
    // Never resolves — represents the period before the bridge is ready.
  });

const failingFactory: BridgeFactory = () =>
  Promise.reject(
    new globalThis.Error("Bridge connect failed: handshake timed out"),
  );

function FrameContainer({
  children,
  size,
}: {
  children: ReactNode;
  size: "default" | "maximized";
}) {
  const dims =
    size === "maximized" ? { w: "100%", h: 600 } : { w: 480, h: 320 };
  return (
    <Box {...dims} bd="1px solid var(--mantine-color-gray-4)">
      {children}
    </Box>
  );
}

const meta: Meta<typeof AppRenderer> = {
  title: "Elements/AppRenderer",
  component: AppRenderer,
  args: {
    sandboxPath: PLACEHOLDER_SANDBOX,
    tool: cohortTool,
    onError: fn(),
  },
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof AppRenderer>;

export const Loading: Story = {
  args: {
    bridgeFactory: pendingFactory,
  },
  render: (args) => (
    <FrameContainer size="default">
      <AppRenderer {...args} />
    </FrameContainer>
  ),
};

export const Loaded: Story = {
  args: {
    bridgeFactory: okFactory,
  },
  render: (args) => (
    <FrameContainer size="default">
      <AppRenderer {...args} />
    </FrameContainer>
  ),
};

export const Error: Story = {
  args: {
    bridgeFactory: failingFactory,
  },
  render: (args) => (
    <FrameContainer size="default">
      <AppRenderer {...args} />
    </FrameContainer>
  ),
};

export const Maximized: Story = {
  args: {
    bridgeFactory: okFactory,
  },
  render: (args) => (
    <FrameContainer size="maximized">
      <AppRenderer {...args} />
    </FrameContainer>
  ),
};
