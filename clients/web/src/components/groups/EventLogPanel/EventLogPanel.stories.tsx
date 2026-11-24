import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EventLogPanel } from "./EventLogPanel";
import { eventLog, subscriptions } from "../../../test/fixtures/events";

const meta: Meta<typeof EventLogPanel> = {
  title: "Groups/EventLogPanel",
  component: EventLogPanel,
  args: { onClear: fn(), subscriptions },
};

export default meta;
type Story = StoryObj<typeof EventLogPanel>;

/** Every entry kind: occurrences (valid, invalid, unchecked), gap, error, reconnect, termination. */
export const EveryKind: Story = { args: { entries: eventLog } };
export const Empty: Story = { args: { entries: [] } };
export const FilteredToOne: Story = {
  args: {
    entries: eventLog.filter((e) => e.subscription === subscriptions[0]!.id),
    filteredTo: "email.received (poll)",
  },
};
