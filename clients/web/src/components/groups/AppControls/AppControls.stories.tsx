import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn, userEvent, within } from "storybook/test";
import { AppControls } from "./AppControls";
import { SUN_ICON_SVG } from "../../../test/fixtures/storyIcons";

const sampleApps: Tool[] = [
  {
    name: "get-cohort-data",
    title: "Cohort Data",
    description: "Returns cohort retention heatmap data.",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/cohort" } },
  },
  {
    name: "weather-widget",
    title: "Weather Widget",
    description: "Live weather and a five-day forecast for any city.",
    icons: [{ src: SUN_ICON_SVG, mimeType: "image/svg+xml" }],
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/weather" } },
  },
  {
    name: "ops-dashboard",
    title: "Ops Dashboard",
    description: "Current operational status across services.",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/ops" } },
  },
  {
    name: "git_log",
    description: "Recent commits on the current branch.",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/git-log" } },
  },
];

const meta: Meta<typeof AppControls> = {
  title: "Groups/AppControls",
  component: AppControls,
  args: {
    onRefreshList: fn(),
    onSelectApp: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof AppControls>;

export const Default: Story = {
  args: {
    tools: sampleApps,
  },
};

export const WithSelection: Story = {
  args: {
    tools: sampleApps,
    selectedName: "weather-widget",
  },
};

export const WithSearch: Story = {
  args: {
    tools: sampleApps,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByPlaceholderText("Search apps..."),
      "git",
    );
  },
};

export const ListChanged: Story = {
  args: {
    tools: sampleApps,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    tools: [],
  },
};
