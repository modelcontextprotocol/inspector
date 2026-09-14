import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { EditReplayModal } from "./EditReplayModal";

const meta: Meta<typeof EditReplayModal> = {
  title: "Groups/EditReplayModal",
  component: EditReplayModal,
  args: {
    opened: true,
    method: "tools/call",
    params: { name: "get_weather", arguments: { city: "Boston" } },
    onSend: fn(),
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof EditReplayModal>;

export const Default: Story = {};

/** A request that carried no params — `tools/list` and friends. */
export const NoParams: Story = {
  args: { method: "tools/list", params: undefined },
};

/**
 * Ace's own editing behavior is covered by the `JsonObjectInput` play
 * functions; what this pins is the gate on top of it — invalid text must not be
 * sendable, because unlike the metadata editor this modal commits.
 */
export const InvalidDraftBlocksSend: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    // Modals render in a portal, so the body is the canvas here.
    const body = within(document.body);
    const editor = document.querySelector(".ace_editor") as HTMLElement & {
      env: { editor: { focus(): void; selectAll(): void } };
    };
    editor.env.editor.focus();
    editor.env.editor.selectAll();
    await userEvent.keyboard("{Backspace}");
    // A bare number: valid JSON, wrong shape for JSON-RPC `params`.
    await userEvent.keyboard("42");

    await expect(await body.findByText(/must be a JSON object/i)).toBeVisible();
    await expect(body.getByRole("button", { name: "Send" })).toBeDisabled();
    // The canvas itself holds no controls — everything is portalled.
    await expect(canvas.queryByRole("button", { name: "Send" })).toBeNull();
  },
};
