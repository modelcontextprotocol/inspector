import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourcesScreen } from "./ResourcesScreen";
import type { ResourceListItemProps } from "../../molecules/ResourceListItem/ResourceListItem";
import type { ResourceTemplateInputProps } from "../../molecules/ResourceTemplateInput/ResourceTemplateInput";
import type { ResourcePreviewPanelProps } from "../../molecules/ResourcePreviewPanel/ResourcePreviewPanel";

const meta: Meta<typeof ResourcesScreen> = {
  component: ResourcesScreen,
  parameters: { layout: "fullscreen" },
  args: {
    searchText: "",
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectResource: fn(),
    listChanged: false,
    subscriptions: [],
    templates: [],
  },
};

export default meta;
type Story = StoryObj<typeof ResourcesScreen>;

const sampleResources: ResourceListItemProps[] = [
  {
    name: "config.json",
    uri: "file:///config.json",
    annotations: { audience: "developer", priority: 0.8 },
    selected: false,
    onClick: fn(),
  },
  {
    name: "README.md",
    uri: "file:///README.md",
    selected: false,
    onClick: fn(),
  },
  {
    name: "schema.sql",
    uri: "file:///schema.sql",
    annotations: { priority: 0.5 },
    selected: false,
    onClick: fn(),
  },
];

const sampleTemplates: ResourceTemplateInputProps[] = [
  {
    template: "file:///users/{userId}/profile",
    variables: { userId: "" },
    onVariableChange: fn(),
    onSubmit: fn(),
  },
  {
    template: "db://tables/{tableName}/rows/{rowId}",
    variables: { tableName: "", rowId: "" },
    onVariableChange: fn(),
    onSubmit: fn(),
  },
];

const selectedResourceProps: ResourcePreviewPanelProps = {
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
  onCopy: fn(),
  onSubscribe: fn(),
  onUnsubscribe: fn(),
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
    selectedResource: selectedResourceProps,
    subscriptions: [
      { name: "config.json", lastUpdated: "2026-03-17T10:30:00Z" },
    ],
  },
};

export const WithTemplates: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
  },
};

export const Empty: Story = {
  args: {
    resources: [],
  },
};
