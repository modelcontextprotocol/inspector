import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ResourcePreviewPanel } from "./ResourcePreviewPanel";

const meta: Meta<typeof ResourcePreviewPanel> = {
  title: "Groups/ResourcePreviewPanel",
  component: ResourcePreviewPanel,
  args: {
    onRefresh: fn(),
    onSubscribe: fn(),
    onUnsubscribe: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourcePreviewPanel>;

export const JsonResource: Story = {
  args: {
    resource: {
      name: "config.json",
      uri: "file:///config.json",
    },
    contents: [
      {
        uri: "file:///config.json",
        mimeType: "application/json",
        text: JSON.stringify(
          { name: "mcp-inspector", version: "2.0.0", debug: true },
          null,
          2,
        ),
      },
    ],
    isSubscribed: false,
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
};

export const TextResource: Story = {
  args: {
    resource: {
      name: "readme.txt",
      uri: "file:///readme.txt",
    },
    contents: [
      {
        uri: "file:///readme.txt",
        mimeType: "text/plain",
        text: "This is a plain text resource with some example content.\nLine two of the content.",
      },
    ],
    isSubscribed: false,
  },
};

export const Subscribed: Story = {
  args: {
    resource: {
      name: "data.json",
      uri: "file:///data.json",
    },
    contents: [
      {
        uri: "file:///data.json",
        mimeType: "application/json",
        text: JSON.stringify({ status: "active" }, null, 2),
      },
    ],
    isSubscribed: true,
    lastUpdated: new Date("2026-03-17T12:00:00Z"),
  },
};

export const NotSubscribed: Story = {
  args: {
    resource: {
      name: "data.json",
      uri: "file:///data.json",
    },
    contents: [
      {
        uri: "file:///data.json",
        mimeType: "application/json",
        text: JSON.stringify({ status: "active" }, null, 2),
      },
    ],
    isSubscribed: false,
  },
};

export const SubscriptionsUnsupported: Story = {
  args: {
    resource: {
      name: "data.json",
      uri: "file:///data.json",
    },
    contents: [
      {
        uri: "file:///data.json",
        mimeType: "application/json",
        text: JSON.stringify({ status: "active" }, null, 2),
      },
    ],
    isSubscribed: false,
    // Server does not advertise resources.subscribe — only Refresh shows.
    subscriptionsSupported: false,
  },
};

// Markdown, CSV, and HTML resources expose a "View Source" link (left of
// Refresh) that swaps the rendered preview for the raw resource text. The play
// function drives the toggle: rendered heading → raw source → back.
export const MarkdownWithViewSource: Story = {
  args: {
    resource: {
      name: "README.md",
      uri: "file:///README.md",
    },
    contents: [
      {
        uri: "file:///README.md",
        mimeType: "text/markdown",
        text: "# Project\n\nA **bold** intro with a [link](https://example.com).",
      },
    ],
    isSubscribed: false,
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Rendered by default.
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Project" }),
    ).toBeInTheDocument();
    // Switch to raw source.
    await userEvent.click(canvas.getByRole("button", { name: "View Source" }));
    await expect(canvas.getByText(/# Project/)).toBeInTheDocument();
    // Switch back to rendered.
    await userEvent.click(
      canvas.getByRole("button", { name: "View Rendered" }),
    );
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Project" }),
    ).toBeInTheDocument();
  },
};

export const WithAnnotations: Story = {
  args: {
    resource: {
      name: "settings.json",
      uri: "file:///settings.json",
      annotations: {
        audience: ["user"],
        priority: 0.8,
      },
    },
    contents: [
      {
        uri: "file:///settings.json",
        mimeType: "application/json",
        text: JSON.stringify({ theme: "dark", lang: "en" }, null, 2),
      },
    ],
    isSubscribed: false,
    lastUpdated: new Date("2026-03-17T09:00:00Z"),
  },
};
