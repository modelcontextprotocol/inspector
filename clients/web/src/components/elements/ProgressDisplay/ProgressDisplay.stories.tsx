import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressDisplay } from "./ProgressDisplay";

const meta: Meta<typeof ProgressDisplay> = {
  title: "Elements/ProgressDisplay",
  component: ProgressDisplay,
};

export default meta;
type Story = StoryObj<typeof ProgressDisplay>;

export const ZeroPercent: Story = {
  args: {
    params: { progress: 0, total: 100 },
  },
};

export const HalfComplete: Story = {
  args: {
    params: {
      progress: 50,
      total: 100,
      message: "Processing...",
    },
  },
};

export const NearComplete: Story = {
  args: {
    params: {
      progress: 95,
      total: 100,
      message: "Almost done",
    },
    elapsed: "1m 30s",
  },
};

export const Complete: Story = {
  args: {
    params: {
      progress: 100,
      total: 100,
      message: "Done",
    },
    elapsed: "2m 15s",
  },
};

export const WithoutTotal: Story = {
  args: {
    params: {
      progress: 42,
      message: "Working...",
    },
  },
};
