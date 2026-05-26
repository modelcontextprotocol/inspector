import type {
  InitializeResult,
  Prompt,
  Resource,
  ResourceTemplate,
  Task,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  FetchRequestEntry,
  InspectorResourceSubscription,
  MessageEntry,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InspectorView } from "./InspectorView";
import { mixedEntries as demoLogs } from "../../screens/LoggingScreen/LoggingScreen.fixtures";
import { longToolList as demoRegularTools } from "../../screens/ToolsScreen/ToolsScreen.fixtures";
import { SUN_ICON_SVG } from "../../../test/fixtures/storyIcons";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";
import type { BridgeFactory } from "../../elements/AppRenderer/AppRenderer";

// Stories never drive a real MCP App bridge — render the iframe stage with
// a no-op factory so the AppsScreen mounts without trying to postMessage to
// a real sandbox.
const noopBridgeFactory: BridgeFactory = () =>
  ({
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  }) as unknown as AppBridge;

// MCP App tools — `isAppTool` detects these via `_meta.ui.resourceUri`,
// so they get filtered into the Apps tab while still appearing on Tools.
const demoApps: Tool[] = [
  {
    name: "get-cohort-data",
    title: "Cohort Data",
    description: "Cohort retention heatmap with adjustable period and metric.",
    inputSchema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "retention | engagement" },
        periodType: { type: "string", description: "daily | weekly | monthly" },
        cohortCount: { type: "number", description: "Cohorts to render" },
        maxPeriods: { type: "number", description: "Periods per cohort" },
      },
      required: ["metric", "periodType"],
    },
    _meta: { ui: { resourceUri: "ui://apps/cohort-heatmap" } },
  },
  {
    name: "weather-widget",
    title: "Weather Widget",
    description: "Live weather and a five-day forecast for any city.",
    icons: [{ src: SUN_ICON_SVG, mimeType: "image/svg+xml" }],
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name" },
      },
      required: ["city"],
    },
    _meta: { ui: { resourceUri: "ui://apps/weather" } },
  },
  {
    name: "ops-dashboard",
    title: "Ops Dashboard",
    description: "Current operational status across services.",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/ops" } },
  },
];

const demoTools: Tool[] = [...demoApps, ...demoRegularTools];

const demoServers: ServerEntry[] = [
  {
    id: "5e8c3d1f-2a4b-4c6d-8e7f-1a2b3c4d5e6f",
    name: "Local Dev Server",
    config: {
      command:
        "npx -y @modelcontextprotocol/server-filesystem /home/user/projects",
    },
    info: { name: "Local Dev Server", version: "1.2.0" },
    connection: { status: "disconnected" },
  },
  {
    id: "b3a7c1d2-9f8e-4a5b-bc6d-7e8f9a0b1c2d",
    name: "Legacy Events Server",
    config: { type: "sse", url: "https://legacy-events.example.com/mcp" },
    info: { name: "Legacy Events Server", version: "0.9.1" },
    connection: { status: "disconnected" },
  },
  {
    id: "c4d5e6f7-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
    name: "Remote API Server",
    config: { type: "streamable-http", url: "https://api.example.com/mcp" },
    info: { name: "Remote API Server", version: "2.0.0" },
    connection: { status: "disconnected" },
  },
];

const demoPrompts: Prompt[] = [
  {
    name: "summarize",
    description: "Summarize the given text into key points",
  },
  {
    name: "translate",
    description: "Translate text from one language to another",
    arguments: [
      { name: "text", required: true, description: "The text to translate" },
      {
        name: "targetLanguage",
        required: true,
        description: "Target language code",
      },
    ],
  },
  { name: "code-review", description: "Review code for issues" },
  { name: "refactor" },
];

const demoResources: Resource[] = [
  {
    name: "config.json",
    uri: "file:///config.json",
    annotations: { audience: ["user"], priority: 0.8 },
  },
  { name: "README.md", uri: "file:///README.md" },
  {
    name: "schema.sql",
    uri: "file:///schema.sql",
    annotations: { priority: 0.5 },
  },
  { name: "package.json", uri: "file:///package.json" },
];

const demoResourceTemplates: ResourceTemplate[] = [
  { name: "User Profile", uriTemplate: "file:///users/{userId}/profile" },
  {
    name: "Table Row",
    title: "Database Table Row",
    uriTemplate: "db://tables/{tableName}/rows/{rowId}",
  },
];

const demoSubscriptions: InspectorResourceSubscription[] = [
  {
    resource: { name: "config.json", uri: "file:///config.json" },
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
];

const demoTasks: Task[] = [
  {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "working",
    ttl: 300000,
    createdAt: "2026-03-29T20:18:20Z",
    lastUpdatedAt: "2026-03-29T20:18:22Z",
    statusMessage: "Processing records 650 of 1000...",
  },
  {
    taskId: "d487b49aa39023d907b5a2a5b506cb3",
    status: "completed",
    ttl: 300000,
    createdAt: "2026-03-29T20:16:47Z",
    lastUpdatedAt: "2026-03-29T20:16:49Z",
  },
  {
    taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
    status: "failed",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:27Z",
    lastUpdatedAt: "2026-03-29T20:17:57Z",
    statusMessage: "Timeout waiting for tool response after 30s",
  },
];

const demoProgressByTaskId: Record<string, TaskProgress> = {
  d0b22eba71fa36229ce5c4dfadeaa7de: {
    progress: 650,
    total: 1000,
    message: "Processing records 650 of 1000...",
  },
};

const demoHistory: MessageEntry[] = [
  {
    id: "req-1",
    timestamp: new Date("2026-03-17T10:00:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "send_message",
        arguments: { message: "Hello, world!" },
      },
    },
    response: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Message sent successfully" }],
      },
    },
    duration: 120,
  },
  {
    id: "req-2",
    timestamp: new Date("2026-03-17T10:01:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "file:///config.json" },
    },
    response: {
      jsonrpc: "2.0",
      id: 2,
      result: { contents: [{ uri: "file:///config.json", text: "{}" }] },
    },
    duration: 45,
  },
  {
    id: "req-3",
    timestamp: new Date("2026-03-17T10:02:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "delete_records", arguments: { ids: [1, 2, 3] } },
    },
    response: {
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32000, message: "Permission denied" },
    },
    duration: 350,
  },
];

const demoNetwork: FetchRequestEntry[] = [
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
];

const demoInitializeResult: InitializeResult = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  serverInfo: { name: "Local Dev Server", version: "1.2.0" },
};

const meta: Meta<typeof InspectorView> = {
  title: "Views/InspectorView",
  component: InspectorView,
  parameters: { layout: "fullscreen" },
  args: {
    // Data
    servers: demoServers,
    tools: demoTools,
    prompts: demoPrompts,
    resources: demoResources,
    resourceTemplates: demoResourceTemplates,
    subscriptions: demoSubscriptions,
    logs: demoLogs,
    tasks: demoTasks,
    progressByTaskId: demoProgressByTaskId,
    history: demoHistory,
    network: demoNetwork,

    // Connection state — stories default to "disconnected"; per-story
    // overrides drive the connected / error narratives.
    activeServer: undefined,
    connectionStatus: "disconnected",
    initializeResult: undefined,
    latencyMs: undefined,
    errorMessage: undefined,

    // Misc state
    currentLogLevel: "info",
    sandboxPath: "about:blank",
    bridgeFactory: noopBridgeFactory,

    // Callbacks — all wired to storybook spies so play functions can assert
    // on dispatch. Real wiring routes these to InspectorClient methods (the
    // app shell at clients/web/src/App.tsx).
    onToggleTheme: fn(),
    onToggleConnection: fn(),
    onDisconnect: fn(),
    onServerAdd: fn(),
    onServerImportConfig: fn(),
    onServerImportJson: fn(),
    onServerExport: fn(),
    onServerInfo: fn(),
    onServerSettings: fn(),
    onServerEdit: fn(),
    onServerClone: fn(),
    onServerRemove: fn(),
    onCallTool: fn(),
    onRefreshTools: fn(),
    onGetPrompt: fn(),
    onRefreshPrompts: fn(),
    onReadResource: fn(),
    onSubscribeResource: fn(),
    onUnsubscribeResource: fn(),
    onRefreshResources: fn(),
    onCancelTask: fn(),
    onClearCompletedTasks: fn(),
    onRefreshTasks: fn(),
    onSetLogLevel: fn(),
    onClearLogs: fn(),
    onExportLogs: fn(),
    onCopyAllLogs: fn(),
    onClearHistory: fn(),
    onExportHistory: fn(),
    onReplayHistory: fn(),
    onTogglePinHistory: fn(),
    onClearNetwork: fn(),
    onExportNetwork: fn(),
    onSelectApp: fn(),
    onOpenApp: fn(),
    onCloseApp: fn(),
    onRefreshApps: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof InspectorView>;

export const Default: Story = {};

export const NoServers: Story = {
  args: {
    servers: [],
  },
};

// Renders the connected-state shell (full tab list, ViewHeader in connected
// mode). The other tabs still render their disconnected fixtures because
// the lists are passed through as static data — that's fine for visual
// regression / storybook play function coverage.
export const Connected: Story = {
  args: {
    activeServer: demoServers[0]!.id,
    connectionStatus: "connected",
    initializeResult: demoInitializeResult,
    latencyMs: 142,
  },
};

export const ConnectionError: Story = {
  args: {
    activeServer: demoServers[0]!.id,
    connectionStatus: "error",
    errorMessage: "Handshake timeout",
  },
};
