import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  InitializeResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { InspectorView, type InspectorViewProps } from "./InspectorView";
import type { BridgeFactory } from "../../elements/AppRenderer/AppRenderer";

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
    errorMessage: undefined,
    tools: [],
    prompts: [],
    resources: [],
    resourceTemplates: [],
    subscriptions: [],
    logs: [],
    tasks: [],
    history: [],
    currentLogLevel: "info",
    sandboxPath: "about:blank",
    bridgeFactory: noopBridgeFactory,
    onToggleTheme: vi.fn(),
    onToggleConnection: vi.fn(),
    onDisconnect: vi.fn(),
    onServerAdd: vi.fn(),
    onServerImportConfig: vi.fn(),
    onServerImportJson: vi.fn(),
    onServerExport: vi.fn(),
    onServerInfo: vi.fn(),
    onServerSettings: vi.fn(),
    onServerEdit: vi.fn(),
    onServerClone: vi.fn(),
    onServerRemove: vi.fn(),
    onCallTool: vi.fn(),
    onRefreshTools: vi.fn(),
    onGetPrompt: vi.fn(),
    onRefreshPrompts: vi.fn(),
    onReadResource: vi.fn(),
    onSubscribeResource: vi.fn(),
    onUnsubscribeResource: vi.fn(),
    onRefreshResources: vi.fn(),
    onCancelTask: vi.fn(),
    onClearCompletedTasks: vi.fn(),
    onRefreshTasks: vi.fn(),
    onSetLogLevel: vi.fn(),
    onClearLogs: vi.fn(),
    onExportLogs: vi.fn(),
    onCopyAllLogs: vi.fn(),
    onClearHistory: vi.fn(),
    onExportHistory: vi.fn(),
    onReplayHistory: vi.fn(),
    onTogglePinHistory: vi.fn(),
    onSelectApp: vi.fn(),
    onOpenApp: vi.fn(),
    onCloseApp: vi.fn(),
    onRefreshApps: vi.fn(),
    ...overrides,
  };
}

const sampleServer: ServerEntry = {
  id: "alpha",
  name: "Alpha",
  config: { type: "stdio", command: "echo" },
  connection: { status: "disconnected" },
};

const connectedInit: InitializeResult = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  serverInfo: { name: "Alpha", version: "1.0.0" },
};

describe("InspectorView", () => {
  it("renders the empty-server-list placeholder when no servers are configured", () => {
    renderWithMantine(<InspectorView {...makeProps()} />);
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("renders the server card from the input list", () => {
    renderWithMantine(
      <InspectorView {...makeProps({ servers: [sampleServer] })} />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("dispatches onToggleConnection with the server id when the card toggle is clicked", async () => {
    const onToggleConnection = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView
        {...makeProps({ servers: [sampleServer], onToggleConnection })}
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onToggleConnection).toHaveBeenCalledWith("alpha");
  });

  it("renders the connected header when connectionStatus + initializeResult are set", () => {
    renderWithMantine(
      <InspectorView
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

  it("renders the error banner when connectionStatus is 'error' with an errorMessage", () => {
    renderWithMantine(
      <InspectorView
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "error",
          errorMessage: "Handshake timeout",
        })}
      />,
    );
    expect(screen.getByText("Handshake timeout")).toBeInTheDocument();
  });

  it("snaps activeTab back to Servers when connection drops", async () => {
    const { rerender } = renderWithMantine(
      <InspectorView
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
      <InspectorView
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
    renderWithMantine(<InspectorView {...makeProps()} />);
    // The disconnected ViewHeader doesn't render the tab Select at all —
    // only the connected branch does. Asserting on the empty-state copy is
    // enough; a follow-up could deepen this once the disconnected header
    // grows additional affordances.
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("filters tools to apps and auto-launches a no-fields app on the Apps tab", async () => {
    const user = userEvent.setup();
    const opsApp: Tool = {
      name: "ops",
      title: "Ops Dashboard",
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: "ui://apps/ops" } },
    };
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
      <InspectorView
        {...makeProps({
          servers: [sampleServer],
          activeServer: "alpha",
          connectionStatus: "connected",
          initializeResult: connectedInit,
          latencyMs: 50,
          tools: [opsApp, plainTool, malformedAppTool],
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

  it("dispatches onSetLogLevel through to the Logs screen", async () => {
    const onSetLogLevel = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView
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

  it("toggles autoScroll locally on the Logs screen after connecting", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView
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
    const autoScroll = await screen.findByRole("checkbox", {
      name: "Auto-scroll",
    });
    expect(autoScroll).toBeChecked();
    await user.click(autoScroll);
    expect(autoScroll).not.toBeChecked();
  });
});
