import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LoggingScreen } from "./LoggingScreen";
import { mixedEntries } from "./LoggingScreen.fixtures";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";

const meta: Meta<typeof LoggingScreen> = {
  title: "Screens/LoggingScreen",
  component: LoggingScreen,
  parameters: { layout: "fullscreen" },
  args: {
    currentLevel: "info",
    onSetLevel: fn(),
    onClear: fn(),
    onExport: fn(),
    autoScroll: true,
    onToggleAutoScroll: fn(),
    onCopyAll: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LoggingScreen>;

export const Empty: Story = {
  args: {
    entries: [],
  },
};

export const WithEntries: Story = {
  args: {
    entries: mixedEntries,
  },
};

const allLevelEntries: LogEntryData[] = [
  {
    receivedAt: new Date("2026-03-17T10:00:01Z"),
    params: {
      level: "debug",
      data: "Resolving transport handler for stdio connection",
      logger: "transport",
    },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:02Z"),
    params: { level: "info", data: "MCP session initialized successfully" },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:03Z"),
    params: {
      level: "notice",
      data: "Server capabilities negotiated: tools, resources, prompts",
      logger: "session",
    },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:04Z"),
    params: {
      level: "warning",
      data: "Rate limit approaching: 85% of quota used",
      logger: "ratelimit",
    },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:05Z"),
    params: {
      level: "error",
      data: "Tool execution failed: timeout after 30s",
      logger: "tools",
    },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:06Z"),
    params: {
      level: "critical",
      data: "Database connection pool exhausted",
      logger: "db",
    },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:07Z"),
    params: {
      level: "alert",
      data: "Memory usage exceeds 95% threshold",
      logger: "system",
    },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:08Z"),
    params: {
      level: "emergency",
      data: "System unresponsive - initiating graceful shutdown",
      logger: "system",
    },
  },
];

export const MixedLevels: Story = {
  args: {
    entries: allLevelEntries,
  },
};
