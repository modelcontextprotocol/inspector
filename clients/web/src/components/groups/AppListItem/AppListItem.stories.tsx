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

const withIconTool: Tool = {
  name: "weather_widget",
  title: "Weather Widget",
  description:
    "Displays the current weather and a five-day forecast for any city.",
  icons: [
    {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Sun_in_X-Ray.png/120px-Sun_in_X-Ray.png",
      mimeType: "image/png",
      sizes: ["120x120"],
    },
  ],
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
