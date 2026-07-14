import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Card, Flex } from "@mantine/core";
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

const resourceLinksResult: CallToolResult = {
  content: [
    {
      type: "text",
      text: "Here are 3 resource links to resources available in this server:",
    },
    {
      type: "resource_link",
      uri: "demo://resource/dynamic/blob/1",
      name: "Blob Resource 1",
      mimeType: "text/plain",
    },
    {
      type: "resource_link",
      uri: "demo://resource/dynamic/text/2",
      name: "Text Resource 2",
      mimeType: "text/plain",
    },
    {
      type: "resource_link",
      uri: "demo://resource/dynamic/blob/3",
      name: "Blob Resource 3",
      mimeType: "text/plain",
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

// A run of `resource_link` blocks is grouped into one scrollable "Resource
// Links" box, with each link card in the recessed inset surface that matches
// the Protocol message cards. The decorator mirrors the Tools screen's
// full-height result card (ContentPane height → ContentCard `flex: 1`) so the
// box fills the available space and scrolls within, as it does in the app.
export const ResourceLinks: Story = {
  args: {
    result: resourceLinksResult,
    onReadResource: async (uri: string) => ({
      contents: [{ uri, mimeType: "text/plain", text: `Contents of ${uri}` }],
    }),
  },
  decorators: [
    (Story) => (
      <Flex h={520} direction="column" align="stretch">
        <Card withBorder padding="lg" variant="preview" flex={1}>
          <Story />
        </Card>
      </Flex>
    ),
  ],
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
