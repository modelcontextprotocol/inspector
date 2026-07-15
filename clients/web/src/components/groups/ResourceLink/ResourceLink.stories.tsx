import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReadResourceResult } from "@modelcontextprotocol/client";
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

const BLOB_URI = "demo://resource/session/blob.gz";

const readLargeBlob = async (): Promise<ReadResourceResult> => ({
  contents: [
    {
      uri: BLOB_URI,
      mimeType: "application/gzip",
      // A long base64 blob so the rendered JSON exceeds the card's max height
      // and scrolls within it rather than pushing the page down.
      blob: "H4sIAAAAAAAA".repeat(400),
    },
  ],
});

const meta: Meta<typeof ResourceLink> = {
  title: "Groups/ResourceLink",
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

// A large read result: the inline JSON exceeds the card's max height and
// scrolls within the bounded area instead of overflowing the card.
export const LargeResult: Story = {
  args: {
    uri: BLOB_URI,
    name: "Blob Resource",
    description: "A large gzipped resource",
    mimeType: "application/gzip",
    onReadResource: readLargeBlob,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: `Expand resource ${BLOB_URI}` }),
    );
    await waitFor(() =>
      expect(canvas.getByText("Resource:")).toBeInTheDocument(),
    );
  },
};
