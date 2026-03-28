import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AddServerMenu } from "./AddServerMenu";

const meta: Meta<typeof AddServerMenu> = {
  title: "Groups/AddServerMenu",
  component: AddServerMenu,
  args: {
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof AddServerMenu>;

export const Default: Story = {};
