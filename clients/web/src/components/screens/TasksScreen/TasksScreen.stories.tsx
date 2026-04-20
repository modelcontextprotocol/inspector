import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { TasksScreen } from "./TasksScreen";

const meta: Meta<typeof TasksScreen> = {
  title: "Screens/TasksScreen",
  component: TasksScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onRefresh: fn(),
    onClearCompleted: fn(),
    onCancel: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TasksScreen>;

const sampleTasks: Task[] = [
  {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "working",
    ttl: 300000,
    createdAt: "2026-03-29T20:18:20Z",
    lastUpdatedAt: "2026-03-29T20:18:22Z",
    statusMessage: "Processing records 650 of 1000...",
  },
  {
    taskId: "4100b5e0b0ed9cd0023330342d1bf647",
    status: "input_required",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:55Z",
    lastUpdatedAt: "2026-03-29T20:17:55Z",
  },
  {
    taskId: "d487b49aa39023d907b5a2a5b506cb3",
    status: "completed",
    ttl: 300000,
    createdAt: "2026-03-29T20:16:47Z",
    lastUpdatedAt: "2026-03-29T20:16:49Z",
  },
  {
    taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
    status: "failed",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:27Z",
    lastUpdatedAt: "2026-03-29T20:17:57Z",
    statusMessage: "Timeout waiting for tool response after 30s",
  },
];

export const Mixed: Story = {
  args: {
    tasks: sampleTasks,
    progressByTaskId: {
      d0b22eba71fa36229ce5c4dfadeaa7de: {
        progress: 650,
        total: 1000,
        message: "Processing records...",
      },
    },
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
