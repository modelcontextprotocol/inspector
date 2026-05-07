import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { fn, userEvent, within } from "storybook/test";
import { AppsScreen, type AppsScreenProps } from "./AppsScreen";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import { SUN_ICON_SVG } from "../../../test/fixtures/storyIcons";

const PLACEHOLDER_SANDBOX = "data:text/html,<title>Mock%20Sandbox</title>";

function createMockBridge(): AppBridge {
  return {
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  } as unknown as AppBridge;
}

const okBridgeFactory: BridgeFactory = () => createMockBridge();

const cohortApp: Tool = {
  name: "get-cohort-data",
  title: "Cohort Data",
  description: "Returns cohort retention heatmap data.",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", description: "retention | engagement" },
      periodType: { type: "string", description: "daily | weekly | monthly" },
      cohortCount: { type: "number", description: "Cohorts to render" },
      maxPeriods: { type: "number", description: "Periods per cohort" },
    },
    required: ["metric", "periodType"],
  },
  _meta: { ui: { resourceUri: "ui://apps/cohort-heatmap" } },
};

const weatherApp: Tool = {
  name: "weather-widget",
  title: "Weather Widget",
  description: "Live weather and a five-day forecast for any city.",
  icons: [{ src: SUN_ICON_SVG, mimeType: "image/svg+xml" }],
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  _meta: { ui: { resourceUri: "ui://apps/weather" } },
};

const dashboardApp: Tool = {
  name: "ops-dashboard",
  title: "Ops Dashboard",
  description: "Current operational status across services.",
  inputSchema: { type: "object" },
  _meta: { ui: { resourceUri: "ui://apps/ops" } },
};

const sampleApps: Tool[] = [cohortApp, weatherApp, dashboardApp];

const meta: Meta<typeof AppsScreen> = {
  title: "Screens/AppsScreen",
  component: AppsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    sandboxPath: PLACEHOLDER_SANDBOX,
    bridgeFactory: okBridgeFactory,
    listChanged: false,
    onRefreshList: fn(),
    onSelectApp: fn(),
    onOpenApp: fn(),
    onCloseApp: fn(),
  },
  // Each story uses its own ref so AppRenderer's imperative handle gets a
  // fresh slot per render (Storybook may keep the canvas mounted across
  // arg edits, but the ref itself is owned by the wrapping component).
  render: function StoryRender(args: AppsScreenProps) {
    const ref = useRef<AppRendererHandle>(null);
    return <AppsScreen {...args} rendererRef={ref} />;
  },
};

export default meta;
type Story = StoryObj<typeof AppsScreen>;

async function selectByLabel(canvasElement: HTMLElement, label: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByText(label));
}

async function clickByName(canvasElement: HTMLElement, name: RegExp) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name }));
}

export const NoSelection: Story = {
  args: { tools: sampleApps },
};

export const AppSelected: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Cohort Data");
  },
};

export const AppRunning: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Weather Widget");
    const canvas = within(canvasElement);
    const cityField = await canvas.findByRole("textbox", { name: /city/i });
    await userEvent.type(cityField, "Reykjavik");
    await clickByName(canvasElement, /open app/i);
  },
};

export const AppRunningMaximized: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Weather Widget");
    const canvas = within(canvasElement);
    const cityField = await canvas.findByRole("textbox", { name: /city/i });
    await userEvent.type(cityField, "Reykjavik");
    await clickByName(canvasElement, /open app/i);
    await userEvent.click(await canvas.findByLabelText("Maximize"));
  },
};

export const NoFieldsApp: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Ops Dashboard");
  },
};

export const WithListChanged: Story = {
  args: { tools: sampleApps, listChanged: true },
};

export const Empty: Story = {
  args: { tools: [] },
};
