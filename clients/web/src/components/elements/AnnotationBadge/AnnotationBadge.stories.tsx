import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnnotationBadge } from "./AnnotationBadge";

const meta: Meta<typeof AnnotationBadge> = {
  title: "Elements/AnnotationBadge",
  component: AnnotationBadge,
};

export default meta;
type Story = StoryObj<typeof AnnotationBadge>;

export const Audience: Story = {
  args: {
    facet: "audience",
    value: ["user"],
  },
};

export const AudienceMultiple: Story = {
  args: {
    facet: "audience",
    value: ["user", "assistant"],
  },
};

export const ReadOnly: Story = {
  args: {
    facet: "readOnlyHint",
    value: true,
  },
};

export const Destructive: Story = {
  args: {
    facet: "destructiveHint",
    value: true,
  },
};

export const Idempotent: Story = {
  args: {
    facet: "idempotentHint",
    value: true,
  },
};

export const OpenWorld: Story = {
  args: {
    facet: "openWorldHint",
    value: true,
  },
};

export const LongRunning: Story = {
  args: {
    facet: "longRunHint",
    value: true,
  },
};

export const PriorityHigh: Story = {
  args: {
    facet: "priority",
    value: 0.9,
  },
};

export const PriorityLow: Story = {
  args: {
    facet: "priority",
    value: 0.2,
  },
};
