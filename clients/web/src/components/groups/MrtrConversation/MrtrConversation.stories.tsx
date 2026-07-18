import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import { expect, fn, userEvent, within } from "storybook/test";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { MrtrConversation } from "./MrtrConversation";

const meta: Meta<typeof MrtrConversation> = {
  title: "Groups/MrtrConversation",
  component: MrtrConversation,
  args: {
    requestState: "opaque-server-token",
    pinnedIds: new Set<string>(),
    isListExpanded: true,
    onReplay: fn(),
    onTogglePin: fn(),
  },
  decorators: [
    (Story) => (
      <Box maw={720}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MrtrConversation>;

const original: MessageEntry = {
  id: "orig",
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
  duration: 28,
};

const retry: MessageEntry = {
  id: "retry",
  timestamp: new Date("2026-07-28T10:00:05Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "book_flight",
      requestState: "opaque-server-token",
      inputResponses: { "1": { content: { name: "Ada Lovelace" } } },
    },
  },
  response: {
    jsonrpc: "2.0",
    id: 2,
    result: {
      resultType: "complete",
      content: [{ type: "text", text: "Booked flight to SFO" }],
    },
  },
  duration: 44,
};

// A completed two-round conversation: original call → input_required → retry →
// complete.
export const Completed: Story = {
  args: {
    rounds: [original, retry],
  },
};

// The conversation collapsed; expanding it reveals the individual rounds.
export const CollapsedThenExpanded: Story = {
  args: {
    rounds: [original, retry],
    isListExpanded: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("button", {
      name: "Expand MRTR conversation",
    });
    await userEvent.click(toggle);
    await expect(
      await canvas.findByRole("button", {
        name: "Collapse MRTR conversation",
      }),
    ).toBeInTheDocument();
  },
};

// Still awaiting input: the original call returned input_required and the user
// has not answered yet, so the conversation has a single round.
export const AwaitingInput: Story = {
  args: {
    rounds: [original],
  },
};
