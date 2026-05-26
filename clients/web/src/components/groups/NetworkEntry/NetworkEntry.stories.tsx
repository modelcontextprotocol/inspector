import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FetchRequestEntry } from "../../../../../../core/mcp/types.js";
import { NetworkEntry } from "./NetworkEntry";

const meta: Meta<typeof NetworkEntry> = {
  title: "Groups/NetworkEntry",
  component: NetworkEntry,
};

export default meta;
type Story = StoryObj<typeof NetworkEntry>;

const transportEntry: FetchRequestEntry = {
  id: "n-1",
  timestamp: new Date("2026-03-17T10:30:00Z"),
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
};

const authEntry: FetchRequestEntry = {
  id: "n-2",
  timestamp: new Date("2026-03-17T10:30:05Z"),
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
};

const errorEntry: FetchRequestEntry = {
  id: "n-3",
  timestamp: new Date("2026-03-17T10:30:10Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "content-type": "application/json" },
  responseStatus: 500,
  responseStatusText: "Internal Server Error",
  responseHeaders: { "content-type": "text/plain" },
  responseBody: "Unhandled exception",
  duration: 1200,
  category: "transport",
};

const transportError: FetchRequestEntry = {
  id: "n-4",
  timestamp: new Date("2026-03-17T10:30:15Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: {},
  error: "fetch failed: ECONNREFUSED",
  category: "transport",
};

export const TransportSuccessCollapsed: Story = {
  args: { entry: transportEntry, isListExpanded: false },
};

export const TransportSuccessExpanded: Story = {
  args: { entry: transportEntry, isListExpanded: true },
};

export const AuthSuccess: Story = {
  args: { entry: authEntry, isListExpanded: true },
};

export const HttpError: Story = {
  args: { entry: errorEntry, isListExpanded: true },
};

export const FetchError: Story = {
  args: { entry: transportError, isListExpanded: true },
};
