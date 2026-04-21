import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CreateMessageRequestParams } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { InlineSamplingRequest } from "./InlineSamplingRequest";

const defaultRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: "Please analyze the following code and suggest improvements for performance and readability.",
      },
    },
  ],
  maxTokens: 1024,
};

const meta: Meta<typeof InlineSamplingRequest> = {
  title: "Groups/InlineSamplingRequest",
  component: InlineSamplingRequest,
  args: {
    request: defaultRequest,
    queuePosition: "1 of 1",
    responseText: "",
    onAutoRespond: fn(),
    onEditAndSend: fn(),
    onReject: fn(),
    onViewDetails: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof InlineSamplingRequest>;

export const Default: Story = {};

export const WithModelHints: Story = {
  args: {
    request: {
      ...defaultRequest,
      modelPreferences: {
        hints: [
          { name: "claude-opus-4-20250514" },
          { name: "claude-sonnet-4-20250514" },
        ],
      },
    },
  },
};

export const PrefilledResponse: Story = {
  args: {
    responseText:
      "The code looks good overall. Consider extracting the repeated logic into a helper function.",
  },
};

export const InQueue: Story = {
  args: {
    queuePosition: "2 of 3",
  },
};
