import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
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
