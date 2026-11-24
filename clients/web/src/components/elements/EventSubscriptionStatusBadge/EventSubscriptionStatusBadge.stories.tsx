import type { Meta, StoryObj } from "@storybook/react-vite";
import { EventSubscriptionStatusBadge } from "./EventSubscriptionStatusBadge";

const meta: Meta<typeof EventSubscriptionStatusBadge> = {
  title: "Elements/EventSubscriptionStatusBadge",
  component: EventSubscriptionStatusBadge,
};

export default meta;
type Story = StoryObj<typeof EventSubscriptionStatusBadge>;

export const Starting: Story = { args: { status: "starting" } };
export const Active: Story = { args: { status: "active" } };
export const Reconnecting: Story = { args: { status: "reconnecting" } };
export const Terminated: Story = { args: { status: "terminated" } };
export const Stopped: Story = { args: { status: "stopped" } };
