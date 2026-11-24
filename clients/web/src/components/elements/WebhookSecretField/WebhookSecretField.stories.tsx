import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WebhookSecretField } from "./WebhookSecretField";

const meta: Meta<typeof WebhookSecretField> = {
  title: "Elements/WebhookSecretField",
  component: WebhookSecretField,
  args: { secret: `whsec_${"A".repeat(43)}=` },
};

export default meta;
type Story = StoryObj<typeof WebhookSecretField>;

export const CopyOnly: Story = {};
export const WithRegenerate: Story = { args: { onRegenerate: fn() } };
