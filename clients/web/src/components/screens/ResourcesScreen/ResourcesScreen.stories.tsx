import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { fn, userEvent, within } from "storybook/test";
import { ResourcesScreen } from "./ResourcesScreen";
import type { ReadResourceState } from "./ResourcesScreen";

const meta: Meta<typeof ResourcesScreen> = {
  title: "Screens/ResourcesScreen",
  component: ResourcesScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onRefreshList: fn(),
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

const sampleResources: Resource[] = [
  {
    name: "config.json",
    uri: "file:///config.json",
    annotations: { audience: ["user"], priority: 0.8 },
  },
  { name: "README.md", uri: "file:///README.md" },
  {
    name: "schema.sql",
    uri: "file:///schema.sql",
    annotations: { priority: 0.5 },
  },
  {
    name: "package.json",
    uri: "file:///package.json",
    annotations: { audience: ["user"] },
  },
  { name: ".env.example", uri: "file:///.env.example" },
  {
    name: "docker-compose.yml",
    uri: "file:///docker-compose.yml",
    annotations: { priority: 0.6 },
  },
];

const sampleTemplates: ResourceTemplate[] = [
  {
    name: "User Profile",
    uriTemplate: "file:///users/{userId}/profile",
  },
  {
    name: "Table Row",
    title: "Database Table Row",
    uriTemplate: "db://tables/{tableName}/rows/{rowId}",
  },
  {
    name: "Log File",
    title: "Application Log",
    uriTemplate: "file:///logs/{service}/{date}.log",
  },
];

const sampleSubscriptions: InspectorResourceSubscription[] = [
  {
    resource: { name: "config.json", uri: "file:///config.json" },
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
  {
    resource: { name: "schema.sql", uri: "file:///schema.sql" },
    lastUpdated: new Date("2026-03-17T10:28:00Z"),
  },
];

const readConfigState: ReadResourceState = {
  status: "ok",
  uri: "file:///config.json",
  result: {
    contents: [
      {
        uri: "file:///config.json",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            name: "my-project",
            version: "1.0.0",
            settings: { debug: true, logLevel: "info" },
          },
          null,
          2,
        ),
      },
    ],
  },
  lastUpdated: new Date("2026-03-17T10:30:00Z"),
  isSubscribed: true,
};

const readUserProfileState: ReadResourceState = {
  status: "ok",
  uri: "file:///users/42/profile",
  result: {
    contents: [
      {
        uri: "file:///users/42/profile",
        mimeType: "application/json",
        text: JSON.stringify(
          { id: 42, name: "Alice", email: "alice@example.com" },
          null,
          2,
        ),
      },
    ],
  },
  isSubscribed: false,
};

async function clickByText(canvasElement: HTMLElement, label: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByText(label));
}

// The userId value typed below must match the `{userId}` segment in
// `readUserProfileState.uri` so the synthetic-resource fallback in
// ResourcesScreen matches and the preview panel renders.
async function expandUserProfileTemplate(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByText("User Profile"));
  const userIdInput = await canvas.findByLabelText("userId");
  await userEvent.type(userIdInput, "42");
  await userEvent.click(
    await canvas.findByRole("button", { name: "Read Resource" }),
  );
}

export const WithResources: Story = {
  args: {
    resources: sampleResources,
  },
};

export const ResourceSelected: Story = {
  args: {
    resources: sampleResources,
    subscriptions: sampleSubscriptions,
    readState: readConfigState,
  },
  play: async ({ canvasElement }) => {
    await clickByText(canvasElement, "config.json");
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
    templates: sampleTemplates,
  },
  play: async ({ canvasElement }) => {
    await clickByText(canvasElement, "User Profile");
  },
};

export const TemplateWithResource: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    readState: readUserProfileState,
  },
  play: async ({ canvasElement }) => {
    await expandUserProfileTemplate(canvasElement);
  },
};

export const AllSections: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    subscriptions: sampleSubscriptions,
    readState: readUserProfileState,
  },
  play: async ({ canvasElement }) => {
    await expandUserProfileTemplate(canvasElement);
  },
};

export const Empty: Story = {
  args: {
    resources: [],
  },
};
