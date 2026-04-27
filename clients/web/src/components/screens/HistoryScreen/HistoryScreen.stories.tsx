import type { Meta, StoryObj } from "@storybook/react-vite";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { HistoryScreen } from "./HistoryScreen";

const meta: Meta<typeof HistoryScreen> = {
  title: "Screens/HistoryScreen",
  component: HistoryScreen,
  parameters: { layout: "fullscreen" },
  args: {
    pinnedIds: new Set<string>(),
    onClearAll: fn(),
    onExport: fn(),
    onReplay: fn(),
    onTogglePin: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof HistoryScreen>;

const sampleEntries: MessageEntry[] = [
  {
    id: "req-1",
    timestamp: new Date("2026-03-17T10:00:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "send_message", arguments: { message: "Hello, world!" } },
    },
    response: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Message sent successfully" }],
      },
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
  {
    id: "req-5",
    timestamp: new Date("2026-03-17T09:35:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 5,
      method: "prompts/get",
      params: { name: "greeting" },
    },
    response: {
      jsonrpc: "2.0",
      id: 5,
      result: {
        messages: [{ role: "user", content: { type: "text", text: "Hello!" } }],
      },
    },
    duration: 60,
  },
];

export const WithEntries: Story = {
  args: {
    entries: sampleEntries,
    pinnedIds: new Set(["req-4", "req-5"]),
  },
};

export const Empty: Story = {
  args: {
    entries: [],
  },
};

export const MethodFilterClearedOnClearAll: Story = {
  args: {
    entries: sampleEntries,
    pinnedIds: new Set<string>(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filter = canvas.getByPlaceholderText(
      "All methods",
    ) as HTMLInputElement;

    await userEvent.click(filter);
    await userEvent.click(
      await screen.findByRole("option", { name: "tools/call" }),
    );
    await expect(filter).toHaveValue("tools/call");

    await userEvent.click(canvas.getByRole("button", { name: /^clear$/i }));
    await expect(filter).toHaveValue("");
  },
};
