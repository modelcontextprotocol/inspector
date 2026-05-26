import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Card, Stack } from "@mantine/core";
import { ProtocolStepList } from "./ProtocolStepList";
import type { ProtocolStep } from "../../screens/ProtocolBuilderScreen/protocol";
import { flightBookingTools } from "../../screens/ProtocolBuilderScreen/ProtocolBuilderScreen.fixtures";

const meta: Meta<typeof ProtocolStepList> = {
  title: "Groups/ProtocolStepList",
  component: ProtocolStepList,
  parameters: { layout: "padded" },
  args: {
    tools: flightBookingTools,
    receiveOptions: ["search_flightsResult", "search_flightsError"],
    insertTarget: null,
    onSetInsertTarget: fn(),
    onUpdateStep: fn(),
    onRemoveStep: fn(),
    onConvertToChoice: fn(),
  },
  render: (args) => (
    <Stack maw={520}>
      <Card withBorder padding="lg">
        <ProtocolStepList {...args} />
      </Card>
    </Stack>
  ),
};

export default meta;
type Story = StoryObj<typeof ProtocolStepList>;

const pair: ProtocolStep[] = [
  {
    id: "s1",
    type: "action",
    direction: "send",
    label: "search_flights",
    pairId: "p1",
  },
  {
    id: "r1",
    type: "action",
    direction: "receive",
    label: "search_flightsResult",
    pairId: "p1",
  },
];

const choice: ProtocolStep = {
  id: "c1",
  type: "choice",
  direction: "send",
  branches: [
    { id: "b1", label: "Confirm", steps: [] },
    { id: "b2", label: "Cancel", steps: [] },
  ],
};

const recursion: ProtocolStep[] = [
  { id: "rec1", type: "recursion", recVar: "X" },
  ...pair.map((s) => ({ ...s, id: `${s.id}-r` })),
  { id: "ref1", type: "action", isRecRef: true, recVar: "X" },
];

export const PairedSteps: Story = { args: { steps: pair } };

export const Choice: Story = { args: { steps: [choice] } };

export const Recursion: Story = { args: { steps: recursion } };

export const NestedChoice: Story = {
  args: {
    steps: [
      {
        id: "outer",
        type: "choice",
        direction: "receive",
        branches: [
          {
            id: "ob1",
            label: "Ok",
            steps: [
              {
                id: "inner",
                type: "choice",
                direction: "send",
                branches: [
                  { id: "ib1", label: "RetryA", steps: [] },
                  { id: "ib2", label: "RetryB", steps: [] },
                ],
              },
            ],
          },
          { id: "ob2", label: "Err", steps: [] },
        ],
      },
    ],
  },
};
