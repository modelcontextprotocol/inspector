import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { ProtocolBuilderScreen } from "./ProtocolBuilderScreen";
import { flightBookingTools } from "./ProtocolBuilderScreen.fixtures";

const meta: Meta<typeof ProtocolBuilderScreen> = {
  title: "Screens/ProtocolBuilderScreen",
  component: ProtocolBuilderScreen,
  parameters: { layout: "fullscreen" },
  args: {
    listChanged: false,
    onRefreshTools: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ProtocolBuilderScreen>;

export const Empty: Story = {
  args: { tools: flightBookingTools },
};

export const NoToolsYet: Story = {
  args: { tools: [] },
};

export const ToolListChanged: Story = {
  args: { tools: flightBookingTools, listChanged: true },
};

export const WithSimpleSequence: Story = {
  args: { tools: flightBookingTools },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: /search_flights/ }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: /book_flight/ }),
    );
  },
};

export const WithChoice: Story = {
  args: { tools: flightBookingTools },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: /Internal Choice/ }),
    );
  },
};

export const WithRecursion: Story = {
  args: { tools: flightBookingTools },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: /^rec Recursion$/ }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: /search_flights/ }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: /Loop back to X0/ }),
    );
  },
};
