import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResourceLinkInfo } from "./ResourceLinkInfo";

const meta: Meta<typeof ResourceLinkInfo> = {
  title: "Elements/ResourceLinkInfo",
  component: ResourceLinkInfo,
};

export default meta;
type Story = StoryObj<typeof ResourceLinkInfo>;

export const Full: Story = {
  args: {
    uri: "file:///docs/readme.md",
    name: "Readme",
    mimeType: "text/markdown",
  },
};

export const UriOnly: Story = {
  args: {
    uri: "demo://resource/dynamic/text/2",
  },
};
