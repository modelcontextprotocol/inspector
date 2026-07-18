import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
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
  responseBody: JSON.stringify({
    access_token: "eyJhbGciOiJSUzI1NiwidHlwIjoiSldUIn0.payload.sig",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "rt_9f8e7d6c5b4a",
    scope: "mcp:tools",
  }),
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

const streamingEntry: FetchRequestEntry = {
  id: "n-stream",
  timestamp: new Date("2026-03-17T10:30:12Z"),
  method: "POST",
  url: "http://localhost:3000/mcp",
  requestHeaders: {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-session-id": "0a0b0a5-fd27-4c95-a805-c0fba67e00fb",
  },
  requestBody: '{"method":"resources/templates/list","jsonrpc":"2.0","id":4}',
  responseStatus: 200,
  responseStatusText: "OK",
  responseHeaders: {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
    "mcp-session-id": "0a0b0a5-fd27-4c95-a805-c0fba67e00fb",
  },
  duration: 26,
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Both bodies carry secrets: the form request (`code=…`) and the JSON
    // response (`access_token`). Both are masked by default — the raw values
    // must not be visible until explicitly revealed.
    const hidden = canvas.getAllByText("Secrets hidden");
    await expect(hidden.length).toBeGreaterThanOrEqual(2);
    await expect(canvasElement.textContent).not.toContain("eyJhbGciOiJSUzI1");
    await expect(canvasElement.textContent).toContain("••••••••");
    // Non-secret fields stay visible.
    await expect(canvasElement.textContent).toContain("Bearer");

    // Reveal every masked body and confirm the raw response token appears.
    const revealButtons = canvas.getAllByRole("button", {
      name: "Reveal secrets in body",
    });
    for (const button of revealButtons) {
      await userEvent.click(button);
    }
    await expect(
      canvas.getAllByText("Secrets revealed").length,
    ).toBeGreaterThanOrEqual(revealButtons.length);
    await expect(canvasElement.textContent).toContain("eyJhbGciOiJSUzI1");
  },
};

export const HttpError: Story = {
  args: { entry: errorEntry, isListExpanded: true },
};

export const StreamingResponse: Story = {
  args: { entry: streamingEntry, isListExpanded: true },
};

export const FetchError: Story = {
  args: { entry: transportError, isListExpanded: true },
};

/** Mirror of the SDK's SEP-2243 sentinel encoding, for building fixtures. */
function encodeSentinel(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?base64?${btoa(bin)}?=`;
}

// A modern Streamable HTTP tools/call: mirrored Mcp-Method / Mcp-Name headers,
// a Mcp-Param-* custom header, and a sentinel-encoded value that decodes to a
// non-ASCII string.
const modernHeadersEntry: FetchRequestEntry = {
  id: "n-modern",
  timestamp: new Date("2026-07-28T10:30:20Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: {
    "content-type": "application/json",
    "mcp-method": "tools/call",
    "mcp-name": "get_weather",
    "mcp-param-city": encodeSentinel("São Paulo"),
    "mcp-protocol-version": "2026-07-28",
  },
  requestBody: JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "get_weather",
      arguments: { city: "São Paulo" },
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    },
  }),
  responseStatus: 200,
  responseStatusText: "OK",
  responseHeaders: { "content-type": "application/json" },
  responseBody: '{"jsonrpc":"2.0","id":7,"result":{}}',
  duration: 33,
  category: "transport",
};

// A HeaderMismatch: the sent Mcp-Method disagrees with the body's method, and
// the server rejects it with -32020 / HTTP 400.
const headerMismatchEntry: FetchRequestEntry = {
  id: "n-mismatch",
  timestamp: new Date("2026-07-28T10:30:22Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: {
    "content-type": "application/json",
    "mcp-method": "tools/list",
    "mcp-protocol-version": "2026-07-28",
  },
  requestBody: JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "get_weather",
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    },
  }),
  responseStatus: 400,
  responseStatusText: "Bad Request",
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    error: { code: -32020, message: "Mcp-Method header does not match body" },
  }),
  duration: 12,
  category: "transport",
};

const unsupportedVersionEntry: FetchRequestEntry = {
  id: "n-version",
  timestamp: new Date("2026-07-28T10:30:24Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "content-type": "application/json" },
  requestBody: '{"jsonrpc":"2.0","id":9,"method":"initialize"}',
  responseStatus: 400,
  responseStatusText: "Bad Request",
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    error: {
      code: -32022,
      message: "Unsupported protocol version",
      data: { supported: ["2025-06-18", "2025-11-25", "2026-07-28"] },
    },
  }),
  duration: 8,
  category: "transport",
};

const modernMethodNotFoundEntry: FetchRequestEntry = {
  id: "n-404",
  timestamp: new Date("2026-07-28T10:30:26Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "content-type": "application/json" },
  requestBody: '{"jsonrpc":"2.0","id":10,"method":"tasks/get"}',
  responseStatus: 404,
  responseStatusText: "Not Found",
  responseHeaders: { "content-type": "application/json" },
  responseBody: JSON.stringify({
    jsonrpc: "2.0",
    id: 10,
    error: { code: -32601, message: "Method not found" },
  }),
  duration: 6,
  category: "transport",
};

const cancelledEntry: FetchRequestEntry = {
  id: "n-cancel",
  timestamp: new Date("2026-07-28T10:30:28Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "mcp-method": "tools/call" },
  requestBody: '{"jsonrpc":"2.0","id":11,"method":"tools/call"}',
  error: "The operation was aborted",
  category: "transport",
};

export const ModernHeaders: Story = {
  args: { entry: modernHeadersEntry, isListExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The sentinel Mcp-Param value decodes to its non-ASCII string and is
    // flagged as base64-encoded.
    await expect(canvas.getByText("São Paulo")).toBeInTheDocument();
    await expect(canvas.getByText("base64")).toBeInTheDocument();
  },
};

export const HeaderMismatchError: Story = {
  args: { entry: headerMismatchEntry, isListExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("-32020 HeaderMismatch").length,
    ).toBeGreaterThan(0);
    // The disagreeing header is called out against the body.
    await expect(
      canvas.getByLabelText(/expected tools\/call/),
    ).toBeInTheDocument();
  },
};

export const UnsupportedVersionError: Story = {
  args: { entry: unsupportedVersionEntry, isListExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Server supports: 2025-06-18, 2025-11-25, 2026-07-28/),
    ).toBeInTheDocument();
  },
};

export const ModernMethodNotFound: Story = {
  args: { entry: modernMethodNotFoundEntry, isListExpanded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("-32601 MethodNotFound").length,
    ).toBeGreaterThan(0);
  },
};

export const Cancelled: Story = {
  args: { entry: cancelledEntry, isListExpanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Cancelled")).toBeInTheDocument();
    await expect(canvas.getByText("Request cancelled")).toBeInTheDocument();
  },
};
