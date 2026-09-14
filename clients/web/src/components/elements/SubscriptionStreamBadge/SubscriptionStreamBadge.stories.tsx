import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubscriptionStreamBadge } from "./SubscriptionStreamBadge";

const meta: Meta<typeof SubscriptionStreamBadge> = {
  title: "Elements/SubscriptionStreamBadge",
  component: SubscriptionStreamBadge,
};

export default meta;
type Story = StoryObj<typeof SubscriptionStreamBadge>;

export const Connecting: Story = {
  args: { status: "connecting" },
};

export const Acknowledged: Story = {
  args: { status: "acknowledged" },
};

export const Reconnecting: Story = {
  args: { status: "reconnecting" },
};

export const Ended: Story = {
  args: { status: "ended" },
};

/**
 * The server answered `subscriptions/listen` with a bare JSON-RPC result — the
 * graceful-closure marker — without ever acknowledging it (#2097). Distinct from
 * `Ended` because the Inspector does not retry it.
 */
export const NeverAcknowledged: Story = {
  args: { status: "never-acknowledged" },
};
