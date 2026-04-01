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
  {
    name: "package.json",
    uri: "file:///package.json",
    annotations: { audience: "developer" },
    selected: false,
  },
  {
    name: "tsconfig.json",
    uri: "file:///tsconfig.json",
    annotations: { audience: "developer", priority: 0.3 },
    selected: false,
  },
  {
    name: ".env.example",
    uri: "file:///.env.example",
    selected: false,
  },
  {
    name: "docker-compose.yml",
    uri: "file:///docker-compose.yml",
    annotations: { priority: 0.6 },
    selected: false,
  },
  {
    name: "migrations/001_init.sql",
    uri: "file:///migrations/001_init.sql",
    annotations: { audience: "developer", priority: 0.4 },
    selected: false,
  },
  {
    name: "migrations/002_add_users.sql",
    uri: "file:///migrations/002_add_users.sql",
    annotations: { audience: "developer", priority: 0.4 },
    selected: false,
  },
  {
    name: "seeds/users.json",
    uri: "file:///seeds/users.json",
    selected: false,
  },
  {
    name: "seeds/products.json",
    uri: "file:///seeds/products.json",
    selected: false,
  },
  {
    name: "certs/server.pem",
    uri: "file:///certs/server.pem",
    annotations: { priority: 0.9 },
    selected: false,
  },
  {
    name: "logs/access.log",
    uri: "file:///logs/access.log",
    annotations: { audience: "application", priority: 0.2 },
    selected: false,
  },
  {
    name: "logs/error.log",
    uri: "file:///logs/error.log",
    annotations: { audience: "application", priority: 0.7 },
    selected: false,
  },
  {
    name: "api-spec.yaml",
    uri: "file:///api-spec.yaml",
    annotations: { audience: "developer" },
    selected: false,
  },
  {
    name: "CHANGELOG.md",
    uri: "file:///CHANGELOG.md",
    selected: false,
  },
  {
    name: "LICENSE",
    uri: "file:///LICENSE",
    selected: false,
  },
  {
    name: ".gitignore",
    uri: "file:///.gitignore",
    selected: false,
  },
  {
    name: "Makefile",
    uri: "file:///Makefile",
    annotations: { audience: "developer", priority: 0.3 },
    selected: false,
  },
  {
    name: "fixtures/test-data.json",
    uri: "file:///fixtures/test-data.json",
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
  {
    name: "Log File",
    title: "Application Log",
    uriTemplate: "file:///logs/{service}/{date}.log",
    selected: false,
  },
  {
    name: "Migration",
    uriTemplate: "file:///migrations/{version}_{name}.sql",
    selected: false,
  },
  {
    name: "Config by Environment",
    title: "Environment Config",
    uriTemplate: "file:///config/{environment}.json",
    selected: false,
  },
  {
    name: "API Endpoint",
    uriTemplate: "https://api.example.com/{version}/{resource}",
    selected: false,
  },
  {
    name: "Report",
    title: "Generated Report",
    uriTemplate: "reports://{reportType}/{year}/{month}",
    selected: false,
  },
];

const sampleSubscriptions = [
  {
    name: "config.json",
    uri: "file:///config.json",
    lastUpdated: "2026-03-17T10:30:00Z",
  },
  {
    name: "schema.sql",
    uri: "file:///schema.sql",
    lastUpdated: "2026-03-17T10:28:00Z",
  },
  {
    name: "docker-compose.yml",
    uri: "file:///docker-compose.yml",
    lastUpdated: "2026-03-17T09:45:00Z",
  },
  {
    name: "logs/error.log",
    uri: "file:///logs/error.log",
    lastUpdated: "2026-03-17T10:31:12Z",
  },
  {
    name: "certs/server.pem",
    uri: "file:///certs/server.pem",
  },
  {
    name: "api-spec.yaml",
    uri: "file:///api-spec.yaml",
    lastUpdated: "2026-03-17T08:15:00Z",
  },
  {
    name: "package.json",
    uri: "file:///package.json",
    lastUpdated: "2026-03-17T10:22:00Z",
  },
  {
    name: "seeds/users.json",
    uri: "file:///seeds/users.json",
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
    subscriptions: sampleSubscriptions,
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

export const AllSections: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates.map((t) =>
      t.uriTemplate === "file:///users/{userId}/profile"
        ? { ...t, selected: true }
        : t,
    ),
    subscriptions: sampleSubscriptions,
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
