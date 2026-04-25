import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ViewHeader } from "./ViewHeader";

const meta: Meta<typeof ViewHeader> = {
  title: "Groups/ViewHeader",
  component: ViewHeader,
  decorators: [
    (Story) => (
      <AppShell header={{ height: 60 }}>
        <AppShell.Header>
          <Story />
        </AppShell.Header>
      </AppShell>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ViewHeader>;

export const Connected: Story = {
  args: {
    connected: true,
    serverInfo: { name: "my-mcp-server", version: "1.2.0" },
    status: "connected",
    latencyMs: 23,
    activeTab: "Tools",
    availableTabs: [
      "Tools",
      "Resources",
      "Prompts",
      "Tasks",
      "Logs",
      "History",
    ],
    onTabChange: fn(),
    onDisconnect: fn(),
    onToggleTheme: fn(),
  },
};

export const Unconnected: Story = {
  args: {
    connected: false,
    onToggleTheme: fn(),
  },
};
