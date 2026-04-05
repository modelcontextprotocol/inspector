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
    uri: "file:///config.json",
    mimeType: "application/json",
    content: JSON.stringify(
      { name: "mcp-inspector", version: "2.0.0", debug: true },
      null,
      2,
    ),
    isSubscribed: false,
    lastUpdated: "2026-03-17T10:30:00Z",
  },
};

export const TextResource: Story = {
  args: {
    uri: "file:///readme.txt",
    mimeType: "text/plain",
    content:
      "This is a plain text resource with some example content.\nLine two of the content.",
    isSubscribed: false,
  },
};

export const Subscribed: Story = {
  args: {
    uri: "file:///data.json",
    mimeType: "application/json",
    content: JSON.stringify({ status: "active" }, null, 2),
    isSubscribed: true,
    lastUpdated: "2026-03-17T12:00:00Z",
  },
};

export const NotSubscribed: Story = {
  args: {
    uri: "file:///data.json",
    mimeType: "application/json",
    content: JSON.stringify({ status: "active" }, null, 2),
    isSubscribed: false,
  },
};

export const WithAnnotations: Story = {
  args: {
    uri: "file:///settings.json",
    mimeType: "application/json",
    content: JSON.stringify({ theme: "dark", lang: "en" }, null, 2),
    isSubscribed: false,
    annotations: {
      audience: "application",
      priority: 0.8,
    },
    lastUpdated: "2026-03-17T09:00:00Z",
  },
};
