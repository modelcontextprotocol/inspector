import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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

const emptyResult: CallToolResult = {
  content: [],
};

const textResult: CallToolResult = {
  content: [
    {
      type: "text",
      text: "The current weather in San Francisco is 65°F and sunny.",
    },
  ],
};

const jsonResult: CallToolResult = {
  content: [
    {
      type: "text",
      text: '{"temperature":65,"unit":"fahrenheit","condition":"sunny","city":"San Francisco"}',
    },
  ],
};

const imageResult: CallToolResult = {
  content: [
    {
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      mimeType: "image/png",
    },
  ],
};

const mixedResult: CallToolResult = {
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
};

export const Empty: Story = {
  args: {
    result: emptyResult,
  },
};

export const TextResult: Story = {
  args: {
    result: textResult,
  },
};

export const JsonResult: Story = {
  args: {
    result: jsonResult,
  },
};

export const ImageResult: Story = {
  args: {
    result: imageResult,
  },
};

export const MixedContent: Story = {
  args: {
    result: mixedResult,
  },
};

export const ErrorResult: Story = {
  args: {
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: "ENOENT: no such file or directory, open '/data/missing.txt'",
        },
      ],
    },
  },
};
