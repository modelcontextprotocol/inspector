import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourceControls } from "./ResourceControls";

const meta: Meta<typeof ResourceControls> = {
  title: "Groups/ResourceControls",
  component: ResourceControls,
  args: {
    searchText: "",
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectUri: fn(),
    onSelectTemplate: fn(),
    onUnsubscribeResource: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof ResourceControls>;

export const Default: Story = {
  args: {
    resources: [
      {
        name: "config.json",
        uri: "file:///config.json",
        annotations: { audience: "developer", priority: 0.8 },
        selected: false,
      },
      {
        name: "README.md",
        uri: "file:///README.md",
        selected: false,
      },
      {
        name: "schema.sql",
        uri: "file:///schema.sql",
        selected: false,
      },
    ],
    templates: [
      {
        name: "User Profile",
        uriTemplate: "file:///users/{userId}/profile",
        selected: false,
      },
    ],
    subscriptions: [
      {
        name: "config.json",
        uri: "file:///config.json",
        lastUpdated: "2026-03-17T10:30:00Z",
      },
    ],
  },
};

export const WithSearch: Story = {
  args: {
    ...Default.args,
    searchText: "config",
  },
};

export const ListChanged: Story = {
  args: {
    ...Default.args,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    resources: [],
    templates: [],
    subscriptions: [],
  },
};
