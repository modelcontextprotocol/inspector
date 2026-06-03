import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderWithMantine,
  screen,
  waitFor,
  act,
} from "./test/renderWithMantine";
import userEvent from "@testing-library/user-event";

// Spy on the toast layer so the progress-notification tests can assert the
// show/update calls without mounting Mantine's <Notifications/> portal.
// `vi.hoisted` lets the mock factory (hoisted above imports) reach the spies.
const { notificationsMock } = vi.hoisted(() => ({
  notificationsMock: {
    show: vi.fn(),
    update: vi.fn(),
    hide: vi.fn(),
    clean: vi.fn(),
  },
}));
vi.mock("@mantine/notifications", () => ({
  notifications: notificationsMock,
}));

// App is a wiring component: it owns session-scoped UI state (the per-call
// result panels and the optimistic log level) and resets it when the active
// InspectorClient emits `disconnect`. These tests exercise that reset in
// isolation by mocking the InspectorClient (a fake EventTarget we can fire
// `disconnect` on), the per-server state managers, the core hooks, and the
// InspectorView (a thin double that surfaces the props under test and lets us
// trigger the handlers). See #1368.

// --- Fake InspectorClient ---------------------------------------------------
// Extends EventTarget so the App's `addEventListener("disconnect", …)` wiring
// is real; the test fires `dispatchEvent(new Event("disconnect"))` to simulate
// any of the three disconnect paths (toggle, header button, transport failure).
vi.mock("@inspector/core/mcp/index.js", () => {
  class FakeInspectorClient extends EventTarget {
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    callTool = vi
      .fn()
      .mockResolvedValue({ success: true, result: { acts: [] } });
    getPrompt = vi.fn().mockResolvedValue({ result: { messages: [] } });
    readResource = vi
      .fn()
      .mockResolvedValue({ result: { contents: [] }, timestamp: 1 });
    setLoggingLevel = vi.fn().mockResolvedValue(undefined);
    getOAuthState = vi.fn().mockReturnValue(undefined);
    getPendingSamples = vi.fn().mockReturnValue([]);
    getPendingElicitations = vi.fn().mockReturnValue([]);
  }
  const instances: FakeInspectorClient[] = [];
  return {
    InspectorClient: vi.fn(function () {
      const client = new FakeInspectorClient();
      instances.push(client);
      return client;
    }),
    // Test-only handle so the test can grab the live instance and fire events.
    __clientInstances: instances,
  };
});

// Per-server state managers — App constructs nine of them per connect and
// calls `destroy()` on teardown. Replace each with a no-op constructor.
vi.mock("@inspector/core/mcp/state/managedToolsState.js", () => ({
  ManagedToolsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedPromptsState.js", () => ({
  ManagedPromptsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedResourcesState.js", () => ({
  ManagedResourcesState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedResourceTemplatesState.js", () => ({
  ManagedResourceTemplatesState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/managedRequestorTasksState.js", () => ({
  ManagedRequestorTasksState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/resourceSubscriptionsState.js", () => ({
  ResourceSubscriptionsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/messageLogState.js", () => ({
  MessageLogState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/fetchRequestLogState.js", () => ({
  FetchRequestLogState: vi.fn(function () {
    return { destroy: vi.fn(), getFetchRequests: vi.fn(() => []) };
  }),
}));
vi.mock("@inspector/core/mcp/state/stderrLogState.js", () => ({
  StderrLogState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));

vi.mock("@inspector/core/mcp/remote/index.js", () => ({
  RemoteInspectorClientStorage: vi.fn(function () {
    return { saveSession: vi.fn() };
  }),
}));

vi.mock("./lib/environmentFactory", () => ({
  createWebEnvironment: vi.fn(() => ({ environment: {} })),
}));

// --- Core hooks -------------------------------------------------------------
// One server is available; the tools list carries the `get_acts` tool the
// repro runs. Everything else returns empty.
const SERVER_A = {
  id: "A",
  name: "PlotRocket",
  config: { type: "stdio", command: "node" },
  connection: { status: "disconnected" },
};

vi.mock("@inspector/core/react/useServers.js", () => ({
  useServers: vi.fn(() => ({
    servers: [SERVER_A],
    addServer: vi.fn(),
    updateServer: vi.fn(),
    updateServerSettings: vi.fn(),
    removeServer: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useInspectorClient.js", () => ({
  useInspectorClient: vi.fn(() => ({
    status: "connected",
    capabilities: {},
    clientCapabilities: {},
    // Left undefined so `initializeResult` stays undefined and the
    // ConnectionInfoModal (gated on it) never mounts during the test.
    serverInfo: undefined,
    instructions: undefined,
  })),
}));
vi.mock("@inspector/core/react/useManagedTools.js", () => ({
  useManagedTools: vi.fn(() => ({
    tools: [{ name: "get_acts", inputSchema: { type: "object" } }],
    refresh: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useManagedPrompts.js", () => ({
  useManagedPrompts: vi.fn(() => ({ prompts: [], refresh: vi.fn() })),
}));
vi.mock("@inspector/core/react/useManagedResources.js", () => ({
  useManagedResources: vi.fn(() => ({ resources: [], refresh: vi.fn() })),
}));
vi.mock("@inspector/core/react/useManagedResourceTemplates.js", () => ({
  useManagedResourceTemplates: vi.fn(() => ({ resourceTemplates: [] })),
}));
vi.mock("@inspector/core/react/useManagedRequestorTasks.js", () => ({
  useManagedRequestorTasks: vi.fn(() => ({ tasks: [], refresh: vi.fn() })),
}));
vi.mock("@inspector/core/react/useResourceSubscriptions.js", () => ({
  useResourceSubscriptions: vi.fn(() => ({ subscriptions: [] })),
}));
vi.mock("@inspector/core/react/useMessageLog.js", () => ({
  useMessageLog: vi.fn(() => ({ messages: [] })),
}));
vi.mock("@inspector/core/react/useFetchRequestLog.js", () => ({
  useFetchRequestLog: vi.fn(() => ({ fetchRequests: [] })),
}));
vi.mock("@inspector/core/react/useSettingsDraft.js", () => ({
  useSettingsDraft: vi.fn(() => ({
    draft: undefined,
    onChange: vi.fn(),
    flush: vi.fn(),
  })),
}));

// --- InspectorView double ---------------------------------------------------
// Surfaces each piece of session-scoped state under test and exposes buttons
// that invoke the App's connect / call-tool / get-prompt / read-resource /
// set-log-level handlers.
vi.mock("./components/views/InspectorView/InspectorView", () => ({
  InspectorView: (props: {
    toolCallState?: { status?: string };
    selectedToolName?: string;
    toolSearch?: string;
    selectedPromptName?: string;
    logFilterText?: string;
    getPromptState?: { status?: string };
    readResourceState?: { status?: string };
    currentLogLevel?: string;
    onToggleConnection: (id: string) => void;
    onSelectTool: (name: string) => void;
    onToolSearchChange: (value: string) => void;
    onSelectedPromptNameChange: (value: string | undefined) => void;
    onLogFilterChange: (value: string) => void;
    onCallTool: (name: string, args: Record<string, unknown>) => void;
    onGetPrompt: (name: string, args: Record<string, string>) => void;
    onReadResource: (uri: string) => void;
    onSetLogLevel: (level: string) => void;
  }) => (
    <div>
      <span data-testid="tool-status">
        {props.toolCallState?.status ?? "none"}
      </span>
      <span data-testid="selected-tool">
        {props.selectedToolName ?? "none"}
      </span>
      <span data-testid="tool-search">{props.toolSearch || "none"}</span>
      <span data-testid="selected-prompt">
        {props.selectedPromptName ?? "none"}
      </span>
      <span data-testid="log-filter">{props.logFilterText || "none"}</span>
      <span data-testid="prompt-status">
        {props.getPromptState?.status ?? "none"}
      </span>
      <span data-testid="resource-status">
        {props.readResourceState?.status ?? "none"}
      </span>
      <span data-testid="log-level">{props.currentLogLevel}</span>
      <button onClick={() => props.onToggleConnection("A")}>connect</button>
      <button onClick={() => props.onSelectTool("get_acts")}>
        select-tool
      </button>
      <button onClick={() => props.onToolSearchChange("act")}>
        set-tool-search
      </button>
      <button onClick={() => props.onSelectedPromptNameChange("greet")}>
        select-prompt
      </button>
      <button onClick={() => props.onLogFilterChange("err")}>
        set-log-filter
      </button>
      <button onClick={() => props.onCallTool("get_acts", {})}>call</button>
      <button onClick={() => props.onGetPrompt("greet", {})}>get-prompt</button>
      <button onClick={() => props.onReadResource("res://x")}>
        read-resource
      </button>
      <button onClick={() => props.onSetLogLevel("debug")}>set-level</button>
    </div>
  ),
}));

import App from "./App";
import * as McpIndex from "@inspector/core/mcp/index.js";

const clientInstances = (
  McpIndex as unknown as { __clientInstances: EventTarget[] }
).__clientInstances;

describe("App session-scoped state reset on disconnect", () => {
  beforeEach(() => {
    clientInstances.length = 0;
  });

  it("clears the per-call panels and resets the log level on client disconnect", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    // Connect: builds the InspectorClient and registers the disconnect listener.
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // Fill all three per-call panels with their (resolved) results.
    await user.click(screen.getByText("call"));
    await user.click(screen.getByText("get-prompt"));
    await user.click(screen.getByText("read-resource"));
    await waitFor(() => {
      expect(screen.getByTestId("tool-status")).toHaveTextContent("ok");
      expect(screen.getByTestId("prompt-status")).toHaveTextContent("ok");
      expect(screen.getByTestId("resource-status")).toHaveTextContent("ok");
    });

    // Set App-owned per-screen UI state (selection + search + filter) — all of
    // it persists across navigation, so all of it must reset on disconnect
    // (#1417). A representative sample across screens exercises the shared
    // `resetSessionScopedUiState` wiring.
    await user.click(screen.getByText("select-tool"));
    await user.click(screen.getByText("set-tool-search"));
    await user.click(screen.getByText("select-prompt"));
    await user.click(screen.getByText("set-log-filter"));
    await waitFor(() => {
      expect(screen.getByTestId("selected-tool")).toHaveTextContent("get_acts");
      expect(screen.getByTestId("tool-search")).toHaveTextContent("act");
      expect(screen.getByTestId("selected-prompt")).toHaveTextContent("greet");
      expect(screen.getByTestId("log-filter")).toHaveTextContent("err");
    });

    // Bump the optimistic log level off its "info" default.
    await user.click(screen.getByText("set-level"));
    await waitFor(() =>
      expect(screen.getByTestId("log-level")).toHaveTextContent("debug"),
    );

    // Disconnect: every panel empties, all per-screen UI state clears, and the
    // level returns to "info".
    act(() => {
      clientInstances[0].dispatchEvent(new Event("disconnect"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("tool-status")).toHaveTextContent("none");
      expect(screen.getByTestId("prompt-status")).toHaveTextContent("none");
      expect(screen.getByTestId("resource-status")).toHaveTextContent("none");
    });
    expect(screen.getByTestId("selected-tool")).toHaveTextContent("none");
    expect(screen.getByTestId("tool-search")).toHaveTextContent("none");
    expect(screen.getByTestId("selected-prompt")).toHaveTextContent("none");
    expect(screen.getByTestId("log-filter")).toHaveTextContent("none");
    expect(screen.getByTestId("log-level")).toHaveTextContent("info");
  });

  it("persists the selected tool across navigation within a live session", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // The selection lives in App (not the unmounting ToolsScreen), so once set
    // it stays put through re-renders / tab switches until the session ends.
    await user.click(screen.getByText("select-tool"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-tool")).toHaveTextContent("get_acts"),
    );
  });
});

describe("App tool progress toasts", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    notificationsMock.show.mockClear();
    notificationsMock.update.mockClear();
  });

  it("shows a toast on the first progress tick and updates it on later ticks", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // First tick of a progress stream → a fresh toast keyed by its stream id.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("progressNotification", {
          detail: { progress: 1, total: 4, message: "Working" },
        }),
      );
    });
    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    const shown = notificationsMock.show.mock.calls[0][0];
    expect(shown.title).toBe("Tool progress");
    expect(shown.message).toBe("Working — 1 / 4 (25%)");

    // Second tick on the same stream → the existing toast is updated, not
    // stacked, so a chatty server doesn't flood the corner.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("progressNotification", {
          detail: { progress: 2, total: 4, message: "Working" },
        }),
      );
    });
    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    expect(notificationsMock.update).toHaveBeenCalledTimes(1);
    expect(notificationsMock.update.mock.calls[0][0].message).toBe(
      "Working — 2 / 4 (50%)",
    );
  });

  it("formats a totalless progress tick as the bare count", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("progressNotification", {
          detail: { progress: 7 },
        }),
      );
    });
    expect(notificationsMock.show.mock.calls[0][0].message).toBe("7");
  });
});

describe("App pending server-initiated request modal", () => {
  beforeEach(() => {
    clientInstances.length = 0;
  });

  it("opens the modal on a pending sample, resolves it, and closes", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // The usePendingClientRequests hook subscribes to the live client's
    // `pendingSamplesChange` event; firing it drives the App-owned modal that
    // InspectorView does not render. Mirrors how the client enqueues a
    // server-initiated sampling request mid tool-call.
    const respond = vi.fn().mockResolvedValue(undefined);
    const sample = {
      id: "sample-1",
      request: {
        params: {
          messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
          maxTokens: 256,
        },
      },
      respond,
      reject: vi.fn(),
    };
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("pendingSamplesChange", { detail: [sample] }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText("Sampling Request")).toBeInTheDocument(),
    );

    // Resolving via the modal calls the queued request's respond() — this is
    // what unblocks the originating call (the "spinner clears" criterion).
    await user.click(screen.getByRole("button", { name: "Auto-respond" }));
    expect(respond).toHaveBeenCalledTimes(1);

    // The client clearing its queue (empty event) closes the modal.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("pendingSamplesChange", { detail: [] }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByText("Sampling Request")).not.toBeInTheDocument(),
    );
  });
});
