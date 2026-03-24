import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LoggingScreen } from "./LoggingScreen";
import type { LogControlsProps } from "../../molecules/LogControls/LogControls";
import type { LogEntryProps, LogLevel } from "../../atoms/LogEntry/LogEntry";

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

const logMessages: { level: LogLevel; message: string; logger?: string }[] = [
  { level: "info", message: "Server started on port 3000" },
  {
    level: "debug",
    message: "Loading configuration from /etc/mcp/config.json",
    logger: "config",
  },
  {
    level: "warning",
    message: "Deprecated API endpoint called: /v1/tools",
    logger: "http",
  },
  { level: "info", message: "Client connected: inspector-web-ui" },
  {
    level: "error",
    message: "Failed to read resource: file not found at /data/missing.txt",
    logger: "resources",
  },
  {
    level: "info",
    message: "Tool execution completed: search_files (245ms)",
    logger: "tools",
  },
  {
    level: "debug",
    message: "Parsing JSON-RPC request body",
    logger: "transport",
  },
  {
    level: "info",
    message: "Listing available tools for client session",
    logger: "tools",
  },
  {
    level: "warning",
    message: "Slow query detected: 1200ms for resource lookup",
    logger: "db",
  },
  {
    level: "info",
    message: "Resource subscription added: file:///config.json",
    logger: "resources",
  },
  {
    level: "debug",
    message: "Heartbeat ping received from client",
    logger: "session",
  },
  {
    level: "error",
    message: "Permission denied reading /etc/secrets.env",
    logger: "resources",
  },
  {
    level: "info",
    message: "Prompt 'summarize' resolved with 2 messages",
    logger: "prompts",
  },
  {
    level: "debug",
    message: "Cache hit for resource: db://users/42",
    logger: "cache",
  },
  {
    level: "info",
    message: "Tool 'create_record' executed successfully in 89ms",
    logger: "tools",
  },
  {
    level: "warning",
    message: "Client reconnection attempt #3",
    logger: "session",
  },
  {
    level: "info",
    message: "New resource detected: file:///data/output.csv",
    logger: "resources",
  },
  {
    level: "debug",
    message: "Serializing response payload (2.4KB)",
    logger: "transport",
  },
  {
    level: "error",
    message: "Timeout waiting for tool response after 30s",
    logger: "tools",
  },
  {
    level: "info",
    message: "Session initialized with capabilities: tools, resources, prompts",
  },
  {
    level: "debug",
    message: "Validating input schema for tool 'batch_process'",
    logger: "tools",
  },
  {
    level: "info",
    message: "Resource template resolved: db://tables/users/rows/15",
    logger: "resources",
  },
  {
    level: "warning",
    message: "Memory usage at 78% — consider increasing limits",
    logger: "system",
  },
  {
    level: "info",
    message: "Client disconnected gracefully",
    logger: "session",
  },
  {
    level: "debug",
    message: "Flushing log buffer to disk (128 entries)",
    logger: "logging",
  },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

const mixedEntries: LogEntryProps[] = Array.from({ length: 50 }, (_, i) => {
  const src = logMessages[i % logMessages.length];
  const seconds = pad(i + 1);
  return {
    timestamp: `2026-03-17T10:00:${seconds}Z`,
    level: src.level,
    message: src.message,
    logger: src.logger,
  };
});

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
