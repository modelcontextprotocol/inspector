import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ToolControls } from "./ToolControls";

const meta: Meta<typeof ToolControls> = {
  title: "Groups/ToolControls",
  component: ToolControls,
  args: {
    searchText: "",
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectTool: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof ToolControls>;

const sampleTools = [
  {
    name: "send_message",
    title: "Send Message",
    selected: false,
    onClick: fn(),
  },
  {
    name: "create_record",
    title: "Create Record",
    selected: false,
    onClick: fn(),
  },
  { name: "delete_records", selected: false, onClick: fn() },
  { name: "list_users", selected: false, onClick: fn() },
  { name: "batch_process", selected: false, onClick: fn() },
];

export const Default: Story = {
  args: {
    tools: sampleTools,
  },
};

export const WithSelection: Story = {
  args: {
    tools: sampleTools.map((t) =>
      t.name === "create_record" ? { ...t, selected: true } : t,
    ),
  },
};

export const WithSearch: Story = {
  args: {
    tools: sampleTools,
    searchText: "send",
  },
};

export const ListChanged: Story = {
  args: {
    tools: sampleTools,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    tools: [],
  },
};
