import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { TaskListPanel } from "./TaskListPanel";
import type { TaskCardProps } from "../TaskCard/TaskCard";

const sampleTasks: TaskCardProps[] = [
  {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "running",
    method: "tools/call",
    target: "generate_report",
    progress: 80,
    progressDescription: "Synthesizing findings...",
    startedAt: "3/29/2026, 8:18:20 PM",
    lastUpdated: "3/29/2026, 8:18:22 PM",
    ttl: 300000,
    isListExpanded: true,
    onCancel: fn(),
  },
  {
    taskId: "4100b5e0b0ed9cd0023330342d1bf647",
    status: "waiting",
    method: "resources/read",
    target: "file:///data/report.csv",
    startedAt: "3/29/2026, 8:17:55 PM",
    lastUpdated: "3/29/2026, 8:17:55 PM",
    ttl: 300000,
    isListExpanded: true,
    onCancel: fn(),
  },
  {
    taskId: "d487b49aa39023d907b5a2a5b506cb3",
    status: "completed",
    method: "tools/call",
    target: "generate_summary",
    startedAt: "3/29/2026, 8:16:47 PM",
    completedAt: "3/29/2026, 8:16:51 PM",
    lastUpdated: "3/29/2026, 8:16:51 PM",
    ttl: 300000,
    progressDescription: "Generating report...",
    isListExpanded: true,
    onCancel: fn(),
  },
  {
    taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
    status: "failed",
    method: "tools/call",
    target: "fetch_remote_data",
    startedAt: "3/29/2026, 8:17:27 PM",
    lastUpdated: "3/29/2026, 8:17:28 PM",
    ttl: 300000,
    error: "Connection refused: upstream server not responding",
    isListExpanded: true,
    onCancel: fn(),
  },
];

const meta: Meta<typeof TaskListPanel> = {
  title: "Groups/TaskListPanel",
  component: TaskListPanel,
  args: {
    tasks: sampleTasks,
    searchText: "",
  },
};

export default meta;
type Story = StoryObj<typeof TaskListPanel>;

export const Default: Story = {};

export const FilteredByStatus: Story = {
  args: {
    statusFilter: "running",
  },
};

export const WithSearch: Story = {
  args: {
    searchText: "generate",
  },
};

export const Empty: Story = {
  args: {
    tasks: [],
  },
};
