import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EventSubscriptionCard } from "./EventSubscriptionCard";
import {
  activePoll,
  forbiddenPoll,
  reconnectingPush,
  terminatedPush,
} from "../../../test/fixtures/events";

const meta: Meta<typeof EventSubscriptionCard> = {
  title: "Groups/EventSubscriptionCard",
  component: EventSubscriptionCard,
  args: {
    logFiltered: false,
    onStop: fn(),
    onResume: fn(),
    onRemove: fn(),
    onToggleLogFilter: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof EventSubscriptionCard>;

export const ActivePoll: Story = { args: { subscription: activePoll } };
export const ReconnectingPush: Story = {
  args: { subscription: reconnectingPush },
};
export const TerminatedResumable: Story = {
  args: { subscription: terminatedPush },
};
export const TerminatedForbidden: Story = {
  args: { subscription: forbiddenPoll },
};
export const LogFiltered: Story = {
  args: { subscription: activePoll, logFiltered: true },
};
