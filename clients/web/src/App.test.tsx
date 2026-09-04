import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ProtocolErrorCode,
  ProtocolError,
  AuthorizationServerMismatchError,
} from "@modelcontextprotocol/client";
import { UrlElicitationLoopError } from "@inspector/core/mcp/urlElicitation.js";
import { ToolCallCancelledError } from "@inspector/core/mcp/toolCallCancelledError.js";
import {
  renderWithMantine,
  screen,
  waitFor,
  act,
} from "./test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { RemoteOAuthStorage } from "@inspector/core/auth/remote/storage-remote.js";

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
// Extends the real TypedEventTarget so the App's `addEventListener("disconnect",
// …)` wiring is real; the test fires `dispatchEvent(new Event("disconnect"))` to
// simulate any of the three disconnect paths (toggle, header button, transport
// failure).
//
// The real base rather than a bare EventTarget because the hooks this fake is
// handed to read state through `useStoreSnapshot`, which caches its snapshot
// against `getEventRevision` — a method the base owns and a bare EventTarget
// does not have (#1955). Inheriting it also means the counter is advanced by
// the `dispatchEvent` calls below, exactly as it would be in production.
vi.mock("@inspector/core/mcp/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/mcp/index.js")>();
  const { TypedEventTarget } =
    await import("@inspector/core/mcp/typedEventTarget.js");
  // Each armed value makes one `connect()` reject, in FIFO order, so a test can
  // exercise the handshake-failure path — or a two-connect sequence such as the
  // auth-recovery retry, where the first call rejects with the recovery error
  // and the retry behind it fails too. A queue rather than a single slot: with
  // one slot the second arming would overwrite the first, and the retry would
  // silently succeed.
  const connectRejections: unknown[] = [];
  // Same one-shot arming for the `/oauth/callback` token exchange, so a test can
  // exercise the callback-leg failure paths (#1808).
  let nextResumeRejection: unknown = null;
  // And for `authenticate()`, the pre-redirect OAuth leg (discovery + DCR), so a
  // test can exercise a failure there — the case that never reaches the "error"
  // connection status (#2108).
  let nextAuthenticateRejection: unknown = null;
  // And for the auth-recovery challenge check, whose *rejection* is a distinct
  // control-flow decision from its resolving `false` (#2108): a throw is
  // surfaced as a failed attempt rather than falling through to the redirect.
  let nextChallengeCheckRejection: unknown = null;
  class FakeInspectorClient extends TypedEventTarget<
    import("@inspector/core/mcp/index.js").InspectorClientEventMap
  > {
    connect = vi.fn(() => {
      if (connectRejections.length > 0) {
        return Promise.reject(connectRejections.shift());
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
    isTasksExtensionNegotiated = vi.fn().mockReturnValue(false);
    getRequestorTask = vi.fn().mockResolvedValue({
      taskId: "t",
      status: "working",
      ttl: null,
      createdAt: "",
      lastUpdatedAt: "",
    });
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
    resumeAfterOAuth = vi.fn(() => {
      if (nextResumeRejection !== null) {
        const err = nextResumeRejection;
        nextResumeRejection = null;
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });
    authenticate = vi.fn(() => {
      if (nextAuthenticateRejection !== null) {
        const err = nextAuthenticateRejection;
        nextAuthenticateRejection = null;
        return Promise.reject(err);
      }
      return Promise.resolve(undefined);
    });
    checkAuthChallengeSatisfied = vi.fn(() => {
      if (nextChallengeCheckRejection !== null) {
        const err = nextChallengeCheckRejection;
        nextChallengeCheckRejection = null;
        return Promise.reject(err);
      }
      return Promise.resolve(true);
    });
    // #2144: the clear path reads the returned RFC 7009 outcome.
    clearOAuthTokens = vi
      .fn()
      .mockResolvedValue({ status: "skipped", reason: "no_endpoint" });
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
    // Call it more than once to arm consecutive calls.
    __rejectNextConnect: (err: unknown) => {
      connectRejections.push(err);
    },
    // Test-only: arm the next resumeAfterOAuth() to reject (callback-leg failure).
    __rejectNextResumeAfterOAuth: (err: unknown) => {
      nextResumeRejection = err;
    },
    // Test-only: arm the next authenticate() to reject (pre-redirect OAuth leg).
    __rejectNextAuthenticate: (err: unknown) => {
      nextAuthenticateRejection = err;
    },
    // Test-only: arm the next checkAuthChallengeSatisfied() to reject.
    __rejectNextChallengeCheck: (err: unknown) => {
      nextChallengeCheckRejection = err;
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

vi.mock("@inspector/core/mcp/remote/index.js", async (importOriginal) => ({
  // Partial: `getWebProxiedFetch` (the OAuth clear's revocation fetch, #2144)
  // reaches for `createRemoteFetch` from this module, and a bare stub would
  // throw a missing-export error before the clear under test ever ran.
  ...(await importOriginal<
    typeof import("@inspector/core/mcp/remote/index.js")
  >()),
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

// Stable spy so tests can assert the sidebar paginated toggle persisted the
// `paginatedLists` setting (#1721). `vi.hoisted` so it exists when the hoisted
// `vi.mock` factory closes over it.
const { updateServerSettingsSpy } = vi.hoisted(() => ({
  updateServerSettingsSpy: vi.fn(() => Promise.resolve()),
}));

// Same idea for the edit-modal rename path (#1914): the test needs to make the
// PUT's *reload* fail, which only a spy it controls can do.
const { updateServerSpy, addServerSpy } = vi.hoisted(() => ({
  updateServerSpy: vi.fn(() => Promise.resolve()),
  addServerSpy: vi.fn(() => Promise.resolve()),
}));
// Stable spy for the tools list-changed acknowledgement, so a test can assert
// the paginated Refresh clears the indicator (#1721).
const { clearToolsListChangedSpy } = vi.hoisted(() => ({
  clearToolsListChangedSpy: vi.fn(),
}));
vi.mock("@inspector/core/react/useServers.js", async (importOriginal) => ({
  // `ServerListReloadError` is a real class the pagination toggle branches on
  // with `instanceof`, so it must be the genuine one — a stub would make the
  // check vacuously false and the #1914 branch untestable (#1914 review r1).
  ...(await importOriginal<
    typeof import("@inspector/core/react/useServers.js")
  >()),
  useServers: vi.fn(() => ({
    servers: [SERVER_A],
    addServer: addServerSpy,
    updateServer: updateServerSpy,
    updateServerSettings: updateServerSettingsSpy,
    removeServer: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useInspectorClient.js", () => ({
  useInspectorClient: vi.fn(() => ({
    status: "connected",
    capabilities: {},
    clientCapabilities: {},
    // Undefined models a modern server that omitted the optional serverInfo. As
    // of #1772 `initializeResult` is still built when connected (with a
    // catalog-name fallback), so this exercises that path — see the "#1772"
    // describe block.
    serverInfo: undefined,
    instructions: undefined,
  })),
}));
vi.mock("@inspector/core/react/useManagedTools.js", () => ({
  useManagedTools: vi.fn(() => ({
    tools: [{ name: "get_acts", inputSchema: { type: "object" } }],
    refresh: vi.fn(),
    clearListChanged: clearToolsListChangedSpy,
  })),
}));
vi.mock("@inspector/core/react/useManagedPrompts.js", () => ({
  useManagedPrompts: vi.fn(() => ({
    prompts: [],
    refresh: vi.fn(),
    clearListChanged: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useManagedResources.js", () => ({
  useManagedResources: vi.fn(() => ({
    resources: [],
    refresh: vi.fn(),
    clearListChanged: vi.fn(),
  })),
}));
vi.mock("@inspector/core/react/useManagedResourceTemplates.js", () => ({
  useManagedResourceTemplates: vi.fn(() => ({
    resourceTemplates: [],
    refresh: vi.fn(),
  })),
}));
// Paged (paginated) hooks + state managers (#1721). Mirrors the managed
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

// --- App bridge factory spy (#2055) -----------------------------------------
// Passes through to the real factory but records the deps App hands it, so a
// test can drive `getListedResourceMeta` — the wiring that carries a
// `resources/list` entry's `_meta.ui` into the sandbox CSP. Without this the
// bridge-factory unit tests would still pass while App stopped supplying it.
const appBridgeFactoryDeps: AppBridgeFactoryDeps[] = [];
vi.mock(
  "./components/elements/AppRenderer/createAppBridgeFactory",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./components/elements/AppRenderer/createAppBridgeFactory")
      >();
    return {
      ...actual,
      createAppBridgeFactory: (deps: AppBridgeFactoryDeps) => {
        appBridgeFactoryDeps.push(deps);
        return actual.createAppBridgeFactory(deps);
      },
    };
  },
);

// --- publishAppDocument spy (#2056) -----------------------------------------
// The dedicated-origin publisher App hands both bridge factories. Mocked at the
// module so a test can assert the wiring is live — the factory's own tests
// inject the dep and cannot see App failing to supply it.
const publishAppDocumentMock =
  vi.fn<
    (
      doc: { html: string; csp?: string },
      opts: { baseUrl: string; authToken?: string },
    ) => Promise<string | null>
  >();
vi.mock("./lib/publishAppDocument", () => ({
  publishAppDocument: (
    doc: { html: string; csp?: string },
    opts: { baseUrl: string; authToken?: string },
  ) => publishAppDocumentMock(doc, opts),
}));

// --- InspectorView double ---------------------------------------------------
// Surfaces each piece of session-scoped state under test and exposes buttons
// that invoke the App's connect / call-tool / get-prompt / read-resource /
// set-log-level handlers.
vi.mock("./components/views/InspectorView/InspectorView", () => ({
  InspectorView: (props: InspectorViewProps) => (
    <div>
      <span data-testid="tool-status">
        {props.tools.toolCallState?.status ?? "none"}
      </span>
      <span data-testid="task-progress-keys">
        {Object.keys(props.tasks.progressByTaskId ?? {}).join(",") || "none"}
      </span>
      <span data-testid="selected-tool">
        {props.tools.toolsUi?.selectedToolKey ?? "none"}
      </span>
      <span data-testid="tool-search">
        {props.tools.toolsUi?.search || "none"}
      </span>
      <span data-testid="selected-prompt">
        {props.prompts.promptsUi?.selectedPromptName ?? "none"}
      </span>
      <span data-testid="log-filter">
        {props.logs.logsUi?.filterText || "none"}
      </span>
      <span data-testid="prompt-status">
        {props.prompts.getPromptState?.status ?? "none"}
      </span>
      <span data-testid="resource-status">
        {props.resources.readResourceState?.status ?? "none"}
      </span>
      <span data-testid="log-level">{props.logs.currentLogLevel}</span>
      <span data-testid="active-tab">{props.shell.activeTab ?? "none"}</span>
      <span data-testid="init-result">
        {props.connection.initializeResult
          ? `name:${props.connection.initializeResult.serverInfo.name || "(empty)"}`
          : "none"}
      </span>
      <span data-testid="errored-server">
        {props.connection.erroredServerId ?? "none"}
      </span>
      <span data-testid="active-server">
        {props.connection.activeServer ?? "none"}
      </span>
      <button onClick={() => props.shell.onActiveTabChange("Servers")}>
        switch-servers-tab
      </button>
      <button onClick={() => props.connection.onToggleConnection("A")}>
        connect
      </button>
      {/* A second target, so a test can drive an A -> B -> A switch (#2095). */}
      <button onClick={() => props.connection.onToggleConnection("B")}>
        connect-b
      </button>
      {/* The header's explicit Disconnect, which routes to the standalone
          `onDisconnect` rather than through the toggle. */}
      <button onClick={() => props.connection.onDisconnect()}>
        disconnect
      </button>
      <button onClick={() => props.servers.onConnectionInfo("A")}>
        open-connection-info
      </button>
      <button
        onClick={() =>
          props.tools.onToolsUiChange({
            ...props.tools.toolsUi,
            selectedToolKey: "0:get_acts",
          })
        }
      >
        select-tool
      </button>
      <button
        onClick={() =>
          props.tools.onToolsUiChange({
            ...props.tools.toolsUi,
            selectedToolKey: "1:other_tool",
          })
        }
      >
        select-other-tool
      </button>
      <button
        onClick={() =>
          props.tools.onToolsUiChange({
            ...props.tools.toolsUi,
            search: "act",
          })
        }
      >
        set-tool-search
      </button>
      <button
        onClick={() =>
          props.prompts.onPromptsUiChange({
            ...props.prompts.promptsUi,
            selectedPromptName: "greet",
          })
        }
      >
        select-prompt
      </button>
      <button
        onClick={() =>
          props.logs.onLogsUiChange({
            ...props.logs.logsUi,
            filterText: "err",
          })
        }
      >
        set-log-filter
      </button>
      <button onClick={() => props.tools.onCallTool("get_acts", {})}>
        call
      </button>
      <button onClick={() => props.tools.onCallTool("get_acts", {}, true)}>
        call-as-task
      </button>
      <button onClick={() => props.tasks.onCancelTask("task-1")}>
        cancel-task
      </button>
      <button onClick={() => props.tools.onCancelToolCall?.()}>
        cancel-tool-call
      </button>
      <button onClick={() => props.tasks.onClearCompletedTasks()}>
        clear-completed
      </button>
      <button onClick={() => props.tasks.onRefreshTasks()}>
        refresh-tasks
      </button>
      <button onClick={() => props.prompts.onGetPrompt("greet", {})}>
        get-prompt
      </button>
      <button onClick={() => props.resources.onReadResource("res://x")}>
        read-resource
      </button>
      <button onClick={() => props.logs.onSetLogLevel("debug")}>
        set-level
      </button>
      <button onClick={() => props.servers.onServerSettings("A")}>
        open-settings
      </button>
      {/* A second settings target, so a test can drive a clear against an
          entry other than the active one (#2217). */}
      <button onClick={() => props.servers.onServerSettings("B")}>
        open-settings-b
      </button>
      {/* The real server grid (and its Add / Edit controls) lives inside this
          mocked view, so the config modal is only reachable through these
          callbacks — and the highlight batch only observable through this prop. */}
      <button onClick={() => props.servers.onServerEdit("A")}>
        edit-server
      </button>
      <button onClick={() => props.servers.onServerAdd()}>add-server</button>
      {/* The real drag-and-drop reorder lives inside this mocked view, so the
          callback is only reachable through a control like this one. */}
      <button onClick={() => props.servers.onServerReorder(["B", "A"])}>
        reorder-servers
      </button>
      <span data-testid="highlighted-servers">
        {(props.servers.highlightedServerIds ?? []).join(",") || "none"}
      </span>
      <span data-testid="pinned-history">
        {Array.from(props.protocol.pinnedProtocolIds ?? []).join(",")}
      </span>
      <button onClick={() => props.protocol.onTogglePinProtocol("hist-1")}>
        toggle-pin
      </button>
      <button onClick={() => props.protocol.onReplayProtocol("hist-1")}>
        replay-history
      </button>
      <button onClick={() => props.protocol.onClearProtocol()}>
        clear-history
      </button>
      <span data-testid="tools-paginated">
        {String(props.tools.toolsPagination.paginated)}
      </span>
      <span data-testid="tools-loaded-pages">
        {props.tools.toolsPagination.loadedPages}
      </span>
      <button
        onClick={() => props.tools.toolsPagination.onPaginatedChange(true)}
      >
        paginated-on
      </button>
      <button
        onClick={() => props.tools.toolsPagination.onPaginatedChange(false)}
      >
        paginated-off
      </button>
      <button onClick={() => props.tools.toolsPagination.onLoadMore()}>
        load-more-tools
      </button>
      <button onClick={() => props.tools.onRefreshTools()}>
        refresh-tools
      </button>
    </div>
  ),
}));

import App from "./App";
import type { InspectorViewProps } from "./components/views/InspectorView/InspectorView";
import { SERVER_INFO_NOT_REPORTED_LABEL } from "./components/groups/ConnectionInfoContent/ConnectionInfoContent";
import { OAUTH_CALLBACK_PATH } from "./utils/oauthFlow.js";
import { INSPECTOR_SERVERS_TAB } from "./utils/inspectorTabs.js";
import {
  readOAuthResumeSnapshot,
  writeOAuthResumeSnapshot,
  type OAuthResumeSnapshot,
} from "./lib/oauthResume.js";
import * as McpIndex from "@inspector/core/mcp/index.js";
import * as FetchLogModule from "@inspector/core/mcp/state/fetchRequestLogState.js";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks.js";
import { useManagedTools } from "@inspector/core/react/useManagedTools.js";
import { usePagedTools } from "@inspector/core/react/usePagedTools.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import { useSettingsDraft } from "@inspector/core/react/useSettingsDraft.js";
import {
  ServerListReloadError,
  useServers,
} from "@inspector/core/react/useServers.js";
import type {
  InspectorClientOptions,
  InspectorServerSettings,
  MessageEntry,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import type { AppBridgeFactoryDeps } from "./components/elements/AppRenderer/createAppBridgeFactory";
import { useManagedResources } from "@inspector/core/react/useManagedResources.js";
import type { UseManagedResourcesResult } from "@inspector/core/react/useManagedResources.js";
import type { Resource } from "@modelcontextprotocol/client";

// Default useInspectorClient return — capabilities empty (no task tool calls).
// Individual tests override via vi.mocked(...).mockReturnValue(...).
const DEFAULT_USE_INSPECTOR_CLIENT: ReturnType<typeof useInspectorClient> = {
  status: "connected",
  capabilities: {},
  clientCapabilities: {},
  serverInfo: undefined,
  instructions: undefined,
  excludedTools: [],
  malformedListItems: [],
  appRendererClient: null,
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

const clientInstances = (
  McpIndex as unknown as { __clientInstances: EventTarget[] }
).__clientInstances;

/**
 * Mirror how the real client enqueues a server-initiated request: put it on the
 * queue, then announce the change.
 *
 * Both halves matter now that `usePendingClientRequests` reads the queue back
 * off the client (`useStoreSnapshot`, #1955) rather than taking the event's
 * `detail`. The store is the source of truth and the event is only the signal
 * that it moved, so dispatching alone would announce a change that isn't there
 * — and the modal under test would never open.
 */
function enqueuePendingRequests(
  client: EventTarget,
  queue: "getPendingSamples" | "getPendingElicitations",
  event: "pendingSamplesChange" | "pendingElicitationsChange",
  entries: readonly unknown[],
): void {
  const withQueue = client as EventTarget &
    Record<typeof queue, ReturnType<typeof vi.fn>>;
  withQueue[queue].mockReturnValue(entries);
  client.dispatchEvent(new CustomEvent(event, { detail: entries }));
}

const enqueuePendingSamples = (
  client: EventTarget,
  samples: readonly unknown[],
): void =>
  enqueuePendingRequests(
    client,
    "getPendingSamples",
    "pendingSamplesChange",
    samples,
  );

const enqueuePendingElicitations = (
  client: EventTarget,
  elicitations: readonly unknown[],
): void =>
  enqueuePendingRequests(
    client,
    "getPendingElicitations",
    "pendingElicitationsChange",
    elicitations,
  );

// The mock factory adds four test-only arming hooks to the module namespace.
// Intersecting with `typeof McpIndex` keeps the real module's shape checked and
// narrows this to a single cast — `as unknown as` would discard the former and
// is what AGENTS.md rules out.
type ArmingHooks = typeof McpIndex & {
  __rejectNextConnect: (err: unknown) => void;
  __rejectNextResumeAfterOAuth: (err: unknown) => void;
  __rejectNextAuthenticate: (err: unknown) => void;
  __rejectNextChallengeCheck: (err: unknown) => void;
};

const { __rejectNextConnect: rejectNextConnect } = McpIndex as ArmingHooks;
const { __rejectNextResumeAfterOAuth: rejectNextResumeAfterOAuth } =
  McpIndex as ArmingHooks;
const { __rejectNextAuthenticate: rejectNextAuthenticate } =
  McpIndex as ArmingHooks;
const { __rejectNextChallengeCheck: rejectNextChallengeCheck } =
  McpIndex as ArmingHooks;

const fetchLogInstances = (
  FetchLogModule as unknown as { __fetchLogInstances: EventTarget[] }
).__fetchLogInstances;

// #2068 — the web connection seam for the refresh-token opt-out. The provider
// and manager tests start from an already-built OAuth config and the runner test
// covers only the CLI/TUI leg, so without this case deleting the
// `requestRefreshToken` spread from App's `oauthFromServer` would leave the
// checkbox persisted but inert with every other new test still green.
describe("App wires the refresh-token opt-out into the client (#2068)", () => {
  // Fully-typed fixtures rather than a cast: `settings` is the whole
  // `InspectorServerSettings`, so a field added to that interface later is a
  // compile error here instead of a silently-absent value at runtime.
  const HTTP_SERVER: ServerEntry = {
    id: "A",
    name: "PlotRocket",
    config: { type: "streamable-http", url: "https://api.example.com/mcp" },
    connection: { status: "disconnected" },
  };

  const BASE_SETTINGS: InspectorServerSettings = {
    headers: [],
    env: [],
    metadata: {},
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
  };

  function mockServersWith(overrides?: Partial<InspectorServerSettings>) {
    vi.mocked(useServers).mockReturnValue({
      servers: [
        {
          ...HTTP_SERVER,
          ...(overrides
            ? { settings: { ...BASE_SETTINGS, ...overrides } }
            : {}),
        },
      ],
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
      addServer: addServerSpy,
      updateServer: updateServerSpy,
      updateServerSettings: updateServerSettingsSpy,
      removeServer: vi.fn(),
      reorderServers: vi.fn(),
      importSource: vi.fn().mockResolvedValue({ servers: {} }),
    });
  }

  /**
   * The `oauth` option the mocked InspectorClient constructor was given. Read
   * through the constructor's own parameter type, so a rename of the option
   * fails to compile here rather than silently reading `undefined`.
   */
  function constructedOAuth(): InspectorClientOptions["oauth"] {
    return vi.mocked(McpIndex.InspectorClient).mock.calls[0]?.[1]?.oauth;
  }

  let previousUseServers: typeof useServers | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientInstances.length = 0;
    previousUseServers = vi.mocked(useServers).getMockImplementation();
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  afterEach(() => {
    if (previousUseServers) {
      vi.mocked(useServers).mockImplementation(previousUseServers);
    }
  });

  it("passes requestRefreshToken: false when the server opted out", async () => {
    const user = userEvent.setup();
    mockServersWith({ oauthRequestRefreshToken: false });
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    expect(constructedOAuth()?.requestRefreshToken).toBe(false);
  });

  // The default must not send the key at all — the provider's own default is
  // what declares the grant, and a stray `true` here would mask its removal.
  it("omits requestRefreshToken when the setting is on", async () => {
    const user = userEvent.setup();
    mockServersWith({ oauthScopes: "openid" });
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const oauth = constructedOAuth();
    expect(oauth).toBeDefined();
    expect(oauth).not.toHaveProperty("requestRefreshToken");
  });

  // The opt-out is the only OAuth field set, so it must be enough on its own to
  // materialize the `oauth` option — otherwise it is dropped for any server
  // without credentials or scopes, which is the common case here.
  it("builds the oauth option from the opt-out alone", async () => {
    const user = userEvent.setup();
    mockServersWith({ oauthRequestRefreshToken: false });
    renderWithMantine(<App />);

    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    expect(constructedOAuth()).toEqual({ requestRefreshToken: false });
  });
});

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

  // An OAuth leg that fails never reaches the `"error"` connection status — the
  // handler tears the client down, leaving the session `"disconnected"` — so the
  // flag is the only signal downstream that a connect attempt died. Without it
  // the monitoring sidebar stays shut on exactly the failure the Network tab
  // exists to explain (#2108).
  it("flags the server when the OAuth authorization leg fails (#2108)", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    expect(screen.getByTestId("errored-server")).toHaveTextContent("none");

    // 401 from the server -> App starts the authorization-code flow, whose
    // discovery/DCR round-trip then fails (e.g. an invalid
    // `/.well-known/oauth-authorization-server`).
    rejectNextConnect(Object.assign(new Error("HTTP 401"), { status: 401 }));
    rejectNextAuthenticate(new Error("discovery failed"));
    await user.click(screen.getByText("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );
    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("OAuth authorization failed"),
      }),
    );
  });

  // The auth-recovery arm re-connects from inside the outer `catch`, so before
  // #2108 a rejection there escaped `onToggleConnection` entirely as an
  // unhandled rejection: no toast, no red border, no sidebar.
  it("flags the server when the satisfied-challenge retry fails (#2108)", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    // First connect asks for recovery; the fake reports the challenge already
    // satisfied, so App retries the connect — and that retry fails.
    rejectNextConnect(
      new AuthRecoveryRequiredError(
        new URL("https://as.example.com/authorize"),
        {
          reason: "unauthorized",
        },
      ),
    );
    rejectNextConnect(new Error("handshake failed after re-authorization"));
    await user.click(screen.getByText("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );
    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Failed to connect"),
      }),
    );
  });

  // The other half of the guarded arm. A *rejecting* challenge check is not the
  // same as one that resolves `false`: the latter means "re-authorize", the
  // former means the check itself broke, so it is surfaced rather than used as
  // grounds to navigate the whole page to the auth server.
  it("surfaces a rejecting challenge check instead of redirecting (#2108)", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);

    rejectNextConnect(
      new AuthRecoveryRequiredError(
        new URL("https://as.example.com/authorize"),
        { reason: "unauthorized" },
      ),
    );
    rejectNextChallengeCheck(new Error("challenge check failed"));
    await user.click(screen.getByText("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );
    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Failed to connect"),
        message: "challenge check failed",
      }),
    );
    // No redirect was prepared: `prepareOAuthRedirect` persists a resume
    // snapshot before navigating, and nothing wrote one.
    expect(readOAuthResumeSnapshot()).toBeUndefined();
    // And the attempt was ended. The outer connect rejected with an
    // auth-recovery error, which holds the status at "connecting", so without
    // an explicit teardown here the toggle would spin forever.
    const client = clientInstances[0] as EventTarget & {
      disconnect: ReturnType<typeof vi.fn>;
    };
    expect(client.disconnect).toHaveBeenCalled();
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

describe("App initializeResult when connected without serverInfo (#1772)", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
  });

  // A modern-era `server/discover` makes `serverInfo` optional, so a conforming
  // modern server can be `connected` with `serverInfo === undefined`. The header
  // (and its whole tab bar) is gated on `initializeResult` downstream, so it must
  // still be built in that case — otherwise the connected server shows no menu.
  it("builds initializeResult when connected even though serverInfo is undefined", () => {
    // DEFAULT_USE_INSPECTOR_CLIENT is exactly this case: connected + no serverInfo.
    renderWithMantine(<App />);
    expect(screen.getByTestId("init-result")).not.toHaveTextContent("none");
  });

  it("falls back to the active server's catalog name when serverInfo is undefined", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    // Connect server "A" (PlotRocket) via the mocked InspectorView control so it
    // becomes the active server; serverInfo is still undefined (default mock), so
    // the synthesized name must come from the catalog entry.
    await user.click(screen.getByText("connect"));
    await waitFor(() =>
      expect(screen.getByTestId("init-result")).toHaveTextContent(
        "name:PlotRocket",
      ),
    );
  });

  it("does not build initializeResult while disconnected", () => {
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      status: "disconnected",
    });
    renderWithMantine(<App />);
    expect(screen.getByTestId("init-result")).toHaveTextContent("none");
  });

  it("uses the reported serverInfo name when present (legacy / stamped modern)", () => {
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      serverInfo: { name: "real-server", version: "2.0.0" },
    });
    renderWithMantine(<App />);
    expect(screen.getByTestId("init-result")).toHaveTextContent(
      "name:real-server",
    );
  });

  // Pins the App → ConnectionInfoModal wiring of `serverInfoReported`: without
  // this, hard-coding it to `true` would keep the suite green and silently
  // reintroduce the fidelity bug.
  it("passes serverInfoReported=false to the modal, which shows 'not reported' (serverInfo omitted)", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect")); // active server = A
    await user.click(screen.getByText("open-connection-info"));
    await waitFor(() =>
      expect(screen.getAllByText(SERVER_INFO_NOT_REPORTED_LABEL)).toHaveLength(
        2,
      ),
    );
    // The synthesized catalog name is not presented as the server's report.
    // Exact-match query on purpose: the mocked InspectorView's `init-result` span
    // prints "name:PlotRocket" (prefixed), so this only matches a bare "PlotRocket"
    // — i.e. the modal's Name cell — not the harness span.
    expect(screen.queryByText("PlotRocket")).not.toBeInTheDocument();
  });

  it("passes serverInfoReported=true to the modal, which shows the reported name", async () => {
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      serverInfo: { name: "real-server", version: "2.0.0" },
    });
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await user.click(screen.getByText("open-connection-info"));
    await waitFor(() =>
      expect(screen.getByText("real-server")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(SERVER_INFO_NOT_REPORTED_LABEL),
    ).not.toBeInTheDocument();
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

    // A search keystroke leaves `selectedToolKey` unchanged, so the result
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
      enqueuePendingSamples(clientInstances[0], [sample]);
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
      enqueuePendingSamples(clientInstances[0], []);
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

  it("Cancel on a task-input-required elicitation cancels the task, not answers it (#1631)", async () => {
    // The user-facing half of the cancelable-loop fix: clicking Cancel on a
    // MODERN task's input_required modal must cancel the underlying task (so the
    // poll unblocks) rather than send an { action: "cancel" } answer that a
    // non-advancing server would just re-prompt on.
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const client = clientInstances[0] as unknown as {
      cancelRequestorTask: ReturnType<typeof vi.fn>;
    };

    const respond = vi.fn().mockResolvedValue(undefined);
    const elicitation = {
      id: "elicitation-1",
      origin: "task-input-required",
      taskId: "task-77",
      request: {
        params: {
          message: "Approve this task before it continues?",
          requestedSchema: {
            type: "object",
            properties: { approved: { type: "boolean", title: "Approved" } },
          },
        },
      },
      respond,
    };
    act(() => {
      enqueuePendingElicitations(clientInstances[0], [elicitation]);
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Approve this task before it continues/),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(client.cancelRequestorTask).toHaveBeenCalledWith("task-77");
    // The task is cancelled instead of answering the request.
    expect(respond).not.toHaveBeenCalled();
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
  // Close also pushes the settings it decided to apply, which is what the
  // failed-save case asserts on (#2089).
  setServerSettings: ReturnType<typeof vi.fn>;
};

const settingsWithRoots = (
  roots: InspectorServerSettings["roots"],
): InspectorServerSettings => ({
  headers: [],
  env: [],
  metadata: {},
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

  it("applies the last persisted settings on close after a save failed (#2089)", async () => {
    // `useSettingsDraft` keeps the draft when a save rejects, so closing the
    // modal would push a value that never reached disk into the live client —
    // undoing the rollback that reported the failure. Close has to apply what
    // landed instead.
    const user = userEvent.setup();
    updateServerSettingsSpy.mockClear();
    const failedDraft: InspectorServerSettings = {
      ...settingsWithRoots([{ uri: "file:///rejected" }]),
      paginatedLists: true,
    };
    const client = await openSettingsForConnectedServer(failedDraft);
    client.getRoots.mockReturnValue([]);

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    // One save lands, so the tracker has an account of disk…
    const persistedSettings: InspectorServerSettings = {
      ...settingsWithRoots([]),
      paginatedLists: false,
    };
    await act(async () => {
      await draftOptions.onPersist("A", persistedSettings);
    });
    // …then the next one rejects, leaving the draft holding an unsaved edit.
    updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      await draftOptions.onPersist("A", failedDraft).catch(() => undefined);
    });
    client.setServerSettings.mockClear();

    await closeModal(user);

    await waitFor(() => expect(client.setServerSettings).toHaveBeenCalled());
    expect(client.setServerSettings).toHaveBeenLastCalledWith(
      persistedSettings,
    );
    // …and the rejected roots edit is not advertised either.
    expect(client.setRoots).not.toHaveBeenCalled();
  });

  it("restores the roots and log size too when a flushed save rejects (#2089)", async () => {
    // Close flushes a pending save and live-applies the draft immediately —
    // roots and the Network log size, not just the settings object. If that
    // save then rejects, reconciling only `setServerSettings` would leave the
    // server advertising roots that were never persisted.
    const user = userEvent.setup();
    updateServerSettingsSpy.mockClear();
    const rejectedDraft: InspectorServerSettings = {
      ...settingsWithRoots([{ uri: "file:///rejected" }]),
      maxFetchRequests: 10,
    };
    const client = await openSettingsForConnectedServer(rejectedDraft);
    client.getRoots.mockReturnValue([]);

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    const persistedSettings = settingsWithRoots([]);
    await act(async () => {
      await draftOptions.onPersist("A", persistedSettings);
    });

    // Close applies the draft live — the state the flush leaves behind.
    const fetchLog = fetchLogInstances.at(-1) as EventTarget & {
      setMaxFetchRequests: ReturnType<typeof vi.fn>;
    };
    await closeModal(user);
    await waitFor(() =>
      expect(client.setRoots).toHaveBeenCalledWith([
        { uri: "file:///rejected" },
      ]),
    );
    expect(fetchLog.setMaxFetchRequests).toHaveBeenLastCalledWith(10);
    client.getRoots.mockReturnValue([{ uri: "file:///rejected" }]);
    client.setRoots.mockClear();

    // …and only now does the flushed save reject.
    updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      await draftOptions.onPersist("A", rejectedDraft).catch(() => undefined);
    });

    // The whole live surface goes back to what landed — settings, roots, and
    // the log size, each of which close had moved to the rejected draft.
    await waitFor(() => expect(client.setRoots).toHaveBeenCalledWith([]));
    expect(client.setServerSettings).toHaveBeenLastCalledWith(
      persistedSettings,
    );
    expect(fetchLog.setMaxFetchRequests).toHaveBeenLastCalledWith(
      persistedSettings.maxFetchRequests,
    );
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

// A callback that lands without recorded SEP-2352 discovery state used to
// dead-end with the SDK's raw `AuthorizationServerMismatchError` text. It now
// raises an explicit recovery affordance — but only for that case; a genuine
// cross-authorization-server mismatch stays a security error. See #1808.
describe("App OAuth callback issuer-binding failures (#1808)", () => {
  const storage = new Map<string, string>();
  const HTTP_SERVER: ServerEntry = {
    id: "A",
    name: "PlotRocket",
    config: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
    connection: { status: "disconnected" },
  };
  const STDIO_SERVER: ServerEntry = {
    id: "A",
    name: "PlotRocket",
    config: { type: "stdio", command: "node" },
    connection: { status: "disconnected" },
  };

  /** Full `useServers` shape so the override typechecks like the real hook. */
  const useServersResult = (
    servers: ServerEntry[],
  ): ReturnType<typeof useServers> => ({
    servers,
    loading: false,
    error: undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
    addServer: vi.fn().mockResolvedValue(undefined),
    updateServer: vi.fn().mockResolvedValue(undefined),
    updateServerSettings: updateServerSettingsSpy,
    removeServer: vi.fn().mockResolvedValue(undefined),
    reorderServers: vi.fn().mockResolvedValue(undefined),
    importSource: vi.fn().mockResolvedValue({ servers: {} }),
  });

  // A real SDK error, not a look-alike: the SDK's `mcpBrand` is static, so a
  // fabricated instance-branded object would exercise a shape that cannot occur.
  const mismatchError = (recordedIssuer: string): Error =>
    new AuthorizationServerMismatchError(
      recordedIssuer,
      "https://as.example.com",
    );

  const renderCallbackWithFailure = (err: Error) => {
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "A",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: {},
    });
    window.history.replaceState({}, "", `${OAUTH_CALLBACK_PATH}?code=test`);
    rejectNextResumeAfterOAuth(err);
    renderWithMantine(<App />);
  };

  beforeEach(() => {
    clientInstances.length = 0;
    storage.clear();
    notificationsMock.show.mockClear();
    vi.mocked(useInspectorClient).mockReturnValue({
      ...DEFAULT_USE_INSPECTOR_CLIENT,
      status: "disconnected",
    });
    vi.mocked(useServers).mockReturnValue(useServersResult([HTTP_SERVER]));
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
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
    vi.mocked(useServers).mockReturnValue(useServersResult([STDIO_SERVER]));
    window.history.replaceState({}, "", "/");
  });

  it("offers an explicit re-authorize affordance when the recorded state was lost", async () => {
    renderCallbackWithFailure(
      mismatchError(
        "discoveryState was not available on the callback leg; ensure your provider persists discoveryState alongside codeVerifier",
      ),
    );

    expect(
      await screen.findByText("Authorization state was lost"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Authorize again" }),
    ).toBeInTheDocument();
    // The raw SDK wording never reaches the user.
    expect(screen.queryByText(/discoveryState/)).not.toBeInTheDocument();
    expect(screen.queryByText("Re-authentication required")).toBeNull();
  });

  // The callback leg is a connect attempt too, so a failure there must flag the
  // server — that is what opens the monitoring sidebar onto the OAuth requests
  // (discovery, DCR and the token exchange, restored from the pre-redirect
  // session) rather than leaving the user with only a banner (#2108).
  it("flags the server when the callback leg fails (#2108)", async () => {
    renderCallbackWithFailure(new Error("token exchange rejected"));

    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );
    // The active server is deliberately retained. "Authorize again" on the
    // re-auth banner only hands `clearServerOAuthState` the live client when
    // the banner's server is the active one, so releasing it here would leave
    // the stale tokens on the client that holds them. Asserted so a later
    // "cleanup" of the apparent leak fails here rather than silently breaking
    // the recovery.
    expect(screen.getByTestId("active-server")).toHaveTextContent("A");
    // The teardown still runs, for the case where the reconnect is what
    // rejected and the status really is left at "connecting".
    const client = clientInstances[0] as EventTarget & {
      disconnect: ReturnType<typeof vi.fn>;
    };
    await waitFor(() => expect(client.disconnect).toHaveBeenCalled());
  });

  // The callback leg can also die before the token exchange, if the persisted
  // OAuth state cannot be read back at all. Spied on the prototype rather than
  // mocked at the module, so every other test keeps the real storage.
  it("flags the server when the OAuth storage fails to load (#2108)", async () => {
    const loadSpy = vi
      .spyOn(RemoteOAuthStorage.prototype, "load")
      .mockRejectedValueOnce(new Error("storage unavailable"));
    try {
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "A",
        activeTab: "Tools",
        authKind: "reauth",
        tabUi: {},
      });
      window.history.replaceState({}, "", `${OAUTH_CALLBACK_PATH}?code=test`);
      renderWithMantine(<App />);

      await waitFor(() =>
        expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
      );
      // Red border only, by design: this arm returns before a client is built,
      // so nothing restores the Network log — and a failed local read of
      // `oauth.json` would not be in it anyway.
      expect(
        await screen.findByText(/storage unavailable/),
      ).toBeInTheDocument();
    } finally {
      loadSpy.mockRestore();
    }
  });

  // The other callback arm: the provider redirected back with an error instead
  // of a code, so no token exchange is even attempted. Still a connect attempt
  // that failed, so the server carries the same flag (#2108).
  //
  // The flag is deliberately all this asserts. That arm returns before a client
  // is rebuilt, so no Network entries are restored and the content-gated column
  // stays shut — which is right here: the provider's `error` param is the whole
  // diagnostic and the re-auth banner is already showing it. Asserting a
  // sidebar would be asserting behavior this arm should not have.
  it("flags the server when the provider returns an error to the callback (#2108)", async () => {
    writeOAuthResumeSnapshot({
      version: 1,
      serverId: "A",
      activeTab: "Tools",
      authKind: "reauth",
      tabUi: {},
    });
    window.history.replaceState(
      {},
      "",
      `${OAUTH_CALLBACK_PATH}?error=access_denied`,
    );
    renderWithMantine(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("errored-server")).toHaveTextContent("A"),
    );
  });

  it("clears the stale OAuth state and reconnects when the affordance is used", async () => {
    const user = userEvent.setup();
    renderCallbackWithFailure(
      mismatchError("discoveryState was not available on the callback leg"),
    );

    const button = await screen.findByRole("button", {
      name: "Authorize again",
    });
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    const callbackClient = clientInstances[0] as unknown as {
      clearOAuthTokens: ReturnType<typeof vi.fn>;
    };

    await user.click(button);

    await waitFor(() =>
      expect(callbackClient.clearOAuthTokens).toHaveBeenCalled(),
    );
    // A fresh client is built for the retry connect.
    await waitFor(() => expect(clientInstances.length).toBeGreaterThan(1));
    expect(screen.queryByText("Authorization state was lost")).toBeNull();
  });

  it("treats a genuine issuer mismatch as a security error with no recovery button", async () => {
    renderCallbackWithFailure(mismatchError("https://old.example.com"));

    await waitFor(() =>
      expect(notificationsMock.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Authorization server mismatch",
          color: "red",
        }),
      ),
    );
    expect(screen.queryByText("Authorization state was lost")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Authorize again" }),
    ).toBeNull();
  });

  it("falls back to the generic re-auth banner for an unrelated callback failure", async () => {
    renderCallbackWithFailure(new Error("token endpoint exploded"));

    expect(
      await screen.findByText("Re-authentication required"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Authorization state was lost")).toBeNull();
  });
});

describe("App paginated list pagination toggle (#1721)", () => {
  beforeEach(() => {
    clientInstances.length = 0;
    updateServerSettingsSpy.mockClear();
  });

  it("persists and live-pushes paginatedLists when the sidebar toggle flips", async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    expect(screen.getByTestId("tools-paginated")).toHaveTextContent("false");

    await user.click(screen.getByText("paginated-on"));

    // Optimistic UI flip is immediate.
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    // Persisted to the server settings (survives reconnects).
    expect(updateServerSettingsSpy).toHaveBeenCalledWith(
      "A",
      expect.objectContaining({ paginatedLists: true }),
    );
    // Live-pushed to the client so the managed state's gating reads it now.
    const client = clientInstances[0] as unknown as {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    expect(client.setServerSettings).toHaveBeenCalledWith(
      expect.objectContaining({ paginatedLists: true }),
    );

    // Toggling back off persists false.
    await user.click(screen.getByText("paginated-off"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledWith(
        "A",
        expect.objectContaining({ paginatedLists: false }),
      ),
    );
  });

  it("routes Refresh and Load-next-page in paginated mode and clears the indicator", async () => {
    const user = userEvent.setup();
    clearToolsListChangedSpy.mockClear();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    // Exercise the mode-aware Refresh (paginated → reload page 1) and the
    // Load-next-page control; both should run without error.
    await user.click(screen.getByText("refresh-tools"));
    await user.click(screen.getByText("load-more-tools"));
    expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true");
    // The paginated Refresh must acknowledge the managed list-changed
    // indicator (the paged reload bypasses the managed hook's refresh) (#1721).
    expect(clearToolsListChangedSpy).toHaveBeenCalled();
  });

  it("reverts the optimistic toggle when persisting the setting fails (#1721)", async () => {
    const user = userEvent.setup();
    updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    // The optimistic flip is rolled back once the persist rejects, so the UI
    // reflects the (unchanged) persisted value rather than the failed edit.
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("false"),
    );
    // The live client setting was rolled back too (last call reverts it).
    const client = clientInstances[0] as unknown as {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBeFalsy();
  });

  it("rolls back to the last write that landed, not to a stale list entry (#2089)", async () => {
    // Two toggles. The first PUT lands but the list reload behind it fails, so
    // the `servers` entry keeps describing disk as it was *before* it — which
    // this suite models exactly, because `useServers` is mocked to return the
    // same entry forever. The second PUT fails outright and rolls back.
    //
    // Reverting to the `servers` entry there lands on `false`, the value from
    // before the first toggle, contradicting what is on disk. The baseline has
    // to come from the write that landed instead.
    //
    // One failed toggle cannot distinguish the two baselines — they only differ
    // once a write has landed that the list never caught up with — so the test
    // needs the full sequence.
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledWith(
        "A",
        expect.objectContaining({ paginatedLists: true }),
      ),
    );

    updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
    await user.click(screen.getByText("paginated-off"));

    // Back to the value the first toggle put on disk, not to the pre-toggle one.
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBe(true);
  });

  it("rolls back to a write that landed while this one was in flight (#2089)", async () => {
    // Overlapping toggles. The baseline cannot be captured when a write is
    // issued: toggle 1 is still in flight when toggle 2 reads it, so toggle 2
    // would close over `false` — and by the time toggle 2 fails, toggle 1 has
    // landed `true` on disk. Rolling back to the captured value contradicts
    // disk exactly as the stale-list case does; the baseline has to be resolved
    // at failure time. The two writes are driven by deferred promises so the
    // order — issue 1, issue 2, land 1, fail 2 — is exact rather than timed.
    const user = userEvent.setup();
    let landFirst: (() => void) | undefined;
    let failSecond: ((err: Error) => void) | undefined;
    const first = new Promise<void>((resolve) => {
      landFirst = resolve;
    });
    const second = new Promise<void>((_resolve, reject) => {
      failSecond = (err) => {
        reject(err);
      };
    });
    updateServerSettingsSpy
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    await user.click(screen.getByText("paginated-off"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      landFirst?.();
      await first;
    });
    await act(async () => {
      failSecond?.(new Error("disk full"));
      await second.catch(() => undefined);
    });

    // `true` is what the landed write put on disk — not the `false` the second
    // toggle read before it got there.
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBe(true);
  });

  it("re-applies a write that lands after an overlapping one failed (#2089)", async () => {
    // The mirror of the test above, in the other settlement order: toggle 1
    // (`true`) is still in flight when toggle 2 (`false`) fails, so the rollback
    // resolves to the stale entry's `false` — correct at that instant, since
    // nothing had landed. Toggle 1 then lands `true`. If its list reload failed
    // too, no render will ever correct the UI, so the write that settles has to
    // re-apply itself.
    const user = userEvent.setup();
    let landFirst: (() => void) | undefined;
    let failSecond: ((err: Error) => void) | undefined;
    const first = new Promise<void>((resolve) => {
      landFirst = resolve;
    });
    const second = new Promise<void>((_resolve, reject) => {
      failSecond = (err) => {
        reject(err);
      };
    });
    updateServerSettingsSpy
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    await user.click(screen.getByText("paginated-off"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledTimes(2),
    );

    // Fail the second write first, then land the first.
    await act(async () => {
      failSecond?.(new Error("disk full"));
      await second.catch(() => undefined);
    });
    expect(screen.getByTestId("tools-paginated")).toHaveTextContent("false");
    await act(async () => {
      landFirst?.();
      await first;
    });

    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBe(true);
  });

  it("re-applies a settled modal save after a toggle failed first (#2089)", async () => {
    // The mixed-writer version of the order above: the modal's flush is in
    // flight with `paginatedLists: true` when the sidebar toggle fails and
    // rolls back to the stale entry's `false`. The modal save then lands, so it
    // is the settled state — and it has to re-apply itself for the same reason
    // the toggle does, or disk holds `true` while the UI and the live client
    // sit on `false`.
    const user = userEvent.setup();
    let landModal: (() => void) | undefined;
    const modalWrite = new Promise<void>((resolve) => {
      landModal = resolve;
    });
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    updateServerSettingsSpy.mockImplementationOnce(() => modalWrite);
    const persisted = draftOptions.onPersist("A", {
      ...settingsWithRoots([]),
      paginatedLists: true,
    });

    updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
    await user.click(screen.getByText("paginated-off"));
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("false"),
    );

    await act(async () => {
      landModal?.();
      await persisted;
    });

    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBe(true);
  });

  it("applies a settled write to the current client, not the one it started on (#2089)", async () => {
    // A write can outlive a disconnect/reconnect to the *same* server: the id
    // guard still passes, but the client captured when the write was issued has
    // been destroyed and replaced by one built from the stale list entry. The
    // settled value has to reach the live instance.
    const user = userEvent.setup();
    let landWrite: (() => void) | undefined;
    const write = new Promise<void>((resolve) => {
      landWrite = resolve;
    });
    updateServerSettingsSpy.mockImplementationOnce(() => write);

    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    // Reconnect to the same server while that write is in flight. The transport
    // drops, then the user reconnects — and `onToggleConnection` always
    // rebuilds the client so the latest saved settings are picked up.
    act(() => {
      clientInstances[0].dispatchEvent(new Event("disconnect"));
    });
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(2));
    const replacement = clientInstances[1] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    replacement.setServerSettings.mockClear();

    await act(async () => {
      landWrite?.();
      await write;
    });

    await waitFor(() =>
      expect(replacement.setServerSettings).toHaveBeenCalledWith(
        expect.objectContaining({ paginatedLists: true }),
      ),
    );
  });

  it("reconciles after a modal save fails onto a write that landed first (#2089)", async () => {
    // Reverse of the mixed-writer case above: the toggle lands while the modal
    // save is still pending, so it is told it is not settled and applies
    // nothing. The modal save then fails, which makes the toggle's value the
    // account of disk — and nothing else is left to apply it.
    const user = userEvent.setup();
    let failModal: ((err: Error) => void) | undefined;
    const modalWrite = new Promise<void>((_resolve, reject) => {
      failModal = (err) => {
        reject(err);
      };
    });
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    updateServerSettingsSpy.mockImplementationOnce(() => modalWrite);
    const persisted = draftOptions
      .onPersist("A", { ...settingsWithRoots([]), paginatedLists: false })
      .catch(() => undefined);

    // The toggle lands `true` while the modal save is still in flight.
    await user.click(screen.getByText("paginated-on"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledTimes(2),
    );
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    client.setServerSettings.mockClear();

    await act(async () => {
      failModal?.(new Error("disk full"));
      await persisted;
    });

    // The failure is what reconciles: a push carrying the landed value arrives
    // only after it, since the landed write itself was not settled at the time.
    await waitFor(() =>
      expect(client.setServerSettings).toHaveBeenCalledWith(
        expect.objectContaining({ paginatedLists: true }),
      ),
    );
  });

  it("seeds the settings modal from the last write, not the stale entry (#2089)", async () => {
    // The modal draft is the input to the *next* write, so seeding it from a
    // `servers` entry that a failed list reload froze would send the superseded
    // value back to disk the moment the user saves any unrelated field.
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledWith(
        "A",
        expect.objectContaining({ paginatedLists: true }),
      ),
    );

    // `servers` is mocked to a fixed entry here, so it still reports the
    // pre-toggle value — exactly what a failed reload leaves behind.
    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    expect(draftOptions.resolveInitial("A")).toEqual(
      expect.objectContaining({ paginatedLists: true }),
    );
  });

  it("builds the next client from the last write, not the stale entry (#2089)", async () => {
    // Connecting is where the whole connection is configured, and it read the
    // `servers` entry directly — so a save that landed while list reads were
    // failing (including one made from the modal for a server that was not
    // connected at the time) was undone by the next connect, which rebuilt the
    // client from the frozen entry.
    const user = userEvent.setup();
    renderWithMantine(<App />);

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    const saved: InspectorServerSettings = {
      ...settingsWithRoots([{ uri: "file:///saved" }]),
      maxFetchRequests: 42,
    };
    await act(async () => {
      await draftOptions.onPersist("A", saved);
    });

    // `servers` still reports the entry with no settings at all — what a failed
    // reload leaves. The client must be built from the write that landed.
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    const clientOptions = vi
      .mocked(McpIndex.InspectorClient)
      .mock.calls.at(-1)?.[1] as { roots?: { uri: string }[] } | undefined;
    expect(clientOptions?.roots).toEqual([{ uri: "file:///saved" }]);
    const fetchLogOptions = vi
      .mocked(FetchLogModule.FetchRequestLogState)
      .mock.calls.at(-1)?.[1] as { maxFetchRequests?: number } | undefined;
    expect(fetchLogOptions?.maxFetchRequests).toBe(42);
  });

  it("carries a landed stdio env/cwd onto the config it connects with (#2096)", async () => {
    // The sibling case above covers the client *options*, which are derived
    // from the settings. `env` and `cwd` are the two fields the modal edits as
    // settings while the transport reads them off the **config** — and the
    // config came straight off the same frozen `servers` entry. So a save that
    // landed while list reads were failing kept spawning the child process with
    // the pre-save environment, while the modal (re-seeded from the tracker
    // since #2089) showed the new one. Credentials live here, so the symptom is
    // the inspected server failing to authorize rather than a lost edit.
    const user = userEvent.setup();
    renderWithMantine(<App />);

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    await act(async () => {
      await draftOptions.onPersist("A", {
        ...settingsWithRoots([]),
        env: [{ key: "FOO", value: "after" }],
        cwd: "/tmp/after",
      });
    });

    // `servers` still reports `{ type: "stdio", command: "node" }` with no
    // settings node at all — what a failed reload leaves behind.
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    expect(vi.mocked(McpIndex.InspectorClient).mock.calls.at(-1)?.[0]).toEqual({
      type: "stdio",
      command: "node",
      env: { FOO: "after" },
      cwd: "/tmp/after",
    });
  });

  it("clears a stdio env/cwd the last write removed (#2096)", async () => {
    // Clearing has to travel too, and it is the direction a naive merge gets
    // wrong: an empty env list and a blank cwd mean "remove the field", which
    // is how the modal deletes a value. Spreading the settings over the config
    // would leave the stale one in place instead.
    const user = userEvent.setup();
    const previousUseServers = vi.mocked(useServers).getMockImplementation();
    try {
      vi.mocked(useServers).mockReturnValue({
        servers: [
          {
            ...SERVER_A,
            config: {
              type: "stdio",
              command: "node",
              env: { FOO: "before" },
              cwd: "/tmp/before",
            },
          } as ServerEntry,
        ],
        loading: false,
        error: undefined,
        refresh: vi.fn().mockResolvedValue(undefined),
        addServer: vi.fn(),
        updateServer: vi.fn(),
        updateServerSettings: updateServerSettingsSpy,
        removeServer: vi.fn(),
        reorderServers: vi.fn(),
        importSource: vi.fn().mockResolvedValue({ servers: {} }),
      });
      renderWithMantine(<App />);

      const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
      if (!draftOptions) throw new Error("useSettingsDraft was never called");
      await act(async () => {
        await draftOptions.onPersist("A", {
          ...settingsWithRoots([]),
          env: [],
          cwd: "",
        });
      });

      await user.click(screen.getByText("connect"));
      await waitFor(() => expect(clientInstances).toHaveLength(1));
      expect(
        vi.mocked(McpIndex.InspectorClient).mock.calls.at(-1)?.[0],
      ).toEqual({ type: "stdio", command: "node" });
    } finally {
      if (previousUseServers) {
        vi.mocked(useServers).mockImplementation(previousUseServers);
      }
    }
  });

  it("lets a successful list read supersede a concrete rollback override (#2089)", async () => {
    // A rollback sets the override to a value rather than clearing it, so the
    // effect that drops it cannot key on the persisted boolean alone: if a
    // later read reports the value the override replaced — an edit made outside
    // the Inspector overtaking the write — neither that boolean nor the server
    // id changes, and the UI would stay stuck on the override forever. A read
    // rebuilds the list, so the entry object is the signal that supersedes it.
    const user = userEvent.setup();
    const previousUseServers = vi.mocked(useServers).getMockImplementation();
    try {
      const { rerender } = renderWithMantine(<App />);
      await user.click(screen.getByText("connect"));
      await waitFor(() => expect(clientInstances).toHaveLength(1));

      // A write lands `true` while list reads are stale, then a toggle fails —
      // leaving the override on `true` with the entry still reporting `false`.
      const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
      if (!draftOptions) throw new Error("useSettingsDraft was never called");
      await act(async () => {
        await draftOptions.onPersist("A", {
          ...settingsWithRoots([]),
          paginatedLists: true,
        });
      });
      updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
      await user.click(screen.getByText("paginated-off"));
      await waitFor(() =>
        expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
      );

      // Now a list read succeeds and still says `false` — same boolean, same
      // server id, new entry object. It is authoritative and must win.
      vi.mocked(useServers).mockReturnValue({
        servers: [{ ...SERVER_A } as ServerEntry],
        loading: false,
        error: undefined,
        refresh: vi.fn().mockResolvedValue(undefined),
        addServer: vi.fn(),
        updateServer: vi.fn(),
        updateServerSettings: updateServerSettingsSpy,
        removeServer: vi.fn(),
        reorderServers: vi.fn(),
        importSource: vi.fn().mockResolvedValue({ servers: {} }),
      });
      rerender(<App />);
      await waitFor(() =>
        expect(screen.getByTestId("tools-paginated")).toHaveTextContent(
          "false",
        ),
      );
    } finally {
      if (previousUseServers) {
        vi.mocked(useServers).mockImplementation(previousUseServers);
      }
    }
  });

  it("rolls back to a settings-modal save that landed, not just a toggle (#2089)", async () => {
    // The two settings writers feed one record, and this is the half the
    // toggle-driven tests cannot reach: `useSettingsDraft` is mocked for this
    // file, so its `onPersist` never runs on its own and a regression that
    // dropped `begin`/`landed` from the modal path would go unnoticed. The
    // callback the App handed the hook is invoked directly instead.
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    const saved: InspectorServerSettings = {
      ...settingsWithRoots([]),
      paginatedLists: true,
    };
    // The save lands; the list read behind it is what stays stale, so `servers`
    // (mocked to a fixed entry here) never reports it.
    await act(async () => {
      await draftOptions.onPersist("A", saved);
    });
    expect(updateServerSettingsSpy).toHaveBeenCalledWith("A", saved);

    updateServerSettingsSpy.mockRejectedValueOnce(new Error("disk full"));
    await user.click(screen.getByText("paginated-off"));

    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBe(true);
  });

  it("treats a modal save whose list reload failed as landed (#1914 + #2089)", async () => {
    // A `ServerListReloadError` rejects *after* the PUT landed, so the save is
    // on disk. It has to be recorded as the last landed write and applied like
    // any other settled one — the failure path would roll the UI, the live
    // client and the modal's seed back to a value disk no longer holds.
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    const draftOptions = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0];
    if (!draftOptions) throw new Error("useSettingsDraft was never called");
    updateServerSettingsSpy.mockRejectedValueOnce(
      new ServerListReloadError(
        "The server was saved, but the server list could not be reloaded: disk full",
      ),
    );
    const saved: InspectorServerSettings = {
      ...settingsWithRoots([]),
      paginatedLists: true,
    };
    await act(async () => {
      await draftOptions.onPersist("A", saved).catch(() => undefined);
    });

    // `servers` is mocked to a fixed entry here — exactly what a failed reload
    // leaves — so both of these read the record rather than the entry.
    expect(draftOptions.resolveInitial("A")).toEqual(
      expect.objectContaining({ paginatedLists: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
  });

  it("keeps the optimistic toggle when only the list reload failed (#1914)", async () => {
    // The mirror of the test above. `refreshAfterWrite` rejects with a
    // `ServerListReloadError` when the PUT landed and only reading the list
    // back failed — the setting IS on disk, so the #1721 rollback would put
    // the UI and the live client on the value the user just changed away
    // from, and contradict what a reload would show.
    const user = userEvent.setup();
    updateServerSettingsSpy.mockRejectedValueOnce(
      new ServerListReloadError(
        "The server was saved, but the server list could not be reloaded: disk full",
      ),
    );
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("paginated-on"));
    await waitFor(() =>
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
    );
    // Give the rejection a turn to land, then confirm nothing reverted it.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true");
    // Single intersection assertion rather than the `as unknown as` this file
    // uses elsewhere: the fake client really is an EventTarget, and widening
    // it keeps that relationship instead of erasing it (#1914 r2).
    const client = clientInstances[0] as EventTarget & {
      setServerSettings: ReturnType<typeof vi.fn>;
    };
    const lastPush = client.setServerSettings.mock.calls.at(-1)?.[0] as {
      paginatedLists?: boolean;
    };
    expect(lastPush?.paginatedLists).toBe(true);
  });

  it("keeps the toggle on the last write after switching servers and back (#2095)", async () => {
    // The override is what holds the display up while list reads are failing --
    // the `servers` entry it would otherwise be read from is frozen at the last
    // successful read, which this suite models exactly by mocking `useServers`
    // to a fixed list.
    //
    // Held app-wide and cleared on every change of the *active* entry, it did
    // not survive a plain server switch: A to B and back dropped it and the
    // toggle fell back to that stale entry, reading `off` while disk, the
    // tracker, and the client just built from it all said `on`. The lists were
    // then rendered in all-pages mode showing an aggregate the client never
    // fetched, with no Load-next-page control to fill them.
    //
    // Nothing here fails a list read explicitly: the fixed mock *is* that
    // state, which is why one write is enough to reproduce it.
    const user = userEvent.setup();
    const previousUseServers = vi.mocked(useServers).getMockImplementation();
    try {
      vi.mocked(useServers).mockReturnValue({
        servers: [
          SERVER_A,
          { ...SERVER_A, id: "B", name: "Other" },
        ] as ServerEntry[],
        loading: false,
        error: undefined,
        refresh: vi.fn().mockResolvedValue(undefined),
        addServer: addServerSpy,
        updateServer: updateServerSpy,
        updateServerSettings: updateServerSettingsSpy,
        removeServer: vi.fn(),
        reorderServers: vi.fn(),
        importSource: vi.fn().mockResolvedValue({ servers: {} }),
      });
      renderWithMantine(<App />);
      await user.click(screen.getByText("connect"));
      await waitFor(() => expect(clientInstances).toHaveLength(1));

      await user.click(screen.getByText("paginated-on"));
      await waitFor(() =>
        expect(updateServerSettingsSpy).toHaveBeenCalledWith(
          "A",
          expect.objectContaining({ paginatedLists: true }),
        ),
      );
      await waitFor(() =>
        expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
      );

      // Away to B, whose own entry has never been written and so reads false.
      await user.click(screen.getByText("connect-b"));
      await waitFor(() =>
        expect(screen.getByTestId("active-server")).toHaveTextContent("B"),
      );
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("false");

      // ...and back to A, which is still paginated on disk.
      await user.click(screen.getByText("connect"));
      await waitFor(() =>
        expect(screen.getByTestId("active-server")).toHaveTextContent("A"),
      );
      expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true");
    } finally {
      if (previousUseServers) {
        vi.mocked(useServers).mockImplementation(previousUseServers);
      }
    }
  });
});

// A post-write reload failure rejects *after* the write landed, so every piece
// of state `onConfigSubmit` used to apply on the resolve path has to be applied
// on the reject path too — the rename target and the highlight batch both
// describe a row that really is on disk (#1914 review r2 / r3).
describe("App config submit with a failed list reload (#1914)", () => {
  // Earlier describes install their own `useServers` return value, which
  // outlives them — so this block installs its own and puts the previous
  // implementation back, rather than trusting whatever leaked in.
  let restoreUseServers: (() => void) | undefined;

  const serversResult = (ids: string[]): ReturnType<typeof useServers> => ({
    servers: ids.map((id) => ({ ...SERVER_A, id }) as ServerEntry),
    loading: false,
    error: undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
    addServer: addServerSpy,
    updateServer: updateServerSpy,
    updateServerSettings: updateServerSettingsSpy,
    removeServer: vi.fn().mockResolvedValue(undefined),
    reorderServers: vi.fn().mockResolvedValue(undefined),
    importSource: vi.fn().mockResolvedValue({ servers: {} }),
  });

  beforeEach(() => {
    clientInstances.length = 0;
    const previous = vi.mocked(useServers).getMockImplementation();
    restoreUseServers = previous
      ? () => vi.mocked(useServers).mockImplementation(previous)
      : undefined;
    updateServerSpy.mockClear();
    addServerSpy.mockClear();
    updateServerSettingsSpy.mockClear();
    vi.mocked(useServers).mockReturnValue(serversResult(["A"]));
  });

  afterEach(() => {
    restoreUseServers?.();
  });

  it("follows the rename so the active id isn't orphaned (#1914)", async () => {
    // `activeServerId` isn't rendered anywhere, so it's read back through the
    // one handler that passes it straight to a spy: the pagination toggle
    // calls `updateServerSettings(activeServerId, …)`.
    const user = userEvent.setup();
    updateServerSpy.mockRejectedValueOnce(
      new ServerListReloadError(
        "The server was saved, but the server list could not be reloaded: disk full",
      ),
    );
    const { rerender } = renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));

    await user.click(screen.getByText("edit-server"));
    const idField = await screen.findByLabelText(/Server ID/);
    await user.clear(idField);
    await user.type(idField, "A-renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateServerSpy).toHaveBeenCalledWith(
        "A",
        "A-renamed",
        expect.anything(),
      ),
    );
    // The rejection still reaches the modal, which stays open showing it.
    expect(
      await screen.findByText(/could not be reloaded: disk full/),
    ).toBeInTheDocument();

    // Now let the row land, as the SSE refresh the write itself triggers
    // would. The modal's target ("A") is gone, so it closes rather than
    // blanking its own form — `initialId`/`initialConfig` would go undefined
    // and ServerConfigModal's reset would wipe the open form and the error
    // it is showing (#1914 r3).
    vi.mocked(useServers).mockReturnValue(serversResult(["A-renamed"]));
    rerender(<App />);
    await waitFor(() =>
      expect(screen.queryByLabelText(/Server ID/)).not.toBeInTheDocument(),
    );

    // With the modal gone, read the active id back off the toggle.
    await user.click(screen.getByText("paginated-on"));
    await waitFor(() =>
      expect(updateServerSettingsSpy).toHaveBeenCalledWith(
        "A-renamed",
        expect.objectContaining({ paginatedLists: true }),
      ),
    );
  });

  it("labels a settings save whose reload failed as saved, not failed (#1914)", () => {
    // The settings draft debounces and flushes on close, so this toast is the
    // user's only signal — a flush that rejects usually does so after the
    // modal is gone. `useSettingsDraft` is mocked here, so the App's `onError`
    // is invoked directly with the options it was handed.
    renderWithMantine(<App />);
    const onError = vi.mocked(useSettingsDraft).mock.calls.at(-1)?.[0].onError;
    expect(onError).toBeDefined();

    act(() => {
      onError!(
        "A",
        new ServerListReloadError(
          "The server was saved, but the server list could not be reloaded: disk full",
        ),
      );
    });
    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Saved settings for "A", but the server list did not reload',
        message: expect.stringContaining("disk full"),
      }),
    );

    // A genuinely failed write still reads as a failure.
    act(() => {
      onError!("A", new Error("disk full"));
    });
    expect(notificationsMock.show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Failed to save settings for "A"' }),
    );
  });

  it("keeps a successful add in the highlight batch when the reload failed (#1914)", async () => {
    // `addServerHighlighted` marked the new id only after `addServer`
    // resolved. The row is on disk either way, so on a reload failure it has
    // to be marked from the catch — the next successful refresh is what
    // renders it, and it would otherwise arrive unhighlighted.
    const user = userEvent.setup();
    addServerSpy.mockRejectedValueOnce(
      new ServerListReloadError(
        "The server was added, but the server list could not be reloaded: disk full",
      ),
    );
    renderWithMantine(<App />);
    expect(screen.getByTestId("highlighted-servers")).toHaveTextContent("none");

    await user.click(screen.getByText("add-server"));
    await user.type(await screen.findByLabelText(/Server ID/), "brand-new");
    await user.type(screen.getByLabelText(/^Command/), "node");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(addServerSpy).toHaveBeenCalledWith("brand-new", expect.anything()),
    );
    expect(
      await screen.findByText(/could not be reloaded: disk full/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("highlighted-servers")).toHaveTextContent(
        "brand-new",
      ),
    );
  });
});

// A background command runs through `runCommandInBackground`, which owns the
// rejection. Before #2049 the 17 `void runWithCommandAuthRecovery(...)` sites
// had no handler, so any non-auth failure of the wrapped operation became an
// unhandled rejection in the browser — invisible to the type-aware
// no-floating-promises rule (`void` is its sanctioned suppression) and fatal to
// `smoke:web:browser`, which hard-fails on exactly that signal.
describe("App background command rejections (#2049)", () => {
  const LIST_FAILURE = new Error("list boom");

  /**
   * Record process-level unhandled rejections for the duration of a test.
   * Asserting on the captured list — rather than relying on vitest failing the
   * whole run — is what attributes a regression to this test rather than to
   * whichever file happened to be running when the rejection surfaced.
   */
  const captureUnhandledRejections = () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      seen.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    return {
      seen,
      stop: () => {
        process.off("unhandledRejection", onUnhandled);
      },
    };
  };

  // Node reports an unhandled rejection at the end of the turn, so drain the
  // macrotask queue before asserting that none was reported.
  const settleRejections = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  beforeEach(() => {
    clientInstances.length = 0;
    notificationsMock.show.mockClear();
  });

  afterEach(() => {
    // Restore the module defaults the other blocks render against.
    vi.mocked(useManagedTools).mockReturnValue({
      tools: [{ name: "get_acts", inputSchema: { type: "object" } }],
      error: null,
      listChanged: false,
      refresh: vi.fn().mockResolvedValue([]),
      clearListChanged: clearToolsListChangedSpy,
    });
    vi.mocked(usePagedTools).mockReturnValue({
      tools: [],
      nextCursor: undefined,
      pageCount: 0,
      error: null,
      loadPage: vi.fn(() =>
        Promise.resolve({ tools: [], nextCursor: undefined }),
      ),
      clear: vi.fn(),
    });
  });

  const connect = async () => {
    const user = userEvent.setup();
    renderWithMantine(<App />);
    await user.click(screen.getByText("connect"));
    await waitFor(() => expect(clientInstances).toHaveLength(1));
    return user;
  };

  // A complete `useServers` return with one injected mutator, so the mock stays
  // type-checked against the hook's contract rather than spread from a call.
  const serversWithReorder = (
    reorderServers: ReturnType<typeof useServers>["reorderServers"],
  ): ReturnType<typeof useServers> => ({
    servers: [
      {
        id: "A",
        name: "PlotRocket",
        config: { type: "streamable-http", url: "https://api.example.com/mcp" },
        connection: { status: "disconnected" },
      },
    ],
    loading: false,
    error: undefined,
    refresh: vi.fn().mockResolvedValue(undefined),
    addServer: vi.fn().mockResolvedValue(undefined),
    updateServer: vi.fn().mockResolvedValue(undefined),
    updateServerSettings: vi.fn().mockResolvedValue(undefined),
    removeServer: vi.fn().mockResolvedValue(undefined),
    reorderServers,
    importSource: vi.fn().mockResolvedValue({ servers: {} }),
  });

  it("does not leak an unhandled rejection when an all-pages Refresh fails", async () => {
    vi.mocked(useManagedTools).mockReturnValue({
      tools: [],
      error: LIST_FAILURE,
      listChanged: false,
      refresh: vi.fn().mockRejectedValue(LIST_FAILURE),
      clearListChanged: clearToolsListChangedSpy,
    });
    const rejections = captureUnhandledRejections();
    try {
      const user = await connect();
      await user.click(screen.getByText("refresh-tools"));
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
    // The panel already renders the failure with a Retry, so no toast is added
    // on top of it — that is the whole reason this site swallows the rejection.
    expect(notificationsMock.show).not.toHaveBeenCalled();
  });

  it("does not leak an unhandled rejection when a paginated Refresh or Load-next-page fails", async () => {
    vi.mocked(usePagedTools).mockReturnValue({
      tools: [],
      // A cursor is what makes Load-next-page actually fetch.
      nextCursor: "cursor-1",
      pageCount: 1,
      error: LIST_FAILURE,
      loadPage: vi.fn().mockRejectedValue(LIST_FAILURE),
      clear: vi.fn(),
    });
    const rejections = captureUnhandledRejections();
    try {
      const user = await connect();
      // Flipping the mode drives its own page-1 load, which fails too.
      await user.click(screen.getByText("paginated-on"));
      await waitFor(() =>
        expect(screen.getByTestId("tools-paginated")).toHaveTextContent("true"),
      );
      await user.click(screen.getByText("refresh-tools"));
      await user.click(screen.getByText("load-more-tools"));
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  it("toasts a set-log-level failure instead of leaking it", async () => {
    const rejections = captureUnhandledRejections();
    try {
      const user = await connect();
      // Single assertion: the fake client IS an EventTarget, so narrowing it
      // to that intersection needs no `as unknown as` detour.
      const client = clientInstances[0] as EventTarget & {
        setLoggingLevel: ReturnType<typeof vi.fn>;
      };
      client.setLoggingLevel.mockRejectedValueOnce(new Error("no logging"));

      await user.click(screen.getByText("set-level"));

      await waitFor(() =>
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to set log level",
            message: "no logging",
            color: "red",
          }),
        ),
      );
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  // `onToggleConnection` and `onDisconnect` both close a live session with
  // `try { await disconnect() } finally { finalizeExplicitDisconnect() }` — a
  // `finally`, not a `catch` — so a transport that fails to close rejects out
  // of the handler. App discards neither: both are terminated with a `.catch`
  // that toasts, because a bare `void` would turn an ordinary click into a
  // global unhandled rejection with nothing shown to the user (#2130 review).
  const CLOSE_FAILURE = new Error("close boom");

  it("toasts a failed transport close from the connection toggle instead of leaking it", async () => {
    const rejections = captureUnhandledRejections();
    try {
      const user = await connect();
      const client = clientInstances[0] as EventTarget & {
        disconnect: ReturnType<typeof vi.fn>;
      };
      client.disconnect.mockRejectedValueOnce(CLOSE_FAILURE);

      // Second click on the same, now-connected server takes the disconnect
      // branch of the toggle.
      await user.click(screen.getByText("connect"));

      await waitFor(() =>
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to change the connection",
            message: "close boom",
            color: "red",
          }),
        ),
      );
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  // The four command handlers await `handleCommandScopedAuthRecovery` from
  // *inside* their catch blocks, and a rejection thrown from a catch is not
  // caught by that same catch — so it escapes the handler entirely. That helper
  // awaits `checkAuthChallengeSatisfied`, which reaches the backend and can
  // reject. Before #2130's review this escaped a bare `void` as a global
  // unhandled rejection with nothing shown to the user.
  it("toasts an auth-recovery failure that escapes a tool call instead of leaking it", async () => {
    const rejections = captureUnhandledRejections();
    try {
      const user = await connect();
      const client = clientInstances[0] as EventTarget & {
        callTool: ReturnType<typeof vi.fn>;
      };
      client.callTool.mockRejectedValueOnce(
        new AuthRecoveryRequiredError(
          new URL("https://as.example.com/authorize"),
          { reason: "unauthorized" },
        ),
      );
      // The recovery helper's first await is the one that breaks.
      rejectNextChallengeCheck(new Error("challenge check failed"));

      await user.click(screen.getByText("call"));

      await waitFor(() =>
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Tool call failed",
            message: "challenge check failed",
            color: "red",
          }),
        ),
      );
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  // The reorder handler was lifted out of the JSX into a named callback with a
  // `.catch` that toasts (#2130). `reorderServers` reverts its own optimistic
  // ordering and re-throws — on a 409 from a racing external edit, or a network
  // error — so without the toast the drag just silently bounces back.
  it("forwards a reorder to the server list", async () => {
    const reorderServers = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useServers).mockReturnValue(serversWithReorder(reorderServers));
    const user = userEvent.setup();
    renderWithMantine(<App />);

    await user.click(screen.getByText("reorder-servers"));

    await waitFor(() =>
      expect(reorderServers).toHaveBeenCalledWith(["B", "A"]),
    );
    expect(notificationsMock.show).not.toHaveBeenCalled();
  });

  it("toasts a failed reorder instead of leaking it", async () => {
    const reorderServers = vi
      .fn()
      .mockRejectedValue(new Error("stale server list"));
    vi.mocked(useServers).mockReturnValue(serversWithReorder(reorderServers));
    const rejections = captureUnhandledRejections();
    try {
      const user = userEvent.setup();
      renderWithMantine(<App />);

      await user.click(screen.getByText("reorder-servers"));

      await waitFor(() =>
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to reorder servers",
            message: "stale server list",
            color: "red",
          }),
        ),
      );
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  it("toasts a failed transport close from the explicit Disconnect instead of leaking it", async () => {
    const rejections = captureUnhandledRejections();
    try {
      const user = await connect();
      const client = clientInstances[0] as EventTarget & {
        disconnect: ReturnType<typeof vi.fn>;
      };
      client.disconnect.mockRejectedValueOnce(CLOSE_FAILURE);

      await user.click(screen.getByText("disconnect"));

      await waitFor(() =>
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to disconnect",
            message: "close boom",
            color: "red",
          }),
        ),
      );
      await settleRejections();
      expect(rejections.seen).toEqual([]);
    } finally {
      rejections.stop();
    }
  });
});

/** A complete `useManagedResources` return, so the mock stays type-checked against the hook's contract. */
function managedResourcesResult(
  resources: Resource[],
): UseManagedResourcesResult {
  return {
    error: null,
    resources,
    listChanged: false,
    refresh: vi.fn().mockResolvedValue(resources),
    clearListChanged: vi.fn(),
  };
}

describe("App MCP App listed-resource metadata wiring (#2055)", () => {
  beforeEach(() => {
    appBridgeFactoryDeps.length = 0;
  });

  afterEach(() => {
    // The hook mock is module-level and shared, so put the empty-list default
    // back rather than leaving a populated list for whatever runs next.
    vi.mocked(useManagedResources).mockReturnValue(managedResourcesResult([]));
  });

  it("hands the bridge factory a getListedResourceMeta reading the resources/list entries", async () => {
    // ext-apps treats a listing entry's `_meta.ui` as the static default for a
    // UI resource, so the App has to surface the listing to the bridge — the
    // factory's own tests inject the dep and cannot see this wiring break.
    const listedMeta = {
      ui: { csp: { connectDomains: ["https://api.example.com"] } },
    };
    vi.mocked(useManagedResources).mockReturnValue(
      managedResourcesResult([
        { uri: "ui://weather/app.html", name: "app", _meta: listedMeta },
      ]),
    );

    renderWithMantine(<App />);

    // App builds two factories, differing only in `advertiseElicitation`. Wait
    // for BOTH by that flag rather than for a count: waiting on "at least one"
    // would still pass with the wiring stripped from either call site, since
    // the other's deps sit in the same array.
    const appsFactory = () =>
      appBridgeFactoryDeps.find((d) => !d.advertiseElicitation);
    const elicitationFactory = () =>
      appBridgeFactoryDeps.find((d) => d.advertiseElicitation === true);
    await waitFor(() => {
      expect(appsFactory()).toBeDefined();
      expect(elicitationFactory()).toBeDefined();
    });

    for (const deps of [appsFactory(), elicitationFactory()]) {
      expect(deps?.getListedResourceMeta?.("ui://weather/app.html")).toEqual(
        listedMeta,
      );
      expect(
        deps?.getListedResourceMeta?.("ui://other/app.html"),
      ).toBeUndefined();
    }
  });

  it("hands BOTH bridge factories a working publishAppDocument (#2056)", async () => {
    // Both call sites pass the same `publishDocument`, and the end-to-end smoke
    // only covers the Apps-screen one — so without this the elicitation
    // factory's `publishAppDocument` could be dropped and every test stays
    // green while a domain-declaring elicitation app silently loses its real
    // origin. Assert it is not merely present but actually reaches the lib.
    publishAppDocumentMock.mockResolvedValue(
      "http://127.0.0.1:6278/app-document/deadbeef",
    );

    renderWithMantine(<App />);

    const appsFactory = () =>
      appBridgeFactoryDeps.find((d) => !d.advertiseElicitation);
    const elicitationFactory = () =>
      appBridgeFactoryDeps.find((d) => d.advertiseElicitation === true);
    await waitFor(() => {
      expect(appsFactory()).toBeDefined();
      expect(elicitationFactory()).toBeDefined();
    });

    for (const deps of [appsFactory(), elicitationFactory()]) {
      publishAppDocumentMock.mockClear();
      await expect(
        deps?.publishAppDocument?.({
          html: "<p>app</p>",
          csp: "default-src 'none'",
        }),
      ).resolves.toBe("http://127.0.0.1:6278/app-document/deadbeef");
      expect(publishAppDocumentMock).toHaveBeenCalledWith(
        { html: "<p>app</p>", csp: "default-src 'none'" },
        expect.objectContaining({ baseUrl: expect.any(String) }),
      );
    }
  });
});

// #2217 — persisted OAuth state is keyed by server URL and `serverList`
// enforces no URL uniqueness, so two catalog entries can share one credential
// blob, one grant and one revocation. `runClear`'s in-flight guard used to
// dedupe by catalog id, which cannot see that: clearing both entries while the
// first revocation was still out ran concurrent store writes, concurrent RFC
// 7009 requests and two contradictory teardown toasts — the exact race the
// guard exists to prevent (Copilot, on this PR).
describe("App dedupes concurrent OAuth clears that share a storage key (#2217)", () => {
  const SHARED_URL = "https://shared.example/mcp";
  const sharedEntry = (id: string, name: string): ServerEntry => ({
    id,
    name,
    config: { type: "streamable-http", url: SHARED_URL },
    connection: { status: "disconnected" },
  });

  let previousUseServers: typeof useServers | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    clientInstances.length = 0;
    previousUseServers = vi.mocked(useServers).getMockImplementation();
    vi.mocked(useInspectorClient).mockReturnValue(DEFAULT_USE_INSPECTOR_CLIENT);
    vi.mocked(useServers).mockReturnValue({
      servers: [sharedEntry("A", "PlotRocket"), sharedEntry("B", "Same URL")],
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
      addServer: addServerSpy,
      updateServer: updateServerSpy,
      updateServerSettings: updateServerSettingsSpy,
      removeServer: vi.fn(),
    } as unknown as ReturnType<typeof useServers>);
  });

  afterEach(() => {
    if (previousUseServers) {
      vi.mocked(useServers).mockImplementation(previousUseServers);
    }
  });

  /** Open the settings modal for `which` and press its OAuth-section clear. */
  async function clearFromSettings(
    user: ReturnType<typeof userEvent.setup>,
    which: "open-settings" | "open-settings-b",
  ): Promise<void> {
    await user.click(screen.getByText(which));
    // The control lives in an accordion section. The modal stays mounted
    // across a target switch, so the section may already be open from a
    // previous call — toggling it again would close it.
    const section = await screen.findByRole("button", {
      name: "OAuth Settings",
    });
    if (section.getAttribute("aria-expanded") !== "true") {
      await user.click(section);
    }
    await user.click(
      await screen.findByRole("button", { name: "Clear stored OAuth state" }),
    );
  }

  // Three full modal interaction sequences against the whole App tree, so this
  // one runs long enough to trip the 5s default when the suite is under load.
  it(
    "suppresses a second clear for another entry with the same URL, and allows one after it settles",
    { timeout: 20000 },
    async () => {
      // `delay: null` drops userEvent's inter-event waits, which dominate here.
      const user = userEvent.setup({ delay: null });
      renderWithMantine(<App />);

      await user.click(screen.getByText("connect"));
      await waitFor(() => expect(clientInstances).toHaveLength(1));
      const client = clientInstances[0] as unknown as {
        clearOAuthTokens: ReturnType<typeof vi.fn>;
      };

      // Hold the first clear open, as a pending RFC 7009 request would.
      let settle: (v: { status: string; reason: string }) => void = () => {};
      client.clearOAuthTokens.mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve as typeof settle;
          }),
      );

      await clearFromSettings(user, "open-settings");
      await waitFor(() =>
        expect(client.clearOAuthTokens).toHaveBeenCalledTimes(1),
      );

      // Entry B: a different catalog id, the same OAuth storage key. Both clears
      // route through the live client precisely because they share that key, so
      // an id-keyed guard would let this second one straight through.
      await clearFromSettings(user, "open-settings-b");
      expect(client.clearOAuthTokens).toHaveBeenCalledTimes(1);

      // Suppression is for the duration of the in-flight clear only — the key
      // must be released when it settles, or the control is dead for the rest of
      // the session.
      await act(async () => {
        settle({ status: "skipped", reason: "no_endpoint" });
        await Promise.resolve();
      });
      client.clearOAuthTokens.mockResolvedValue({
        status: "skipped",
        reason: "no_endpoint",
      });
      await clearFromSettings(user, "open-settings-b");
      await waitFor(() =>
        expect(client.clearOAuthTokens).toHaveBeenCalledTimes(2),
      );
    },
  );
});
