import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InlineSamplingRequest } from "./InlineSamplingRequest";

const meta: Meta<typeof InlineSamplingRequest> = {
  title: "Molecules/InlineSamplingRequest",
  component: InlineSamplingRequest,
  args: {
    queuePosition: "1 of 1",
    messagePreview:
      "Please analyze the following code and suggest improvements for performance and readability.",
    responseText: "",
    onAutoRespond: fn(),
    onEditAndSend: fn(),
    onReject: fn(),
    onViewDetails: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof InlineSamplingRequest>;

export const Default: Story = {};

export const WithModelHints: Story = {
  args: {
    modelHints: ["claude-3-opus", "claude-3-sonnet"],
  },
};

export const PrefilledResponse: Story = {
  args: {
    responseText:
      "The code looks good overall. Consider extracting the repeated logic into a helper function.",
  },
};

export const InQueue: Story = {
  args: {
    queuePosition: "2 of 3",
  },
};
