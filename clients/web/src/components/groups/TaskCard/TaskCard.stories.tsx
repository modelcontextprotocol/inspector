import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { TaskCard } from "./TaskCard";

const meta: Meta<typeof TaskCard> = {
  title: "Groups/TaskCard",
  component: TaskCard,
  args: {
    onCancel: fn(),
    isListExpanded: true,
  },
};

export default meta;
type Story = StoryObj<typeof TaskCard>;

export const Running: Story = {
  args: {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "running",
    method: "tools/call",
    target: "generate_report",
    progress: 80,
    progressDescription: "Synthesizing findings...",
    startedAt: "3/29/2026, 8:18:20 PM",
    lastUpdated: "3/29/2026, 8:18:22 PM",
    ttl: 300000,
  },
};

export const Waiting: Story = {
  args: {
    taskId: "4100b5e0b0ed9cd0023330342d1bf647",
    status: "waiting",
    method: "resources/read",
    target: "file:///data/report.csv",
    startedAt: "3/29/2026, 8:17:55 PM",
    lastUpdated: "3/29/2026, 8:17:55 PM",
    ttl: 300000,
  },
};

export const Completed: Story = {
  args: {
    taskId: "d487b49aa39023d907b5a2a5b506cb3",
    status: "completed",
    method: "tools/call",
    target: "generate_summary",
    startedAt: "3/29/2026, 8:16:47 PM",
    completedAt: "3/29/2026, 8:16:51 PM",
    lastUpdated: "3/29/2026, 8:16:51 PM",
    ttl: 300000,
    progressDescription: "Generating report...",
  },
};

export const Failed: Story = {
  args: {
    taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
    status: "failed",
    method: "tools/call",
    target: "fetch_remote_data",
    startedAt: "3/29/2026, 8:17:27 PM",
    completedAt: "3/29/2026, 8:17:28 PM",
    lastUpdated: "3/29/2026, 8:17:28 PM",
    ttl: 300000,
    error: "Connection refused: upstream server not responding after 3 retries",
  },
};

export const Cancelled: Story = {
  args: {
    taskId: "c416bc183cb04468d3f81696f1b868f6",
    status: "cancelled",
    method: "tools/call",
    target: "long_running_analysis",
    startedAt: "3/29/2026, 8:18:15 PM",
    completedAt: "3/29/2026, 8:18:18 PM",
    lastUpdated: "3/29/2026, 8:18:18 PM",
    ttl: 300000,
  },
};

export const Collapsed: Story = {
  args: {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "running",
    method: "tools/call",
    target: "generate_report",
    progress: 80,
    progressDescription: "Synthesizing findings...",
    startedAt: "3/29/2026, 8:18:20 PM",
    lastUpdated: "3/29/2026, 8:18:22 PM",
    ttl: 300000,
    isListExpanded: false,
  },
};
