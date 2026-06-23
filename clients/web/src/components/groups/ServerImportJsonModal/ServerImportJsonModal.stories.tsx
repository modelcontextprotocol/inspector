import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import {
  ServerImportJsonModal,
  type ServerImportJsonModalProps,
} from "./ServerImportJsonModal";

function InteractiveRender(args: ServerImportJsonModalProps) {
  const [, updateArgs] = useArgs<ServerImportJsonModalProps>();
  return (
    <AppShell>
      <AppShell.Main>
        <ServerImportJsonModal
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

const meta: Meta<typeof ServerImportJsonModal> = {
  title: "Groups/ServerImportJsonModal",
  component: ServerImportJsonModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    existingIds: [],
    onClose: fn(),
    onAddServer: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerImportJsonModal>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      await body.findByText("Import from registry config"),
    ).toBeInTheDocument();
    await expect(
      body.getByRole("button", { name: "Add Server" }),
    ).toBeInTheDocument();
  },
};
