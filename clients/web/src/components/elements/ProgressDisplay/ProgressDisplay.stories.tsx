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
    params: { progressToken: "t1", progress: 0, total: 100 },
  },
};

export const HalfComplete: Story = {
  args: {
    params: {
      progressToken: "t2",
      progress: 50,
      total: 100,
      message: "Processing...",
    },
  },
};

export const NearComplete: Story = {
  args: {
    params: {
      progressToken: "t3",
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
      progressToken: "t4",
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
      progressToken: "t5",
      progress: 42,
      message: "Working...",
    },
  },
};
