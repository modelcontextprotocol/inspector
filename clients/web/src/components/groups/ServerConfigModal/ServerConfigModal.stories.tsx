import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import {
  ServerConfigModal,
  type ServerConfigModalProps,
} from "./ServerConfigModal";

function InteractiveRender(args: ServerConfigModalProps) {
  const [, updateArgs] = useArgs<ServerConfigModalProps>();
  return (
    <AppShell>
      <AppShell.Main>
        <ServerConfigModal
          {...args}
          onClose={() => {
            args.onClose();
            updateArgs({ opened: false });
          }}
          onSubmit={async (id, config) => {
            await args.onSubmit(id, config);
            updateArgs({ opened: false });
          }}
        />
      </AppShell.Main>
    </AppShell>
  );
}

const stdioConfig: MCPServerConfig = {
  type: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-everything"],
  env: { DEBUG: "1" },
};

const sseConfig: MCPServerConfig = {
  type: "sse",
  url: "https://example.com/sse",
};

const meta: Meta<typeof ServerConfigModal> = {
  title: "Groups/ServerConfigModal",
  component: ServerConfigModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    existingIds: [],
    onClose: fn(),
    onSubmit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerConfigModal>;

// Mantine's Modal portals to `document.body` outside the storybook
// canvas, and its first paint can race against the 1000ms default that
// `findBy*` queries retry against — especially in the Storybook dev UI
// (slower than `test:storybook`'s headless browser, particularly with
// devtools open or coverage instrumentation on). Waiting on the dialog
// role with a longer ceiling is more reliable than `findByText` against
// the title: it asserts the dialog actually mounted, scopes subsequent
// queries to its subtree (no false-positive matches from sibling
// loaders), and uses the accessible name Mantine derives from the
// `title` prop.
const DIALOG_MOUNT_TIMEOUT_MS = 5000;
const findDialog = (body: ReturnType<typeof within>, name: RegExp | string) =>
  body.findByRole("dialog", { name }, { timeout: DIALOG_MOUNT_TIMEOUT_MS });

export const AddEmpty: Story = {
  args: { mode: "add" },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(body, "Add server"));
    const idInput = dialog.getByLabelText(/Server ID/i) as HTMLInputElement;
    await expect(idInput).toBeInTheDocument();
    await expect(dialog.getByLabelText(/Command/i)).toBeInTheDocument();
    // Regression guard for the synthetic-event currentTarget bug — happy-dom
    // doesn't null currentTarget after the handler returns, so unit tests
    // sail past it. Real Chromium (here) does, so any future onChange that
    // reads e.currentTarget inside a setState updater will throw here.
    await userEvent.type(idInput, "my-server");
    await expect(idInput.value).toBe("my-server");
    const cmdInput = dialog.getByLabelText(/Command/i) as HTMLInputElement;
    await userEvent.type(cmdInput, "node");
    await expect(cmdInput.value).toBe("node");
  },
};

export const EditStdio: Story = {
  args: {
    mode: "edit",
    initialId: "filesystem-server-default",
    initialConfig: stdioConfig,
    existingIds: ["other-server"],
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(body, "Edit server"));
    const idInput = dialog.getByLabelText(/Server ID/i) as HTMLInputElement;
    await expect(idInput.value).toBe("filesystem-server-default");
  },
};

export const CloneStdio: Story = {
  args: {
    mode: "clone",
    initialId: "filesystem-server-default",
    initialConfig: stdioConfig,
    existingIds: ["filesystem-server-default"],
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(body, "Clone server"));
    const idInput = dialog.getByLabelText(/Server ID/i) as HTMLInputElement;
    await expect(idInput.value).toBe("");
    const cmdInput = dialog.getByLabelText(/Command/i) as HTMLInputElement;
    await expect(cmdInput.value).toBe("npx");
  },
};

export const EditSse: Story = {
  args: {
    mode: "edit",
    initialId: "remote",
    initialConfig: sseConfig,
    existingIds: [],
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(await findDialog(body, "Edit server"));
    await expect(await dialog.findByLabelText(/^URL/)).toBeInTheDocument();
    // Headers are no longer entered here — they live in ServerSettingsForm.
    await expect(dialog.queryByLabelText(/Headers/i)).toBeNull();
  },
};
