import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { FetchRequestEntry } from "../../../../../../core/mcp/types.js";
import { NetworkStreamPanel } from "./NetworkStreamPanel";

const meta: Meta<typeof NetworkStreamPanel> = {
  title: "Groups/NetworkStreamPanel",
  component: NetworkStreamPanel,
  parameters: { layout: "fullscreen" },
  args: {
    filterText: "",
    visibleCategories: { auth: true, transport: true },
    onClear: fn(),
    onExport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof NetworkStreamPanel>;

const sample: FetchRequestEntry[] = [
  {
    id: "n-1",
    timestamp: new Date("2026-03-17T10:00:00Z"),
    method: "POST",
    url: "https://example.com/mcp",
    requestHeaders: { "content-type": "application/json" },
    responseStatus: 200,
    duration: 45,
    category: "transport",
  },
  {
    id: "n-2",
    timestamp: new Date("2026-03-17T10:00:05Z"),
    method: "POST",
    url: "https://example.com/oauth/token",
    requestHeaders: {},
    responseStatus: 200,
    duration: 120,
    category: "auth",
  },
];

export const WithEntries: Story = {
  args: { entries: sample },
};

export const Empty: Story = {
  args: { entries: [] },
};
