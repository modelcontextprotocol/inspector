import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SamplingRequestPanel } from "./SamplingRequestPanel";

const meta: Meta<typeof SamplingRequestPanel> = {
  title: "Molecules/SamplingRequestPanel",
  component: SamplingRequestPanel,
  args: {
    responseText: "",
    modelUsed: "claude-3-sonnet",
    stopReason: "end_turn",
    onResponseChange: fn(),
    onModelChange: fn(),
    onStopReasonChange: fn(),
    onAutoRespond: fn(),
    onSend: fn(),
    onReject: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SamplingRequestPanel>;

export const SimpleRequest: Story = {
  args: {
    messages: [{ role: "user", content: "What is the capital of France?" }],
  },
};

export const WithModelHints: Story = {
  args: {
    messages: [{ role: "user", content: "Summarize this document for me." }],
    modelHints: ["claude-3-sonnet", "gpt-4"],
  },
};

export const WithPriorities: Story = {
  args: {
    messages: [{ role: "user", content: "Translate this text to Spanish." }],
    modelHints: ["claude-3-sonnet"],
    costPriority: 0.3,
    speedPriority: 0.5,
    intelligencePriority: 0.9,
  },
};

export const WithAllParams: Story = {
  args: {
    messages: [
      { role: "user", content: "Write a haiku about programming." },
      { role: "assistant", content: "Here is a haiku:" },
    ],
    maxTokens: 1024,
    stopSequences: ["\n\n", "END"],
    temperature: 0.7,
    includeContext: "thisServer",
  },
};

export const WithTools: Story = {
  args: {
    messages: [
      { role: "user", content: "Look up the weather in San Francisco." },
    ],
    tools: [
      {
        name: "get_weather",
        description: "Get the current weather for a given location.",
        inputSchema: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name" },
          },
          required: ["location"],
        },
      },
      {
        name: "search_web",
        description: "Search the web for information.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    ],
    toolChoice: "auto",
  },
};

export const PrefilledResponse: Story = {
  args: {
    messages: [{ role: "user", content: "What is 2 + 2?" }],
    responseText: "The answer is 4.",
    modelUsed: "claude-3-haiku",
    stopReason: "end_turn",
  },
};
