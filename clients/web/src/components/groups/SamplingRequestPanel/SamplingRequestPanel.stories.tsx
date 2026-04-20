import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { SamplingRequestPanel } from "./SamplingRequestPanel";

const defaultDraftResult: CreateMessageResult = {
  role: "assistant",
  content: { type: "text", text: "" },
  model: "claude-sonnet-4-20250514",
};

const meta: Meta<typeof SamplingRequestPanel> = {
  title: "Groups/SamplingRequestPanel",
  component: SamplingRequestPanel,
  args: {
    draftResult: defaultDraftResult,
    onResultChange: fn(),
    onAutoRespond: fn(),
    onSend: fn(),
    onReject: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SamplingRequestPanel>;

const simpleRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "What is the capital of France?" },
    },
  ],
  maxTokens: 1024,
};

const withPreferencesRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "Summarize this document for me." },
    },
  ],
  maxTokens: 2048,
  modelPreferences: {
    hints: [{ name: "claude-sonnet-4-20250514" }, { name: "gpt-4" }],
    costPriority: 0.3,
    speedPriority: 0.5,
    intelligencePriority: 0.9,
  },
};

const fullRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "Write a haiku about programming." },
    },
    {
      role: "assistant",
      content: { type: "text", text: "Here is a haiku:" },
    },
  ],
  maxTokens: 1024,
  stopSequences: ["\n\n", "END"],
  temperature: 0.7,
  includeContext: "thisServer",
};

export const SimpleRequest: Story = {
  args: { request: simpleRequest },
};

export const WithModelHints: Story = {
  args: { request: withPreferencesRequest },
};

export const WithAllParams: Story = {
  args: { request: fullRequest },
};

export const PrefilledResponse: Story = {
  args: {
    request: simpleRequest,
    draftResult: {
      role: "assistant",
      content: { type: "text", text: "The capital of France is Paris." },
      model: "claude-haiku-4-5-20251001",
      stopReason: "endTurn",
    },
  },
};
