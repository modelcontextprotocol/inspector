import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { Card, Flex } from "@mantine/core";
import { fn } from "storybook/test";
import { ToolCallErrorPanel } from "./ToolCallErrorPanel";

// Frame the panel in the same result card the Tools screen uses, so the story
// shows it at its real width/height.
const inCardDecorators: Decorator[] = [
  (Story) => (
    <Flex h={360} direction="column" align="stretch">
      <Card withBorder padding="lg" variant="preview">
        <Story />
      </Card>
    </Flex>
  ),
];

const meta: Meta<typeof ToolCallErrorPanel> = {
  title: "Groups/ToolCallErrorPanel",
  component: ToolCallErrorPanel,
  args: {
    onClear: fn(),
  },
  decorators: inCardDecorators,
};

export default meta;
type Story = StoryObj<typeof ToolCallErrorPanel>;

// A generic thrown protocol/SDK error (no special code).
export const GenericError: Story = {
  args: {
    error: "MCP error -32603: Internal error while executing the tool",
  },
};

// SDK v2's unknown-tool rejection: `-32602` arrives as a thrown error, not an
// `isError` result, so it renders here with the targeted "Unknown Tool" hint.
export const UnknownTool: Story = {
  args: {
    error: "MCP error -32602: Invalid params: unknown tool 'ghost_tool'",
    errorCode: -32602,
  },
};
