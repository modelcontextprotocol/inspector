import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { FetchRequestEntry } from "../../../../../../core/mcp/types.js";
import { NetworkScreen } from "./NetworkScreen";

const meta: Meta<typeof NetworkScreen> = {
  title: "Screens/NetworkScreen",
  component: NetworkScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onClear: fn(),
    onExport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof NetworkScreen>;

const sampleEntries: FetchRequestEntry[] = [
  {
    id: "fetch-1",
    timestamp: new Date("2026-03-17T10:00:00Z"),
    method: "POST",
    url: "https://example.com/mcp",
    requestHeaders: {
      "content-type": "application/json",
      "x-test": "hello",
    },
    requestBody: '{"jsonrpc":"2.0","method":"initialize","id":1}',
    responseStatus: 200,
    responseStatusText: "OK",
    responseHeaders: { "content-type": "application/json" },
    responseBody: '{"jsonrpc":"2.0","id":1,"result":{}}',
    duration: 45,
    category: "transport",
  },
  {
    id: "fetch-2",
    timestamp: new Date("2026-03-17T10:00:05Z"),
    method: "POST",
    url: "https://example.com/oauth/token",
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    requestBody: "grant_type=authorization_code&code=abc",
    responseStatus: 200,
    responseStatusText: "OK",
    responseHeaders: { "content-type": "application/json" },
    responseBody: '{"access_token":"x","token_type":"bearer"}',
    duration: 120,
    category: "auth",
  },
  {
    id: "fetch-3",
    timestamp: new Date("2026-03-17T10:00:08Z"),
    method: "GET",
    url: "https://example.com/oauth/authorize",
    requestHeaders: {},
    responseStatus: 302,
    responseStatusText: "Found",
    responseHeaders: { location: "https://example.com/callback" },
    duration: 22,
    category: "auth",
  },
  {
    id: "fetch-4",
    timestamp: new Date("2026-03-17T10:00:12Z"),
    method: "POST",
    url: "https://example.com/mcp",
    requestHeaders: { "content-type": "application/json" },
    requestBody: '{"jsonrpc":"2.0","method":"tools/call","id":2}',
    responseStatus: 500,
    responseStatusText: "Internal Server Error",
    responseHeaders: { "content-type": "text/plain" },
    responseBody: "Unhandled exception",
    duration: 1200,
    category: "transport",
  },
  {
    id: "fetch-5",
    timestamp: new Date("2026-03-17T10:00:18Z"),
    method: "POST",
    url: "https://example.com/mcp",
    requestHeaders: { "content-type": "application/json" },
    error: "fetch failed: ECONNREFUSED",
    category: "transport",
  },
];

export const WithEntries: Story = {
  args: {
    entries: sampleEntries,
  },
};

export const Empty: Story = {
  args: {
    entries: [],
  },
};

export const FilterByCategory: Story = {
  args: {
    entries: sampleEntries,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Initially both auth and transport entries are visible
    await expect(
      canvas.getByText("https://example.com/oauth/token"),
    ).toBeInTheDocument();
    // Hide the auth category — the oauth entry should disappear
    await userEvent.click(canvas.getByRole("button", { name: "auth" }));
    await expect(
      canvas.queryByText("https://example.com/oauth/token"),
    ).not.toBeInTheDocument();
  },
};
