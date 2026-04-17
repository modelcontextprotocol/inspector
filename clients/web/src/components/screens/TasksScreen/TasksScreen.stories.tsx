import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { TasksScreen } from "./TasksScreen";
import type { TaskCardProps } from "../../groups/TaskCard/TaskCard";

const meta: Meta<typeof TasksScreen> = {
  title: "Screens/TasksScreen",
  component: TasksScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onRefresh: fn(),
    onClearHistory: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TasksScreen>;

const sampleTasks: TaskCardProps[] = [
  {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "working",
    method: "tools/call",
    target: "batch_process",
    progress: 65,
    progressDescription: "Processing records 650 of 1000...",
    startedAt: "3/29/2026, 8:18:20 PM",
    lastUpdated: "3/29/2026, 8:18:22 PM",
    ttl: 300000,
    isListExpanded: true,
    onCancel: fn(),
  },
  {
    taskId: "4100b5e0b0ed9cd0023330342d1bf647",
    status: "input_required",
    method: "resources/read",
    target: "file:///data/large-dataset.csv",
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
    target: "send_message",
    startedAt: "3/29/2026, 8:16:47 PM",
    completedAt: "3/29/2026, 8:16:49 PM",
    lastUpdated: "3/29/2026, 8:16:49 PM",
    ttl: 300000,
    isListExpanded: true,
    onCancel: fn(),
  },
  {
    taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
    status: "failed",
    method: "tools/call",
    target: "delete_records",
    startedAt: "3/29/2026, 8:17:27 PM",
    completedAt: "3/29/2026, 8:17:57 PM",
    lastUpdated: "3/29/2026, 8:17:57 PM",
    ttl: 300000,
    error: "Timeout waiting for tool response after 30s",
    isListExpanded: true,
    onCancel: fn(),
  },
];

export const Mixed: Story = {
  args: {
    tasks: sampleTasks,
  },
};

export const ActiveOnly: Story = {
  args: {
    tasks: sampleTasks.filter(
      (t) => t.status === "working" || t.status === "input_required",
    ),
  },
};

export const CompletedOnly: Story = {
  args: {
    tasks: sampleTasks.filter(
      (t) => t.status !== "working" && t.status !== "input_required",
    ),
  },
};

export const Empty: Story = {
  args: {
    tasks: [],
  },
};
