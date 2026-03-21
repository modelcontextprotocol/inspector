import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptsScreen } from "./PromptsScreen";

const meta: Meta<typeof PromptsScreen> = {
  component: PromptsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onRefreshList: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PromptsScreen>;

export const NoSelection: Story = {
  args: {
    promptForm: {
      prompts: [
        { name: "summarize", description: "Summarize a document" },
        {
          name: "translate",
          description: "Translate text to another language",
        },
        { name: "code-review", description: "Review code for issues" },
      ],
      selectedPrompt: undefined,
      arguments: [],
      argumentValues: {},
      onSelectPrompt: fn(),
      onArgumentChange: fn(),
      onGetPrompt: fn(),
    },
    messages: undefined,
    listChanged: false,
  },
};

export const WithResult: Story = {
  args: {
    promptForm: {
      prompts: [
        { name: "summarize", description: "Summarize a document" },
        {
          name: "translate",
          description: "Translate text to another language",
        },
        { name: "code-review", description: "Review code for issues" },
      ],
      selectedPrompt: "translate",
      arguments: [
        { name: "text", required: true, description: "The text to translate" },
        {
          name: "targetLanguage",
          required: true,
          description: "Target language code",
        },
      ],
      argumentValues: {
        text: "Hello, how are you?",
        targetLanguage: "es",
      },
      onSelectPrompt: fn(),
      onArgumentChange: fn(),
      onGetPrompt: fn(),
    },
    messages: {
      messages: [
        {
          role: "user",
          content:
            'Translate the following text to Spanish: "Hello, how are you?"',
        },
        {
          role: "assistant",
          content: "Hola, como estas?",
        },
      ],
      onCopy: fn(),
    },
    listChanged: false,
  },
};
