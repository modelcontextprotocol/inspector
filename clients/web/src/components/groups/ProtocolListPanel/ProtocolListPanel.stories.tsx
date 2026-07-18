import type { Meta, StoryObj } from "@storybook/react-vite";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { fn } from "storybook/test";
import { ProtocolListPanel } from "./ProtocolListPanel.js";
import { expectScrollbarGutterIdleHidden } from "../../../test/scrollAreaStoryAssertions";

const meta: Meta<typeof ProtocolListPanel> = {
  title: "Groups/ProtocolListPanel",
  component: ProtocolListPanel,
  args: {
    searchText: "",
    pinnedIds: new Set<string>(),
    onClearAll: fn(),
    onExport: fn(),
    onClearSection: fn(),
    onExportSection: fn(),
    onReplay: fn(),
    onTogglePin: fn(),
    sortDirection: "newest-first",
    onSortChange: fn(),
    compact: true,
    onToggleCompact: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ProtocolListPanel>;

const sampleEntries: MessageEntry[] = [
  {
    id: "req-1",
    timestamp: new Date("2026-03-17T10:00:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "send_message", arguments: { message: "Hello!" } },
    },
    response: {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "Sent" }] },
    },
    duration: 120,
  },
  {
    id: "req-2",
    timestamp: new Date("2026-03-17T10:01:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "file:///config.json" },
    },
    response: {
      jsonrpc: "2.0",
      id: 2,
      result: {
        contents: [{ uri: "file:///config.json", text: "{}" }],
      },
    },
    duration: 45,
  },
  {
    id: "req-3",
    timestamp: new Date("2026-03-17T10:02:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "delete_records", arguments: { ids: [1, 2, 3] } },
    },
    response: {
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "Permission denied" },
    },
    duration: 350,
  },
  {
    id: "req-4",
    timestamp: new Date("2026-03-17T09:30:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
    },
    response: {
      jsonrpc: "2.0",
      id: 4,
      result: { tools: [] },
    },
    duration: 80,
  },
];

export const WithEntries: Story = {
  args: {
    entries: sampleEntries,
    pinnedIds: new Set(["req-4"]),
  },
  // The list ScrollArea reserves a scrollbar gutter (offsetScrollbars) so the
  // bar never overlays the cards, and uses type="scroll" so it stays hidden
  // when idle rather than appearing on hover (#1474).
  play: async ({ canvasElement }) => {
    expectScrollbarGutterIdleHidden(canvasElement);
  },
};

export const Empty: Story = {
  args: {
    entries: [],
  },
};

// A modern (2026-07-28) connection: the era badge labels the traffic, and an
// MRTR round-trip (original call → input_required → retry → complete) renders as
// one grouped conversation.
const mrtrEntries: MessageEntry[] = [
  {
    id: "mrtr-orig",
    timestamp: new Date("2026-07-28T10:00:00Z"),
    direction: "request",
    origin: "client",
    message: {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "book_flight", arguments: { destination: "SFO" } },
    },
    response: {
      jsonrpc: "2.0",
      id: 10,
      result: {
        resultType: "input_required",
        requestState: "opaque-token",
        inputRequests: {
          "1": { method: "elicitation/create", params: {} },
        },
      },
    },
  },
  {
    id: "mrtr-retry",
    timestamp: new Date("2026-07-28T10:00:05Z"),
    direction: "request",
    origin: "client",
    message: {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "book_flight",
        requestState: "opaque-token",
        inputResponses: { "1": { content: { name: "Ada" } } },
      },
    },
    response: {
      jsonrpc: "2.0",
      id: 11,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: "Booked" }],
      },
    },
  },
  {
    id: "disc-1",
    timestamp: new Date("2026-07-28T09:59:00Z"),
    direction: "request",
    origin: "client",
    message: { jsonrpc: "2.0", id: 0, method: "server/discover" },
    response: {
      jsonrpc: "2.0",
      id: 0,
      result: { supportedVersions: ["2026-07-28"], capabilities: {} },
    },
  },
];

export const ModernWithMrtr: Story = {
  args: {
    entries: mrtrEntries,
    protocolEra: "modern",
    visibleDirections: { client: true, server: true },
    compact: false,
  },
};
