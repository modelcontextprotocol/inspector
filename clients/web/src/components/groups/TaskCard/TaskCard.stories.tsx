import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { TaskCard } from "./TaskCard";

const meta: Meta<typeof TaskCard> = {
  title: "Groups/TaskCard",
  component: TaskCard,
  args: {
    onViewDetails: fn(),
    onViewResult: fn(),
    onCancel: fn(),
    onDismiss: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TaskCard>;

export const Running: Story = {
  args: {
    taskId: "task-abc-123",
    status: "running",
    method: "tools/call",
    target: "generate_report",
    progress: 80,
    progressDescription: "Generating report section 4 of 5...",
    startedAt: "2026-03-17T10:30:00Z",
    elapsed: "2m 15s",
  },
};

export const RunningWithProgress: Story = {
  args: {
    taskId: "task-def-456",
    status: "running",
    method: "tools/call",
    target: "analyze_data",
    progress: 45,
    progressDescription: "Analyzing dataset...",
    startedAt: "2026-03-17T10:32:00Z",
    elapsed: "30s",
  },
};

export const Waiting: Story = {
  args: {
    taskId: "task-ghi-789",
    status: "waiting",
    method: "resources/read",
    target: "file:///data/report.csv",
    progress: 0,
    startedAt: "2026-03-17T10:35:00Z",
  },
};

export const Completed: Story = {
  args: {
    taskId: "task-jkl-012",
    status: "completed",
    method: "tools/call",
    target: "generate_summary",
    progress: 100,
    startedAt: "2026-03-17T10:20:00Z",
    completedAt: "2026-03-17T10:25:00Z",
    elapsed: "5m 00s",
  },
};

export const Failed: Story = {
  args: {
    taskId: "task-mno-345",
    status: "failed",
    method: "tools/call",
    target: "fetch_remote_data",
    progress: 45,
    startedAt: "2026-03-17T10:28:00Z",
    completedAt: "2026-03-17T10:29:30Z",
    elapsed: "1m 30s",
    error: "Connection refused: upstream server not responding after 3 retries",
  },
};

export const Cancelled: Story = {
  args: {
    taskId: "task-pqr-678",
    status: "cancelled",
    method: "tools/call",
    target: "long_running_analysis",
    progress: 30,
    startedAt: "2026-03-17T10:15:00Z",
    completedAt: "2026-03-17T10:18:00Z",
    elapsed: "3m 00s",
  },
};
