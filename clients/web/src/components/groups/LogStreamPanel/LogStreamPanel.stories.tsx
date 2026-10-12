import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LoggingLevel } from "@modelcontextprotocol/client";
import { fn } from "storybook/test";
import { LogStreamPanel } from "./LogStreamPanel";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import {
  expectNoHorizontalOverflow,
  expectScrollbarGutterIdleHidden,
} from "../../../test/scrollAreaStoryAssertions";
import { narrowSidebarDecorator } from "../../../test/narrowSidebarDecorator";

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
    onClear: fn(),
    onExport: fn(),
    sortDirection: "newest-first",
    onSortChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LogStreamPanel>;

export const Empty: Story = {
  args: {
    entries: [],
  },
};

const logMessages: {
  level: LoggingLevel;
  data: string;
  logger?: string;
}[] = [
  { level: "info", data: "Server started on port 3000" },
  { level: "debug", data: "Loading configuration", logger: "config" },
  {
    level: "warning",
    data: "Deprecated API endpoint called",
    logger: "http",
  },
  { level: "error", data: "Failed to read resource", logger: "resources" },
  {
    level: "info",
    data: "Tool execution completed (245ms)",
    logger: "tools",
  },
  {
    level: "critical",
    data: "Database connection pool exhausted",
    logger: "db",
  },
  { level: "alert", data: "Memory usage exceeds 95%", logger: "system" },
  { level: "emergency", data: "System unresponsive", logger: "system" },
];

const entries: LogEntryData[] = Array.from({ length: 30 }, (_, i) => {
  const src = logMessages[i % logMessages.length];
  return {
    receivedAt: new Date(`2026-03-17T10:00:${String(i + 1).padStart(2, "0")}Z`),
    params: { level: src.level, data: src.data, logger: src.logger },
  };
});

export const WithEntries: Story = {
  args: {
    entries,
  },
  // List scrollbar reserves a gutter and stays hidden when idle (#1474).
  play: async ({ canvasElement }) => {
    await expectScrollbarGutterIdleHidden(canvasElement);
  },
};

// A long unbroken token (a URI, a hash) and a long logger name in the sidebar
// must wrap or shrink inside the row, never widen the list (#2675).
export const EmbeddedLongContent: Story = {
  args: {
    embedded: true,
    entries: [
      {
        receivedAt: new Date("2026-03-17T10:00:01Z"),
        params: {
          level: "info",
          logger: "resources.minted.gzip-file-as-resource",
          data: "Minted demo://resource/minted/c05df264-ed9c-44a4-a81d-c2d7f3b9e1a0/gzip-file-as-resource/compressed-payload.gz",
        },
      },
      {
        receivedAt: new Date("2026-03-17T10:00:02Z"),
        params: { level: "debug", data: "short line" },
      },
    ],
  },
  decorators: [narrowSidebarDecorator],
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};
