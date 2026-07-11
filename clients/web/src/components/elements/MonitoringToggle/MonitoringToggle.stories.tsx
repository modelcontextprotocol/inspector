import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { MonitoringToggle } from "./MonitoringToggle";

const meta: Meta<typeof MonitoringToggle> = {
  title: "Elements/MonitoringToggle",
  component: MonitoringToggle,
  args: { open: false, onToggle: fn() },
};

export default meta;
type Story = StoryObj<typeof MonitoringToggle>;

export const Closed: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("button", { name: "Open monitoring column" }),
    ).toBeInTheDocument();
  },
};

export const Open: Story = {
  args: { open: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("button", { name: "Close monitoring column" }),
    ).toBeInTheDocument();
  },
};
