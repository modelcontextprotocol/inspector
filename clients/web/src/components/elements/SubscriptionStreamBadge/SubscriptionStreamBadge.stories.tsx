import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubscriptionStreamBadge } from "./SubscriptionStreamBadge";

const meta: Meta<typeof SubscriptionStreamBadge> = {
  title: "Elements/SubscriptionStreamBadge",
  component: SubscriptionStreamBadge,
};

export default meta;
type Story = StoryObj<typeof SubscriptionStreamBadge>;

export const Acknowledged: Story = {
  args: { status: "acknowledged" },
};

export const Reconnecting: Story = {
  args: { status: "reconnecting" },
};

export const Ended: Story = {
  args: { status: "ended" },
};
