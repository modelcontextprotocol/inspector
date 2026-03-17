import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogEntry } from "./LogEntry";

const meta: Meta<typeof LogEntry> = {
  title: "Atoms/LogEntry",
  component: LogEntry,
};

export default meta;
type Story = StoryObj<typeof LogEntry>;

export const Debug: Story = {
  args: {
    timestamp: "2026-03-17T10:00:00Z",
    level: "debug",
    message: "Initializing connection pool",
  },
};

export const Info: Story = {
  args: {
    timestamp: "2026-03-17T10:00:01Z",
    level: "info",
    message: "Server started on port 3000",
  },
};

export const Notice: Story = {
  args: {
    timestamp: "2026-03-17T10:00:02Z",
    level: "notice",
    message: "Configuration reloaded successfully",
  },
};

export const Warning: Story = {
  args: {
    timestamp: "2026-03-17T10:00:03Z",
    level: "warning",
    message: "Memory usage above 80%",
  },
};

export const Error: Story = {
  args: {
    timestamp: "2026-03-17T10:00:04Z",
    level: "error",
    message: "Failed to connect to database",
  },
};

export const Critical: Story = {
  args: {
    timestamp: "2026-03-17T10:00:05Z",
    level: "critical",
    message: "Disk space critically low",
  },
};

export const Alert: Story = {
  args: {
    timestamp: "2026-03-17T10:00:06Z",
    level: "alert",
    message: "Service degradation detected",
  },
};

export const Emergency: Story = {
  args: {
    timestamp: "2026-03-17T10:00:07Z",
    level: "emergency",
    message: "System is unusable",
  },
};

export const WithLogger: Story = {
  args: {
    timestamp: "2026-03-17T10:00:08Z",
    level: "info",
    message: "Tool execution completed",
    logger: "mcp-server",
  },
};
