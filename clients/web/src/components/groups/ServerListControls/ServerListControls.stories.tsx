import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ServerListControls } from "./ServerListControls";

const meta: Meta<typeof ServerListControls> = {
  title: "Groups/ServerListControls",
  component: ServerListControls,
};

export default meta;
type Story = StoryObj<typeof ServerListControls>;

export const WithServers: Story = {
  args: {
    serverCount: 5,
    compact: false,
    onToggleList: fn(),
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
    onExport: fn(),
  },
  play: async ({ canvasElement, args }) => {
    // Real-Chromium regression guard: Export is enabled when servers exist,
    // and clicking it fires onExport. Unit tests cover the same path under
    // happy-dom; this catches anything browser-specific in the wiring.
    const body = within(canvasElement.ownerDocument.body);
    const exportBtn = await body.findByRole("button", { name: /Export/ });
    await expect(exportBtn).not.toBeDisabled();
    await userEvent.click(exportBtn);
    await expect(args.onExport).toHaveBeenCalledTimes(1);
  },
};

export const WithoutServers: Story = {
  args: {
    serverCount: 0,
    compact: true,
    onToggleList: fn(),
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
    onExport: fn(),
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const exportBtn = await body.findByRole("button", { name: /Export/ });
    await expect(exportBtn).toBeDisabled();
  },
};
