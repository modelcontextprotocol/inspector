import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HistoryListPanel } from "./HistoryListPanel.js";
import type { HistoryEntryProps } from "../HistoryEntry/HistoryEntry";

const meta: Meta<typeof HistoryListPanel> = {
  title: "Groups/HistoryListPanel",
  component: HistoryListPanel,
  args: {
    searchText: "",
  },
};

export default meta;
type Story = StoryObj<typeof HistoryListPanel>;

function makeEntry(overrides: Partial<HistoryEntryProps>): HistoryEntryProps {
  return {
    timestamp: "2026-03-17T10:00:00Z",
    method: "tools/call",
    target: "send_message",
    status: "success",
    durationMs: 120,
    isPinned: false,
    isListExpanded: false,
    onReplay: fn(),
    onTogglePin: fn(),
    ...overrides,
  };
}

export const WithEntries: Story = {
  args: {
    entries: [
      makeEntry({
        timestamp: "2026-03-17T10:00:00Z",
        method: "tools/call",
        target: "send_message",
      }),
      makeEntry({
        timestamp: "2026-03-17T10:01:00Z",
        method: "resources/read",
        target: "config.json",
        durationMs: 45,
      }),
      makeEntry({
        timestamp: "2026-03-17T10:02:00Z",
        method: "tools/call",
        target: "delete_records",
        status: "error",
        durationMs: 350,
      }),
    ],
    pinnedEntries: [
      makeEntry({
        timestamp: "2026-03-17T09:30:00Z",
        method: "tools/list",
        isPinned: true,
        durationMs: 80,
      }),
    ],
  },
};

export const Empty: Story = {
  args: {
    entries: [],
    pinnedEntries: [],
  },
};
