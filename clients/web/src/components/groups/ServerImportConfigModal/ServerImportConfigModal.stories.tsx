import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import type { ImportSourceResult } from "@inspector/core/mcp/import/index.js";
import {
  ServerImportConfigModal,
  type ServerImportConfigModalProps,
} from "./ServerImportConfigModal";

function InteractiveRender(args: ServerImportConfigModalProps) {
  const [, updateArgs] = useArgs<ServerImportConfigModalProps>();
  return (
    <AppShell>
      <AppShell.Main>
        <ServerImportConfigModal
          {...args}
          onClose={() => {
            args.onClose();
            updateArgs({ opened: false });
          }}
        />
      </AppShell.Main>
    </AppShell>
  );
}

const fetchResult: ImportSourceResult = {
  type: "cursor",
  found: true,
  path: "/home/u/.cursor/mcp.json",
  searched: ["/home/u/.cursor/mcp.json"],
  config: {
    mcpServers: {
      "new-server": { type: "stdio", command: "npx", args: ["-y", "demo"] },
      existing: { type: "streamable-http", url: "https://example.com/mcp" },
    },
  },
};

const meta: Meta<typeof ServerImportConfigModal> = {
  title: "Groups/ServerImportConfigModal",
  component: ServerImportConfigModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    existingIds: ["existing"],
    onClose: fn(),
    onFetchSource: fn(async () => fetchResult),
    onAddServer: fn(async () => undefined),
    onUpdateServer: fn(async () => undefined),
  },
};

export default meta;
type Story = StoryObj<typeof ServerImportConfigModal>;

export const SourcePicker: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByLabelText("Client")).toBeInTheDocument();
    await expect(
      body.getByRole("button", { name: "Import" }),
    ).toBeInTheDocument();
    await expect(
      body.getByRole("button", { name: /From file/ }),
    ).toBeInTheDocument();
  },
};

export const ReviewWithConflict: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.selectOptions(
      await body.findByLabelText("Client"),
      "Cursor",
    );
    await userEvent.click(body.getByRole("button", { name: "Import" }));
    await expect(await body.findByText("New servers (1)")).toBeInTheDocument();
    await expect(body.getByText("Already exists (1)")).toBeInTheDocument();
  },
};
