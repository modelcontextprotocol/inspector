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

const activeTask1: TaskCardProps = {
  taskId: "task-001",
  status: "running",
  method: "tools/call",
  target: "send_message",
  progress: 45,
  progressDescription: "Sending message to remote server...",
  startedAt: "2026-03-17T10:00:00Z",
  onViewDetails: fn(),
  onViewResult: fn(),
  onCancel: fn(),
  onDismiss: fn(),
};

const activeTask2: TaskCardProps = {
  taskId: "task-002",
  status: "waiting",
  method: "resources/read",
  target: "config.json",
  startedAt: "2026-03-17T10:01:00Z",
  onViewDetails: fn(),
  onViewResult: fn(),
  onCancel: fn(),
  onDismiss: fn(),
};

const completedTask1: TaskCardProps = {
  taskId: "task-003",
  status: "completed",
  method: "tools/call",
  target: "list_users",
  startedAt: "2026-03-17T09:50:00Z",
  completedAt: "2026-03-17T09:50:02Z",
  elapsed: "2.1s",
  onViewDetails: fn(),
  onViewResult: fn(),
  onCancel: fn(),
  onDismiss: fn(),
};

const completedTask2: TaskCardProps = {
  taskId: "task-004",
  status: "failed",
  method: "tools/call",
  target: "delete_records",
  startedAt: "2026-03-17T09:45:00Z",
  completedAt: "2026-03-17T09:45:01Z",
  elapsed: "0.8s",
  error: "Permission denied: insufficient privileges",
  onViewDetails: fn(),
  onViewResult: fn(),
  onCancel: fn(),
  onDismiss: fn(),
};

export const Mixed: Story = {
  args: {
    activeTasks: [activeTask1, activeTask2],
    completedTasks: [completedTask1, completedTask2],
  },
};

export const ActiveOnly: Story = {
  args: {
    activeTasks: [activeTask1, activeTask2],
    completedTasks: [],
  },
};

export const CompletedOnly: Story = {
  args: {
    activeTasks: [],
    completedTasks: [completedTask1, completedTask2],
  },
};

export const Empty: Story = {
  args: {
    activeTasks: [],
    completedTasks: [],
  },
};
