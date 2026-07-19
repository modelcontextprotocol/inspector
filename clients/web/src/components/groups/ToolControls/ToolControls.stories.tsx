import { useState } from "react";
import { noopPagination } from "../../../test/fixtures/pagination";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { ToolControls } from "./ToolControls";
import { longToolList } from "../../screens/ToolsScreen/ToolsScreen.fixtures";

// ToolControls' search text is controlled by the parent (App, via ToolsScreen —
// see #1417). This wrapper holds that state so the play-driven typing updates
// the controlled input.
function StatefulToolControls(args: ComponentProps<typeof ToolControls>) {
  const [searchText, setSearchText] = useState(args.searchText ?? "");
  return (
    <ToolControls
      {...args}
      searchText={searchText}
      onSearchChange={setSearchText}
    />
  );
}

const meta: Meta<typeof ToolControls> = {
  title: "Groups/ToolControls",
  component: ToolControls,
  args: {
    pagination: noopPagination,
    onRefreshList: fn(),
    onSelectTool: fn(),
    onSearchChange: fn(),
    listChanged: false,
  },
  render: (args) => <StatefulToolControls {...args} />,
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
