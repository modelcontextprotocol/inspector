import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { AppListItem } from "./AppListItem";

const meta: Meta<typeof AppListItem> = {
  title: "Groups/AppListItem",
  component: AppListItem,
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof AppListItem>;

const calculatorTool: Tool = {
  name: "calculator",
  title: "Calculator",
  description: "An interactive calculator widget for arithmetic operations.",
  inputSchema: { type: "object" },
};

const noDescriptionTool: Tool = {
  name: "no_description",
  title: "No Description",
  inputSchema: { type: "object" },
};

// Inline SVG so stories render offline and in Chromatic without external fetches.
const SUN_ICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='gold'%3E%3Ccircle cx='12' cy='12' r='5'/%3E%3Cg stroke='gold' stroke-width='2' stroke-linecap='round'%3E%3Cline x1='12' y1='2' x2='12' y2='5'/%3E%3Cline x1='12' y1='19' x2='12' y2='22'/%3E%3Cline x1='2' y1='12' x2='5' y2='12'/%3E%3Cline x1='19' y1='12' x2='22' y2='12'/%3E%3Cline x1='4.93' y1='4.93' x2='7.05' y2='7.05'/%3E%3Cline x1='16.95' y1='16.95' x2='19.07' y2='19.07'/%3E%3Cline x1='4.93' y1='19.07' x2='7.05' y2='16.95'/%3E%3Cline x1='16.95' y1='7.05' x2='19.07' y2='4.93'/%3E%3C/g%3E%3C/svg%3E";

const withIconTool: Tool = {
  name: "weather_widget",
  title: "Weather Widget",
  description:
    "Displays the current weather and a five-day forecast for any city.",
  icons: [{ src: SUN_ICON_SVG, mimeType: "image/svg+xml" }],
  inputSchema: { type: "object" },
};

const longNameTool: Tool = {
  name: "this_is_a_very_long_app_tool_name_that_should_truncate_in_the_list_view_when_rendered",
  description:
    "A description that itself runs to a couple of lines so we can confirm the line clamp behavior on the description renders correctly without pushing the chevron down or wrapping the row in unexpected ways.",
  inputSchema: { type: "object" },
};

export const Default: Story = {
  args: {
    tool: calculatorTool,
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    tool: calculatorTool,
    selected: true,
  },
};

export const WithIcon: Story = {
  args: {
    tool: withIconTool,
    selected: false,
  },
};

export const NoDescription: Story = {
  args: {
    tool: noDescriptionTool,
    selected: false,
  },
};

export const LongName: Story = {
  args: {
    tool: longNameTool,
    selected: false,
  },
};
