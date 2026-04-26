import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { ToolControls } from "./ToolControls";
import { longToolList } from "../../screens/ToolsScreen/ToolsScreen.fixtures";

const meta: Meta<typeof ToolControls> = {
  title: "Groups/ToolControls",
  component: ToolControls,
  args: {
    onRefreshList: fn(),
    onSelectTool: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof ToolControls>;

export const Default: Story = {
  args: {
    tools: longToolList,
  },
};

export const WithSelection: Story = {
  args: {
    tools: longToolList,
    selectedName: "query_database",
  },
};

export const WithSearch: Story = {
  args: {
    tools: longToolList,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByPlaceholderText("Search tools..."),
      "git",
    );
  },
};

export const ListChanged: Story = {
  args: {
    tools: longToolList,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    tools: [],
  },
};
