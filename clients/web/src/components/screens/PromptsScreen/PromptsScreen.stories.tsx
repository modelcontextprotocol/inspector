import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptsScreen } from "./PromptsScreen";
import type { PromptItem, SelectedPrompt } from "./PromptsScreen";

const meta: Meta<typeof PromptsScreen> = {
  title: "Screens/PromptsScreen",
  component: PromptsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onRefreshList: fn(),
    onSelectPrompt: fn(),
    onArgumentChange: fn(),
    onGetPrompt: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof PromptsScreen>;

const samplePrompts: PromptItem[] = [
  {
    name: "summarize",
    description: "Summarize the given text into key points",
    selected: false,
  },
  {
    name: "translate",
    description: "Translate text from one language to another",
    selected: false,
  },
  {
    name: "code-review",
    description: "Review code for issues",
    selected: false,
  },
  {
    name: "analyze",
    description: "Analyze sentiment and tone of the text",
    selected: false,
  },
  { name: "refactor", selected: false },
];

const selectedTranslate: SelectedPrompt = {
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
  argumentValues: {},
};

export const NoSelection: Story = {
  args: {
    prompts: samplePrompts,
  },
};

export const PromptSelected: Story = {
  args: {
    prompts: samplePrompts.map((p) =>
      p.name === "translate" ? { ...p, selected: true } : p,
    ),
    selectedPrompt: selectedTranslate,
  },
};

export const WithResult: Story = {
  args: {
    prompts: samplePrompts.map((p) =>
      p.name === "translate" ? { ...p, selected: true } : p,
    ),
    selectedPrompt: {
      ...selectedTranslate,
      argumentValues: {
        text: "Hello, how are you?",
        targetLanguage: "es",
      },
    },
    messages: {
      onCopyAll: fn(),
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
