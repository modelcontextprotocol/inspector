import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourcesScreen } from "./ResourcesScreen";
import type {
  ResourceItem,
  TemplateListItem,
  SelectedResource,
  SelectedTemplate,
} from "./ResourcesScreen";

const meta: Meta<typeof ResourcesScreen> = {
  title: "Screens/ResourcesScreen",
  component: ResourcesScreen,
  parameters: { layout: "fullscreen" },
  args: {
    searchText: "",
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectUri: fn(),
    onSelectTemplate: fn(),
    onReadResource: fn(),
    onSubscribeResource: fn(),
    onUnsubscribeResource: fn(),
    listChanged: false,
    subscriptions: [],
    templates: [],
  },
};

export default meta;
type Story = StoryObj<typeof ResourcesScreen>;

const sampleResources: ResourceItem[] = [
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
    annotations: { priority: 0.5 },
    selected: false,
  },
];

const sampleTemplates: TemplateListItem[] = [
  {
    name: "User Profile",
    uriTemplate: "file:///users/{userId}/profile",
    selected: false,
  },
  {
    name: "Table Row",
    title: "Database Table Row",
    uriTemplate: "db://tables/{tableName}/rows/{rowId}",
    selected: false,
  },
];

const selectedResourceData: SelectedResource = {
  uri: "file:///config.json",
  mimeType: "application/json",
  annotations: { audience: "developer", priority: 0.8 },
  content: JSON.stringify(
    {
      name: "my-project",
      version: "1.0.0",
      settings: { debug: true, logLevel: "info" },
    },
    null,
    2,
  ),
  lastUpdated: "2026-03-17T10:30:00Z",
  isSubscribed: true,
};

const selectedTemplateData: SelectedTemplate = {
  name: "User Profile",
  uriTemplate: "file:///users/{userId}/profile",
  description: "Fetch a user profile by their unique identifier.",
};

export const WithResources: Story = {
  args: {
    resources: sampleResources,
  },
};

export const ResourceSelected: Story = {
  args: {
    resources: sampleResources.map((r) =>
      r.uri === "file:///config.json" ? { ...r, selected: true } : r,
    ),
    selectedResource: selectedResourceData,
    subscriptions: [
      {
        name: "config.json",
        uri: "file:///config.json",
        lastUpdated: "2026-03-17T10:30:00Z",
      },
    ],
  },
};

export const WithTemplates: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
  },
};

export const TemplateSelected: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates.map((t) =>
      t.uriTemplate === "file:///users/{userId}/profile"
        ? { ...t, selected: true }
        : t,
    ),
    selectedTemplate: selectedTemplateData,
  },
};

export const TemplateWithResource: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates.map((t) =>
      t.uriTemplate === "file:///users/{userId}/profile"
        ? { ...t, selected: true }
        : t,
    ),
    selectedTemplate: selectedTemplateData,
    selectedResource: {
      uri: "file:///users/42/profile",
      mimeType: "application/json",
      annotations: { audience: "developer", priority: 0.8 },
      content: JSON.stringify(
        { id: 42, name: "Alice", email: "alice@example.com" },
        null,
        2,
      ),
      lastUpdated: "2026-03-17T11:15:00Z",
      isSubscribed: false,
    },
  },
};

export const Empty: Story = {
  args: {
    resources: [],
  },
};
