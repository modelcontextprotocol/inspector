import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptArgumentsForm } from "./PromptArgumentsForm";

const meta: Meta<typeof PromptArgumentsForm> = {
  title: "Molecules/PromptArgumentsForm",
  component: PromptArgumentsForm,
  args: {
    onSelectPrompt: fn(),
    onArgumentChange: fn(),
    onGetPrompt: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PromptArgumentsForm>;

const samplePrompts = [
  {
    name: "summarize",
    description: "Summarize the given text into key points",
  },
  {
    name: "translate",
    description: "Translate text from one language to another",
  },
  { name: "analyze", description: "Analyze sentiment and tone of the text" },
];

export const NoSelection: Story = {
  args: {
    prompts: samplePrompts,
    selectedPrompt: undefined,
    arguments: [],
    argumentValues: {},
  },
};

export const Selected: Story = {
  args: {
    prompts: samplePrompts,
    selectedPrompt: "translate",
    arguments: [
      { name: "text", required: true, description: "The text to translate" },
      {
        name: "targetLanguage",
        required: true,
        description: "The language to translate into",
      },
    ],
    argumentValues: {},
  },
};

export const WithRequiredArgs: Story = {
  args: {
    prompts: samplePrompts,
    selectedPrompt: "summarize",
    arguments: [
      { name: "text", required: true, description: "The text to summarize" },
      {
        name: "maxLength",
        required: true,
        description: "Maximum length of summary in words",
      },
      {
        name: "format",
        required: false,
        description: "Output format (bullets or paragraph)",
      },
    ],
    argumentValues: {},
  },
};

export const AllFilled: Story = {
  args: {
    prompts: samplePrompts,
    selectedPrompt: "translate",
    arguments: [
      { name: "text", required: true, description: "The text to translate" },
      {
        name: "targetLanguage",
        required: true,
        description: "The language to translate into",
      },
    ],
    argumentValues: {
      text: "Hello, how are you?",
      targetLanguage: "Spanish",
    },
  },
};
