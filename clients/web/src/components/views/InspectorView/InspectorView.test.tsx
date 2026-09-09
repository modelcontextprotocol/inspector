import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  InitializeResult,
  Prompt,
  Resource,
  ServerCapabilities,
  Task,
  Tool,
} from "@modelcontextprotocol/client";
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
import { noopPagination } from "../../../test/fixtures/pagination";

// happy-dom's viewport is 1024px, narrower than the app's 1280px floor, so any
// viewport media query would read "narrow". Force every `useMediaQuery` "wide"
// so the connected header renders its full form (the only surviving query is
// ServerStatusIndicator's 1500px status-text gate — the monitoring sidebar's old
// 1040px gate was removed when the app gained its 1280px floor).
vi.mock("@mantine/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mantine/hooks")>();
  return {
    ...actual,
    useMediaQuery: (): boolean => true,
  };
});
import type { BridgeFactory } from "../../elements/AppRenderer/AppRenderer";
import {
  EMPTY_TOOLS_UI,
  EMPTY_APPS_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_SKILLS_UI,
  EMPTY_TASKS_UI,
  EMPTY_LOGS_UI,
  EMPTY_PROTOCOL_UI,
  EMPTY_NETWORK_UI,
  EMPTY_CONSOLE_UI,
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

/**
 * Per-bundle overrides. Each key takes a `Partial` of that bundle, so a test
 * names only the field it cares about — `makeProps({ tools: { tools: [t] } })`
 * — and inherits the rest of the bundle's defaults.
 */
type PropOverrides = {
  [K in keyof InspectorViewProps]?: Partial<InspectorViewProps[K]>;
};

// Merges one bundle across every supplied override layer, later layers
// winning. Kept generic (rather than a spread over `Object.assign`) so each
// bundle stays typed to its own shape.
function mergeBundle<K extends keyof InspectorViewProps>(
  key: K,
  layers: PropOverrides[],
): Partial<InspectorViewProps[K]> {
  let merged: Partial<InspectorViewProps[K]> = {};
  for (const layer of layers) {
    const part = layer[key];
    if (part) merged = { ...merged, ...part };
  }
  return merged;
}

// Returns a fresh fixture each call so per-test spies can be asserted on
// in isolation. The view is purely prop-driven; every callback is
// dispatched up to the parent — these spies stand in for App.tsx's
// hook-routed handlers in the real wiring.
//
// Takes any number of override layers so a scenario helper can supply its own
// base (see `connectedHttp` below) and still let the caller override on top.
function makeProps(...overrides: PropOverrides[]): InspectorViewProps {
  return {
    shell: {
      activeTab: "Servers",
      onActiveTabChange: vi.fn(),
      onToggleTheme: vi.fn(),
      onOpenClientSettings: vi.fn(),
      ...mergeBundle("shell", overrides),
    },
    connection: {
      activeServer: undefined,
      connectionStatus: "disconnected",
      initializeResult: undefined,
      latencyMs: undefined,
      onToggleConnection: vi.fn(),
      onDisconnect: vi.fn(),
      ...mergeBundle("connection", overrides),
    },
    servers: {
      servers: [],
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
      ...mergeBundle("servers", overrides),
    },
    tools: {
      tools: [],
      toolsListChanged: false,
      toolsUi: EMPTY_TOOLS_UI,
      toolsPagination: noopPagination,
      serverSupportsTaskToolCalls: false,
      onToolsUiChange: vi.fn(),
      onCallTool: vi.fn(),
      onRefreshTools: vi.fn(),
      ...mergeBundle("tools", overrides),
    },
    prompts: {
      prompts: [],
      promptsListChanged: false,
      promptsUi: EMPTY_PROMPTS_UI,
      promptsPagination: noopPagination,
      onPromptsUiChange: vi.fn(),
      onGetPrompt: vi.fn(),
      onRefreshPrompts: vi.fn(),
      ...mergeBundle("prompts", overrides),
    },
    resources: {
      resources: [],
      resourceTemplates: [],
      subscriptions: [],
      resourcesListChanged: false,
      resourcesUi: EMPTY_RESOURCES_UI,
      resourcesPagination: noopPagination,
      onResourcesUiChange: vi.fn(),
      onReadResource: vi.fn(),
      onSubscribeResource: vi.fn(),
      onUnsubscribeResource: vi.fn(),
      onRefreshResources: vi.fn(),
      ...mergeBundle("resources", overrides),
    },
    apps: {
      appsUi: EMPTY_APPS_UI,
      sandboxPath: "about:blank",
      bridgeFactory: noopBridgeFactory,
      appRendererRef: { current: null },
      onAppsUiChange: vi.fn(),
      onSelectApp: vi.fn(),
      onOpenApp: vi.fn(),
      onCloseApp: vi.fn(),
      onAppError: vi.fn(),
      onRefreshApps: vi.fn(),
      ...mergeBundle("apps", overrides),
    },
    skills: {
      skillsSessionKey: "test-session",
      skills: [],
      skillsPageCount: 0,
      skillsUi: EMPTY_SKILLS_UI,
      onSkillsUiChange: vi.fn(),
      onRefreshSkills: vi.fn(),
      onReadSkillFile: vi.fn().mockResolvedValue({ text: "" }),
      onGetSkill: vi.fn(),
      ...mergeBundle("skills", overrides),
    },
    tasks: {
      tasks: [],
      tasksUi: EMPTY_TASKS_UI,
      onTasksUiChange: vi.fn(),
      onCancelTask: vi.fn(),
      onClearCompletedTasks: vi.fn(),
      onRefreshTasks: vi.fn(),
      ...mergeBundle("tasks", overrides),
    },
    logs: {
      logs: [],
      logsUi: EMPTY_LOGS_UI,
      currentLogLevel: "info",
      onSetLogLevel: vi.fn(),
      onLogsUiChange: vi.fn(),
      onClearLogs: vi.fn(),
      onExportLogs: vi.fn(),
      ...mergeBundle("logs", overrides),
    },
    protocol: {
      protocol: [],
      protocolUi: EMPTY_PROTOCOL_UI,
      onProtocolUiChange: vi.fn(),
      onClearProtocol: vi.fn(),
      onExportProtocol: vi.fn(),
      onClearProtocolSection: vi.fn(),
      onExportProtocolSection: vi.fn(),
      onReplayProtocol: vi.fn(),
      onTogglePinProtocol: vi.fn(),
      ...mergeBundle("protocol", overrides),
    },
    network: {
      network: [],
      networkUi: EMPTY_NETWORK_UI,
      onNetworkUiChange: vi.fn(),
      onClearNetwork: vi.fn(),
      onExportNetwork: vi.fn(),
      ...mergeBundle("network", overrides),
    },
    console: {
      stderrLogs: [],
      consoleUi: EMPTY_CONSOLE_UI,
      onConsoleUiChange: vi.fn(),
      onClearConsole: vi.fn(),
      onExportConsole: vi.fn(),
      ...mergeBundle("console", overrides),
    },
  };
}

function StatefulInspectorViewHost(props: InspectorViewProps) {
  const [activeTab, setActiveTab] = useState(props.shell.activeTab);
  const [appsUi, setAppsUi] = useState(props.apps.appsUi);
  return (
    <InspectorView
      {...props}
      shell={{ ...props.shell, activeTab, onActiveTabChange: setActiveTab }}
      apps={{ ...props.apps, appsUi, onAppsUiChange: setAppsUi }}
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
      <StatefulInspectorViewHost
        {...makeProps({
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("renders the footer row with the version and copyright (#1682)", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            version: "9.9.9",
          },
        })}
      />,
    );
    expect(screen.getByText("v9.9.9")).toBeInTheDocument();
    expect(
      screen.getByText(/Model Context Protocol.*Series of LF Projects, LLC\./),
    ).toBeInTheDocument();
  });

  it("dispatches onToggleConnection with the server id when the card toggle is clicked", async () => {
    const onToggleConnection = vi.fn();
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            onToggleConnection,
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onToggleConnection).toHaveBeenCalledWith("alpha");
  });

  it("exposes the machine-readable connection-status header attributes for drivers", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            deepLinkStatus: "rejected",
          },
          connection: {
            connectionStatus: "error",
            connectErrorMessage: "handshake failed: 500",
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    const header = screen.getByTestId("connection-status");
    expect(header).toHaveAttribute("data-status", "error");
    expect(header).toHaveAttribute(
      "data-error-message",
      "handshake failed: 500",
    );
    expect(header).toHaveAttribute("data-deeplink", "rejected");
  });

  it("omits the error-message attribute when no connect error is recorded", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            deepLinkStatus: "none",
          },
          connection: {
            connectionStatus: "disconnected",
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    const header = screen.getByTestId("connection-status");
    expect(header).toHaveAttribute("data-status", "disconnected");
    expect(header).not.toHaveAttribute("data-error-message");
    expect(header).toHaveAttribute("data-deeplink", "none");
  });

  it("renders the connected header when connectionStatus + initializeResult are set", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    // ServerCard renders the server name AND ViewHeader does (in connected
    // mode it shows the serverInfo.name); checking ≥1 occurrence accepts
    // both. The connected toggle being on confirms the connected mode.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("falls back to the catalog name in the header when the reported serverInfo name is empty (#1774)", () => {
    // A non-conforming server reports serverInfo with an empty name string.
    // `App`'s `??` fallback only fires when the whole object is absent, so the
    // header would otherwise render a nameless title. The view degrades to the
    // active server's catalog name ("Alpha") so the header still identifies the
    // server. Scoped to the header (role="banner") to exclude the ServerCard,
    // which shows the catalog name unconditionally.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: {
              ...connectedInit,
              serverInfo: { name: "", version: "1.0.0" },
            },
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    expect(
      within(screen.getByRole("banner")).getByText("Alpha"),
    ).toBeInTheDocument();
  });

  it("falls back to the catalog name in the header when the reported serverInfo name is missing (#1774)", () => {
    // Non-conforming server: `serverInfo` omits `name` entirely (the field is
    // typed non-null). Pins the `?.trim()` tolerance in resolveHeaderServerInfo
    // — a runtime-absent name degrades to the catalog name, it doesn't throw.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: {
              ...connectedInit,
              serverInfo: { version: "1.0.0" } as never,
            },
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    expect(
      within(screen.getByRole("banner")).getByText("Alpha"),
    ).toBeInTheDocument();
  });

  it("falls back to the catalog name in the header when the reported serverInfo name is whitespace-only (#1774)", () => {
    // A whitespace-only reported name ("   ") is the same non-conforming class
    // as an empty string — truthy, so a naive `if (serverInfo.name)` guard would
    // let it through and render a blank-looking title. The `.trim()` guard
    // degrades it to the catalog name like the empty case.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: {
              ...connectedInit,
              serverInfo: { name: "   ", version: "1.0.0" },
            },
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    expect(
      within(screen.getByRole("banner")).getByText("Alpha"),
    ).toBeInTheDocument();
  });

  it("still renders the connected header when the reported name is blank and no catalog entry matches (#1774)", () => {
    // Blank reported name AND no catalog server to borrow from: the connected
    // header must still render (the connection is live) rather than crash or
    // invent a label — it just shows no server name. Asserting the Disconnect
    // control inside the banner makes this a real regression guard for the
    // no-catalog-match branch, not merely a coverage-only test.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "ghost",
            connectionStatus: "connected",
            initializeResult: {
              ...connectedInit,
              serverInfo: { name: "", version: "1.0.0" },
            },
          },
          servers: {
            servers: [],
          },
        })}
      />,
    );
    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("button", { name: "Disconnect from server" }),
    ).toBeInTheDocument();
    // No reported name and nothing to borrow, so the header shows no catalog name.
    expect(within(header).queryByText("ghost")).not.toBeInTheDocument();
  });

  it("surfaces the negotiated protocol version on the active connected card", () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "disconnected",
            initializeResult: undefined,
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: { ...connectedInit, protocolVersion: "" },
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    const user = userEvent.setup({ delay: null });
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Tools"));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Tools")).toBeInTheDocument(),
    );

    rerender(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: undefined,
            connectionStatus: "disconnected",
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "beta",
            connectionStatus: "connected",
            initializeResult: httpInit,
          },
          servers: {
            servers: [httpServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            // No `tools` capability — only logging is advertised.
            initializeResult: initWithCapabilities({ logging: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            // A non-empty tool list must not override the missing capability.
            tools: [{ name: "echo", inputSchema: { type: "object" } }],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ logging: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Logs");
  });

  it("keeps Protocol available regardless of advertised server capabilities", async () => {
    // Protocol is a local client-side log — never gated on server capabilities.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            // Empty capability set: every server-capability tab is hidden.
            initializeResult: initWithCapabilities({}),
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Servers");
    expect(labels).toContain("Protocol");
    expect(labels).not.toContain("Tools");
    expect(labels).not.toContain("Logs");
  });

  it("hides the Apps tab when app tools exist but the server omits the tools capability", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            // Logging only — no tools capability, even though an app tool is
            // present in the (stale/optimistic) list.
            initializeResult: initWithCapabilities({ logging: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [sampleAppTool],
          },
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).not.toContain("Apps");
  });

  it("filters tools to apps and auto-launches a no-fields app on the Apps tab", async () => {
    const user = userEvent.setup({ delay: null });
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [sampleAppTool, plainTool, malformedAppTool],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            // Only a non-app tool — no `_meta.ui.resourceUri`, so appTools is empty.
            tools: [plainTool],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [sampleAppTool],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [plainTool],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [plainTool, sampleAppTool],
          },
        })}
      />,
    );
    await waitFor(async () => {
      radios = await screen.findAllByRole("radio");
      expect(radios.map((r) => r.getAttribute("value"))).toContain("Apps");
    });
  });

  it("deep-link openApp auto-switches to the Apps tab and pre-selects the app once connected", async () => {
    const onSelectApp = vi.fn();
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            deepLink: {
              serverId: "deep-link",
              serverConfig: {
                type: "streamable-http",
                url: "https://example.com/mcp",
              },
              openApp: "ops",
              appArgs: {},
              autoOpen: false,
            },
          },
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [sampleAppTool],
          },
          apps: {
            onSelectApp,
          },
        })}
      />,
    );
    // No click: the effect flips the lifted tab to Apps and seeds the selection.
    expect(await screen.findByText("MCP Apps (1)")).toBeInTheDocument();
    await waitFor(() => expect(onSelectApp).toHaveBeenCalledWith("ops"));
  });

  it("deep-link appArgs are merged over the schema defaults into the pre-filled form", async () => {
    const fieldedAppTool: Tool = {
      name: "cohorts",
      title: "Cohort Data",
      inputSchema: {
        type: "object",
        properties: {
          metric: { type: "string", default: "retention" },
          zip: { type: "string" },
        },
      },
      _meta: { ui: { resourceUri: "ui://apps/cohorts" } },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            deepLink: {
              serverId: "deep-link",
              serverConfig: {
                type: "streamable-http",
                url: "https://example.com/mcp",
              },
              openApp: "cohorts",
              // Overrides no default (zip), leaving `metric`'s schema default intact.
              appArgs: { zip: "10001" },
              autoOpen: false,
            },
          },
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [fieldedAppTool],
          },
        })}
      />,
    );
    // The form is pre-filled: `zip` from appArgs, `metric` from the schema default.
    expect(await screen.findByDisplayValue("10001")).toBeInTheDocument();
    expect(screen.getByDisplayValue("retention")).toBeInTheDocument();
  });

  it("deep-link appArgs select their root-union branch and keep its defaults (#2123)", async () => {
    const unionAppTool: Tool = {
      name: "notify",
      title: "Notify",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string" } },
        anyOf: [
          {
            type: "object",
            properties: {
              kind: { type: "string", const: "email" },
              address: { type: "string" },
              retries: { type: "number", default: 1 },
            },
            required: ["kind", "address"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", const: "sms" },
              phone: { type: "string" },
              retries: { type: "number", default: 3 },
            },
            required: ["kind", "phone"],
          },
        ],
      },
      _meta: { ui: { resourceUri: "ui://apps/notify" } },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            deepLink: {
              serverId: "deep-link",
              serverConfig: {
                type: "streamable-http",
                url: "https://example.com/mcp",
              },
              openApp: "notify",
              // Names the SECOND branch. A shallow default-then-overlay would
              // seed the first branch's fields underneath these values.
              appArgs: { kind: "sms", phone: "555-0100" },
              autoOpen: false,
            },
          },
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [unionAppTool],
          },
        })}
      />,
    );
    // The picker opens on the branch the args describe…
    expect(await screen.findByDisplayValue("555-0100")).toBeInTheDocument();
    // Twice over: the Variant picker names the branch, and the read-only
    // discriminator carries the value that will be submitted.
    expect(screen.getAllByDisplayValue("sms")).toHaveLength(2);
    // …with THAT branch's default, not the first branch's `1`.
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
    // …and nothing from the branch this call is not making.
    expect(screen.queryByRole("textbox", { name: /address/i })).toBeNull();
  });

  it("ignores a deep-link openApp whose tool is not an app (no tab switch)", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          shell: {
            deepLink: {
              serverId: "deep-link",
              serverConfig: {
                type: "streamable-http",
                url: "https://example.com/mcp",
              },
              openApp: "does-not-exist",
              appArgs: {},
              autoOpen: false,
            },
          },
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [sampleAppTool],
          },
        })}
      />,
    );
    // The target app never appears, so the effect never switches tabs: the
    // Apps screen is never activated even though the Apps tab is available.
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toContain("Apps");
    expect(screen.queryByText("MCP Apps (1)")).not.toBeInTheDocument();
  });

  it("snaps activeTab back to Servers when the Apps tab disappears after a refresh", async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [sampleAppTool],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer],
          },
          tools: {
            tools: [],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            // Advertise tools but not prompts.
            initializeResult: initWithCapabilities({ tools: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          prompts: {
            // Content is irrelevant to gating now — even a populated list stays
            // hidden when the capability is absent.
            prompts: [samplePrompt],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ prompts: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          prompts: {
            // No prompts yet — the tab is still available because the server
            // advertises the capability (#1516).
            prompts: [],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          resources: {
            // Populated lists are ignored when the capability is absent.
            resources: [sampleResource],
            resourceTemplates: [
              { uriTemplate: "file:///{path}", name: "Files" },
            ],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ resources: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          resources: {
            resources: [],
            resourceTemplates: [],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          tasks: {
            // An existing task is ignored when the capability is absent.
            tasks: [sampleTask],
          },
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Tasks");
  });

  it("hides the Skills tab when the server declares no skills extension (#2234)", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {} }),
          },
          servers: { servers: [sampleServer] },
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Tools");
    expect(labels).not.toContain("Skills");
  });

  it("shows the Skills tab on a LEGACY connection that declares the extension (#2234)", async () => {
    // Unlike Tasks, Skills is not era-gated: `skills/*` are not spec method
    // names in either codec, so a legacy-era server that declares the
    // extension is serving it and must get the tab.
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            protocolEra: "legacy",
            initializeResult: initWithCapabilities({
              tools: {},
              extensions: { "io.modelcontextprotocol/skills": {} },
            }),
          },
          servers: { servers: [sampleServer] },
        })}
      />,
    );
    const radios = await screen.findAllByRole("radio");
    const labels = radios.map((r) => r.getAttribute("value"));
    expect(labels).toContain("Skills");
  });

  it("shows the Tasks tab when the server advertises tasks even with no tasks yet", async () => {
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tasks: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
          tasks: {
            tasks: [],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {}, tasks: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({ tools: {}, logging: {} }),
          },
          servers: {
            servers: [sampleServer],
          },
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
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
          logs: {
            onSetLogLevel,
          },
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
    const user = userEvent.setup({ delay: null });
    const { unmount } = renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
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
    const user = userEvent.setup({ delay: null });
    window.localStorage.setItem("inspector.sortDirection.protocol", "garbage");
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Protocol"));
    const sortSelect = await screen.findByRole("textbox", {
      name: "History sort direction",
    });
    await waitFor(() => expect(sortSelect).toHaveValue("Newest First"));
  });

  it("persists Protocol list compact state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup({ delay: null });
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
          protocol: {
            protocol: [historyEntry],
          },
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Protocol"));
    // Default is collapsed — ListToggle reads "Expand all".
    await user.click(await screen.findByRole("button", { name: "Expand all" }));

    await waitFor(() =>
      expect(
        window.localStorage.getItem("inspector.listCompact.protocol"),
      ).toBe("false"),
    );

    unmount();
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
          protocol: {
            protocol: [historyEntry],
          },
        })}
      />,
    );
    const tabSelect2 = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect2);
    await user.click(await screen.findByText("Protocol"));
    // After restore the list is expanded, so the ListToggle reads "Collapse all".
    expect(
      await screen.findByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("falls back to collapsed when a corrupted compact value is stored", async () => {
    const user = userEvent.setup({ delay: null });
    window.localStorage.setItem("inspector.listCompact.protocol", "garbage");
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
            latencyMs: 50,
          },
          servers: {
            servers: [sampleServer],
          },
          protocol: {
            protocol: [historyEntry],
          },
        })}
      />,
    );
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    await user.click(await screen.findByText("Protocol"));
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer, betaServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "connected",
            initializeResult: connectedInit,
          },
          servers: {
            servers: [sampleServer, betaServer],
          },
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
          connection: {
            activeServer: "alpha",
            connectionStatus: "error",
            initializeResult: undefined,
          },
          servers: {
            servers: [sampleServer, betaServer],
          },
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
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          servers: {
            servers: [sampleServer],
          },
        })}
      />,
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
    const user = userEvent.setup({ delay: null });
    const httpServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "streamable-http", url: "http://localhost:3000/mcp" },
      connection: { status: "connected" },
    };
    renderWithMantine(
      <StatefulInspectorViewHost
        {...makeProps({
          connection: {
            activeServer: "beta",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({}),
          },
          servers: {
            servers: [httpServer],
          },
          network: {
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
          },
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
          connection: {
            activeServer: "ghost",
            connectionStatus: "connected",
            initializeResult: initWithCapabilities({}),
          },
          servers: {
            servers: [httpServer],
          },
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
      const user = userEvent.setup({ delay: null });
      const tabSelect = await screen.findByDisplayValue("Servers");
      await user.click(tabSelect);
      await user.click(await screen.findByText(tab));
      return user;
    }

    it("routes toolsListChanged to the Tools screen indicator", async () => {
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: connectedInit,
            },
            servers: {
              servers: [sampleServer],
            },
            tools: {
              toolsListChanged: true,
            },
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
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: connectedInit,
            },
            servers: {
              servers: [sampleServer],
            },
            tools: {
              // An app tool is required for the Apps tab to be available — Apps
              // keeps a content check on top of the tools capability (#1516).
              tools: [sampleAppTool],
              toolsListChanged: true,
            },
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
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: connectedInit,
            },
            servers: {
              servers: [sampleServer],
            },
            prompts: {
              // connectedInit advertises prompts, so the tab is available; the
              // prompt populates the screen so the indicator has a list to mark.
              prompts: [samplePrompt],
              promptsListChanged: true,
            },
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
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: connectedInit,
            },
            servers: {
              servers: [sampleServer],
            },
            resources: {
              // connectedInit advertises resources, so the tab is available; the
              // resource populates the screen so the indicator has a list to mark.
              resources: [sampleResource],
              resourcesListChanged: true,
            },
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
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: connectedInit,
            },
            servers: {
              servers: [sampleServer],
            },
            tools: {
              // Tools changed, but Prompts did not — the Prompts screen must
              // stay quiet.
              toolsListChanged: true,
            },
            prompts: {
              // connectedInit advertises prompts, so the Prompts tab is available.
              prompts: [samplePrompt],
              promptsListChanged: false,
            },
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

  describe("pinned monitoring sidebar (#1616)", () => {
    const httpServer: ServerEntry = {
      id: "beta",
      name: "Beta",
      config: { type: "streamable-http", url: "http://localhost:3000/mcp" },
      connection: { status: "connected" },
    };
    const httpInit = initWithCapabilities(allCapabilities);

    function connectedHttp(overrides: PropOverrides = {}) {
      return makeProps(
        {
          connection: {
            activeServer: "beta",
            connectionStatus: "connected",
            initializeResult: httpInit,
          },
          servers: {
            servers: [httpServer],
          },
        },
        overrides,
      );
    }

    async function gotoTab(tab: string) {
      const user = userEvent.setup();
      const tabSelect = await screen.findByDisplayValue("Servers");
      await user.click(tabSelect);
      await user.click(await screen.findByText(tab));
      return user;
    }

    it("shows the header monitoring toggle when connected with monitor tabs", async () => {
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        await screen.findByRole("button", { name: "Open monitoring sidebar" }),
      ).toBeInTheDocument();
    });

    it("hides the header monitoring toggle when there is no connected or failed server", () => {
      // Disconnected, wide viewport: nothing to monitor, so no toggle appears.
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Open monitoring sidebar" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    it("opens the monitoring sidebar when a connection is established", async () => {
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      // Disconnected: the column is closed.
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();

      // Connecting opens it (the disconnected → connected transition).
      rerender(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();
    });

    it("does not auto-open on a mount that starts already connected", () => {
      // No disconnected → connected transition, and no stored preference, so the
      // column stays closed (a user who closed it isn't fought on remount).
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    // A failed connect leaves the errored server's id set but no
    // initializeResult (capabilities were never negotiated). `erroredServerId`
    // is the parent's connect-attempt-failure signal (it survives the failure's
    // `disconnect` clearing `activeServer`), which gates the failure column.
    function failedHttp(overrides: PropOverrides = {}) {
      return makeProps(
        {
          connection: {
            activeServer: "beta",
            erroredServerId: "beta",
            connectionStatus: "error",
            initializeResult: undefined,
          },
          servers: {
            servers: [httpServer],
          },
        },
        overrides,
      );
    }

    it("opens the monitoring sidebar on a failed connection attempt (#1621)", async () => {
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      // Disconnected: the column is closed.
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();

      // A connection failure (→ error) opens it to surface the diagnostics. The
      // failed HTTP request is what captured the failure, so Network is present.
      rerender(
        <StatefulInspectorViewHost
          {...failedHttp({
            network: {
              network: [
                {
                  id: "f1",
                  timestamp: new Date(),
                  method: "POST",
                  url: "http://localhost:3000/mcp",
                  requestHeaders: {},
                  error: "fetch failed: ECONNREFUSED",
                  category: "transport",
                },
              ],
            },
          })}
        />,
      );
      expect(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();

      // The failure column leads with Network (the captured request) — the only
      // diagnostic with content. Protocol is content-gated and empty here (the
      // message log clears on the error transition), so it isn't offered; nor is
      // Logs (no logging capability was negotiated) or Console (HTTP has no
      // child-process stderr).
      expect(screen.getByRole("radio", { name: "Network" })).toBeChecked();
      expect(screen.queryByRole("radio", { name: "Protocol" })).toBeNull();
      expect(screen.queryByRole("radio", { name: "Logs" })).toBeNull();
      expect(screen.queryByRole("radio", { name: "Console" })).toBeNull();
    });

    // An OAuth failure is torn down by the parent, so the session rests at
    // "disconnected" rather than "error" — the status gate the failure column
    // used to carry never saw it, and the requests explaining the failure were
    // unreachable (#2108). The parent's `erroredServerId` is the signal instead.
    it("opens the monitoring sidebar to Network when OAuth fails without an error status (#2108)", async () => {
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "beta",
              connectionStatus: "connecting",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();

      rerender(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              // The failure's teardown clears the active server and settles the
              // session at "disconnected" — never "error".
              activeServer: undefined,
              erroredServerId: "beta",
              connectionStatus: "disconnected",
              initializeResult: undefined,
            },
            servers: {
              servers: [httpServer],
            },
            network: {
              network: [
                {
                  id: "a1",
                  timestamp: new Date(),
                  method: "GET",
                  url: "https://as.example.com/.well-known/oauth-authorization-server",
                  requestHeaders: {},
                  responseStatus: 404,
                  responseStatusText: "Not Found",
                  category: "auth",
                },
              ],
            },
          })}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Network" })).toBeChecked();
    });

    it("does not re-open the sidebar on a mount that starts already flagged (#2108)", () => {
      // Same props as the failure above, but as the *initial* render: there is
      // no transition, so a user who closed the column isn't fought on remount.
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              erroredServerId: "beta",
              connectionStatus: "disconnected",
              initializeResult: undefined,
            },
            servers: {
              servers: [httpServer],
            },
            network: {
              network: [
                {
                  id: "a1",
                  timestamp: new Date(),
                  method: "GET",
                  url: "https://as.example.com/.well-known/oauth-authorization-server",
                  requestHeaders: {},
                  responseStatus: 404,
                  responseStatusText: "Not Found",
                  category: "auth",
                },
              ],
            },
          })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    it("surfaces Console (stderr), not Network, in the failure column for a stdio server (#1621)", async () => {
      const stdioErr: ServerEntry = {
        id: "beta",
        name: "Beta",
        config: { type: "stdio", command: "missing-bin" },
        connection: { status: "disconnected" },
      };
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [stdioErr],
            },
          })}
        />,
      );
      rerender(
        <StatefulInspectorViewHost
          {...failedHttp({
            connection: {
              // A connect failure fires the client `disconnect` event, which
              // clears activeServer — so the failure column must key off captured
              // stderr, NOT the (now-undefined) active server's transport.
              activeServer: undefined,
            },
            servers: {
              servers: [stdioErr],
            },
            console: {
              stderrLogs: [
                { timestamp: new Date(), message: "ModuleNotFoundError: boom" },
              ],
            },
          })}
        />,
      );
      // The captured stderr means it was a stdio launch: the column leads with
      // Console (the process's stderr) — that's where the spawn error is — with
      // no Network (no HTTP traffic) and no Protocol (content-gated, empty on a
      // fresh failure). The stderr line renders.
      expect(
        await screen.findByRole("radio", { name: "Console" }),
      ).toBeChecked();
      expect(screen.queryByRole("radio", { name: "Protocol" })).toBeNull();
      expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
      expect(screen.getByText("ModuleNotFoundError: boom")).toBeInTheDocument();
    });

    it("leads with Console even when the stored tab was Protocol, on a stdio failure (#1621)", async () => {
      // Regression for the review note: a returning user whose last-pinned tab
      // was Protocol must still land on the Console diagnostic, not the (empty)
      // Protocol — Protocol is content-gated out of the failure column.
      window.localStorage.setItem("inspector.monitor.tab", "Protocol");
      const stdioErr: ServerEntry = {
        id: "beta",
        name: "Beta",
        config: { type: "stdio", command: "missing-bin" },
        connection: { status: "disconnected" },
      };
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [stdioErr],
            },
          })}
        />,
      );
      rerender(
        <StatefulInspectorViewHost
          {...failedHttp({
            connection: {
              activeServer: undefined,
            },
            servers: {
              servers: [stdioErr],
            },
            console: {
              stderrLogs: [
                { timestamp: new Date(), message: "ModuleNotFoundError: boom" },
              ],
            },
          })}
        />,
      );
      expect(
        await screen.findByRole("radio", { name: "Console" }),
      ).toBeChecked();
      expect(screen.queryByRole("radio", { name: "Protocol" })).toBeNull();
    });

    it("keeps the failure column closed until a diagnostic has content (#1621)", () => {
      // A connect failure with nothing captured yet (no stderr, no fetch, and
      // Protocol cleared on the error transition) opens onto nothing — so the
      // column stays closed rather than showing an empty pane.
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      rerender(
        <StatefulInspectorViewHost
          {...failedHttp({
            protocol: {
              protocol: [],
            },
            network: {
              network: [],
            },
            console: {
              stderrLogs: [],
            },
          })}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    it("offers Protocol in the failure column when it has captured content (#1621)", async () => {
      // The failure Protocol tab is content-gated, so when the message log *does*
      // hold entries it's offered alongside the diagnostic (Network here).
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      rerender(
        <StatefulInspectorViewHost
          {...failedHttp({
            protocol: {
              protocol: [
                {
                  id: "h1",
                  timestamp: new Date(),
                  direction: "request",
                  message: { jsonrpc: "2.0", id: 1, method: "initialize" },
                },
              ],
            },
            network: {
              network: [
                {
                  id: "f1",
                  timestamp: new Date(),
                  method: "POST",
                  url: "http://localhost:3000/mcp",
                  requestHeaders: {},
                  error: "boom",
                  category: "transport",
                },
              ],
            },
          })}
        />,
      );
      expect(
        await screen.findByRole("radio", { name: "Network" }),
      ).toBeChecked();
      expect(
        screen.getByRole("radio", { name: "Protocol" }),
      ).toBeInTheDocument();
    });

    it("does not auto-open on a mount that starts already errored (#1621)", () => {
      // No transition into error, and no stored preference, so the column stays
      // closed — a user who closed it isn't fought on remount.
      renderWithMantine(<StatefulInspectorViewHost {...failedHttp()} />);
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    it("does not treat a mid-session crash as a connect-attempt failure (#1621)", async () => {
      // A previously-connected server that crashes settles to `error` too, but
      // with no `erroredServerId` (the parent sets that only for connect
      // attempts). That must NOT reorganize the column into the failure tab set
      // — it closes like any session teardown, so a user who closed the column
      // mid-session isn't reopened onto diagnostics.
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost {...connectedHttp()} />,
      );
      // Connected + pinned: the column is open with the live monitor tabs.
      expect(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();

      // Crash: connected → error, activeServer cleared, NO erroredServerId.
      rerender(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "error",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      // The column closes (after its slide-out) rather than switching to the
      // failure tabs.
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Close monitoring sidebar" }),
        ).toBeNull(),
      );
    });

    const stdioServer: ServerEntry = {
      id: "gamma",
      name: "Gamma",
      config: { type: "stdio", command: "echo" },
      connection: { status: "connected" },
    };

    it("offers Console (not Network) as a monitor tab for a connected stdio server (#1621)", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "gamma",
              connectionStatus: "connected",
              initializeResult: httpInit,
            },
            servers: {
              servers: [stdioServer],
            },
            console: {
              stderrLogs: [
                { timestamp: new Date(), message: "server booting" },
              ],
            },
          })}
        />,
      );
      // Pinned column for a stdio server hosts Logs/Protocol/Console — never
      // Network (no HTTP traffic to show).
      expect(
        await screen.findByRole("radio", { name: "Console" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: "Protocol" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
    });

    it("lists Console in the header tab menu for a connected stdio server when unpinned (#1621)", async () => {
      // Column not pinned, so the monitor group (incl. Console) lives in the
      // header menu — the user can reach the stderr stream during a live
      // session, not only on failure.
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "gamma",
              connectionStatus: "connected",
              initializeResult: httpInit,
            },
            servers: {
              servers: [stdioServer],
            },
          })}
        />,
      );
      const header = screen.getByRole("banner");
      expect(
        within(header).getByRole("radio", { name: "Console" }),
      ).toBeInTheDocument();
      // stdio: Network is not in the header menu.
      expect(
        within(header).queryByRole("radio", { name: "Network" }),
      ).toBeNull();
    });

    it("pins the monitor group into the column and removes it from the header", async () => {
      const user = userEvent.setup();
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      await user.click(
        await screen.findByRole("button", { name: "Open monitoring sidebar" }),
      );

      // Column is open (its close control is present).
      expect(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();

      // The monitor group is gone from the header tab bar...
      const header = screen.getByRole("banner");
      expect(within(header).queryByRole("radio", { name: "Logs" })).toBeNull();
      expect(
        within(header).queryByRole("radio", { name: "Protocol" }),
      ).toBeNull();
      expect(
        within(header).queryByRole("radio", { name: "Network" }),
      ).toBeNull();
      // Tasks (#1680) joins the monitor group, so it also leaves the header
      // (the server advertises the `tasks` capability via allCapabilities).
      expect(within(header).queryByRole("radio", { name: "Tasks" })).toBeNull();
      // ...and a non-monitor tab still sits in the header.
      expect(
        within(header).getByRole("radio", { name: "Tools" }),
      ).toBeInTheDocument();

      // The column hosts the monitor tabs, defaulting to the pinned one.
      expect(screen.getByRole("radio", { name: "Logs" })).toBeChecked();
      expect(
        screen.getByRole("radio", { name: "Network" }),
      ).toBeInTheDocument();
      // Tasks is available as a column panel.
      expect(screen.getByRole("radio", { name: "Tasks" })).toBeInTheDocument();
    });

    it("returns the monitor group to the header when the column is closed", async () => {
      const user = userEvent.setup();
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      await user.click(
        await screen.findByRole("button", { name: "Open monitoring sidebar" }),
      );
      await user.click(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      );

      // The column plays its slide-out animation before unmounting.
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Close monitoring sidebar" }),
        ).toBeNull(),
      );
      const header = screen.getByRole("banner");
      expect(
        within(header).getByRole("radio", { name: "Logs" }),
      ).toBeInTheDocument();
    });

    it("keeps the current header screen (not the column's) when closed", async () => {
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      // Navigate the primary onto a monitor tab (Logs) first, then open the
      // column — which moves the monitor group out of the header, so the primary
      // clamps to the first non-Servers header tab (Tools).
      const user = await gotoTab("Logs");
      await user.click(
        await screen.findByRole("button", { name: "Open monitoring sidebar" }),
      );
      // Pinning moved the primary to the first non-Servers header tab (Tools).
      const header = screen.getByRole("banner");
      expect(
        within(header).getByRole("radio", { name: "Tools" }),
      ).toBeChecked();

      // Switch the column to Protocol, then close it.
      await user.click(await screen.findByRole("radio", { name: "Protocol" }));
      await user.click(
        await screen.findByRole("button", { name: "Close monitoring sidebar" }),
      );

      // The primary stays on the header's current screen (Tools), not the
      // column's Protocol, and the monitor group returns to the header.
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Close monitoring sidebar" }),
        ).toBeNull(),
      );
      expect(
        within(header).getByRole("radio", { name: "Tools" }),
      ).toBeChecked();
      expect(
        within(header).getByRole("radio", { name: "Protocol" }),
      ).toBeInTheDocument();
    });

    it("reopens the column from the stored pin preference", () => {
      // A stored preference from a prior session reopens the column on load.
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        screen.getByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();
    });

    it("keeps the column closed when the stored preference is explicitly false", () => {
      window.localStorage.setItem("inspector.monitor.pinned", "false");
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      expect(
        screen.queryByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeNull();
    });

    it("hides the column on disconnect but keeps the pin preference", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      const { rerender } = renderWithMantine(
        <StatefulInspectorViewHost {...connectedHttp()} />,
      );
      expect(
        screen.getByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();

      rerender(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: undefined,
              connectionStatus: "disconnected",
            },
            servers: {
              servers: [httpServer],
            },
          })}
        />,
      );
      // The column plays its slide-out animation before unmounting.
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Close monitoring sidebar" }),
        ).toBeNull(),
      );
      // Preference is untouched — only the column's close button clears it.
      expect(window.localStorage.getItem("inspector.monitor.pinned")).toBe(
        "true",
      );
    });

    it("drops Network from the column tabs for a stdio server", () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: initWithCapabilities(allCapabilities),
            },
            servers: {
              servers: [sampleServer],
            },
          })}
        />,
      );
      // Column open, but Network is unavailable over stdio.
      expect(
        screen.getByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Logs" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
    });

    it("falls back to an available tab when the stored monitor tab is unavailable", () => {
      // Stored tab is Network, but a stdio + logging-only server can't offer it.
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      window.localStorage.setItem("inspector.monitor.tab", "Network");
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: initWithCapabilities({ logging: {} }),
            },
            servers: {
              servers: [sampleServer],
            },
          })}
        />,
      );
      // Column active tab clamps to the first available monitor tab (Logs).
      expect(screen.getByRole("radio", { name: "Logs" })).toBeChecked();
      expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
    });

    it("clamps the primary tab to Servers when the header has no other tab", () => {
      // stdio + logging only ⇒ availableTabs = [Servers, Logs, Protocol]; pinning
      // moves both monitor tabs out, leaving [Servers] as the only header tab.
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      renderWithMantine(
        <StatefulInspectorViewHost
          {...makeProps({
            connection: {
              activeServer: "alpha",
              connectionStatus: "connected",
              initializeResult: initWithCapabilities({ logging: {} }),
            },
            servers: {
              servers: [sampleServer],
            },
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
        screen.getByRole("button", { name: "Close monitoring sidebar" }),
      ).toBeInTheDocument();
    });

    it("persists the selected column tab", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      const user = userEvent.setup();
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      await user.click(await screen.findByRole("radio", { name: "Protocol" }));
      await waitFor(() =>
        expect(window.localStorage.getItem("inspector.monitor.tab")).toBe(
          "Protocol",
        ),
      );
    });

    it("keeps the column search across tabs and filters each screen", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      const user = userEvent.setup();
      renderWithMantine(
        <StatefulInspectorViewHost
          {...connectedHttp({
            logs: {
              logs: [
                {
                  receivedAt: new Date(),
                  params: { level: "info", data: "loghello" },
                },
              ],
            },
            protocol: {
              protocol: [
                {
                  id: "h1",
                  timestamp: new Date(),
                  direction: "request",
                  message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
                },
              ],
            },
          })}
        />,
      );
      // Column defaults to Logs; the log entry shows.
      expect(await screen.findByText("loghello")).toBeInTheDocument();

      // A search matching nothing filters the Logs stream...
      const searchBox = screen.getByRole("textbox", { name: "Search" });
      await user.type(searchBox, "zzz");
      expect(screen.queryByText("loghello")).toBeNull();

      // ...and the same term carries over to Protocol (still filtered → empty).
      await user.click(screen.getByRole("radio", { name: "Protocol" }));
      expect(screen.getByText("No request history")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue(
        "zzz",
      );
    });

    it("resizes and persists the column width from the keyboard", async () => {
      window.localStorage.setItem("inspector.monitor.pinned", "true");
      window.localStorage.setItem("inspector.monitor.width", "420");
      renderWithMantine(<StatefulInspectorViewHost {...connectedHttp()} />);
      const handle = await screen.findByRole("separator", {
        name: "Resize monitoring sidebar",
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
