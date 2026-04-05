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
    name: "summarize",
    description: "Summarize the given text into key points",
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    name: "translate",
    description: "Translate text from one language to another",
    selected: true,
  },
};

export const NoDescription: Story = {
  args: {
    name: "code-review",
    selected: false,
  },
};
