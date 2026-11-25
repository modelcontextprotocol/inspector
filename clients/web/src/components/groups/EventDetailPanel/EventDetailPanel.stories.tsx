import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { EventSubscriptionMode } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { EventDetailPanel } from "./EventDetailPanel";
import type { SubscribeTuning } from "../../../utils/eventsUtils";
import {
  allModesType,
  headerAnnotatedType,
  pollOnlyType,
  unknownModeType,
  WEBHOOK_SECRET,
  webhookOnlyType,
} from "../../../test/fixtures/events";

// Mode, tuning and arguments are lifted to the screen; this holds them so the
// story's controls respond.
function Stateful(args: ComponentProps<typeof EventDetailPanel>) {
  const [mode, setMode] = useState<EventSubscriptionMode | undefined>(
    args.mode,
  );
  const [tuning, setTuning] = useState<SubscribeTuning>(args.tuning);
  const [formValues, setFormValues] = useState(args.formValues);
  return (
    <EventDetailPanel
      {...args}
      mode={mode}
      onModeChange={setMode}
      tuning={tuning}
      onTuningChange={setTuning}
      formValues={formValues}
      onFormChange={setFormValues}
    />
  );
}

const meta: Meta<typeof EventDetailPanel> = {
  title: "Groups/EventDetailPanel",
  component: EventDetailPanel,
  render: (args) => <Stateful {...args} />,
  args: {
    formValues: {},
    tuning: {},
    mode: "poll",
    onFormChange: fn(),
    onModeChange: fn(),
    onTuningChange: fn(),
    onSubscribe: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof EventDetailPanel>;

export const AllModes: Story = {
  args: { eventType: allModesType },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Push"));
    await expect(canvas.getByLabelText("heartbeatMs")).toBeInTheDocument();
  },
};
export const AlreadySubscribed: Story = {
  args: { eventType: allModesType, onUnsubscribe: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Unsubscribe" }));
    await expect(args.onUnsubscribe).toHaveBeenCalledTimes(1);
  },
};
export const PollOnly: Story = { args: { eventType: pollOnlyType } };
export const MirroredHeaders: Story = {
  args: { eventType: headerAnnotatedType, formValues: { region: "us-west1" } },
};
export const Webhook: Story = {
  args: {
    eventType: allModesType,
    mode: "webhook",
    tuning: { callbackUrl: "https://hooks.example.com/in", ttlMs: 3_600_000 },
    webhookSecret: WEBHOOK_SECRET,
    onRegenerateWebhookSecret: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/whsec_•+/)).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Subscribe" }),
    ).toBeEnabled();
  },
};
export const WebhookNotHttps: Story = {
  args: {
    eventType: webhookOnlyType,
    mode: "webhook",
    tuning: { callbackUrl: "http://hooks.example.com/in" },
    webhookSecret: WEBHOOK_SECRET,
  },
};
export const NoSubscribableMode: Story = {
  args: { eventType: unknownModeType, mode: undefined },
};
export const SubscribeRefused: Story = {
  args: {
    eventType: pollOnlyType,
    subscribeError:
      "The server does not offer the Events extension on this connection.",
  },
};
