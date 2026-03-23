import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ExperimentalFeaturesPanel } from "./ExperimentalFeaturesPanel";

const meta: Meta<typeof ExperimentalFeaturesPanel> = {
  title: "Molecules/ExperimentalFeaturesPanel",
  component: ExperimentalFeaturesPanel,
  args: {
    onToggleClientCapability: fn(),
    onRequestChange: fn(),
    onSendRequest: fn(),
    onAddHeader: fn(),
    onRemoveHeader: fn(),
    onHeaderChange: fn(),
    onCopyResponse: fn(),
    onTestCapability: fn(),
    clientCapabilities: [
      { name: "experimental/customSampling", enabled: false },
      { name: "experimental/batchRequests", enabled: true },
    ],
    customHeaders: [],
    requestHistory: [],
    requestJson: JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "experimental/myMethod",
        params: {},
      },
      null,
      2,
    ),
  },
};

export default meta;
type Story = StoryObj<typeof ExperimentalFeaturesPanel>;

export const WithServerCaps: Story = {
  args: {
    serverCapabilities: [
      {
        name: "experimental/streaming",
        description: "Supports streaming responses for long-running operations",
        methods: ["experimental/stream.start", "experimental/stream.cancel"],
      },
      {
        name: "experimental/caching",
        description: "Server-side response caching with TTL support",
        methods: [
          "experimental/cache.get",
          "experimental/cache.set",
          "experimental/cache.clear",
        ],
      },
    ],
  },
};

export const NoServerCaps: Story = {
  args: {
    serverCapabilities: [],
  },
};

export const WithResponse: Story = {
  args: {
    serverCapabilities: [
      {
        name: "experimental/echo",
        description: "Echoes back the request for testing",
        methods: ["experimental/echo"],
      },
    ],
    responseJson: JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          echo: "Hello from experimental endpoint",
          timestamp: "2026-03-17T10:30:00Z",
        },
      },
      null,
      2,
    ),
    customHeaders: [
      { key: "X-Custom-Auth", value: "Bearer token123" },
      { key: "X-Request-Id", value: "req-abc-456" },
    ],
  },
};

export const WithHistory: Story = {
  args: {
    serverCapabilities: [
      {
        name: "experimental/metrics",
        description: "Exposes server metrics",
      },
    ],
    requestHistory: [
      {
        timestamp: "2026-03-17 10:30:15",
        method: "experimental/metrics.get",
        status: "success",
        durationMs: 42,
      },
      {
        timestamp: "2026-03-17 10:29:50",
        method: "experimental/echo",
        status: "success",
        durationMs: 15,
      },
      {
        timestamp: "2026-03-17 10:28:30",
        method: "experimental/unknown",
        status: "error",
        durationMs: 120,
      },
    ],
  },
};
