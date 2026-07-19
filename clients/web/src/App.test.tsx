import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProtocolErrorCode, ProtocolError } from "@modelcontextprotocol/client";
import { UrlElicitationLoopError } from "@inspector/core/mcp/urlElicitation.js";
import { ToolCallCancelledError } from "@inspector/core/mcp/toolCallCancelledError.js";
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

// Shared spy for MessageLogState.clearMessages so a test can inspect the
// predicate the panel Clear passes (keep-pinned vs clear-all).
const { messageLogClear } = vi.hoisted(() => ({ messageLogClear: vi.fn() }));

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
vi.mock("@inspector/core/mcp/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/mcp/index.js")>();
  // When set, the next `connect()` rejects with this value (one-shot), so a test
  // can exercise the handshake-failure path. Cleared after it fires.
  let nextConnectRejection: unknown = null;
  class FakeInspectorClient extends EventTarget {
    connect = vi.fn(() => {
      if (nextConnectRejection !== null) {
        const err = nextConnectRejection;
        nextConnectRejection = null;
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });
    disconnect = vi.fn().mockResolvedValue(undefined);
    callTool = vi
      .fn()
      .mockResolvedValue({ success: true, result: { acts: [] } });
    callToolStream = vi
      .fn()
      .mockResolvedValue({ success: true, result: { acts: [] } });
    cancelRequestorTask = vi.fn().mockResolvedValue(undefined);
    cancelToolCall = vi.fn().mockReturnValue(true);
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
    getOAuthFlowState = vi.fn().mockReturnValue(undefined);
    getOAuthState = vi.fn().mockResolvedValue(undefined);
    getPendingSamples = vi.fn().mockReturnValue([]);
    getPendingElicitations = vi.fn().mockReturnValue([]);
    getRoots = vi.fn().mockReturnValue([]);
    setRoots = vi.fn().mockResolvedValue(undefined);
    setServerSettings = vi.fn();
    resumeAfterOAuth = vi.fn().mockResolvedValue(undefined);
    checkAuthChallengeSatisfied = vi.fn().mockResolvedValue(true);
  }
  const instances: FakeInspectorClient[] = [];
  return {
    ...actual,
    InspectorClient: vi.fn(function () {
      const client = new FakeInspectorClient();
      instances.push(client);
      return client;
    }),
    // Test-only handle so the test can grab the live instance and fire events.
    __clientInstances: instances,
    // Test-only: arm the next connect() to reject (handshake-failure path).
    __rejectNextConnect: (err: unknown) => {
      nextConnectRejection = err;
    },
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
    return { destroy: vi.fn(), clearMessages: messageLogClear };
  }),
}));
// Extends EventTarget so the App's `fetchRequestBodyDropped` subscription is
// real; the test fires `dispatchEvent(new CustomEvent("fetchRequestBodyDropped",
// { detail }))` on the tracked instance to drive the body-dropped toast.
vi.mock("@inspector/core/mcp/state/fetchRequestLogState.js", () => {
  class FakeFetchRequestLogState extends EventTarget {
    destroy = vi.fn();
    getFetchRequests = vi.fn(() => []);
    setMaxFetchRequests = vi.fn();
  }
  const instances: FakeFetchRequestLogState[] = [];
  return {
    FetchRequestLogState: vi.fn(function () {
      const inst = new FakeFetchRequestLogState();
      instances.push(inst);
      return inst;
    }),
    __fetchLogInstances: instances,
  };
});
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

// Stable spy so tests can assert the sidebar single-page toggle persisted the
// `singlePageLists` setting (#1721). `vi.hoisted` so it exists when the hoisted
// `vi.mock` factory closes over it.
const { updateServerSettingsSpy } = vi.hoisted(() => ({
  updateServerSettingsSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock("@inspector/core/react/useServers.js", () => ({
  useServers: vi.fn(() => ({
    servers: [SERVER_A],
    addServer: vi.fn(),
    updateServer: vi.fn(),
    updateServerSettings: updateServerSettingsSpy,
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
  useManagedResourceTemplates: vi.fn(() => ({
    resourceTemplates: [],
    refresh: vi.fn(),
  })),
}));
// Paged (single-page) hooks + state managers (#1721). Mirrors the managed
// mocks: the hooks return an empty accumulated list and a resolving loadPage so
// usePaginatedList runs without a real transport; the state classes are no-op
// constructors App still instantiates/destroys per connect.
vi.mock("@inspector/core/react/usePagedTools.js", () => ({
  usePagedTools: vi.fn(() => ({
    tools: [],
    nextCursor: undefined,
    pageCount: 0,
    loadPage: vi.fn(() =>
      Promise.resolve({ tools: [], nextCursor: undefined }),
    ),
    clear: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/usePagedPrompts.js", () => ({
  usePagedPrompts: vi.fn(() => ({
    prompts: [],
    nextCursor: undefined,
    pageCount: 0,
    loadPage: vi.fn(() =>
      Promise.resolve({ prompts: [], nextCursor: undefined }),
    ),
    clear: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/usePagedResources.js", () => ({
  usePagedResources: vi.fn(() => ({
    resources: [],
    nextCursor: undefined,
    pageCount: 0,
    loadPage: vi.fn(() =>
      Promise.resolve({ resources: [], nextCursor: undefined }),
    ),
    clear: vi.fn(),
  })),
}));
vi.mock("@inspector/core/mcp/state/pagedToolsState.js", () => ({
  PagedToolsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/pagedPromptsState.js", () => ({
  PagedPromptsState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
}));
vi.mock("@inspector/core/mcp/state/pagedResourcesState.js", () => ({
  PagedResourcesState: vi.fn(function () {
    return { destroy: vi.fn() };
  }),
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
vi.mock("@inspector/core/react/useStderrLog.js", () => ({
  useStderrLog: vi.fn(() => ({ stderrLogs: [] })),
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
    activeTab?: string;
    erroredServerId?: string;
    onActiveTabChange: (tab: string) => void;
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
    onCancelToolCall: () => void;
    onClearCompletedTasks: () => void;
    onRefreshTasks: () => void;
    onServerSettings: (id: string) => void;
    onClearProtocol: () => void;
    onReplayProtocol: (id: string) => void;
    onTogglePinProtocol: (id: string) => void;
    pinnedProtocolIds?: Set<string>;
    onRefreshTools: () => void;
    toolsPagination: {
      singlePage: boolean;
      canLoadMore: boolean;
      loadedPages: number;
      onSinglePageChange: (v: boolean) => void;
      onLoadMore: () => void;
    };
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
      <span data-testid="active-tab">{props.activeTab ?? "none"}</span>
      <span data-testid="errored-server">
        {props.erroredServerId ?? "none"}
      </span>
      <button onClick={() => props.onActiveTabChange("Servers")}>
        switch-servers-tab
      </button>
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
      <button onClick={() => props.onCancelToolCall()}>cancel-tool-call</button>
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
        {Array.from(props.pinnedProtocolIds ?? []).join(",")}
      </span>
      <button onClick={() => props.onTogglePinProtocol("hist-1")}>
        toggle-pin
      </button>
      <button onClick={() => props.onReplayProtocol("hist-1")}>
        replay-history
      </button>
      <button onClick={() => props.onClearProtocol()}>clear-history</button>
      <span data-testid="tools-single-page">
        {String(props.toolsPagination.singlePage)}
      </span>
      <span data-testid="tools-loaded-pages">
        {props.toolsPagination.loadedPages}
      </span>
      <button onClick={() => props.toolsPagination.onSinglePageChange(true)}>
        single-page-on
      </button>
      <button onClick={() => props.toolsPagination.onSinglePageChange(false)}>
        single-page-off
      </button>
      <button onClick={() => props.toolsPagination.onLoadMore()}>
        load-more-tools
      </button>
      <button onClick={() => props.onRefreshTools()}>refresh-tools</button>
    </div>
  ),
}));

import App from "./App";
import { OAUTH_CALLBACK_PATH } from "./utils/oauthFlow.js";
import { INSPECTOR_SERVERS_TAB } from "./utils/inspectorTabs.js";
import {
  readOAuthResumeSnapshot,
  writeOAuthResumeSnapshot,
  type OAuthResumeSnapshot,
} from "./utils/oauthResume.js";
import * as McpIndex from "@inspector/core/mcp/index.js";
import * as FetchLogModule from "@inspector/core/mcp/state/fetchRequestLogState.js";
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

const rejectNextConnect = (
  McpIndex as unknown as { __rejectNextConnect: (err: unknown) => void }
).__rejectNextConnect;

const fetchLogInstances = (
  FetchLogModule as unknown as { __fetchLogInstances: EventTarget[] }
).__fetchLogInstances;

describe("App failed-connection card border (#1621)", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  it("flags the server whose connect attempt fails as erroredServerId", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    expect(screen.getByTestId("errored-server")).toHaveTextContent("none");

    // Arm the next connect() to reject with a plain (non-auth) handshake error.
    rejectNextConnect(new Error("spawn failed"));
    await user.click(screen.getByText("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );
  });

  it("clears the flag when a new connection attempt starts", async () => {
    // Report status "error" so the *second* connect click is treated as a fresh
    // attempt (not a disconnect of a live session), exercising the clear.
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      status: "error",
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);

    rejectNextConnect(new Error("spawn failed"));
    await user.click(screen.getByText("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );

    // A new attempt (this one resolves) clears the red-border flag.
    await user.click(screen.getByText("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("none"),
    );
  });
});

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

describe("App network-log body-dropped toast", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    fetchLogInstances.length = 0;
    notificationsMock.show.mockClear();
    notificationsMock.hide.mockClear();
  });

  it("shows a deduped toast when the fetch log emits fetchRequestBodyDropped", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(fetchLogInstances).toHaveLength(1));

    act(() => {
      fetchLogInstances[0].dispatchEvent(
        new CustomEvent("fetchRequestBodyDropped", {
          detail: { id: "req-1", maxFetchRequests: 1000 },
        }),
      );
    });

    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    const shown = notificationsMock.show.mock.calls[0][0];
    expect(shown.title).toBe("Network log: response body dropped");
    // Stable per-server id + no auto-close so a storm dedupes into one toast.
    expect(typeof shown.id).toBe("string");
    expect(shown.autoClose).toBe(false);
  });

  it("opens the settings modal (Options/Network Log Size) from the toast link", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(fetchLogInstances).toHaveLength(1));

    act(() => {
      fetchLogInstances[0].dispatchEvent(
        new CustomEvent("fetchRequestBodyDropped", {
          detail: { id: "req-1", maxFetchRequests: 500 },
        }),
      );
    });

    // The toast message is a React node carrying the "Adjust" link; render it
    // and click the link to exercise the onAdjust handler (hide toast + open
    // settings modal for the active server).
    const message = notificationsMock.show.mock.calls[0][0].message;
    renderWithMantine(message);
    await user.click(
      screen.getByRole("button", {
        name: /Adjust Network Log Size for this server/,
      }),
    );

    expect(notificationsMock.hide).toHaveBeenCalled();
    // The settings modal is now open on the Options section, showing the field.
    await waitFor(() =>
      expect(screen.getByLabelText(/Network Log Size/)).toBeInTheDocument(),
    );
  });
});

describe("App mid-session error toast", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    notificationsMock.show.mockClear();
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  afterEach(() => {
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  it("toasts the lastError with a generic title when no server is active", () => {
    // `lastError` is set but nothing has been connected, so the active-server
    // name ref is empty and the toast falls back to "Connection lost".
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      lastError: "stdio subprocess crashed",
    });
    renderWithMantine(<App />);

    expect(notificationsMock.show).toHaveBeenCalledTimes(1);
    const shown = notificationsMock.show.mock.calls[0][0];
    expect(shown.title).toBe("Connection lost");
    expect(shown.message).toBe("stdio subprocess crashed");
    expect(shown.color).toBe("red");
  });

  it("names the active server in the toast after a session has connected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    // Connect first so the active-server name ref is populated with SERVER_A.
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // The transport now dies mid-session: `lastError` becomes set and the
    // client's `disconnect` event clears the active server. The name ref
    // survives, so the toast still names the server (PlotRocket).
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      lastError: "SSE stream dropped",
    });
    act(() => {
      clientInstances[0].dispatchEvent(new CustomEvent("disconnect"));
    });

    await waitFor(() => expect(notificationsMock.show).toHaveBeenCalled());
    const shown = notificationsMock.show.mock.calls.at(-1)?.[0];
    expect(shown.title).toBe('Connection to "PlotRocket" lost');
    expect(shown.message).toBe("SSE stream dropped");
    expect(shown.color).toBe("red");
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
    await user.click(screen.getByRole("button", { name: "Send Response" }));
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

  it("cancels the underlying task when a task-augmented tool call is cancelled", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const client = clientInstances[0] as unknown as {
      cancelRequestorTask: ReturnType<typeof vi.fn>;
    };

    // callToolStream surfaces the created task's id via `toolCallTaskUpdated`
    // mid-call; App stashes it so Cancel knows which task to cancel (#1455).
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("toolCallTaskUpdated", {
          detail: { taskId: "task-42", task: { taskId: "task-42" } },
        }),
      );
    });

    await user.click(screen.getByText("cancel-tool-call"));

    expect(client.cancelRequestorTask).toHaveBeenCalledWith("task-42");
  });

  it("does not re-cancel on a rapid second Cancel click", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const client = clientInstances[0] as unknown as {
      cancelRequestorTask: ReturnType<typeof vi.fn>;
    };

    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("toolCallTaskUpdated", {
          detail: { taskId: "task-42", task: { taskId: "task-42" } },
        }),
      );
    });

    // Two clicks before the call resolves must cancel only once — the second
    // finds the ref already cleared, avoiding a spurious cancel of a terminal
    // task.
    await user.click(screen.getByText("cancel-tool-call"));
    await user.click(screen.getByText("cancel-tool-call"));

    expect(client.cancelRequestorTask).toHaveBeenCalledTimes(1);
  });

  it("aborts the request (not a task) when an ordinary tool call is cancelled", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const client = clientInstances[0] as unknown as {
      cancelRequestorTask: ReturnType<typeof vi.fn>;
      cancelToolCall: ReturnType<typeof vi.fn>;
    };

    // A stale task id from an earlier task call...
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("toolCallTaskUpdated", {
          detail: { taskId: "old-task", task: { taskId: "old-task" } },
        }),
      );
    });
    // ...is cleared when a new ordinary call starts, so Cancel routes to the
    // request-abort path (notifications/cancelled), not the task API (#1458).
    await user.click(screen.getByText("call"));
    await waitFor(() =>
      expect(screen.getByTestId("tool-status")).toHaveTextContent("ok"),
    );

    await user.click(screen.getByText("cancel-tool-call"));

    expect(client.cancelToolCall).toHaveBeenCalledTimes(1);
    expect(client.cancelRequestorTask).not.toHaveBeenCalled();
  });

  it("clears the executing state and toasts when a cancelled call rejects", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // The aborted call rejects with ToolCallCancelledError (the SDK already sent
    // notifications/cancelled). App treats that as a clean cancel, not a failure.
    (
      clientInstances[0] as unknown as {
        callTool: ReturnType<typeof vi.fn>;
      }
    ).callTool.mockRejectedValueOnce(new ToolCallCancelledError("get_acts"));

    await user.click(screen.getByText("call"));

    // The result panel returns to idle (no error state)...
    await waitFor(() =>
      expect(screen.getByTestId("tool-status")).toHaveTextContent("none"),
    );
    // ...and a confirmation toast acknowledges the cancellation.
    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tool call cancelled" }),
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
      new ProtocolError(
        ProtocolErrorCode.UrlElicitationRequired,
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

  it("shows a 'Task cancelled' toast when a task is cancelled", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // No live status toast for this task — cancellation shows a fresh one.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("taskCancelled", { detail: { taskId: "task-1" } }),
      );
    });

    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Task cancelled", color: "gray" }),
    );
  });

  it("converts a running task's live toast into the cancellation toast", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    // A running task has an open "Task working" toast...
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
    const liveId = notificationsMock.show.mock.calls[0][0].id;
    notificationsMock.show.mockClear();

    // ...which the cancel replaces in place (update), not a stacked toast.
    act(() => {
      clientInstances[0].dispatchEvent(
        new CustomEvent("taskCancelled", { detail: { taskId: "task-1" } }),
      );
    });

    expect(notificationsMock.show).not.toHaveBeenCalled();
    expect(notificationsMock.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: liveId, title: "Task cancelled" }),
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
  env: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
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

  it("panel Clear removes unpinned history but keeps pinned entries", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("toggle-pin"));
    expect(screen.getByTestId("pinned-history")).toHaveTextContent("hist-1");

    messageLogClear.mockClear();
    await user.click(screen.getByText("clear-history"));

    expect(messageLogClear).toHaveBeenCalledTimes(1);
    const predicate = messageLogClear.mock.calls[0][0] as (m: {
      id: string;
    }) => boolean;
    // The predicate is "should remove?" — pinned survives (false), unpinned is
    // removed (true).
    expect(predicate({ id: "hist-1" })).toBe(false);
    expect(predicate({ id: "other" })).toBe(true);
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

// The `/oauth/callback` handler must reject a returned `state` that does not
// parse to the expected 64-char-hex authId shape (a forgery indicator) instead
// of silently proceeding. See #1562.
describe("App OAuth callback state validation", () => {
  const originalUrl = window.location.href;

  beforeEach(() => {
    notificationsMock.show.mockClear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.history.replaceState({}, "", originalUrl);
  });

  it("rejects an unparseable state param with a clear error toast", async () => {
    window.history.replaceState(
      {},
      "",
      "/oauth/callback?code=abc123&state=not-a-valid-state",
    );

    renderWithMantine(<App />);

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "OAuth callback rejected",
          color: "red",
        }),
      ),
    );
  });

  it("does not reject when the state param parses to a valid authId", async () => {
    // A well-formed 64-char-hex state passes the shape guard, so the handler
    // proceeds to the server-matching step. With the resume snapshot pointing at
    // a server id that is not registered, that step surfaces the "could not be
    // matched" toast — asserting on that specific downstream toast proves the
    // state was accepted (never the "OAuth callback rejected" toast) rather than
    // relying on an indirect "some toast fired" check.
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "server-that-does-not-exist",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: {},
    });
    window.history.replaceState(
      {},
      "",
      `/oauth/callback?code=abc123&state=${"a".repeat(64)}`,
    );

    renderWithMantine(<App />);

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "OAuth callback could not be matched",
        }),
      ),
    );
    expect(notificationsMock.show).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "OAuth callback rejected" }),
    );
  });
});

describe("App OAuth resume lifecycle", () => {
  const storage = new Map<string, string>();

  const writeTestOAuthSnapshot = (
    overrides?: Partial<OAuthResumeSnapshot>,
  ): void => {
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "A",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: {},
      ...overrides,
    });
  };

  beforeEach(() => {
    clientInstances.length = 0;
    storage.clear();
    notificationsMock.show.mockClear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("preserves the OAuth resume snapshot when the transport disconnects", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    writeTestOAuthSnapshot();

    await user.click(screen.getByText("select-tool"));
    await waitFor(() =>
      expect(screen.getByTestId("selected-tool")).toHaveTextContent("get_acts"),
    );

    act(() => {
      clientInstances[0].dispatchEvent(new Event("disconnect"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("selected-tool")).toHaveTextContent("none"),
    );
    expect(readOAuthResumeSnapshot()?.serverId).toBe("A");
  });

  it("preserves the OAuth resume snapshot when reconnect rebuilds the client", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    writeTestOAuthSnapshot();

    act(() => {
      clientInstances[0].dispatchEvent(new Event("disconnect"));
    });

    expect(readOAuthResumeSnapshot()?.serverId).toBe("A");

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(2));
    expect(readOAuthResumeSnapshot()?.serverId).toBe("A");
  });

  it("clears the OAuth resume snapshot on explicit disconnect toggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    writeTestOAuthSnapshot();
    expect(readOAuthResumeSnapshot()?.serverId).toBe("A");

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(readOAuthResumeSnapshot()).toBeUndefined());
  });

  it("matches the OAuth callback to the pending server when a resume snapshot exists", async () => {
    writeTestOAuthSnapshot();
    window.history.replaceState({}, "", `${OAUTH_CALLBACK_PATH}?code=test`);

    renderWithMantine(<App />);

    await waitFor(() => expect(clientInstances).toHaveLength(1));
    const client = clientInstances[0] as unknown as {
      resumeAfterOAuth: ReturnType<typeof vi.fn>;
    };
    await waitFor(() =>
      expect(client.resumeAfterOAuth).toHaveBeenCalledWith(
        "test",
        expect.any(Object),
      ),
    );

    expect(readOAuthResumeSnapshot()).toBeUndefined();
    expect(
      notificationsMock.show.mock.calls.some(
        ([args]) => args.title === "OAuth callback could not be matched",
      ),
    ).toBe(false);
  });

  it("does not restore a stale tab after callback consume and reconnect", async () => {
    writeTestOAuthSnapshot({ activeTab: "Tools" });
    window.history.replaceState({}, "", `${OAUTH_CALLBACK_PATH}?code=test`);

    renderWithMantine(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent("Tools"),
    );
    expect(readOAuthResumeSnapshot()).toBeUndefined();

    window.history.replaceState({}, "", "/");
    const user = userEvent.setup();

    // Explicit disconnect while still on Tools (InspectorView clamps to Servers
    // visually, but App must reset activeTab so reconnect does not pop back).
    await user.click(screen.getByText("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(
        INSPECTOR_SERVERS_TAB,
      ),
    );

    await user.click(screen.getByText("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(
        INSPECTOR_SERVERS_TAB,
      ),
    );

    await user.click(screen.getByText("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("active-tab")).toHaveTextContent(
        INSPECTOR_SERVERS_TAB,
      ),
    );
  });
});

describe("App single-page list pagination toggle (#1721)", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    updateServerSettingsSpy.mockClear();
  });

  it("persists and live-pushes singlePageLists when the sidebar toggle flips", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    expect(screen.getByTestId("tools-single-page")).toHaveTextContent("false");

    await user.click(screen.getByText("single-page-on"));

    // Optimistic UI flip is immediate.
    await waitFor(() =>
      expect(screen.getByTestId("tools-single-page")).toHaveTextContent("true"),
    );
    // Persisted to the server settings (survives reconnects).
    expect(updateServerSettingsSpy).toHaveBeenCalledWith(
      "A",
      expect.objectContaining({ singlePageLists: true }),
    );
    // Live-pushed to the client so the managed state's gating reads it now.
    const client = clientInstances[0] as unknown as {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    expect(client.setServerSettings).toHaveBeenCalledWith(
      expect.objectContaining({ singlePageLists: true }),
    );

    // Toggling back off persists false.
    await user.click(screen.getByText("single-page-off"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledWith(
        "A",
        expect.objectContaining({ singlePageLists: false }),
      ),
    );
  });

  it("routes Refresh and Load-next-page without throwing in single-page mode", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("single-page-on"));
    await waitFor(() =>
      expect(screen.getByTestId("tools-single-page")).toHaveTextContent("true"),
    );
    // Exercise the mode-aware Refresh (single-page → reload page 1) and the
    // Load-next-page control; both should run without error.
    await user.click(screen.getByText("refresh-tools"));
    await user.click(screen.getByText("load-more-tools"));
    expect(screen.getByTestId("tools-single-page")).toHaveTextContent("true");
  });
});
