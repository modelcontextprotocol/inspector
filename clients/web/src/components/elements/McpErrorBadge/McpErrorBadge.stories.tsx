import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { McpErrorBadge } from "./McpErrorBadge";

const meta: Meta<typeof McpErrorBadge> = {
  title: "Elements/McpErrorBadge",
  component: McpErrorBadge,
};

export default meta;
type Story = StoryObj<typeof McpErrorBadge>;

export const HeaderMismatch: Story = {
  args: { code: -32020, name: "HeaderMismatch" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("-32020 HeaderMismatch")).toBeInTheDocument();
  },
};

export const MissingCapability: Story = {
  args: { code: -32021, name: "MissingRequiredClientCapability" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByText("-32021 MissingRequiredClientCapability"),
    ).toBeInTheDocument();
  },
};

export const UnsupportedVersion: Story = {
  args: { code: -32022, name: "UnsupportedProtocolVersion" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByText("-32022 UnsupportedProtocolVersion"),
    ).toBeInTheDocument();
  },
};

export const MethodNotFound: Story = {
  args: {
    code: -32601,
    name: "MethodNotFound",
    description:
      "Unknown method. A JSON-RPC body on a 404 marks a modern server.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("-32601 MethodNotFound")).toBeInTheDocument();
  },
};
