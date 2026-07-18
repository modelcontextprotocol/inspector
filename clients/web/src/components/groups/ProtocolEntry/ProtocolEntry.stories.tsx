import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { expect, fn, within } from "storybook/test";
import { ProtocolEntry } from "./ProtocolEntry";

const meta: Meta<typeof ProtocolEntry> = {
  title: "Groups/ProtocolEntry",
  component: ProtocolEntry,
  args: {
    onReplay: fn(),
    onTogglePin: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ProtocolEntry>;

const toolCallEntry: MessageEntry = {
  id: "req-1",
  timestamp: new Date("2026-03-17T10:30:00Z"),
  direction: "request",
  origin: "client",
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
  origin: "client",
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
  origin: "client",
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

// A resources/read whose URI overflows the narrow monitoring column, so the
// embedded header shows it in a horizontal scroll area rather than truncating.
const longUriResourceEntry: MessageEntry = {
  id: "req-5",
  timestamp: new Date("2026-03-17T10:35:00Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: {
      uri: "demo://resource/static/document/architecture/overview/system-design-and-data-flow.md",
    },
  },
  response: {
    jsonrpc: "2.0",
    id: 5,
    result: {
      contents: [
        {
          uri: "demo://resource/static/document/architecture/overview/system-design-and-data-flow.md",
          text: "# Architecture Overview",
        },
      ],
    },
  },
  duration: 41,
};

const pendingEntry: MessageEntry = {
  id: "req-4",
  timestamp: new Date("2026-03-17T10:34:00Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "long_operation" },
  },
};

// Modern (2026-07-28) era frames. An `input_required` result is the first round
// of an MRTR conversation; the retried call returns `complete`.
const inputRequiredEntry: MessageEntry = {
  id: "mrtr-1",
  timestamp: new Date("2026-07-28T10:00:00Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "book_flight", arguments: { destination: "SFO" } },
  },
  response: {
    jsonrpc: "2.0",
    id: 1,
    result: {
      resultType: "input_required",
      requestState: "opaque-server-token",
      inputRequests: {
        "1": {
          method: "elicitation/create",
          params: { message: "Confirm passenger name" },
        },
      },
    },
  },
  duration: 30,
};

const discoverEntry: MessageEntry = {
  id: "disc-1",
  timestamp: new Date("2026-07-28T09:59:00Z"),
  direction: "request",
  origin: "client",
  message: { jsonrpc: "2.0", id: 0, method: "server/discover" },
  response: {
    jsonrpc: "2.0",
    id: 0,
    result: {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {}, resources: {} },
    },
  },
  duration: 12,
};

const subscriptionNotificationEntry: MessageEntry = {
  id: "sub-1",
  timestamp: new Date("2026-07-28T10:05:00Z"),
  direction: "notification",
  origin: "server",
  message: {
    jsonrpc: "2.0",
    method: "notifications/resources/list_changed",
    params: {
      _meta: { "io.modelcontextprotocol/subscriptionId": "sub-abc123" },
    },
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

// Modern-era: an `input_required` result, labeled with a yellow badge (the
// operation isn't done — it needs input and will be retried).
export const ModernInputRequired: Story = {
  args: {
    entry: inputRequiredEntry,
    isPinned: false,
    isListExpanded: true,
  },
};

// Modern-era: a `server/discover` probe, flagged with the "modern" frame badge.
export const ModernDiscoverFrame: Story = {
  args: {
    entry: discoverEntry,
    isPinned: false,
    isListExpanded: false,
  },
};

// Modern-era: a push notification tagged with a subscriptionId (copyable).
export const ModernSubscriptionNotification: Story = {
  args: {
    entry: subscriptionNotificationEntry,
    isPinned: false,
    isListExpanded: false,
  },
};

// Embedded (monitoring-sidebar) layout with a long resource URI: the target sits
// in a horizontal scroll area rather than truncating with an ellipsis. Wrapped
// in the pinned column's width so the overflow is visible.
export const EmbeddedLongUri: Story = {
  args: {
    entry: longUriResourceEntry,
    isPinned: false,
    isListExpanded: false,
    embedded: true,
  },
  decorators: [
    (Story) => (
      <Box w={340}>
        <Story />
      </Box>
    ),
  ],
};

// Modern spec errors (SEP-2243 / SEP-2575) are surfaced distinctly in the
// Protocol tab: a colour-coded chip on the header row plus an explanatory alert.
const headerMismatchEntry: MessageEntry = {
  id: "req-err-20",
  timestamp: new Date("2026-07-28T10:30:22Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "get_weather" },
  },
  response: {
    jsonrpc: "2.0",
    id: 20,
    error: { code: -32020, message: "Mcp-Method header does not match body" },
  },
  duration: 12,
};

const unsupportedVersionEntry: MessageEntry = {
  ...headerMismatchEntry,
  id: "req-err-22",
  response: {
    jsonrpc: "2.0",
    id: 20,
    error: {
      code: -32022,
      message: "Unsupported protocol version",
      data: { supported: ["2025-06-18", "2025-11-25", "2026-07-28"] },
    },
  },
};

// -32601 arrives as HTTP 404 (thrown by the SDK) and is folded onto its pending
// request by enrichProtocolEntries, so it too reaches the Protocol tab.
const methodNotFoundEntry: MessageEntry = {
  ...headerMismatchEntry,
  id: "req-err-601",
  response: {
    jsonrpc: "2.0",
    id: 20,
    error: { code: -32601, message: "Method not found" },
  },
};

export const HeaderMismatch: Story = {
  args: { entry: headerMismatchEntry, isListExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("-32020 HeaderMismatch").length,
    ).toBeGreaterThan(0);
    await expect(
      canvas.getByText(/An Mcp-\* header did not match/),
    ).toBeInTheDocument();
  },
};

export const UnsupportedVersion: Story = {
  args: { entry: unsupportedVersionEntry, isListExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Server supports: 2025-06-18, 2025-11-25, 2026-07-28/),
    ).toBeInTheDocument();
  },
};

export const MethodNotFound: Story = {
  args: { entry: methodNotFoundEntry, isListExpanded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("-32601 MethodNotFound").length,
    ).toBeGreaterThan(0);
  },
};
