import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ResourceLink } from "./ResourceLink";

const URI = "file:///docs/readme.md";

const readMarkdown = async (): Promise<ReadResourceResult> => ({
  contents: [
    {
      uri: URI,
      mimeType: "text/markdown",
      text: "# Readme\n\nRead on demand.",
    },
  ],
});

const meta: Meta<typeof ResourceLink> = {
  title: "Elements/ResourceLink",
  component: ResourceLink,
};

export default meta;
type Story = StoryObj<typeof ResourceLink>;

export const Static: Story = {
  args: {
    uri: URI,
    name: "Readme",
    description: "Project documentation",
    mimeType: "text/markdown",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(URI)).toBeInTheDocument();
    expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};

export const Expandable: Story = {
  args: {
    uri: URI,
    name: "Readme",
    description: "Click to read on demand",
    mimeType: "text/markdown",
    onReadResource: readMarkdown,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", {
      name: `Expand resource ${URI}`,
    });
    await userEvent.click(button);
    await waitFor(() =>
      expect(canvas.getByText("Resource:")).toBeInTheDocument(),
    );
  },
};
