import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { PromptsScreen } from "./PromptsScreen";
import type { GetPromptState } from "./PromptsScreen";

const meta: Meta<typeof PromptsScreen> = {
  title: "Screens/PromptsScreen",
  component: PromptsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onRefreshList: fn(),
    onSelectPrompt: fn(),
    onGetPrompt: fn(),
    onCopyMessages: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof PromptsScreen>;

const samplePrompts: Prompt[] = [
  {
    name: "summarize",
    description: "Summarize the given text into key points",
  },
  {
    name: "translate",
    description: "Translate text from one language to another",
    arguments: [
      { name: "text", required: true, description: "The text to translate" },
      {
        name: "targetLanguage",
        required: true,
        description: "Target language code",
      },
    ],
  },
  {
    name: "code-review",
    description: "Review code for issues",
  },
  {
    name: "analyze",
    description: "Analyze sentiment and tone of the text",
  },
  { name: "refactor" },
];

const translateResult: GetPromptState = {
  status: "ok",
  result: {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: 'Translate the following text to Spanish: "Hello, how are you?"',
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: "Hola, como estas?",
        },
      },
    ],
  },
};

export const NoSelection: Story = {
  args: {
    prompts: samplePrompts,
  },
};

export const PromptSelected: Story = {
  args: {
    prompts: samplePrompts,
    selectedPromptName: "translate",
  },
};

export const WithResult: Story = {
  args: {
    prompts: samplePrompts,
    selectedPromptName: "translate",
    getPromptState: translateResult,
  },
};

export const Loading: Story = {
  args: {
    prompts: samplePrompts,
    selectedPromptName: "translate",
    getPromptState: { status: "pending" },
  },
};

export const WithError: Story = {
  args: {
    prompts: samplePrompts,
    selectedPromptName: "translate",
    getPromptState: {
      status: "error",
      error:
        'Prompt "translate" requires argument "text" but none was provided. Please fill in all required arguments before submitting.',
    },
  },
};

export const ListChanged: Story = {
  args: {
    prompts: samplePrompts,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    prompts: [],
  },
};
