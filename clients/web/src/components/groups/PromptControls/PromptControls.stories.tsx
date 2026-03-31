import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptControls } from "./PromptControls";

const meta: Meta<typeof PromptControls> = {
  title: "Groups/PromptControls",
  component: PromptControls,
  args: {
    searchText: "",
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectPrompt: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof PromptControls>;

const samplePrompts = [
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
    name: "analyze",
    description: "Analyze sentiment and tone of the text",
    selected: false,
  },
  {
    name: "code-review",
    description: "Review code for issues",
    selected: false,
  },
  { name: "refactor", selected: false },
];

export const Default: Story = {
  args: {
    prompts: samplePrompts,
  },
};

export const WithSelection: Story = {
  args: {
    prompts: samplePrompts.map((p) =>
      p.name === "translate" ? { ...p, selected: true } : p,
    ),
  },
};

export const WithSearch: Story = {
  args: {
    prompts: samplePrompts,
    searchText: "sum",
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
