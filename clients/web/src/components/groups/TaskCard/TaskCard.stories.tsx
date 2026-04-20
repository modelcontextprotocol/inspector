import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
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

const workingTask: Task = {
  taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
  status: "working",
  ttl: 300000,
  createdAt: "2026-03-29T20:18:20Z",
  lastUpdatedAt: "2026-03-29T20:18:22Z",
  statusMessage: "Synthesizing findings...",
};

const inputRequiredTask: Task = {
  taskId: "4100b5e0b0ed9cd0023330342d1bf647",
  status: "input_required",
  ttl: 300000,
  createdAt: "2026-03-29T20:17:55Z",
  lastUpdatedAt: "2026-03-29T20:17:55Z",
  statusMessage: "Waiting for user confirmation",
};

const completedTask: Task = {
  taskId: "d487b49aa39023d907b5a2a5b506cb3",
  status: "completed",
  ttl: 300000,
  createdAt: "2026-03-29T20:16:47Z",
  lastUpdatedAt: "2026-03-29T20:16:51Z",
  statusMessage: "Report generated successfully",
};

const failedTask: Task = {
  taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
  status: "failed",
  ttl: 300000,
  createdAt: "2026-03-29T20:17:27Z",
  lastUpdatedAt: "2026-03-29T20:17:28Z",
  statusMessage:
    "Connection refused: upstream server not responding after 3 retries",
};

const cancelledTask: Task = {
  taskId: "c416bc183cb04468d3f81696f1b868f6",
  status: "cancelled",
  ttl: 300000,
  createdAt: "2026-03-29T20:18:15Z",
  lastUpdatedAt: "2026-03-29T20:18:18Z",
};

export const Working: Story = {
  args: {
    task: workingTask,
    progress: { progress: 650, total: 1000, message: "Processing records..." },
  },
};

export const InputRequired: Story = {
  args: { task: inputRequiredTask },
};

export const Completed: Story = {
  args: { task: completedTask },
};

export const Failed: Story = {
  args: { task: failedTask },
};

export const Cancelled: Story = {
  args: { task: cancelledTask },
};

export const Collapsed: Story = {
  args: { task: workingTask, isListExpanded: false },
};
