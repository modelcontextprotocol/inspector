import type { Meta, StoryObj } from "@storybook/react-vite";
import { MrtrOriginNote } from "./MrtrOriginNote";

const meta: Meta<typeof MrtrOriginNote> = {
  title: "Elements/MrtrOriginNote",
  component: MrtrOriginNote,
};

export default meta;
type Story = StoryObj<typeof MrtrOriginNote>;

export const InputRequired: Story = {
  args: { origin: "input-required" },
};

export const ServerRequest: Story = {
  args: { origin: "server-request" },
};
