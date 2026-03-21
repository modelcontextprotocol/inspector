import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnnotationBadge } from "./AnnotationBadge";

const meta: Meta<typeof AnnotationBadge> = {
  title: "Atoms/AnnotationBadge",
  component: AnnotationBadge,
};

export default meta;
type Story = StoryObj<typeof AnnotationBadge>;

export const Audience: Story = {
  args: {
    label: "user",
    variant: "audience",
  },
};

export const ReadOnly: Story = {
  args: {
    label: "read-only",
    variant: "readOnly",
  },
};

export const Destructive: Story = {
  args: {
    label: "destructive",
    variant: "destructive",
  },
};

export const LongRun: Story = {
  args: {
    label: "long-run",
    variant: "longRun",
  },
};

export const PriorityHigh: Story = {
  args: {
    label: "priority: high",
    variant: "priority",
  },
};

export const Default: Story = {
  args: {
    label: "custom",
    variant: "default",
  },
};
