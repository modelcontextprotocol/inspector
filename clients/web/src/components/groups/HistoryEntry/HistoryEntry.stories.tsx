import type { Meta, StoryObj } from "@storybook/react-vite";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { fn } from "storybook/test";
import { HistoryEntry } from "./HistoryEntry";

const meta: Meta<typeof HistoryEntry> = {
  title: "Groups/HistoryEntry",
  component: HistoryEntry,
  args: {
    onReplay: fn(),
    onTogglePin: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof HistoryEntry>;

const toolCallEntry: MessageEntry = {
  id: "req-1",
  timestamp: new Date("2026-03-17T10:30:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_weather", arguments: { city: "San Francisco" } },
  },
  response: {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "18°C, partly cloudy" }],
    },
  },
  duration: 142,
};

const errorEntry: MessageEntry = {
  id: "req-2",
  timestamp: new Date("2026-03-17T10:31:15Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "query_database" },
  },
  response: {
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32000, message: "Connection timeout" },
  },
  duration: 3200,
};

const resourceReadEntry: MessageEntry = {
  id: "req-3",
  timestamp: new Date("2026-03-17T10:33:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "file:///config.json" },
  },
  response: {
    jsonrpc: "2.0",
    id: 3,
    result: {
      contents: [{ uri: "file:///config.json", text: '{"debug": true}' }],
    },
  },
  duration: 45,
};

const pendingEntry: MessageEntry = {
  id: "req-4",
  timestamp: new Date("2026-03-17T10:34:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "long_operation" },
  },
};

export const SuccessCollapsed: Story = {
  args: {
    entry: toolCallEntry,
    isPinned: false,
    isListExpanded: false,
  },
};

export const SuccessExpanded: Story = {
  args: {
    entry: toolCallEntry,
    isPinned: false,
    isListExpanded: true,
  },
};

export const Error: Story = {
  args: {
    entry: errorEntry,
    isPinned: false,
    isListExpanded: true,
  },
};

export const Pinned: Story = {
  args: {
    entry: resourceReadEntry,
    isPinned: true,
    isListExpanded: false,
  },
};

export const Pending: Story = {
  args: {
    entry: pendingEntry,
    isPinned: false,
    isListExpanded: false,
  },
};
