import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptArgumentsForm } from "./PromptArgumentsForm";

const meta: Meta<typeof PromptArgumentsForm> = {
  title: "Groups/PromptArgumentsForm",
  component: PromptArgumentsForm,
  args: {
    onArgumentChange: fn(),
    onGetPrompt: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PromptArgumentsForm>;

export const NoArguments: Story = {
  args: {
    name: "summarize",
    description: "Summarize the given text into key points",
    arguments: [],
    argumentValues: {},
  },
};

export const WithArguments: Story = {
  args: {
    name: "translate",
    description: "Translate text from one language to another",
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

export const WithRequiredAndOptional: Story = {
  args: {
    name: "summarize",
    description: "Summarize the given text into key points",
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
    name: "translate",
    description: "Translate text from one language to another",
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

export const NoDescription: Story = {
  args: {
    name: "code-review",
    arguments: [
      { name: "code", required: true, description: "The code to review" },
    ],
    argumentValues: {},
  },
};
