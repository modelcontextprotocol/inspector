import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ToolResultPanel } from "./ToolResultPanel";

const meta: Meta<typeof ToolResultPanel> = {
  title: "Groups/ToolResultPanel",
  component: ToolResultPanel,
  args: {
    onClear: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ToolResultPanel>;

export const Empty: Story = {
  args: {
    content: [],
  },
};

export const TextResult: Story = {
  args: {
    content: [
      {
        type: "text",
        text: "The current weather in San Francisco is 65°F and sunny.",
      },
    ],
  },
};

export const JsonResult: Story = {
  args: {
    content: [
      {
        type: "json",
        text: '{"temperature":65,"unit":"fahrenheit","condition":"sunny","city":"San Francisco"}',
      },
    ],
  },
};

export const ImageResult: Story = {
  args: {
    content: [
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
    ],
  },
};

export const MixedContent: Story = {
  args: {
    content: [
      {
        type: "text",
        text: "Here is the generated image based on your description:",
      },
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
    ],
  },
};
