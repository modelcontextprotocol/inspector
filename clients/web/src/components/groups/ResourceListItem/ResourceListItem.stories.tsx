import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourceListItem } from "./ResourceListItem";

const meta: Meta<typeof ResourceListItem> = {
  title: "Groups/ResourceListItem",
  component: ResourceListItem,
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourceListItem>;

export const Default: Story = {
  args: {
    resource: {
      name: "config.json",
      uri: "file:///config.json",
    },
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    resource: {
      name: "config.json",
      uri: "file:///config.json",
    },
    selected: true,
  },
};

export const WithTitle: Story = {
  args: {
    resource: {
      name: "config.json",
      title: "Configuration File",
      uri: "file:///config.json",
    },
    selected: false,
  },
};

export const Template: Story = {
  args: {
    resource: {
      name: "User Profile",
      uriTemplate: "file:///users/{userId}/profile",
    },
    selected: false,
  },
};

export const WithAudience: Story = {
  args: {
    resource: {
      name: "settings.json",
      uri: "file:///settings.json",
      annotations: { audience: ["user"] },
    },
    selected: false,
  },
};

export const WithPriority: Story = {
  args: {
    resource: {
      name: "schema.sql",
      uri: "file:///schema.sql",
      annotations: { priority: 0.8 },
    },
    selected: false,
  },
};

export const WithAudienceAndPriority: Story = {
  args: {
    resource: {
      name: "config.json",
      title: "Configuration File",
      uri: "file:///config.json",
      annotations: { audience: ["user", "assistant"], priority: 0.5 },
    },
    selected: false,
  },
};

export const TemplateWithAnnotations: Story = {
  args: {
    resource: {
      name: "User Profile",
      uriTemplate: "file:///users/{userId}/profile",
      annotations: { audience: ["assistant"], priority: 0.2 },
    },
    selected: false,
  },
};
