import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EventTypeListItem } from "./EventTypeListItem";
import {
  allModesType,
  pollOnlyType,
  webhookOnlyType,
} from "../../../test/fixtures/events";

const meta: Meta<typeof EventTypeListItem> = {
  title: "Groups/EventTypeListItem",
  component: EventTypeListItem,
  args: { onClick: fn(), selected: false },
};

export default meta;
type Story = StoryObj<typeof EventTypeListItem>;

export const AllModes: Story = { args: { eventType: allModesType } };
export const Selected: Story = {
  args: { eventType: pollOnlyType, selected: true },
};
export const NoDescription: Story = { args: { eventType: webhookOnlyType } };
