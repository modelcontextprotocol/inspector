import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptMessagesDisplay } from "./PromptMessagesDisplay";

const meta: Meta<typeof PromptMessagesDisplay> = {
  title: "Groups/PromptMessagesDisplay",
  component: PromptMessagesDisplay,
  args: {},
};

export default meta;
type Story = StoryObj<typeof PromptMessagesDisplay>;

export const SingleMessage: Story = {
  args: {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "What is the capital of France?",
        },
      },
    ],
  },
};

export const Conversation: Story = {
  args: {
    onCopyAll: fn(),
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "What is the capital of France?",
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: "The capital of France is Paris. It is the largest city in France and serves as the country's political, economic, and cultural center.",
        },
      },
    ],
  },
};

export const WithImage: Story = {
  args: {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Here is a photo for you to analyze.",
          },
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            mimeType: "image/png",
          },
        ],
      },
    ],
  },
};

export const LongConversation: Story = {
  args: {
    onCopyAll: fn(),
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Can you help me write a haiku about programming?",
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: "Sure! Here is a haiku about programming:\n\nSilent keys tap fast\nLogic flows through glowing screens\nBugs hide in the code",
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text: "That is great! Can you write another one about debugging?",
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: "Here is a debugging haiku:\n\nStack trace lines scroll down\nOne missing semicolon\nHours lost to a typo",
        },
      },
      {
        role: "user",
        content: {
          type: "text",
          text: "I love it! One more about open source?",
        },
      },
    ],
  },
};
