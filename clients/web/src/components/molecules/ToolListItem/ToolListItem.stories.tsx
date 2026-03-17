import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ToolListItem } from "./ToolListItem";

const meta: Meta<typeof ToolListItem> = {
  title: "Molecules/ToolListItem",
  component: ToolListItem,
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ToolListItem>;

export const Default: Story = {
  args: {
    name: "get_weather",
    selected: false,
  },
};

export const Selected: Story = {
  args: {
    name: "get_weather",
    selected: true,
  },
};

export const WithAnnotations: Story = {
  args: {
    name: "get_weather",
    selected: false,
    annotations: [
      { label: "user", variant: "audience" },
      { label: "read-only", variant: "readOnly" },
    ],
  },
};

export const MultipleAnnotations: Story = {
  args: {
    name: "update_database",
    selected: false,
    annotations: [
      { label: "user", variant: "audience" },
      { label: "read-only", variant: "readOnly" },
      { label: "destructive", variant: "destructive" },
      { label: "long-run", variant: "longRun" },
    ],
  },
};

export const LongName: Story = {
  args: {
    name: "this_is_a_very_long_tool_name_that_might_need_to_wrap_across_multiple_lines_in_the_ui",
    selected: false,
  },
};
