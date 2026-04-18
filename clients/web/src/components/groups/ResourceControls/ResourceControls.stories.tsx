import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { fn } from "storybook/test";
import { ResourceControls } from "./ResourceControls";

const meta: Meta<typeof ResourceControls> = {
  title: "Groups/ResourceControls",
  component: ResourceControls,
  args: {
    onRefreshList: fn(),
    onSelectUri: fn(),
    onSelectTemplate: fn(),
    onUnsubscribeResource: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof ResourceControls>;

const sampleResources: Resource[] = [
  {
    name: "config.json",
    uri: "file:///config.json",
    annotations: { audience: ["user"], priority: 0.8 },
  },
  {
    name: "README.md",
    uri: "file:///README.md",
  },
  {
    name: "schema.sql",
    uri: "file:///schema.sql",
  },
];

const sampleTemplates: ResourceTemplate[] = [
  {
    name: "User Profile",
    uriTemplate: "file:///users/{userId}/profile",
  },
];

const sampleSubscriptions: InspectorResourceSubscription[] = [
  {
    resource: {
      name: "config.json",
      uri: "file:///config.json",
    },
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
];

export const Default: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    subscriptions: sampleSubscriptions,
  },
};

export const WithSearch: Story = {
  args: {
    ...Default.args,
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
