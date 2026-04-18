import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptListItem } from "./PromptListItem";

const meta: Meta<typeof PromptListItem> = {
  title: "Groups/PromptListItem",
  component: PromptListItem,
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PromptListItem>;

export const Default: Story = {
  args: {
    prompt: {
      name: "summarize",
      description: "Summarize the given text into key points",
    },
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    prompt: {
      name: "translate",
      description: "Translate text from one language to another",
    },
    selected: true,
  },
};

export const WithTitle: Story = {
  args: {
    prompt: {
      name: "code-review",
      title: "Code Review",
      description: "Review code for issues and best practices",
    },
    selected: false,
  },
};

export const NoDescription: Story = {
  args: {
    prompt: {
      name: "code-review",
    },
    selected: false,
  },
};
