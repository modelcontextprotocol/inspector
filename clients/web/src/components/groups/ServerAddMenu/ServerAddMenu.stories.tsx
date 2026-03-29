import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerAddMenu } from "./ServerAddMenu.js";

const meta: Meta<typeof ServerAddMenu> = {
  title: "Groups/ServerAddMenu",
  component: ServerAddMenu,
  args: {
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerAddMenu>;

export const Default: Story = {};
