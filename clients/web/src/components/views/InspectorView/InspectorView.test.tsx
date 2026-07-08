import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  InitializeResult,
  Prompt,
  Resource,
  ServerCapabilities,
  Task,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import {
  renderWithMantine,
  screen,
  waitFor,
  within,
  fireEvent,
} from "../../../test/renderWithMantine";
import { InspectorView, type InspectorViewProps } from "./InspectorView";

// The monitoring column (#1616) is gated on a 1040px viewport media query.
// happy-dom's viewport is 1024px, so that query is really false; make just that
// gate controllable per test. ViewHeader's own 992/768 queries stay "wide" (as
// they are in the real 1024px happy-dom viewport), so header rendering — and
// every existing test below — is unaffected.
const monitorWide = vi.hoisted(() => ({ value: false }));
vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: (query: string): boolean =>
      query === "(min-width: 1040px)" ? monitorWide.value : true,
  };
});
import type { BridgeFactory } from "../../elements/AppRenderer/AppRenderer";
import {
  EMPTY_TOOLS_UI,
  EMPTY_APPS_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_TASKS_UI,
  EMPTY_LOGS_UI,
  EMPTY_HISTORY_UI,
  EMPTY_NETWORK_UI,
} from "../../screens/screenUiState";

// Stub bridge factory — AppsScreen mounts the inner iframe and invokes
// `bridgeFactory(...)` on selection. The stub keeps that path quiet by
// returning a no-op AppBridge so tests don't try to postMessage to a
// real sandbox.
const noopBridgeFactory: BridgeFactory = () =>
  ({
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  }) as unknown as AppBridge;

// Returns a fresh fixture each call so per-test spies can be asserted on
// in isolation. The view is purely prop-driven; every callback is
// dispatched up to the parent — these spies stand in for App.tsx's
// hook-routed handlers in the real wiring.
function makeProps(
  overrides: Partial<InspectorViewProps> = {},
): InspectorViewProps {
  return {
    servers: [],
    activeServer: undefined,
    connectionStatus: "disconnected",
    initializeResult: undefined,
    latencyMs: undefined,
    tools: [],
    prompts: [],
    resources: [],
    resourceTemplates: [],
    toolsListChanged: false,
    promptsListChanged: false,
    resourcesListChanged: false,
    subscriptions: [],
    logs: [],
    tasks: [],
    history: [],
    network: [],
    currentLogLevel: "info",
    sandboxPath: "about:blank",
    bridgeFactory: noopBridgeFactory,
    appRendererRef: { current: null },
    toolsUi: EMPTY_TOOLS_UI,
    promptsUi: EMPTY_PROMPTS_UI,
    resourcesUi: EMPTY_RESOURCES_UI,
    appsUi: EMPTY_APPS_UI,
    tasksUi: EMPTY_TASKS_UI,
    logsUi: EMPTY_LOGS_UI,
    historyUi: EMPTY_HISTORY_UI,
    networkUi: EMPTY_NETWORK_UI,
    onToggleTheme: vi.fn(),
    onOpenClientSettings: vi.fn(),
    onToggleConnection: vi.fn(),
    onDisconnect: vi.fn(),
    onServerAdd: vi.fn(),
    onServerImportConfig: vi.fn(),
    onServerImportJson: vi.fn(),
    onServerExport: vi.fn(),
    onConnectionInfo: vi.fn(),
    onServerSettings: vi.fn(),
    onServerEdit: vi.fn(),
    onServerClone: vi.fn(),
    onServerRemove: vi.fn(),
    onServerReorder: vi.fn(),
    serverSupportsTaskToolCalls: false,
    onToolsUiChange: vi.fn(),
    onCallTool: vi.fn(),
    onRefreshTools: vi.fn(),
    onPromptsUiChange: vi.fn(),
    onGetPrompt: vi.fn(),
    onRefreshPrompts: vi.fn(),
    onResourcesUiChange: vi.fn(),
    onReadResource: vi.fn(),
    onSubscribeResource: vi.fn(),
    onUnsubscribeResource: vi.fn(),
    onRefreshResources: vi.fn(),
    onTasksUiChange: vi.fn(),
    onCancelTask: vi.fn(),
    onClearCompletedTasks: vi.fn(),
    onRefreshTasks: vi.fn(),
    onSetLogLevel: vi.fn(),
    onLogsUiChange: vi.fn(),
    onClearLogs: vi.fn(),
    onExportLogs: vi.fn(),
    onHistoryUiChange: vi.fn(),
    onClearHistory: vi.fn(),
    onExportHistory: vi.fn(),
    onClearHistorySection: vi.fn(),
    onExportHistorySection: vi.fn(),
    onReplayHistory: vi.fn(),
    onTogglePinHistory: vi.fn(),
    onNetworkUiChange: vi.fn(),
    onClearNetwork: vi.fn(),
    onExportNetwork: vi.fn(),
    onAppsUiChange: vi.fn(),
    onSelectApp: vi.fn(),
    onOpenApp: vi.fn(),
    onCloseApp: vi.fn(),
    onAppError: vi.fn(),
    onRefreshApps: vi.fn(),
    activeTab: "Servers",
    onActiveTabChange: vi.fn(),
    ...overrides,
  };
}

function StatefulInspectorViewHost(props: InspectorViewProps) {
  const [activeTab, setActiveTab] = useState(props.activeTab ?? "Servers");
  const [appsUi, setAppsUi] = useState(props.appsUi ?? EMPTY_APPS_UI);
  return (
    <InspectorView
      {...props}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      appsUi={appsUi}
      onAppsUiChange={setAppsUi}
    />
  );
}

const sampleServer: ServerEntry = {
  id: "alpha",
  name: "Alpha",
  config: { type: "stdio", command: "echo" },
  connection: { status: "disconnected" },
};

// A server that advertises every primitive capability. Each header tab is
// gated on the matching capability field (#1516), so most connected-mode
// tests use this fixture to make the corresponding tabs present; the
// capability-gating tests below override `capabilities` to drop or restore
// individual fields.
const allCapabilities: ServerCapabilities = {
  tools: {},
  prompts: {},
  resources: {},
  logging: {},
  tasks: {},
};

const connectedInit: InitializeResult = {
  protocolVersion: "2025-06-18",
  capabilities: allCapabilities,
  serverInfo: { name: "Alpha", version: "1.0.0" },
};

// Builds an initialize result with a specific capability set, otherwise
// identical to `connectedInit`. Used by the capability-gating tests to assert
// a tab appears/disappears purely on the advertised capability.
function initWithCapabilities(
  capabilities: ServerCapabilities,
): InitializeResult {
  return { ...connectedInit, capabilities };
}

// A tool the `isAppTool` filter recognizes (it carries `_meta.ui.resourceUri`),
// so its presence in the tool list makes the Apps tab available (#1450).
const sampleAppTool: Tool = {
  name: "ops",
  title: "Ops Dashboard",
  inputSchema: { type: "object" },
  _meta: { ui: { resourceUri: "ui://apps/ops" } },
};

// Prompts, Resources, and Tasks tabs are gated on the server's advertised
// capability (#1516), not on content. These fixtures populate the lists where
// a test needs an entry rendered on the screen (e.g. list-changed indicator).
const samplePrompt: Prompt = { name: "greet" };
const sampleResource: Resource = {
  uri: "file:///readme.md",
  name: "README",
};
const sampleTask: Task = {
  taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
  status: "working",
  ttl: 300000,
  createdAt: "2026-03-29T20:18:20Z",
  lastUpdatedAt: "2026-03-29T20:18:22Z",
};

describe("InspectorView", () => {
  it("renders the empty-server-list placeholder when no servers are configured", () => {
    renderWithMantine(<StatefulInspectorViewHost {...makeProps()} />);
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("renders the server card from the input list", () => {
    renderWithMantine(
      <StatefulInspectorViewHost {...makeProps({ servers: [sampleServer] })} />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("dispatches onToggleConnection with the server id when the card toggle is clicked", async () => {
    const onToggleConnection = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({ servers: [sampleServer], onToggleConnection })}
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onToggleConnection).toHaveBeenCalledWith("alpha");
  });

  it("renders the connected header when connectionStatus + initializeResult are set", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
        })}
      />,
    );
    // ServerCard renders the server name AND ViewHeader does (in connected
    // mode it shows the serverInfo.name); checking ≥1 occurrence accepts
    // both. The connected toggle being on confirms the connected mode.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("surfaces the negotiated protocol version on the active connected card", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
        })}
      />,
    );
    // initializeResult.protocolVersion is spliced onto the active server's
    // connection; ServerCard renders it as "MCP <version>".
    expect(screen.getByText("MCP 2025-06-18")).toBeInTheDocument();
  });

  it("does not show a protocol version on the card while disconnected", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "disconnected",
          initializeResult: undefined,
        })}
      />,
    );
    expect(
      screen.queryByText(/^MCP \d{4}-\d{2}-\d{2}$/),
    ).not.toBeInTheDocument();
  });

  it("keeps the connected surface and hides the label when the version is unknown", () => {
    // App emits initializeResult with protocolVersion "" when the negotiated
    // version is somehow absent — the connected header/modal must still render
    // (gated on serverInfo, not the version), and the card label stays hidden.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: { ...connectedInit, protocolVersion: "" },
        })}
      />,
    );
    // Connected: the card toggle is on (connected surface is alive).
    expect(screen.getByRole("switch")).toBeChecked();
    // ...but no "MCP <version>" label, since the version is empty. (The
    // date-shaped matcher avoids matching the "MCP Inspector" header title.)
    expect(
      screen.queryByText(/^MCP \d{4}-\d{2}-\d{2}$/),
    ).not.toBeInTheDocument();
  });

  it("snaps activeTab back to Servers when connection drops", async () => {
    const { rerender } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
        })}
      />,
    );
    const user = userEvent.setup();
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Tools"));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Tools")).toBeInTheDocument(),
    );

    rerender(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: undefined,
          connectionStatus: "disconnected",
        })}
      />,
    );

    // Disconnected ViewHeader has no tab Select. The previously-selected
    // "Tools" display value should be gone after the snap-back.
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Tools")).not.toBeInTheDocument(),
    );
  });

  it("disables non-Servers tabs while disconnected", () => {
    renderWithMantine(<StatefulInspectorViewHost {...makeProps()} />);
    // The disconnected ViewHeader doesn't render the tab Select at all —
    // only the connected branch does. Asserting on the empty-state copy is
    // enough; a follow-up could deepen this once the disconnected header
    // grows additional affordances.
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("hides the Network tab when the active server is stdio", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
        })}
      />,
    );
    // ViewHeader renders the tab radiogroup as accessible radios; check the
    // radio list directly so the assertion isn't fooled by hidden options.
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Network");
  });

  it("shows the Network tab when the active server is streamable-http", async () => {
    const httpServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "streamable-http", url: "http://localhost:3000/mcp" },
      connection: { status: "connected" },
    };
    const httpInit: InitializeResult = {
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: { name: "Beta", version: "1.0.0" },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [httpServer],
          activeServer: "beta",
          connectionStatus: "connected",
          initializeResult: httpInit,
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Network");
  });

  it("hides the Tools tab when the server does not advertise the tools capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          // No `tools` capability — only logging is advertised.
          initializeResult: initWithCapabilities({ logging: {} }),
          // A non-empty tool list must not override the missing capability.
          tools: [{ name: "echo", inputSchema: { type: "object" } }],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).not.toContain("Tools");
    // Sibling capability is independent — Logs is present, Apps stays hidden
    // (Apps build on the tools capability).
    expect(labels).toContain("Logs");
    expect(labels).not.toContain("Apps");
  });

  it("shows the Tools tab when the server advertises tools even with an empty list", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tools: {} }),
          tools: [],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Tools");
  });

  it("hides the Logs tab when the server does not advertise the logging capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tools: {} }),
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Logs");
  });

  it("shows the Logs tab when the server advertises the logging capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ logging: {} }),
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Logs");
  });

  it("keeps History available regardless of advertised server capabilities", async () => {
    // History is a local client-side log — never gated on server capabilities.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          // Empty capability set: every server-capability tab is hidden.
          initializeResult: initWithCapabilities({}),
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Servers");
    expect(labels).toContain("History");
    expect(labels).not.toContain("Tools");
    expect(labels).not.toContain("Logs");
  });

  it("hides the Apps tab when app tools exist but the server omits the tools capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          // Logging only — no tools capability, even though an app tool is
          // present in the (stale/optimistic) list.
          initializeResult: initWithCapabilities({ logging: {} }),
          tools: [sampleAppTool],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).not.toContain("Apps");
  });

  it("filters tools to apps and auto-launches a no-fields app on the Apps tab", async () => {
    const user = userEvent.setup();
    // Plain (non-app) tool plus a tool with a malformed UI resource URI
    // exercise both branches of the appTools filter: the non-app drop and
    // the try/catch around `isAppTool` for malformed metadata.
    const plainTool: Tool = {
      name: "shell.exec",
      title: "Run Shell",
      inputSchema: { type: "object" },
    };
    const malformedAppTool: Tool = {
      name: "broken",
      title: "Broken App",
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: "not-a-ui-uri" } },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
          tools: [sampleAppTool, plainTool, malformedAppTool],
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Apps"));
    expect(screen.getByText("MCP Apps (1)")).toBeInTheDocument();
    await user.click(screen.getByText("Ops Dashboard"));
    expect(screen.getByTitle("Ops Dashboard")).toBeInTheDocument();
  });

  it("hides the Apps tab when the server exposes no MCP App tools", async () => {
    const plainTool: Tool = {
      name: "shell.exec",
      title: "Run Shell",
      inputSchema: { type: "object" },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          // Only a non-app tool — no `_meta.ui.resourceUri`, so appTools is empty.
          tools: [plainTool],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Apps");
  });

  it("shows the Apps tab when the server exposes one or more MCP App tools", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          tools: [sampleAppTool],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Apps");
  });

  it("reveals the Apps tab live when an app tool arrives via list-changed refresh", async () => {
    const plainTool: Tool = {
      name: "shell.exec",
      title: "Run Shell",
      inputSchema: { type: "object" },
    };
    const { rerender } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          tools: [plainTool],
        })}
      />,
    );
    // Initially no app tools → no Apps tab.
    let radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).not.toContain("Apps");

    // A tools/list_changed refresh adds an app tool — the tab appears reactively.
    rerender(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          tools: [plainTool, sampleAppTool],
        })}
      />,
    );
    await waitFor(async () => {
      radios = await screen.findAllByRole("radio");
      expect(radios.map((r) => r.getAttribute("value"))).toContain("Apps");
    });
  });

  it("snaps activeTab back to Servers when the Apps tab disappears after a refresh", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          tools: [sampleAppTool],
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Apps"));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Apps")).toBeInTheDocument(),
    );

    // The app tool goes away (server switch / list-changed) — the Apps tab is
    // pulled from availableTabs and the activeTab fallback lands on Servers.
    rerender(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          tools: [],
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Apps")).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Servers")).toBeInTheDocument();
  });

  it("hides the Prompts tab when the server does not advertise the prompts capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          // Advertise tools but not prompts.
          initializeResult: initWithCapabilities({ tools: {} }),
          // Content is irrelevant to gating now — even a populated list stays
          // hidden when the capability is absent.
          prompts: [samplePrompt],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Prompts");
  });

  it("shows the Prompts tab when the server advertises prompts even with an empty list", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ prompts: {} }),
          // No prompts yet — the tab is still available because the server
          // advertises the capability (#1516).
          prompts: [],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Prompts");
  });

  it("hides the Resources tab when the server does not advertise the resources capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tools: {} }),
          // Populated lists are ignored when the capability is absent.
          resources: [sampleResource],
          resourceTemplates: [{ uriTemplate: "file:///{path}", name: "Files" }],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Resources");
  });

  it("shows the Resources tab when the server advertises resources even with empty lists", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ resources: {} }),
          resources: [],
          resourceTemplates: [],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Resources");
  });

  it("hides the Tasks tab when the server does not advertise the tasks capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tools: {} }),
          // An existing task is ignored when the capability is absent.
          tasks: [sampleTask],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Tasks");
  });

  it("shows the Tasks tab when the server advertises tasks even with no tasks yet", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tasks: {} }),
          tasks: [],
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Tasks");
  });

  it("recomputes tabs from the new capability set when reconnecting to a different server", async () => {
    // First server advertises tasks but not logging.
    const { rerender } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tools: {}, tasks: {} }),
        })}
      />,
    );
    let radios = await screen.findAllByRole("radio");
    let labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tasks");
    expect(labels).not.toContain("Logs");

    // Reconnect to a server that advertises logging but not tasks — the tabs
    // recompute purely from the new capability set.
    rerender(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({ tools: {}, logging: {} }),
        })}
      />,
    );
    await waitFor(async () => {
      radios = await screen.findAllByRole("radio");
      labels = radios.map((r) => r.getAttribute("value"));
      expect(labels).toContain("Logs");
      expect(labels).not.toContain("Tasks");
    });
  });

  it("dispatches onSetLogLevel through to the Logs screen", async () => {
    const onSetLogLevel = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
          onSetLogLevel,
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Logs"));
    // LogControls renders Mantine's Select with the current level — picking
    // a value in the dropdown dispatches onSetLevel directly. (Mantine
    // renders the visible search input and a hidden combobox input, both
    // with the same displayValue; pick the first.)
    const levelInputs = screen.getAllByDisplayValue("info");
    await user.click(levelInputs[0]!);
    const warningOption = await screen.findByRole("option", {
      name: "warning",
      hidden: true,
    });
    await user.click(warningOption);
    expect(onSetLogLevel).toHaveBeenCalledWith("warning");
  });

  it("persists Logs sort direction to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Logs"));

    const sortSelect = await screen.findByRole("textbox", {
      name: "Logs sort direction",
    });
    expect(sortSelect).toHaveValue("Newest First");
    await user.click(sortSelect);
    await user.click(await screen.findByText("Oldest First"));

    await waitFor(() =>
      expect(window.localStorage.getItem("inspector.sortDirection.logs")).toBe(
        "oldest-first",
      ),
    );

    unmount();
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
        })}
      />,
    );
    const tabSelect2 = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect2);
    await user.click(await screen.findByText("Logs"));
    const sortSelect2 = await screen.findByRole("textbox", {
      name: "Logs sort direction",
    });
    await waitFor(() => expect(sortSelect2).toHaveValue("Oldest First"));
  });

  it("falls back to newest-first when a corrupted sort value is stored", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("inspector.sortDirection.history", "garbage");
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("History"));
    const sortSelect = await screen.findByRole("textbox", {
      name: "History sort direction",
    });
    await waitFor(() => expect(sortSelect).toHaveValue("Newest First"));
  });

  it("persists History list compact state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const historyEntry = {
      id: "req-1",
      timestamp: new Date("2026-03-17T10:00:00Z"),
      direction: "request" as const,
      message: {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
      },
    };
    const { unmount } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
          history: [historyEntry],
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("History"));
    // Default is collapsed — ListToggle reads "Expand all".
    await user.click(await screen.findByRole("button", { name: "Expand all" }));

    await waitFor(() =>
      expect(window.localStorage.getItem("inspector.listCompact.history")).toBe(
        "false",
      ),
    );

    unmount();
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
          history: [historyEntry],
        })}
      />,
    );
    const tabSelect2 = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect2);
    await user.click(await screen.findByText("History"));
    // After restore the list is expanded, so the ListToggle reads "Collapse all".
    expect(
      await screen.findByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("falls back to collapsed when a corrupted compact value is stored", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("inspector.listCompact.history", "garbage");
    const historyEntry = {
      id: "req-1",
      timestamp: new Date("2026-03-17T10:00:00Z"),
      direction: "request" as const,
      message: {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "tools/list",
      },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
          history: [historyEntry],
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("History"));
    expect(
      await screen.findByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();
  });

  it("dims the other server cards while a connection is live", () => {
    const betaServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "stdio", command: "echo" },
      connection: { status: "disconnected" },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer, betaServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
        })}
      />,
    );
    // The non-active card is inert while alpha holds a live session, so the
    // user can't start a second connection mid-session.
    const betaCard = screen.getByText("Beta").closest(".mantine-Card-root");
    expect(betaCard?.getAttribute("aria-disabled")).toBe("true");
  });

  it("re-enables the other server cards when the active connection goes to error (#1521)", () => {
    const betaServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "stdio", command: "echo" },
      connection: { status: "disconnected" },
    };
    // Live session on alpha → beta starts out dimmed/inert.
    const { rerender } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer, betaServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
        })}
      />,
    );
    expect(
      screen
        .getByText("Beta")
        .closest(".mantine-Card-root")
        ?.getAttribute("aria-disabled"),
    ).toBe("true");

    // alpha's connection errors. App does NOT clear `activeServer` here — a
    // terminal `error` fires no InspectorClient `disconnect` event — so the
    // id still points at alpha. The other cards must re-enable anyway; only a
    // *live* session should dim them.
    rerender(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [sampleServer, betaServer],
          activeServer: "alpha",
          connectionStatus: "error",
          initializeResult: undefined,
        })}
      />,
    );
    expect(
      screen
        .getByText("Beta")
        .closest(".mantine-Card-root")
        ?.getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("toggles the Servers list compact state from the list toggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <StatefulInspectorViewHost {...makeProps({ servers: [sampleServer] })} />,
    );
    // Servers default to expanded (compact=false), so the toggle reads
    // "Collapse all"; clicking it flips serversCompact via the inline callback.
    const toggle = await screen.findByRole("button", { name: "Collapse all" });
    await user.click(toggle);
    expect(
      await screen.findByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();
  });

  it("toggles the Network list compact state from the list toggle", async () => {
    const user = userEvent.setup();
    const httpServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "streamable-http", url: "http://localhost:3000/mcp" },
      connection: { status: "connected" },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [httpServer],
          activeServer: "beta",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({}),
          // The Network list toggle only renders when there's at least one
          // request to show.
          network: [
            {
              id: "n-1",
              timestamp: new Date("2026-03-17T10:00:00Z"),
              method: "POST",
              url: "http://localhost:3000/mcp",
              requestHeaders: {},
              responseStatus: 200,
              category: "transport",
            },
          ],
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Network"));
    // Network defaults to compact=true → "Expand all"; clicking flips it.
    const toggle = await screen.findByRole("button", { name: "Expand all" });
    await user.click(toggle);
    expect(
      await screen.findByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("shows the Network tab when the active server id is not in the list (non-stdio fallback)", async () => {
    // connectionStatus is connected but activeServer points at an id absent
    // from the list — `active` is undefined, so isStdio falls back to false and
    // the Network tab is not hidden.
    const httpServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "streamable-http", url: "http://localhost:3000/mcp" },
      connection: { status: "connected" },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: [httpServer],
          activeServer: "ghost",
          connectionStatus: "connected",
          initializeResult: initWithCapabilities({}),
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Network");
  });

  describe("listChanged indicator wiring (#1402)", () => {
    // The indicator only mounts on the active screen, so each case connects,
    // navigates to the target tab, and asserts the "List updated" affordance.
    async function gotoTab(tab: string) {
      const user = userEvent.setup();
      const tabSelect = await screen.findByDisplayValue("Servers");
      await user.click(tabSelect);
      await user.click(await screen.findByText(tab));
      return user;
    }

    it("routes toolsListChanged to the Tools screen indicator", async () => {
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            toolsListChanged: true,
          })}
        />,
      );
      await gotoTab("Tools");
      expect(await screen.findByText("List updated")).toBeInTheDocument();
    });

    it("shares the tools flag with the Apps screen (apps are filtered tools)", async () => {
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            // An app tool is required for the Apps tab to be available — Apps
            // keeps a content check on top of the tools capability (#1516).
            tools: [sampleAppTool],
            toolsListChanged: true,
          })}
        />,
      );
      await gotoTab("Apps");
      expect(await screen.findByText("List updated")).toBeInTheDocument();
    });

    it("routes promptsListChanged to the Prompts screen indicator", async () => {
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            // connectedInit advertises prompts, so the tab is available; the
            // prompt populates the screen so the indicator has a list to mark.
            prompts: [samplePrompt],
            promptsListChanged: true,
          })}
        />,
      );
      await gotoTab("Prompts");
      expect(await screen.findByText("List updated")).toBeInTheDocument();
    });

    it("routes resourcesListChanged to the Resources screen indicator", async () => {
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            // connectedInit advertises resources, so the tab is available; the
            // resource populates the screen so the indicator has a list to mark.
            resources: [sampleResource],
            resourcesListChanged: true,
          })}
        />,
      );
      await gotoTab("Resources");
      expect(await screen.findByText("List updated")).toBeInTheDocument();
    });

    it("does not show the indicator on a screen whose flag is false (no cross-wiring)", async () => {
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            // connectedInit advertises prompts, so the Prompts tab is available.
            prompts: [samplePrompt],
            // Tools changed, but Prompts did not — the Prompts screen must
            // stay quiet.
            toolsListChanged: true,
            promptsListChanged: false,
          })}
        />,
      );
      await gotoTab("Prompts");
      // The Prompts screen has mounted (its heading is present)...
      expect(
        await screen.findByRole("heading", { name: "Prompts" }),
      ).toBeInTheDocument();
      // ...but the indicator is not, since promptsListChanged is false.
      expect(screen.queryByText("List updated")).not.toBeInTheDocument();
    });
  });

  describe("pinned monitoring column (#1616)", () => {
    const httpServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "streamable-http", url: "http://localhost:3000/mcp" },
      connection: { status: "connected" },
    };
    const httpInit = initWithCapabilities(allCapabilities);

    beforeEach(() => {
      // Default narrow so a test only pins when it opts in.
      monitorWide.value = false;
    });

    function connectedHttp(overrides: Partial<InspectorViewProps> = {}) {
      return makeProps({
        servers: [httpServer],
        activeServer: "beta",
        connectionStatus: "connected",
        initializeResult: httpInit,
        ...overrides,
      });
    }

    async function gotoTab(tab: string) {
      const user = userEvent.setup();
      const tabSelect = await screen.findByDisplayValue("Servers");
      await user.click(tabSelect);
      await user.click(await screen.findByText(tab));
      return user;
    }

    it("shows the Pin as column button on a monitor screen only when wide", async () => {
      monitorWide.value = false;
      const { unmount } = renderWithMantine(
        <StatefulInspectorViewHost {...connectedHttp()} />,
      );
      await gotoTab("Logs");
      expect(
        screen.queryByRole("button", { name: "Pin as column" }),
      ).not.toBeInTheDocument();
      unmount();

      monitorWide.value = true;
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      await gotoTab("Logs");
      expect(
        await screen.findByRole("button", { name: "Pin as column" }),
      ).toBeInTheDocument();
    });

    it("pins the monitor group into the column and removes it from the header", async () => {
      monitorWide.value = true;
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      const user = await gotoTab("Logs");
      await user.click(
        await screen.findByRole("button", { name: "Pin as column" }),
      );

      // Column is open (its close control is present).
      expect(
        await screen.findByRole("button", { name: "Close monitoring column" }),
      ).toBeInTheDocument();

      // The monitor group is gone from the header tab bar...
      const header = screen.getByRole("banner");
      expect(within(header).queryByRole("radio", { name: "Logs" })).toBeNull();
      expect(
        within(header).queryByRole("radio", { name: "History" }),
      ).toBeNull();
      expect(
        within(header).queryByRole("radio", { name: "Network" }),
      ).toBeNull();
      // ...and a non-monitor tab still sits in the header.
      expect(
        within(header).getByRole("radio", { name: "Tools" }),
      ).toBeInTheDocument();

      // The column hosts the monitor tabs, defaulting to the pinned one.
      expect(screen.getByRole("radio", { name: "Logs" })).toBeChecked();
      expect(
        screen.getByRole("radio", { name: "Network" }),
      ).toBeInTheDocument();
    });

    it("returns the monitor group to the header when the column is closed", async () => {
      monitorWide.value = true;
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      const user = await gotoTab("Logs");
      await user.click(
        await screen.findByRole("button", { name: "Pin as column" }),
      );
      await user.click(
        await screen.findByRole("button", { name: "Close monitoring column" }),
      );

      expect(
        screen.queryByRole("button", { name: "Close monitoring column" }),
      ).toBeNull();
      const header = screen.getByRole("banner");
      expect(
        within(header).getByRole("radio", { name: "Logs" }),
      ).toBeInTheDocument();
    });

    it("persists the pin preference and reopens the column when wide", () => {
      // Stored preference from a prior wide session.
      window.localStorage.setItem("inspector.monitor.pinned", "true");

      // Narrow: the column stays closed and the group is in the header.
      monitorWide.value = false;
      const { unmount } = renderWithMantine(
        <StatefulInspectorViewHost {...connectedHttp()} />,
      );
      expect(
        screen.queryByRole("button", { name: "Close monitoring column" }),
      ).toBeNull();
      expect(
        within(screen.getByRole("banner")).getByRole("radio", { name: "Logs" }),
      ).toBeInTheDocument();
      unmount();

      // Wide: the preserved preference reopens the column without re-pinning.
      monitorWide.value = true;
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        screen.getByRole("button", { name: "Close monitoring column" }),
      ).toBeInTheDocument();
    });

    it("keeps the column closed when the stored preference is explicitly false", () => {
      window.localStorage.setItem("inspector.monitor.pinned", "false");
      monitorWide.value = true;
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        screen.queryByRole("button", { name: "Close monitoring column" }),
      ).toBeNull();
    });

    it("hides the column on disconnect but keeps the pin preference", () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      monitorWide.value = true;
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost {...connectedHttp()} />,
      );
      expect(
        screen.getByRole("button", { name: "Close monitoring column" }),
      ).toBeInTheDocument();

      rerender(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [httpServer],
            activeServer: undefined,
            connectionStatus: "disconnected",
          })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Close monitoring column" }),
      ).toBeNull();
      // Preference is untouched — only the column's close button clears it.
      expect(window.localStorage.getItem("inspector.monitor.pinned")).toBe(
        "true",
      );
    });

    it("drops Network from the column tabs for a stdio server", () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      monitorWide.value = true;
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities(allCapabilities),
          })}
        />,
      );
      // Column open, but Network is unavailable over stdio.
      expect(
        screen.getByRole("button", { name: "Close monitoring column" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Logs" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
    });

    it("falls back to an available tab when the stored monitor tab is unavailable", () => {
      // Stored tab is Network, but a stdio + logging-only server can't offer it.
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      window.localStorage.setItem("inspector.monitor.tab", "Network");
      monitorWide.value = true;
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ logging: {} }),
          })}
        />,
      );
      // Column active tab clamps to the first available monitor tab (Logs).
      expect(screen.getByRole("radio", { name: "Logs" })).toBeChecked();
      expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
    });

    it("clamps the primary tab to Servers when the header has no other tab", () => {
      // stdio + logging only ⇒ availableTabs = [Servers, Logs, History]; pinning
      // moves both monitor tabs out, leaving [Servers] as the only header tab.
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      monitorWide.value = true;
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            servers: [sampleServer],
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ logging: {} }),
          })}
        />,
      );
      const header = screen.getByRole("banner");
      expect(
        within(header)
          .getAllByRole("radio")
          .map((r) => r.getAttribute("value")),
      ).toEqual(["Servers"]);
      expect(
        screen.getByRole("button", { name: "Close monitoring column" }),
      ).toBeInTheDocument();
    });

    it("persists the selected column tab", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      monitorWide.value = true;
      const user = userEvent.setup();
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      await user.click(await screen.findByRole("radio", { name: "History" }));
      await waitFor(() =>
        expect(window.localStorage.getItem("inspector.monitor.tab")).toBe(
          "History",
        ),
      );
    });

    it("resizes and persists the column width from the keyboard", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      window.localStorage.setItem("inspector.monitor.width", "420");
      monitorWide.value = true;
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      const handle = await screen.findByRole("separator", {
        name: "Resize monitoring column",
      });
      // ArrowLeft widens by the 16px step (panel is on the right).
      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      await waitFor(() =>
        expect(window.localStorage.getItem("inspector.monitor.width")).toBe(
          "436",
        ),
      );
    });
  });
});
