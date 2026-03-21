import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LoggingScreen } from "./LoggingScreen";
import type { LogControlsProps } from "../../molecules/LogControls/LogControls";
import type { LogEntryProps } from "../../atoms/LogEntry/LogEntry";

function makeControls(): LogControlsProps {
  return {
    currentLevel: "info",
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
    onSetLevel: fn(),
    onFilterChange: fn(),
    onToggleLevel: fn(),
    onClear: fn(),
    onExport: fn(),
  };
}

const meta: Meta<typeof LoggingScreen> = {
  component: LoggingScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onToggleAutoScroll: fn(),
    onCopyAll: fn(),
    autoScroll: true,
  },
};

export default meta;
type Story = StoryObj<typeof LoggingScreen>;

export const Empty: Story = {
  args: {
    controls: makeControls(),
    entries: [],
  },
};

const mixedEntries: LogEntryProps[] = [
  {
    timestamp: "2026-03-17T10:00:01Z",
    level: "info",
    message: "Server started on port 3000",
  },
  {
    timestamp: "2026-03-17T10:00:02Z",
    level: "debug",
    message: "Loading configuration from /etc/mcp/config.json",
    logger: "config",
  },
  {
    timestamp: "2026-03-17T10:00:03Z",
    level: "warning",
    message: "Deprecated API endpoint called: /v1/tools",
    logger: "http",
  },
  {
    timestamp: "2026-03-17T10:00:04Z",
    level: "info",
    message: "Client connected: inspector-web-ui",
  },
  {
    timestamp: "2026-03-17T10:00:05Z",
    level: "error",
    message: "Failed to read resource: file not found at /data/missing.txt",
    logger: "resources",
  },
  {
    timestamp: "2026-03-17T10:00:06Z",
    level: "info",
    message: "Tool execution completed: search_files (245ms)",
    logger: "tools",
  },
];

export const WithEntries: Story = {
  args: {
    controls: makeControls(),
    entries: mixedEntries,
  },
};

const allLevelEntries: LogEntryProps[] = [
  {
    timestamp: "2026-03-17T10:00:01Z",
    level: "debug",
    message: "Resolving transport handler for stdio connection",
    logger: "transport",
  },
  {
    timestamp: "2026-03-17T10:00:02Z",
    level: "info",
    message: "MCP session initialized successfully",
  },
  {
    timestamp: "2026-03-17T10:00:03Z",
    level: "notice",
    message: "Server capabilities negotiated: tools, resources, prompts",
    logger: "session",
  },
  {
    timestamp: "2026-03-17T10:00:04Z",
    level: "warning",
    message: "Rate limit approaching: 85% of quota used",
    logger: "ratelimit",
  },
  {
    timestamp: "2026-03-17T10:00:05Z",
    level: "error",
    message: "Tool execution failed: timeout after 30s",
    logger: "tools",
  },
  {
    timestamp: "2026-03-17T10:00:06Z",
    level: "critical",
    message: "Database connection pool exhausted",
    logger: "db",
  },
  {
    timestamp: "2026-03-17T10:00:07Z",
    level: "alert",
    message: "Memory usage exceeds 95% threshold",
    logger: "system",
  },
  {
    timestamp: "2026-03-17T10:00:08Z",
    level: "emergency",
    message: "System unresponsive - initiating graceful shutdown",
    logger: "system",
  },
];

export const MixedLevels: Story = {
  args: {
    controls: makeControls(),
    entries: allLevelEntries,
  },
};
