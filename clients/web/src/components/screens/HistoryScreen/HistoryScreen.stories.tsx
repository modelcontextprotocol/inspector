import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HistoryScreen } from "./HistoryScreen";
import type { HistoryEntryProps } from "../../groups/HistoryEntry/HistoryEntry";

const meta: Meta<typeof HistoryScreen> = {
  title: "Screens/HistoryScreen",
  component: HistoryScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onClearAll: fn(),
    onExport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof HistoryScreen>;

const entry1: HistoryEntryProps = {
  timestamp: "2026-03-17T10:00:00Z",
  method: "tools/call",
  target: "send_message",
  status: "success",
  durationMs: 120,
  parameters: { message: "Hello, world!" },
  response: { result: "Message sent successfully" },
  isPinned: false,
  isListExpanded: false,
  onReplay: fn(),
  onTogglePin: fn(),
};

const entry2: HistoryEntryProps = {
  timestamp: "2026-03-17T10:01:00Z",
  method: "resources/read",
  target: "config.json",
  status: "success",
  durationMs: 45,
  parameters: { uri: "file:///config.json" },
  response: { contents: [{ uri: "file:///config.json", text: "{}" }] },
  isPinned: false,
  isListExpanded: false,
  onReplay: fn(),
  onTogglePin: fn(),
};

const entry3: HistoryEntryProps = {
  timestamp: "2026-03-17T10:02:00Z",
  method: "tools/call",
  target: "delete_records",
  status: "error",
  durationMs: 350,
  parameters: { ids: [1, 2, 3] },
  response: { error: "Permission denied" },
  isPinned: false,
  isListExpanded: true,
  onReplay: fn(),
  onTogglePin: fn(),
};

const pinnedEntry1: HistoryEntryProps = {
  timestamp: "2026-03-17T09:30:00Z",
  method: "tools/list",
  status: "success",
  durationMs: 80,
  response: { tools: ["send_message", "list_users"] },
  isPinned: true,
  isListExpanded: false,
  onReplay: fn(),
  onTogglePin: fn(),
};

const pinnedEntry2: HistoryEntryProps = {
  timestamp: "2026-03-17T09:35:00Z",
  method: "prompts/get",
  target: "greeting",
  status: "success",
  durationMs: 60,
  parameters: { name: "greeting" },
  response: {
    messages: [{ role: "user", content: { type: "text", text: "Hello!" } }],
  },
  isPinned: true,
  isListExpanded: false,
  onReplay: fn(),
  onTogglePin: fn(),
};

export const WithEntries: Story = {
  args: {
    entries: [entry1, entry2, entry3],
    pinnedEntries: [pinnedEntry1, pinnedEntry2],
  },
};

export const Empty: Story = {
  args: {
    entries: [],
    pinnedEntries: [],
  },
};
