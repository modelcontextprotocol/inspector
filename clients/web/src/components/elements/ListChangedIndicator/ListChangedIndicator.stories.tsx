import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ListChangedIndicator } from "./ListChangedIndicator";

const meta: Meta<typeof ListChangedIndicator> = {
  title: "Elements/ListChangedIndicator",
  component: ListChangedIndicator,
};

export default meta;
type Story = StoryObj<typeof ListChangedIndicator>;

export const Visible: Story = {
  args: {
    visible: true,
    onRefresh: fn(),
  },
};

export const Hidden: Story = {
  args: {
    visible: false,
    onRefresh: fn(),
  },
};
