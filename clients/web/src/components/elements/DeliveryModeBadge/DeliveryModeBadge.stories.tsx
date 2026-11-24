import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeliveryModeBadge } from "./DeliveryModeBadge";

const meta: Meta<typeof DeliveryModeBadge> = {
  title: "Elements/DeliveryModeBadge",
  component: DeliveryModeBadge,
};

export default meta;
type Story = StoryObj<typeof DeliveryModeBadge>;

export const Poll: Story = { args: { mode: "poll" } };
export const Push: Story = { args: { mode: "push" } };
export const Webhook: Story = { args: { mode: "webhook" } };
export const UnknownMode: Story = { args: { mode: "carrier-pigeon" } };
