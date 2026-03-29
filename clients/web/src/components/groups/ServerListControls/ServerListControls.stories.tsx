import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerListControls } from "./ServerListControls";

const meta: Meta<typeof ServerListControls> = {
  title: "Groups/ServerListControls",
  component: ServerListControls,
};

export default meta;
type Story = StoryObj<typeof ServerListControls>;

export const WithServers: Story = {
  args: {
    serverCount: 5,
    compact: false,
    onToggleList: fn(),
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
  },
};

export const WithoutServers: Story = {
  args: {
    serverCount: 0,
    compact: true,
    onToggleList: fn(),
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
  },
};
