import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { expect, fn, userEvent, within } from "storybook/test";
import { ResourcesScreen } from "./ResourcesScreen";
import type { ReadResourceState, ResourcesUiState } from "./ResourcesScreen";
import { EMPTY_RESOURCES_UI } from "../screenUiState";

// ResourcesScreen is controlled (resource/template selection, the originating
// template, search text, and open accordion sections live in the parent as one
// `ui` object — see #1417). This wrapper holds that state so the play-driven
// clicks still drive the detail/preview panels, mirroring how App owns the state
// in the real app.
function StatefulResourcesScreen(args: ComponentProps<typeof ResourcesScreen>) {
  const [ui, setUi] = useState<ResourcesUiState>(args.ui ?? EMPTY_RESOURCES_UI);
  return <ResourcesScreen {...args} ui={ui} onUiChange={setUi} />;
}

const meta: Meta<typeof ResourcesScreen> = {
  title: "Screens/ResourcesScreen",
  component: ResourcesScreen,
  parameters: { layout: "fullscreen" },
  args: {
    ui: EMPTY_RESOURCES_UI,
    onUiChange: fn(),
    onRefreshList: fn(),
    onReadResource: fn(),
    onSubscribeResource: fn(),
    onUnsubscribeResource: fn(),
    listChanged: false,
    subscriptions: [],
    templates: [],
    compact: false,
    onCompactChange: fn(),
  },
  render: (args) => <StatefulResourcesScreen {...args} />,
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

async function clickByText(
  canvasElement: HTMLElement,
  label: string,
  regionName?: RegExp,
) {
  const canvas = within(canvasElement);
  const scope = regionName
    ? within(await canvas.findByRole("region", { name: regionName }))
    : canvas;
  await userEvent.click(await scope.findByText(label));
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
    await clickByText(canvasElement, "config.json", /^URIs/);
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

const manyResources: Resource[] = Array.from({ length: 40 }, (_, i) => ({
  name: `resource-${String(i + 1).padStart(2, "0")}.wav`,
  uri: `file:///kit/resource-${i + 1}.wav`,
}));

// Enough URIs to overflow the panel. The sidebar card stays the same height as
// the detail panel (no selection → full-height empty card), and only the inner
// accordion scroll region scrolls — it doesn't scroll before the panel is full
// (#1462).
export const ManyResources: Story = {
  args: {
    resources: manyResources,
    templates: sampleTemplates,
  },
  play: async ({ canvasElement }) => {
    const [sidebarCard, detailCard] =
      canvasElement.querySelectorAll(".mantine-Card-root");
    const sidebar = sidebarCard.getBoundingClientRect();
    const detail = detailCard.getBoundingClientRect();
    // The sidebar matches the detail panel's height (same bottom baseline).
    expect(Math.abs(sidebar.bottom - detail.bottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(sidebar.height - detail.height)).toBeLessThanOrEqual(1);
    // The list overflows, so the single inner scroll region scrolls.
    const viewport = canvasElement.querySelector(
      ".mantine-ScrollArea-viewport",
    );
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("scroll viewport not found");
    }
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
  },
};

export const Empty: Story = {
  args: {
    resources: [],
  },
};
