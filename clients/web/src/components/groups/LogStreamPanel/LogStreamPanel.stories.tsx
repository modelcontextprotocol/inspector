import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LogStreamPanel } from "./LogStreamPanel";
import type { LogEntryProps, LogLevel } from "../../elements/LogEntry/LogEntry";

const meta: Meta<typeof LogStreamPanel> = {
  title: "Groups/LogStreamPanel",
  component: LogStreamPanel,
  args: {
    filterText: "",
    visibleLevels: {
      debug: true,
      info: true,
      notice: true,
      warning: true,
      error: true,
      critical: true,
      alert: true,
      emergency: true,
    },
    autoScroll: true,
    onToggleAutoScroll: fn(),
    onCopyAll: fn(),
    onClear: fn(),
    onExport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LogStreamPanel>;

export const Empty: Story = {
  args: {
    entries: [],
  },
};

const logMessages: { level: LogLevel; message: string; logger?: string }[] = [
  { level: "info", message: "Server started on port 3000" },
  { level: "debug", message: "Loading configuration", logger: "config" },
  {
    level: "warning",
    message: "Deprecated API endpoint called",
    logger: "http",
  },
  { level: "error", message: "Failed to read resource", logger: "resources" },
  {
    level: "info",
    message: "Tool execution completed (245ms)",
    logger: "tools",
  },
  {
    level: "critical",
    message: "Database connection pool exhausted",
    logger: "db",
  },
  { level: "alert", message: "Memory usage exceeds 95%", logger: "system" },
  { level: "emergency", message: "System unresponsive", logger: "system" },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

const entries: LogEntryProps[] = Array.from({ length: 30 }, (_, i) => {
  const src = logMessages[i % logMessages.length];
  return {
    timestamp: `2026-03-17T10:00:${pad(i + 1)}Z`,
    level: src.level,
    message: src.message,
    logger: src.logger,
  };
});

export const WithEntries: Story = {
  args: {
    entries,
  },
};
