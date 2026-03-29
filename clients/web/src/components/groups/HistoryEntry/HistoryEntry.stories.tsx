import type { Meta, StoryObj } from "@storybook/react-vite";
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

export const SuccessCollapsed: Story = {
  args: {
    timestamp: "2026-03-17T10:30:00Z",
    method: "tools/call",
    target: "get_weather",
    status: "success",
    durationMs: 142,
    isPinned: false,
    isListExpanded: false,
  },
};

export const SuccessExpanded: Story = {
  args: {
    timestamp: "2026-03-17T10:30:00Z",
    method: "tools/call",
    target: "get_weather",
    status: "success",
    durationMs: 142,
    isPinned: false,
    isListExpanded: true,
    parameters: {
      city: "San Francisco",
      units: "celsius",
    },
    response: {
      temperature: 18,
      conditions: "Partly cloudy",
      humidity: 65,
    },
  },
};

export const Error: Story = {
  args: {
    timestamp: "2026-03-17T10:31:15Z",
    method: "tools/call",
    target: "query_database",
    status: "error",
    durationMs: 3200,
    isPinned: false,
    isListExpanded: false,
  },
};

export const WithChildren: Story = {
  args: {
    timestamp: "2026-03-17T10:32:00Z",
    method: "tools/call",
    target: "complex_operation",
    status: "success",
    durationMs: 1250,
    isPinned: false,
    isListExpanded: true,
    parameters: {
      action: "process",
    },
    response: {
      result: "completed",
    },
    childEntries: [
      {
        timestamp: "+120ms",
        method: "sampling/createMessage",
        target: "gpt-4",
        status: "success",
        durationMs: 800,
      },
      {
        timestamp: "+950ms",
        method: "elicitation/create",
        target: "confirm_action",
        status: "success",
        durationMs: 200,
      },
    ],
  },
};

export const Pinned: Story = {
  args: {
    timestamp: "2026-03-17T10:33:00Z",
    method: "resources/read",
    target: "config.json",
    status: "success",
    durationMs: 45,
    isPinned: true,
    isListExpanded: false,
  },
};
