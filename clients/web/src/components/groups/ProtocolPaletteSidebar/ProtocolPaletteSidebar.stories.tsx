import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Card, Stack } from "@mantine/core";
import { ProtocolPaletteSidebar } from "./ProtocolPaletteSidebar";
import { flightBookingTools } from "../../screens/ProtocolBuilderScreen/ProtocolBuilderScreen.fixtures";

const meta: Meta<typeof ProtocolPaletteSidebar> = {
  title: "Groups/ProtocolPaletteSidebar",
  component: ProtocolPaletteSidebar,
  parameters: { layout: "padded" },
  args: {
    tools: flightBookingTools,
    recVars: [],
    listChanged: false,
    targetTerminated: false,
    targetLabel: null,
    onRefreshTools: fn(),
    onClearTarget: fn(),
    onAddTool: fn(),
    onAddPair: fn(),
    onAddInternalChoice: fn(),
    onAddExternalChoice: fn(),
    onAddRecursion: fn(),
    onAddRecRef: fn(),
  },
  render: (args) => (
    <Stack w={320}>
      <Card withBorder padding="lg">
        <ProtocolPaletteSidebar {...args} />
      </Card>
    </Stack>
  ),
};

export default meta;
type Story = StoryObj<typeof ProtocolPaletteSidebar>;

export const Default: Story = {};

export const Empty: Story = { args: { tools: [] } };

export const WithRecVars: Story = {
  args: { recVars: ["X", "Y"] },
};

export const WithInsertTarget: Story = {
  args: { targetLabel: "BranchA" },
};

export const TargetTerminated: Story = {
  args: { targetTerminated: true, targetLabel: "BranchA" },
};
