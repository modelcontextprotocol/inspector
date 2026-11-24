import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { EventsScreen, type EventsUiState } from "./EventsScreen";
import { EMPTY_EVENTS_UI } from "../screenUiState";
import { noopPagination } from "../../../test/fixtures/pagination";
import {
  eventLog,
  eventTypes,
  subscriptions,
} from "../../../test/fixtures/events";

// The screen's ui is lifted to App; this holds it so the story is interactive.
function Stateful(args: ComponentProps<typeof EventsScreen>) {
  const [ui, setUi] = useState<EventsUiState>(args.ui);
  return <EventsScreen {...args} ui={ui} onUiChange={setUi} />;
}

const meta: Meta<typeof EventsScreen> = {
  title: "Screens/EventsScreen",
  component: EventsScreen,
  parameters: { layout: "fullscreen" },
  render: (args) => <Stateful {...args} />,
  args: {
    eventTypes,
    listChanged: false,
    pagination: noopPagination,
    subscriptions,
    log: eventLog,
    ui: EMPTY_EVENTS_UI,
    onUiChange: fn(),
    onRefreshList: fn(),
    onSubscribe: fn(),
    onStopSubscription: fn(),
    onResumeSubscription: fn(),
    onRemoveSubscription: fn(),
    onClearLog: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof EventsScreen>;

export const Default: Story = {};

export const SelectedType: Story = {
  args: {
    ui: { ...EMPTY_EVENTS_UI, selectedEventName: "incident.created" },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Subscribe" }));
    await expect(args.onSubscribe).toHaveBeenCalled();
  },
};

export const Empty: Story = {
  args: { subscriptions: [], log: [], listChanged: true },
};

export const LoadFailed: Story = {
  args: {
    eventTypes: [],
    subscriptions: [],
    log: [],
    loadError: new Error("events/list failed: -32603 Internal error"),
  },
};
