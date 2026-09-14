import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { EnlargeButton } from "./EnlargeButton";

const meta: Meta<typeof EnlargeButton> = {
  title: "Elements/EnlargeButton",
  component: EnlargeButton,
  args: { onClick: () => {} },
};

export default meta;
type Story = StoryObj<typeof EnlargeButton>;

// Default: labelled "Enlarge", clickable, and out of the tab order (#2138) —
// a form's string fields each carry one, so leaving them in doubled the tab
// stops between adjacent fields. SchemaForm binds Enter on the field itself as
// the keyboard route in.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", { name: "Enlarge" });
    await expect(button).toHaveAttribute("tabindex", "-1");
    await userEvent.click(button);
  },
};

// A per-field accessible name, for a form where several fields each carry one.
export const CustomLabel: Story = {
  args: { ariaLabel: "Enlarge Query" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Enlarge Query" }),
    ).toBeVisible();
  },
};
