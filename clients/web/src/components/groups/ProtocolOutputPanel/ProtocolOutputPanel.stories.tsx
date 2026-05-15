import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Card, Stack } from "@mantine/core";
import { ProtocolOutputPanel } from "./ProtocolOutputPanel";

const meta: Meta<typeof ProtocolOutputPanel> = {
  title: "Groups/ProtocolOutputPanel",
  component: ProtocolOutputPanel,
  parameters: { layout: "padded" },
  args: {
    pythonSnippet:
      'from llmsessioncontract import Monitor\n\nprotocol = "!Search.?SearchResult.end"\nmonitor = Monitor(protocol)',
    copied: null,
    onCopyDsl: fn(),
    onCopyPython: fn(),
    onDownload: fn(),
  },
  render: (args) => (
    <Stack maw={520}>
      <Card withBorder padding="lg">
        <ProtocolOutputPanel {...args} />
      </Card>
    </Stack>
  ),
};

export default meta;
type Story = StoryObj<typeof ProtocolOutputPanel>;

export const SimpleSequence: Story = {
  args: { protocol: "!Search.?SearchResult.!Book.?BookConfirm.end" },
};

export const Choice: Story = {
  args: { protocol: "!{Yes.!Confirm.end, No.end}" },
};

export const Recursion: Story = {
  args: { protocol: "rec X.!Ping.?Pong.X" },
};

export const Empty: Story = {
  args: { protocol: "end" },
};

export const Copied: Story = {
  args: {
    protocol: "!Search.?SearchResult.end",
    copied: "dsl",
  },
};
