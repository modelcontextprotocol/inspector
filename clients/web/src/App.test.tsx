import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { UrlElicitationLoopError } from "@inspector/core/mcp/urlElicitation.js";
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
    callToolStream = vi
      .fn()
      .mockResolvedValue({ success: true, result: { acts: [] } });
    cancelRequestorTask = vi.fn().mockResolvedValue(undefined);
    getPrompt = vi.fn().mockResolvedValue({ result: { messages: [] } });
    readResource = vi
      .fn()
      .mockResolvedValue({ result: { contents: [] }, timestamp: 1 });
    setLoggingLevel = vi.fn().mockResolvedValue(undefined);
    listTools = vi.fn().mockResolvedValue({ tools: [] });
    listPrompts = vi.fn().mockResolvedValue({ prompts: [] });
    listResources = vi.fn().mockResolvedValue({ resources: [] });
    listResourceTemplates = vi
      .fn()
      .mockResolvedValue({ resourceTemplates: [] });
    listRequestorTasks = vi.fn().mockResolvedValue({ tasks: [] });
    ping = vi.fn().mockResolvedValue(undefined);
    getOAuthState = vi.fn().mockReturnValue(undefined);
    getPendingSamples = vi.fn().mockReturnValue([]);
    getPendingElicitations = vi.fn().mockReturnValue([]);
    getRoots = vi.fn().mockReturnValue([]);
    setRoots = vi.fn().mockResolvedValue(undefined);
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
  useManagedRequestorTasks: vi.fn(() => ({
    tasks: [],
    refresh: vi.fn().mockResolvedValue([]),
    clearCompleted: vi.fn(),
  })),
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
    // `draft` is widened so tests can override the return with a populated
    // settings draft via `mockReturnValue` (the roots live-apply-on-close path).
    draft: undefined as InspectorServerSettings | undefined,
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
    toolsUi?: {
      selectedToolName?: string;
      formValues: Record<string, unknown>;
      search: string;
    };
    promptsUi?: {
      selectedPromptName?: string;
      argumentValues: Record<string, string>;
      submittedFor?: string;
      search: string;
    };
    logsUi?: { filterText: string; visibleLevels: Record<string, boolean> };
    getPromptState?: { status?: string };
    readResourceState?: { status?: string };
    currentLogLevel?: string;
    onToggleConnection: (id: string) => void;
    onToolsUiChange: (next: {
      selectedToolName?: string;
      formValues: Record<string, unknown>;
      search: string;
    }) => void;
    onPromptsUiChange: (next: {
      selectedPromptName?: string;
      argumentValues: Record<string, string>;
      submittedFor?: string;
      search: string;
    }) => void;
    onLogsUiChange: (next: {
      filterText: string;
      visibleLevels: Record<string, boolean>;
    }) => void;
    progressByTaskId?: Record<string, unknown>;
    onCallTool: (
      name: string,
      args: Record<string, unknown>,
      runAsTask?: boolean,
    ) => void;
    onGetPrompt: (name: string, args: Record<string, string>) => void;
    onReadResource: (uri: string) => void;
    onSetLogLevel: (level: string) => void;
    onCancelTask: (taskId: string) => void;
    onClearCompletedTasks: () => void;
    onRefreshTasks: () => void;
    onServerSettings: (id: string) => void;
    onReplayHistory: (id: string) => void;
    onTogglePinHistory: (id: string) => void;
    pinnedHistoryIds?: Set<string>;
  }) => (
    <div>
      <span data-testid="tool-status">
        {props.toolCallState?.status ?? "none"}
      </span>
      <span data-testid="task-progress-keys">
        {Object.keys(props.progressByTaskId ?? {}).join(",") || "none"}
      </span>
      <span data-testid="selected-tool">
        {props.toolsUi?.selectedToolName ?? "none"}
      </span>
      <span data-testid="tool-search">{props.toolsUi?.search || "none"}</span>
      <span data-testid="selected-prompt">
        {props.promptsUi?.selectedPromptName ?? "none"}
      </span>
      <span data-testid="log-filter">{props.logsUi?.filterText || "none"}</span>
      <span data-testid="prompt-status">
        {props.getPromptState?.status ?? "none"}
      </span>
      <span data-testid="resource-status">
        {props.readResourceState?.status ?? "none"}
      </span>
      <span data-testid="log-level">{props.currentLogLevel}</span>
      <button onClick={() => props.onToggleConnection("A")}>connect</button>
      <button
        onClick={() =>
          props.onToolsUiChange({
            formValues: {},
            search: "",
            ...props.toolsUi,
            selectedToolName: "get_acts",
          })
        }
      >
        select-tool
      </button>
      <button
        onClick={() =>
          props.onToolsUiChange({
            formValues: {},
            search: "",
            ...props.toolsUi,
            selectedToolName: "other_tool",
          })
        }
      >
        select-other-tool
      </button>
      <button
        onClick={() =>
          props.onToolsUiChange({
            formValues: {},
            ...props.toolsUi,
            search: "act",
          })
        }
      >
        set-tool-search
      </button>
      <button
        onClick={() =>
          props.onPromptsUiChange({
            argumentValues: {},
            search: "",
            ...props.promptsUi,
            selectedPromptName: "greet",
          })
        }
      >
        select-prompt
      </button>
      <button
        onClick={() =>
          props.onLogsUiChange({
            visibleLevels: {},
            ...props.logsUi,
            filterText: "err",
          })
        }
      >
        set-log-filter
      </button>
      <button onClick={() => props.onCallTool("get_acts", {})}>call</button>
      <button onClick={() => props.onCallTool("get_acts", {}, true)}>
        call-as-task
      </button>
      <button onClick={() => props.onCancelTask("task-1")}>cancel-task</button>
      <button onClick={() => props.onClearCompletedTasks()}>
        clear-completed
      </button>
      <button onClick={() => props.onRefreshTasks()}>refresh-tasks</button>
      <button onClick={() => props.onGetPrompt("greet", {})}>get-prompt</button>
      <button onClick={() => props.onReadResource("res://x")}>
        read-resource
      </button>
      <button onClick={() => props.onSetLogLevel("debug")}>set-level</button>
      <button onClick={() => props.onServerSettings("A")}>open-settings</button>
      <span data-testid="pinned-history">
        {Array.from(props.pinnedHistoryIds ?? []).join(",")}
      </span>
      <button onClick={() => props.onTogglePinHistory("hist-1")}>
        toggle-pin
      </button>
      <button onClick={() => props.onReplayHistory("hist-1")}>
        replay-history
      </button>
    </div>
  ),
}));

import App from "./App";
import * as McpIndex from "@inspector/core/mcp/index.js";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import { useSettingsDraft } from "@inspector/core/react/useSettingsDraft.js";
import type {
  InspectorServerSettings,
  MessageEntry,
} from "@inspector/core/mcp/types.js";

// Default useInspectorClient return — capabilities empty (no task tool calls).
// Individual tests override via vi.mocked(...).mockReturnValue(...).
const DEFAULT_USE_INSPECTOR_CLIENT: ReturnType<typeof useInspectorClient> = {
  status: "connected",
  capabilities: {},
  clientCapabilities: {},
  serverInfo: undefined,
  instructions: undefined,
  appRendererClient: null,
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

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

  it("drops the previous tool's result when a different tool is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // Select a tool and run it so the result panel is populated.
    await user.click(screen.getByText("select-tool"));
    await user.click(screen.getByText("call"));
    await waitFor(() =>
      expect(screen.getByTestId("tool-status")).toHaveTextContent("ok"),
    );

    // Selecting a *different* tool clears the stale result so it doesn't linger
    // under the new selection.
    await user.click(screen.getByText("select-other-tool"));
    await waitFor(() => {
      expect(screen.getByTestId("selected-tool")).toHaveTextContent(
        "other_tool",
      );
      expect(screen.getByTestId("tool-status")).toHaveTextContent("none");
    });
  });

  it("keeps the result when the same tool stays selected (search/form edits)", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("select-tool"));
    await user.click(screen.getByText("call"));
    await waitFor(() =>
      expect(screen.getByTestId("tool-status")).toHaveTextContent("ok"),
    );

    // A search keystroke leaves `selectedToolName` unchanged, so the result
    // stays put.
    await user.click(screen.getByText("set-tool-search"));
    await waitFor(() =>
      expect(screen.getByTestId("tool-search")).toHaveTextContent("act"),
    );
    expect(screen.getByTestId("tool-status")).toHaveTextContent("ok");
  });
});

describe("App tool progress toasts", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    notificationsMock.show.mockClear();
    notificationsMock.update.mockClear();
    notificationsMock.hide.mockClear();
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

  it("dismisses still-visible progress toasts when the client is torn down", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("progressNotification", {
          detail: { progress: 1, total: 4 },
        }),
      );
    });
    const id = notificationsMock.show.mock.calls[0][0].id;

    // Tearing down the client (here via unmount; same path as a server swap)
    // hides the live toast so it can't linger into — or race with — the next
    // session, rather than waiting out its auto-close window.
    unmount();
    expect(notificationsMock.hide).toHaveBeenCalledWith(id);
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

describe("App task wiring", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    notificationsMock.show.mockClear();
    notificationsMock.update.mockClear();
    notificationsMock.hide.mockClear();
    // Restore the default task-hook return between tests that override it.
    vi.mocked(useManagedRequestorTasks).mockReturnValue({
      tasks: [],
      refresh: vi.fn().mockResolvedValue([]),
      clearCompleted: vi.fn(),
    });
    // Restore the default capabilities (no task tool calls) between tests.
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  it("routes a Run-as-task call through callToolStream with the server's TTL", async () => {
    // onCallTool only task-augments when the server advertises task tool calls.
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      capabilities: { tasks: { requests: { tools: { call: {} } } } },
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("call-as-task"));

    const client = clientInstances[0] as unknown as {
      callToolStream: ReturnType<typeof vi.fn>;
      callTool: ReturnType<typeof vi.fn>;
    };
    await waitFor(() => expect(client.callToolStream).toHaveBeenCalledTimes(1));
    expect(client.callTool).not.toHaveBeenCalled();
    // 5th arg is the task options; TTL falls back to the 60000 default since
    // SERVER_A has no `settings.taskTtl`.
    expect(client.callToolStream.mock.calls[0][4]).toEqual({ ttl: 60000 });
  });

  it("does NOT task-augment when the server lacks task-tool-call support", async () => {
    // Default capabilities (no tasks.requests.tools.call). A stale run-as-task
    // request must fall back to the normal callTool path, never callToolStream.
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("call-as-task"));

    const client = clientInstances[0] as unknown as {
      callToolStream: ReturnType<typeof vi.fn>;
      callTool: ReturnType<typeof vi.fn>;
    };
    await waitFor(() => expect(client.callTool).toHaveBeenCalledTimes(1));
    expect(client.callToolStream).not.toHaveBeenCalled();
  });

  it("surfaces a cancel failure as a red toast", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    (
      clientInstances[0] as unknown as {
        cancelRequestorTask: ReturnType<typeof vi.fn>;
      }
    ).cancelRequestorTask.mockRejectedValueOnce(new Error("nope"));

    await user.click(screen.getByText("cancel-task"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to cancel task",
          color: "red",
        }),
      ),
    );
  });

  it("shows a URL-elicitation toast when a tool call fails with a no-list -32042", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    (
      clientInstances[0] as unknown as {
        callTool: ReturnType<typeof vi.fn>;
      }
    ).callTool.mockRejectedValueOnce(
      new McpError(
        ErrorCode.UrlElicitationRequired,
        "This request requires browser-based authorization.",
      ),
    );

    await user.click(screen.getByText("call"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "URL elicitation required",
          color: "yellow",
        }),
      ),
    );
  });

  it("shows a loop toast when a tool call aborts on a repeated URL elicitation", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    (
      clientInstances[0] as unknown as {
        callTool: ReturnType<typeof vi.fn>;
      }
    ).callTool.mockRejectedValueOnce(
      new UrlElicitationLoopError("https://example.com/authorize"),
    );

    await user.click(screen.getByText("call"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "URL elicitation loop",
          color: "yellow",
        }),
      ),
    );
  });

  it("surfaces a refresh failure as a red toast", async () => {
    vi.mocked(useManagedRequestorTasks).mockReturnValue({
      tasks: [],
      refresh: vi.fn().mockRejectedValue(new Error("list boom")),
      clearCompleted: vi.fn(),
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("refresh-tasks"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to refresh tasks",
          color: "red",
        }),
      ),
    );
  });

  it("clear-completed calls through to the hook's clearCompleted", async () => {
    const clearCompleted = vi.fn();
    vi.mocked(useManagedRequestorTasks).mockReturnValue({
      tasks: [],
      refresh: vi.fn().mockResolvedValue([]),
      clearCompleted,
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("clear-completed"));
    expect(clearCompleted).toHaveBeenCalledTimes(1);
  });

  it("shows a task-status toast, updates it, and hides it on terminal status", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // First status → a fresh toast keyed by the task id.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("taskStatusChange", {
          detail: {
            taskId: "task-1",
            task: { status: "working", statusMessage: "Interpreting" },
          },
        }),
      );
    });
    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    const shown = notificationsMock.show.mock.calls[0][0];
    expect(shown.title).toBe("Task working");
    expect(shown.message).toBe("Interpreting");

    // Next status on the same task → the existing toast is updated, not stacked.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("taskStatusChange", {
          detail: {
            taskId: "task-1",
            task: { status: "working", statusMessage: "Still going" },
          },
        }),
      );
    });
    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    expect(notificationsMock.update).toHaveBeenCalledTimes(1);

    // Terminal status → the toast is hidden.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("taskStatusChange", {
          detail: {
            taskId: "task-1",
            task: { status: "completed", statusMessage: "Done" },
          },
        }),
      );
    });
    expect(notificationsMock.hide).toHaveBeenCalledWith(shown.id);
  });

  it("builds progressByTaskId from requestorTaskProgress and prunes it on terminal status", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    expect(screen.getByTestId("task-progress-keys")).toHaveTextContent("none");

    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("requestorTaskProgress", {
          detail: {
            taskId: "task-1",
            progress: { progress: 2, total: 5, message: "Halfway" },
          },
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("task-progress-keys")).toHaveTextContent(
        "task-1",
      ),
    );

    // A terminal task update prunes the entry.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("requestorTaskUpdated", {
          detail: {
            taskId: "task-1",
            task: { status: "completed", statusMessage: "Done" },
          },
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("task-progress-keys")).toHaveTextContent(
        "none",
      ),
    );
  });
});

// Live-apply roots on settings-dialog close: the App diffs the final draft
// roots against what the connected client advertises and calls `setRoots`
// once (not per keystroke), and only for the active server. App.tsx is
// excluded from the coverage gate, but the acceptance criterion ("editing
// roots on a live connection notifies the server on dialog close") lives
// here, so it's worth a direct test of the gate/diff/notify path.
type RootsFakeClient = EventTarget & {
  setRoots: ReturnType<typeof vi.fn>;
  getRoots: ReturnType<typeof vi.fn>;
};

const settingsWithRoots = (
  roots: InspectorServerSettings["roots"],
): InspectorServerSettings => ({
  headers: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  roots,
});

describe("App roots live-apply on settings-dialog close", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  afterEach(() => {
    // Restore the default empty draft so the override doesn't leak.
    vi.mocked(useSettingsDraft).mockReturnValue({
      draft: undefined,
      onChange: vi.fn(),
      flush: vi.fn(),
    });
  });

  async function openSettingsForConnectedServer(
    draft: InspectorServerSettings,
  ): Promise<RootsFakeClient> {
    vi.mocked(useSettingsDraft).mockReturnValue({
      draft,
      onChange: vi.fn(),
      flush: vi.fn(),
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    await user.click(screen.getByText("open-settings"));
    await waitFor(() =>
      expect(screen.getByText("Server Settings")).toBeInTheDocument(),
    );
    return clientInstances[0] as RootsFakeClient;
  }

  async function closeModal(user: ReturnType<typeof userEvent.setup>) {
    const closeBtn = document.querySelector(
      "button.mantine-CloseButton-root",
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    await user.click(closeBtn!);
  }

  it("calls setRoots once with cleaned roots when roots changed on the active server", async () => {
    const user = userEvent.setup();
    const client = await openSettingsForConnectedServer(
      // A blank-uri row (left mid-edit) must be dropped; the named root kept.
      settingsWithRoots([{ uri: "file:///x", name: "X" }, { uri: "" }]),
    );
    // Client currently advertises no roots → the draft differs → notify.
    client.getRoots.mockReturnValue([]);

    await closeModal(user);

    await waitFor(() => expect(client.setRoots).toHaveBeenCalledTimes(1));
    expect(client.setRoots).toHaveBeenCalledWith([
      { uri: "file:///x", name: "X" },
    ]);
  });

  it("does not call setRoots when the cleaned roots match what the client advertises", async () => {
    const user = userEvent.setup();
    const client = await openSettingsForConnectedServer(
      settingsWithRoots([{ uri: "file:///x" }]),
    );
    // Same roots already advertised → no notification on close.
    client.getRoots.mockReturnValue([{ uri: "file:///x" }]);

    await closeModal(user);

    // Let any close-handler microtasks settle, then assert no notification.
    await waitFor(() =>
      expect(screen.queryByText("Server Settings")).not.toBeInTheDocument(),
    );
    expect(client.setRoots).not.toHaveBeenCalled();
  });
});

describe("App history pin/replay", () => {
  const replayableEntry: MessageEntry = {
    id: "hist-1",
    timestamp: new Date("2026-06-06T22:00:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_acts", arguments: { city: "SF" } },
    },
  };

  beforeEach(() => {
    clientInstances.length = 0;
    notificationsMock.show.mockClear();
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
    vi.mocked(useMessageLog).mockReturnValue({ messages: [] });
  });

  it("toggles a pinned history id and passes the set down to the view", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    expect(screen.getByTestId("pinned-history")).toHaveTextContent("");
    await user.click(screen.getByText("toggle-pin"));
    expect(screen.getByTestId("pinned-history")).toHaveTextContent("hist-1");
    await user.click(screen.getByText("toggle-pin"));
    expect(screen.getByTestId("pinned-history")).toHaveTextContent("");
  });

  it("replays a tools/call entry by re-issuing callTool with the recorded args", async () => {
    vi.mocked(useMessageLog).mockReturnValue({ messages: [replayableEntry] });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    const client = clientInstances[0] as unknown as {
      callTool: ReturnType<typeof vi.fn>;
    };
    await waitFor(() => expect(client.callTool).toHaveBeenCalledTimes(1));
    expect(client.callTool.mock.calls[0][1]).toEqual({ city: "SF" });
  });

  it("replays a tools/list entry via listTools, preserving the cursor", async () => {
    vi.mocked(useMessageLog).mockReturnValue({
      messages: [
        {
          ...replayableEntry,
          message: {
            jsonrpc: "2.0",
            id: 6,
            method: "tools/list",
            params: { cursor: "page-2" },
          },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    const client = clientInstances[0] as unknown as {
      listTools: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(client.listTools).toHaveBeenCalledWith("page-2"),
    );
  });

  it("replays a tasks/list entry via listRequestorTasks", async () => {
    vi.mocked(useMessageLog).mockReturnValue({
      messages: [
        {
          ...replayableEntry,
          message: { jsonrpc: "2.0", id: 7, method: "tasks/list" },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    const client = clientInstances[0] as unknown as {
      listRequestorTasks: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(client.listRequestorTasks).toHaveBeenCalledTimes(1),
    );
  });

  it("toasts when replaying an unsupported method", async () => {
    vi.mocked(useMessageLog).mockReturnValue({
      messages: [
        {
          ...replayableEntry,
          message: {
            jsonrpc: "2.0",
            id: 2,
            method: "logging/setLevel",
            params: { level: "debug" },
          },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Can't replay", color: "yellow" }),
      ),
    );
  });

  it("replays a prompts/get entry via getPrompt", async () => {
    vi.mocked(useMessageLog).mockReturnValue({
      messages: [
        {
          ...replayableEntry,
          message: {
            jsonrpc: "2.0",
            id: 3,
            method: "prompts/get",
            params: { name: "greet", arguments: { who: "x" } },
          },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    const client = clientInstances[0] as unknown as {
      getPrompt: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(client.getPrompt).toHaveBeenCalledWith("greet", { who: "x" }),
    );
  });

  it("replays a resources/read entry via readResource", async () => {
    vi.mocked(useMessageLog).mockReturnValue({
      messages: [
        {
          ...replayableEntry,
          message: {
            jsonrpc: "2.0",
            id: 4,
            method: "resources/read",
            params: { uri: "res://x" },
          },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    const client = clientInstances[0] as unknown as {
      readResource: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(client.readResource).toHaveBeenCalledWith("res://x"),
    );
  });

  it("toasts when the replayed tool is no longer available", async () => {
    vi.mocked(useMessageLog).mockReturnValue({
      messages: [
        {
          ...replayableEntry,
          message: {
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "gone", arguments: {} },
          },
        },
      ],
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("replay-history"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Can't replay", color: "yellow" }),
      ),
    );
  });
});
