import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Text } from "@mantine/core";
import { ConnectedLayout } from "./ConnectedLayout";

const allTabs = ["Tools", "Resources", "Prompts", "Logs", "Tasks", "History"];

const meta: Meta<typeof ConnectedLayout> = {
  title: "Layouts/ConnectedLayout",
  component: ConnectedLayout,
  parameters: { layout: "fullscreen" },
  args: {
    serverName: "my-mcp-server",
    status: "connected",
    latencyMs: 23,
    availableTabs: allTabs,
    activeTab: "Tools",
    onTabChange: fn(),
    onDisconnect: fn(),
    onToggleTheme: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ConnectedLayout>;

export const ToolsActive: Story = {
  args: {
    activeTab: "Tools",
    children: <Text>Tools screen content</Text>,
  },
};

export const ResourcesActive: Story = {
  args: {
    activeTab: "Resources",
    children: <Text>Resources screen content</Text>,
  },
};

export const LimitedTabs: Story = {
  args: {
    availableTabs: ["Tools", "Resources", "Prompts"],
    children: <Text>Tools screen content</Text>,
  },
};

export const LongServerName: Story = {
  args: {
    serverName: "my-very-long-server-name-that-might-overflow",
    children: <Text>Tools screen content</Text>,
  },
};
