import { Box, Text } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { MonitoringScreen } from "./MonitoringScreen";

const demoScreens = {
  Logs: (
    <Box p="md">
      <Text>Log stream</Text>
    </Box>
  ),
  Protocol: (
    <Box p="md">
      <Text>Request history</Text>
    </Box>
  ),
  Network: (
    <Box p="md">
      <Text>Network requests</Text>
    </Box>
  ),
};

const meta: Meta<typeof MonitoringScreen> = {
  title: "Groups/MonitoringScreen",
  component: MonitoringScreen,
  decorators: [
    (Story) => (
      <Box h={320}>
        <Story />
      </Box>
    ),
  ],
  args: {
    tabs: ["Logs", "Protocol", "Network"],
    value: "Logs",
    onChange: fn(),
    searchValue: "",
    onSearchChange: fn(),
    onClose: fn(),
    screens: demoScreens,
  },
};

export default meta;
type Story = StoryObj<typeof MonitoringScreen>;

export const Logs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Log stream")).toBeInTheDocument();
  },
};

export const Protocol: Story = {
  args: { value: "Protocol" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Request history")).toBeInTheDocument();
  },
};
