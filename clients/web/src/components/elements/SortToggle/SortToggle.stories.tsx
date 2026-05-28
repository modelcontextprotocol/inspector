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

export const FlipsDirection: Story = {
  args: {
    value: "newest-first",
  },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    const select = await body.findByRole("textbox", {
      name: "Sort direction",
    });
    await userEvent.click(select);
    const oldestOption = await body.findByText("Sort: Oldest First");
    await userEvent.click(oldestOption);
    await expect(args.onChange).toHaveBeenCalledWith("oldest-first");
  },
};
