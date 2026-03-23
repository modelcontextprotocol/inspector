import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourceListItem } from "./ResourceListItem";

const meta: Meta<typeof ResourceListItem> = {
  title: "Molecules/ResourceListItem",
  component: ResourceListItem,
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourceListItem>;

export const Default: Story = {
  args: {
    name: "config.json",
    uri: "file:///config.json",
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    name: "config.json",
    uri: "file:///config.json",
    selected: true,
  },
};
