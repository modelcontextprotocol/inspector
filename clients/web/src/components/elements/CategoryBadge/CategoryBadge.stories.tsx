import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { CategoryBadge } from "./CategoryBadge";

const meta: Meta<typeof CategoryBadge> = {
  title: "Elements/CategoryBadge",
  component: CategoryBadge,
};

export default meta;
type Story = StoryObj<typeof CategoryBadge>;

export const Transport: Story = {
  args: { category: "transport" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("transport")).toBeInTheDocument();
  },
};

export const Auth: Story = {
  args: { category: "auth" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("auth")).toBeInTheDocument();
  },
};
