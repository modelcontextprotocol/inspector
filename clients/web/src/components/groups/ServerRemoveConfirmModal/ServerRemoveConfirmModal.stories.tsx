import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import {
  ServerRemoveConfirmModal,
  type ServerRemoveConfirmModalProps,
} from "./ServerRemoveConfirmModal";

function InteractiveRender(args: ServerRemoveConfirmModalProps) {
  const [, updateArgs] = useArgs<ServerRemoveConfirmModalProps>();
  return (
    <AppShell>
      <AppShell.Main>
        <ServerRemoveConfirmModal
          {...args}
          onCancel={() => {
            args.onCancel();
            updateArgs({ opened: false });
          }}
          onConfirm={async () => {
            await args.onConfirm();
            updateArgs({ opened: false });
          }}
        />
      </AppShell.Main>
    </AppShell>
  );
}

const stdioTarget: ServerEntry = {
  id: "filesystem-server-default",
  name: "filesystem-server-default",
  config: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  },
  connection: { status: "disconnected" },
};

const httpTarget: ServerEntry = {
  id: "remote",
  name: "remote",
  config: { type: "streamable-http", url: "https://example.com/mcp" },
  connection: { status: "disconnected" },
};

const meta: Meta<typeof ServerRemoveConfirmModal> = {
  title: "Groups/ServerRemoveConfirmModal",
  component: ServerRemoveConfirmModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    onCancel: fn(),
    onConfirm: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerRemoveConfirmModal>;

export const StdioServer: Story = {
  args: { target: stdioTarget },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("Remove server?")).toBeInTheDocument();
    await expect(
      body.getByText("filesystem-server-default"),
    ).toBeInTheDocument();
    await expect(
      body.getByText(/npx -y @modelcontextprotocol\/server-filesystem \/tmp/),
    ).toBeInTheDocument();
  },
};

export const HttpServer: Story = {
  args: { target: httpTarget },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("remote")).toBeInTheDocument();
    await expect(
      body.getByText(/streamable-http · https:\/\/example\.com\/mcp/),
    ).toBeInTheDocument();
  },
};
