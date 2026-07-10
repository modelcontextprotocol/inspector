import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { MonitoringControls } from "./MonitoringControls";

const meta: Meta<typeof MonitoringControls> = {
  title: "Groups/MonitoringControls",
  component: MonitoringControls,
  args: {
    tabs: ["Logs", "Protocol", "Network"],
    value: "Logs",
    onChange: fn(),
    searchValue: "",
    onSearchChange: fn(),
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof MonitoringControls>;

export const AllTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("radio", { name: "Logs" })).toBeChecked();
    expect(
      canvas.getByRole("button", { name: "Close monitoring column" }),
    ).toBeInTheDocument();
  },
};

export const StdioServer: Story = {
  args: { tabs: ["Logs", "Protocol"], value: "Protocol" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByRole("radio", { name: "Network" })).toBeNull();
  },
};
