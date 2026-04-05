import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogLevelBadge } from "./LogLevelBadge";

const meta: Meta<typeof LogLevelBadge> = {
  title: "Elements/LogLevelBadge",
  component: LogLevelBadge,
};

export default meta;
type Story = StoryObj<typeof LogLevelBadge>;

export const Debug: Story = { args: { level: "debug" } };
export const Info: Story = { args: { level: "info" } };
export const Notice: Story = { args: { level: "notice" } };
export const Warning: Story = { args: { level: "warning" } };
export const Error: Story = { args: { level: "error" } };
export const Critical: Story = { args: { level: "critical" } };
export const Alert: Story = { args: { level: "alert" } };
export const Emergency: Story = { args: { level: "emergency" } };
