import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { PromptControls } from "./PromptControls";

const meta: Meta<typeof PromptControls> = {
  title: "Groups/PromptControls",
  component: PromptControls,
  args: {
    onRefreshList: fn(),
    onSelectPrompt: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof PromptControls>;

const samplePrompts: Prompt[] = [
  {
    name: "summarize",
    description: "Summarize the given text into key points",
  },
  {
    name: "translate",
    description: "Translate text from one language to another",
  },
  {
    name: "analyze",
    description: "Analyze sentiment and tone of the text",
  },
  {
    name: "code-review",
    description: "Review code for issues",
  },
  { name: "refactor" },
];

export const Default: Story = {
  args: {
    prompts: samplePrompts,
  },
};

export const WithSelection: Story = {
  args: {
    prompts: samplePrompts,
    selectedName: "translate",
  },
};

export const WithSearch: Story = {
  args: {
    prompts: samplePrompts,
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
