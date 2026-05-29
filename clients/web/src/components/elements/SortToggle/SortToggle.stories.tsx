import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SortToggle } from "./SortToggle";

const meta: Meta<typeof SortToggle> = {
  title: "Elements/SortToggle",
  component: SortToggle,
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SortToggle>;

export const NewestFirst: Story = {
  args: {
    value: "newest-first",
  },
};

export const OldestFirst: Story = {
  args: {
    value: "oldest-first",
  },
};

export const Subtle: Story = {
  args: {
    value: "newest-first",
    variant: "subtle",
  },
};

export const FlipsDirection: Story = {
  args: {
    value: "newest-first",
  },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await body.findByRole("button", { name: "Sort direction" }),
    );
    await expect(args.onChange).toHaveBeenCalledWith("oldest-first");
  },
};
