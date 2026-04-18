import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { ToolListItem } from "./ToolListItem";

const meta: Meta<typeof ToolListItem> = {
  title: "Groups/ToolListItem",
  component: ToolListItem,
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ToolListItem>;

const weatherTool: Tool = {
  name: "get_weather",
  inputSchema: { type: "object" },
};

const weatherToolWithTitle: Tool = {
  name: "get_weather",
  title: "Get Weather",
  inputSchema: { type: "object" },
};

export const Default: Story = {
  args: {
    tool: weatherTool,
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    tool: weatherTool,
    selected: true,
  },
};

export const WithTitle: Story = {
  args: {
    tool: weatherToolWithTitle,
    selected: false,
  },
};

export const LongName: Story = {
  args: {
    tool: {
      name: "this_is_a_very_long_tool_name_that_might_need_to_wrap_across_multiple_lines_in_the_ui",
      inputSchema: { type: "object" },
    },
    selected: false,
  },
};
