import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskStatusBadge } from "./TaskStatusBadge";

const meta: Meta<typeof TaskStatusBadge> = {
  title: "Elements/TaskStatusBadge",
  component: TaskStatusBadge,
};

export default meta;
type Story = StoryObj<typeof TaskStatusBadge>;

export const Waiting: Story = { args: { status: "waiting" } };
export const Running: Story = { args: { status: "running" } };
export const Completed: Story = { args: { status: "completed" } };
export const Failed: Story = { args: { status: "failed" } };
export const Cancelled: Story = { args: { status: "cancelled" } };
