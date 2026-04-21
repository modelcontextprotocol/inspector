import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type {
  ClientExperimentalToggle,
  RequestHistoryItem,
} from "./ExperimentalFeaturesPanel";
import { ExperimentalFeaturesPanel } from "./ExperimentalFeaturesPanel";

const defaultClientToggles: ClientExperimentalToggle[] = [
  { name: "experimental/customSampling", enabled: false },
  { name: "experimental/batchRequests", enabled: true },
];

const meta: Meta<typeof ExperimentalFeaturesPanel> = {
  title: "Groups/ExperimentalFeaturesPanel",
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
    clientToggles: defaultClientToggles,
    customHeaders: [],
    requestHistory: [],
    requestDraft: JSON.stringify(
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
    serverExperimental: {
      "experimental/streaming": {
        description: "Supports streaming responses for long-running operations",
        methods: ["experimental/stream.start", "experimental/stream.cancel"],
      },
      "experimental/caching": {
        description: "Server-side response caching with TTL support",
        methods: [
          "experimental/cache.get",
          "experimental/cache.set",
          "experimental/cache.clear",
        ],
      },
    },
  },
};

export const NoServerCaps: Story = {
  args: {
    serverExperimental: undefined,
  },
};

export const WithResponse: Story = {
  args: {
    serverExperimental: {
      "experimental/echo": {
        description: "Echoes back the request for testing",
      },
    },
    response: {
      jsonrpc: "2.0" as const,
      id: 1,
      result: {
        echo: "Hello from experimental endpoint",
        timestamp: "2026-03-17T10:30:00Z",
      },
    },
    customHeaders: [
      { key: "X-Custom-Auth", value: "Bearer token123" },
      { key: "X-Request-Id", value: "req-abc-456" },
    ],
  },
};

export const WithErrorResponse: Story = {
  args: {
    serverExperimental: {
      "experimental/echo": {
        description: "Echoes back the request for testing",
      },
    },
    response: {
      jsonrpc: "2.0" as const,
      id: 1,
      error: {
        code: -32601,
        message: "Method not found",
      },
    },
  },
};

export const WithHistory: Story = {
  args: {
    serverExperimental: {
      "experimental/metrics": {
        description: "Exposes server metrics",
      },
    },
    requestHistory: [
      {
        timestamp: new Date("2026-03-17T10:30:15Z"),
        method: "experimental/metrics.get",
        status: "success",
        durationMs: 42,
      },
      {
        timestamp: new Date("2026-03-17T10:29:50Z"),
        method: "experimental/echo",
        status: "success",
        durationMs: 15,
      },
      {
        timestamp: new Date("2026-03-17T10:28:30Z"),
        method: "experimental/unknown",
        status: "error",
        durationMs: 120,
      },
    ] satisfies RequestHistoryItem[],
  },
};
