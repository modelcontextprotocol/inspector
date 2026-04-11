import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourceSubscribedItem } from "./ResourceSubscribedItem";

const meta: Meta<typeof ResourceSubscribedItem> = {
  title: "Groups/ResourceSubscribedItem",
  component: ResourceSubscribedItem,
  args: {
    onUnsubscribe: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourceSubscribedItem>;

export const WithTimestamp: Story = {
  args: {
    name: "config.json",
    lastUpdated: "2026-03-17T10:30:00Z",
  },
};

export const WithoutTimestamp: Story = {
  args: {
    name: "schema.sql",
  },
};
