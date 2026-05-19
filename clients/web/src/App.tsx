import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import type {
  InitializeResult,
  LoggingLevel,
  LoggingMessageNotification,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import type { MessageEntry, ServerEntry } from "@inspector/core/mcp/types.js";
import { API_SERVER_ENV_VARS } from "@inspector/core/mcp/remote/constants.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState.js";
import { ResourceSubscriptionsState } from "@inspector/core/mcp/state/resourceSubscriptionsState.js";
import { MessageLogState } from "@inspector/core/mcp/state/messageLogState.js";
import { FetchRequestLogState } from "@inspector/core/mcp/state/fetchRequestLogState.js";
import { StderrLogState } from "@inspector/core/mcp/state/stderrLogState.js";
import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import { useManagedTools } from "@inspector/core/react/useManagedTools.js";
import { useManagedPrompts } from "@inspector/core/react/useManagedPrompts.js";
import { useManagedResources } from "@inspector/core/react/useManagedResources.js";
import { useManagedResourceTemplates } from "@inspector/core/react/useManagedResourceTemplates.js";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks.js";
import { useResourceSubscriptions } from "@inspector/core/react/useResourceSubscriptions.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { InspectorView } from "./components/views/InspectorView/InspectorView";
import type { ToolCallState } from "./components/screens/ToolsScreen/ToolsScreen";
import type { GetPromptState } from "./components/screens/PromptsScreen/PromptsScreen";
import type { ReadResourceState } from "./components/screens/ResourcesScreen/ResourcesScreen";
import type { BridgeFactory } from "./components/elements/AppRenderer/AppRenderer";
import type { LogEntryData } from "./components/elements/LogEntry/LogEntry";
import { createWebEnvironment } from "./lib/environmentFactory";

// Hardcoded seed servers so the Servers screen has something to connect to.
// Persistence + an "Add server" UI are explicitly out of scope for #1244 (the
// useServers v2-only hook is a separate effort); follow-up work will replace
// this with a real `useServers` store. The two seeds here cover the common
// shapes a developer reaches for first: a real filesystem (scoped to /tmp so
// nothing destructive is possible by default) and the canonical "everything"
// reference server (tools / prompts / resources / sampling / completion).
const SEED_SERVERS: ServerEntry[] = [
  {
    id: "filesystem-server-default",
    name: "Local Filesystem (npx)",
    config: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
    connection: { status: "disconnected" },
  },
  {
    id: "everything-server-default",
    name: "Everything (npx)",
    config: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
    connection: { status: "disconnected" },
  },
];

// OAuth redirect URL provider — points at the dev backend's `/oauth/callback`
// handler. The InspectorClient only consults this when the active server
// requires OAuth; for stdio MCP servers it's never used. Created once and
// reused so `BrowserOAuthClientProvider` doesn't re-instantiate per render.
const redirectUrlProvider: RedirectUrlProvider = {
  getRedirectUrl: () => `${window.location.origin}/oauth/callback`,
};

// Pull the dev-backend's auth token off the URL the launcher banner prints.
// `npm run dev` opens `http://localhost:6274?MCP_INSPECTOR_API_TOKEN=…`;
// every browser request to /api/* needs the same token in the
// `x-mcp-remote-auth: Bearer …` header or the Hono backend returns 401.
// Persist to sessionStorage so SPA navigations / OAuth round-trips don't
// drop the token from the URL bar.
function getAuthToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const STORAGE_KEY = API_SERVER_ENV_VARS.AUTH_TOKEN;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(API_SERVER_ENV_VARS.AUTH_TOKEN);
  if (fromUrl) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // Best-effort persistence — sessionStorage may be unavailable
      // (privacy mode, iframe sandboxing, etc.); the URL value still
      // works for the current page load.
    }
    return fromUrl;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

// MCP Apps sandbox — the iframe URL the parent should embed, plus the
// per-tool bridge factory. The dev backend serves `sandbox_proxy.html` on
// the sandbox controller port; the factory will eventually wrap the SDK
// client. For now neither is wired (the Apps tab uses these props but does
// not yet round-trip tool input through a live bridge — that's a follow-up
// alongside the AppRenderer integration). Keep these as stable references
// so InspectorView's effect deps don't churn.
const STUB_SANDBOX_PATH = "about:blank";
const stubBridgeFactory: BridgeFactory = () =>
  ({
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  }) as unknown as AppBridge;

// Derive `LogEntryData[]` from the MessageLog by filtering for the
// `notifications/message` notifications the server emits in response to
// `logging/setLevel`. The Logs screen renders these; we transform here
// rather than in the screen so the view stays prop-driven.
function messagesToLogEntries(messages: MessageEntry[]): LogEntryData[] {
  const out: LogEntryData[] = [];
  for (const m of messages) {
    if (m.direction !== "notification") continue;
    // MessageEntry.message is a JSONRPC union; notifications have `method`
    // but not `id`. Narrow with an `in` check before the cast.
    if (!("method" in m.message)) continue;
    if (m.message.method !== "notifications/message") continue;
    const params = (m.message as unknown as LoggingMessageNotification).params;
    out.push({
      receivedAt: m.timestamp,
      params,
    });
  }
  return out;
}

function App() {
  // Theme toggle plumbing (preserved from the pre-wire placeholder).
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";
  const onToggleTheme = useCallback(() => {
    setColorScheme(isDark ? "light" : "dark");
  }, [isDark, setColorScheme]);

  // Server list — held locally; one seed entry per #1244's "hardcoded
  // sample server" scope decision. Future work: useServers hook.
  const [servers] = useState<ServerEntry[]>(SEED_SERVERS);

  // The active connection target. `null` between sessions; set as soon as
  // the user toggles a server card on. Drives state-manager lifetime.
  const [activeServerId, setActiveServerId] = useState<string | undefined>(
    undefined,
  );

  // InspectorClient + per-primitive state managers. All recreated together
  // whenever the user switches active servers, then destroyed when the
  // next switch happens (or when the component unmounts).
  const [inspectorClient, setInspectorClient] =
    useState<InspectorClient | null>(null);
  const [managedToolsState, setManagedToolsState] =
    useState<ManagedToolsState | null>(null);
  const [managedPromptsState, setManagedPromptsState] =
    useState<ManagedPromptsState | null>(null);
  const [managedResourcesState, setManagedResourcesState] =
    useState<ManagedResourcesState | null>(null);
  const [managedResourceTemplatesState, setManagedResourceTemplatesState] =
    useState<ManagedResourceTemplatesState | null>(null);
  const [managedRequestorTasksState, setManagedRequestorTasksState] =
    useState<ManagedRequestorTasksState | null>(null);
  const [resourceSubscriptionsState, setResourceSubscriptionsState] =
    useState<ResourceSubscriptionsState | null>(null);
  const [messageLogState, setMessageLogState] =
    useState<MessageLogState | null>(null);
  const [fetchRequestLogState, setFetchRequestLogState] =
    useState<FetchRequestLogState | null>(null);
  const [stderrLogState, setStderrLogState] = useState<StderrLogState | null>(
    null,
  );

  // Optimistic log level — `logging/setLevel` has no echo notification, so
  // the parent keeps the current value locally.
  const [currentLogLevel, setCurrentLogLevel] = useState<LoggingLevel>("info");

  // In-flight call panel state. Tracked here (rather than inside the
  // respective screens) so the panels can reflect pending → ok/error
  // transitions and so `onClear*` handlers can reset the panel without
  // remounting the screen.
  const [toolCallState, setToolCallState] = useState<ToolCallState | undefined>(
    undefined,
  );
  const [getPromptState, setGetPromptState] = useState<
    GetPromptState | undefined
  >(undefined);
  const [readResourceState, setReadResourceState] = useState<
    ReadResourceState | undefined
  >(undefined);

  // Handshake telemetry. `connectStartRef` is set at the "connecting" edge
  // and consumed at the "connected" edge — a ref (not state) so the
  // intervening rerenders don't reset it.
  const connectStartRef = useRef<number | undefined>(undefined);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );

  // Hook layer. Each hook subscribes to its respective event source and
  // re-renders the App on change. When `inspectorClient` / state managers
  // are null, the hooks degrade to empty results.
  const {
    status: connectionStatus,
    capabilities,
    serverInfo,
    instructions,
  } = useInspectorClient(inspectorClient);
  const { tools, refresh: refreshTools } = useManagedTools(
    inspectorClient,
    managedToolsState,
  );
  const { prompts, refresh: refreshPrompts } = useManagedPrompts(
    inspectorClient,
    managedPromptsState,
  );
  const { resources, refresh: refreshResources } = useManagedResources(
    inspectorClient,
    managedResourcesState,
  );
  const { resourceTemplates } = useManagedResourceTemplates(
    inspectorClient,
    managedResourceTemplatesState,
  );
  const { tasks, refresh: refreshTasks } = useManagedRequestorTasks(
    inspectorClient,
    managedRequestorTasksState,
  );
  const { subscriptions } = useResourceSubscriptions(
    resourceSubscriptionsState,
  );
  const { messages } = useMessageLog(messageLogState);

  // Capture observed handshake latency at the connecting → connected edge.
  // Reset when the status leaves "connected" so the next connect starts
  // clean (otherwise a stale latency would render on the next session).
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      connectStartRef.current !== undefined
    ) {
      setLatencyMs(Date.now() - connectStartRef.current);
      connectStartRef.current = undefined;
    } else if (connectionStatus !== "connected") {
      setLatencyMs(undefined);
    }
  }, [connectionStatus]);

  // Disconnect the previous InspectorClient when it's replaced (server
  // switch) or when App unmounts (HMR, tests). Without this the prior
  // session's transport — a spawned stdio subprocess, an SSE stream, or
  // an HTTP session — stays open until GC eventually lets go. The
  // state-manager destroys in `setupClientForServer` only handle the
  // listener side; this effect handles the transport side. `disconnect()`
  // is the canonical lifecycle hook (InspectorClient has no `destroy()`);
  // it closes the transport, clears subscriptions, cancels receiver TTLs.
  useEffect(() => {
    return () => {
      if (inspectorClient) {
        void inspectorClient.disconnect();
      }
    };
  }, [inspectorClient]);

  // Build the InitializeResult the connected ViewHeader expects from the
  // hook's split fields. `protocolVersion` is hard-coded for now — the
  // useInspectorClient hook doesn't expose it. TODO(#1324): consume the
  // negotiated value once the hook surfaces it.
  const initializeResult = useMemo<InitializeResult | undefined>(() => {
    if (connectionStatus !== "connected" || !serverInfo) return undefined;
    return {
      protocolVersion: "2025-06-18",
      capabilities: capabilities ?? {},
      serverInfo,
      ...(instructions ? { instructions } : {}),
    };
  }, [connectionStatus, capabilities, serverInfo, instructions]);

  // Derive log entries from the message log. Filters for
  // `notifications/message` (the response to `logging/setLevel`).
  const logs = useMemo<LogEntryData[]>(
    () => messagesToLogEntries(messages),
    [messages],
  );

  // Wire up + tear down per active server. Called by `onToggleConnection`
  // when the user switches targets. Returns the new client so the toggle
  // can call `connect()` against it before React re-renders.
  const setupClientForServer = useCallback(
    (server: ServerEntry): InspectorClient => {
      // Tear down the previous session's managers — each destroy()
      // unsubscribes from the old client's events. Skipped on the first
      // call (initial values are null).
      managedToolsState?.destroy();
      managedPromptsState?.destroy();
      managedResourcesState?.destroy();
      managedResourceTemplatesState?.destroy();
      managedRequestorTasksState?.destroy();
      resourceSubscriptionsState?.destroy();
      messageLogState?.destroy();
      fetchRequestLogState?.destroy();
      stderrLogState?.destroy();

      const { environment } = createWebEnvironment(
        getAuthToken(),
        redirectUrlProvider,
      );
      const client = new InspectorClient(server.config, {
        environment,
        // The Tasks tab needs the receiver-task pipeline; the
        // requestor-task list comes from the client's task store.
        receiverTasks: true,
        // Sampling / elicitation are on by default; keep the parameterized
        // options off until the UI grows the surface to render them.
        elicit: { form: true, url: true },
      });

      setInspectorClient(client);
      setManagedToolsState(new ManagedToolsState(client));
      setManagedPromptsState(new ManagedPromptsState(client));
      const nextResourcesState = new ManagedResourcesState(client);
      setManagedResourcesState(nextResourcesState);
      setManagedResourceTemplatesState(
        new ManagedResourceTemplatesState(client),
      );
      setManagedRequestorTasksState(new ManagedRequestorTasksState(client));
      // ResourceSubscriptionsState consults the managed resources list to
      // resolve subscribed URIs to full Resource objects (so the subscription
      // tile shows the server-supplied name/title). Pass the freshly created
      // state to avoid the React update lag from setManagedResourcesState.
      setResourceSubscriptionsState(
        new ResourceSubscriptionsState(client, nextResourcesState),
      );
      setMessageLogState(new MessageLogState(client));
      setFetchRequestLogState(new FetchRequestLogState(client));
      setStderrLogState(new StderrLogState(client));

      return client;
    },
    [
      managedToolsState,
      managedPromptsState,
      managedResourcesState,
      managedResourceTemplatesState,
      managedRequestorTasksState,
      resourceSubscriptionsState,
      messageLogState,
      fetchRequestLogState,
      stderrLogState,
    ],
  );

  const onToggleConnection = useCallback(
    async (id: string) => {
      // Same server, already connected → disconnect.
      if (
        id === activeServerId &&
        connectionStatus === "connected" &&
        inspectorClient
      ) {
        await inspectorClient.disconnect();
        return;
      }

      const target = servers.find((s) => s.id === id);
      if (!target) return;

      // Different server (or first connect): rebuild the client + managers.
      let client = inspectorClient;
      if (id !== activeServerId || client === null) {
        client = setupClientForServer(target);
        setActiveServerId(id);
      }

      setErrorMessage(undefined);
      connectStartRef.current = Date.now();
      try {
        await client.connect();
      } catch (err) {
        // Handshake-only. A mid-session transport failure transitions the
        // client status to "error" without rejecting any pending promise,
        // and `errorMessage` stays stale. TODO(#1323): consume an `error`
        // event from `InspectorClientEventMap` once it exists.
        connectStartRef.current = undefined;
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      }
    },
    [
      activeServerId,
      connectionStatus,
      inspectorClient,
      servers,
      setupClientForServer,
    ],
  );

  const onDisconnect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.disconnect();
  }, [inspectorClient]);

  // --- Action handlers that route directly to the InspectorClient. ---

  const onCallTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!inspectorClient) return;
      const tool = tools.find((t: Tool) => t.name === name);
      if (!tool) return;
      setToolCallState({ status: "pending" });
      try {
        // ToolsScreen types the args as `Record<string, unknown>` (it accepts
        // anything the user types into the schema form). `callTool` requires
        // `Record<string, JsonValue>` — narrow at the boundary instead of
        // claiming the object is empty (which the previous `as Record<string,
        // never>` cast did, misleadingly).
        const invocation = await inspectorClient.callTool(
          tool,
          args as Record<string, JsonValue>,
        );
        setToolCallState({
          status: invocation.success ? "ok" : "error",
          result: invocation.result ?? undefined,
          error: invocation.error,
        });
      } catch (err) {
        setToolCallState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [inspectorClient, tools],
  );

  const onClearToolResult = useCallback(() => {
    setToolCallState(undefined);
  }, []);

  const onGetPrompt = useCallback(
    async (name: string, args: Record<string, string>) => {
      if (!inspectorClient) return;
      setGetPromptState({ status: "pending" });
      try {
        const invocation = await inspectorClient.getPrompt(name, args);
        setGetPromptState({ status: "ok", result: invocation.result });
      } catch (err) {
        setGetPromptState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [inspectorClient],
  );

  const onReadResource = useCallback(
    async (uri: string) => {
      if (!inspectorClient) return;
      setReadResourceState({ status: "pending", uri });
      try {
        const invocation = await inspectorClient.readResource(uri);
        setReadResourceState({
          status: "ok",
          uri,
          result: invocation.result,
          lastUpdated: invocation.timestamp,
        });
      } catch (err) {
        setReadResourceState({
          status: "error",
          uri,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [inspectorClient],
  );

  const onSubscribeResource = useCallback(
    (uri: string) => {
      if (!inspectorClient) return;
      void inspectorClient.subscribeToResource(uri);
    },
    [inspectorClient],
  );

  const onUnsubscribeResource = useCallback(
    (uri: string) => {
      if (!inspectorClient) return;
      void inspectorClient.unsubscribeFromResource(uri);
    },
    [inspectorClient],
  );

  const onCancelTask = useCallback(
    (taskId: string) => {
      if (!inspectorClient) return;
      void inspectorClient.cancelRequestorTask(taskId);
    },
    [inspectorClient],
  );

  const onSetLogLevel = useCallback(
    (level: LoggingLevel) => {
      setCurrentLogLevel(level);
      if (!inspectorClient) return;
      void inspectorClient.setLoggingLevel(level);
    },
    [inspectorClient],
  );

  const onRefreshTools = useCallback(() => {
    void refreshTools();
  }, [refreshTools]);
  const onRefreshPrompts = useCallback(() => {
    void refreshPrompts();
  }, [refreshPrompts]);
  const onRefreshResources = useCallback(() => {
    void refreshResources();
  }, [refreshResources]);
  const onRefreshTasks = useCallback(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const onClearLogs = useCallback(() => {
    if (!messageLogState) return;
    // Clear only the log notifications, not the entire request/response
    // history (which the History screen renders from the same source).
    messageLogState.clearMessages(
      (m) =>
        m.direction === "notification" &&
        "method" in m.message &&
        m.message.method === "notifications/message",
    );
  }, [messageLogState]);

  const onClearHistory = useCallback(() => {
    messageLogState?.clearMessages();
  }, [messageLogState]);

  // Action stubs — these UI affordances exist but require additional
  // wiring (server CRUD, history pinning, app sandbox round-trip, log
  // export). Tracked separately; the noop keeps the prop interface
  // satisfied without lying about behavior.
  const todoNoop = useCallback(() => {
    /* TODO: not wired yet */
  }, []);

  // The Resources screen needs `isSubscribed` to flip the Subscribe button
  // label to "Unsubscribe". Derive it from the live subscriptions list rather
  // than threading it through every setReadResourceState site — that way the
  // button reflects state changes from any source (preview panel, subscribed
  // tile, or future server-initiated subscribe notifications).
  const effectiveReadResourceState = useMemo<
    ReadResourceState | undefined
  >(() => {
    if (!readResourceState) return undefined;
    if (!readResourceState.uri) return readResourceState;
    const isSubscribed = subscriptions.some(
      (s) => s.resource.uri === readResourceState.uri,
    );
    return { ...readResourceState, isSubscribed };
  }, [readResourceState, subscriptions]);

  return (
    <InspectorView
      servers={servers}
      activeServer={activeServerId}
      connectionStatus={connectionStatus}
      initializeResult={initializeResult}
      latencyMs={latencyMs}
      errorMessage={errorMessage}
      tools={tools}
      prompts={prompts}
      resources={resources}
      resourceTemplates={resourceTemplates}
      subscriptions={subscriptions}
      logs={logs}
      tasks={tasks}
      history={messages}
      toolCallState={toolCallState}
      getPromptState={getPromptState}
      readResourceState={effectiveReadResourceState}
      currentLogLevel={currentLogLevel}
      sandboxPath={STUB_SANDBOX_PATH}
      bridgeFactory={stubBridgeFactory}
      onToggleTheme={onToggleTheme}
      onToggleConnection={(id) => {
        void onToggleConnection(id);
      }}
      onDisconnect={() => {
        void onDisconnect();
      }}
      onServerAdd={todoNoop}
      onServerImportConfig={todoNoop}
      onServerImportJson={todoNoop}
      onServerInfo={todoNoop}
      onServerSettings={todoNoop}
      onServerEdit={todoNoop}
      onServerClone={todoNoop}
      onServerRemove={todoNoop}
      onCallTool={(name, args) => {
        void onCallTool(name, args);
      }}
      onClearToolResult={onClearToolResult}
      onRefreshTools={onRefreshTools}
      onGetPrompt={(name, args) => {
        void onGetPrompt(name, args);
      }}
      onRefreshPrompts={onRefreshPrompts}
      onReadResource={(uri) => {
        void onReadResource(uri);
      }}
      onSubscribeResource={onSubscribeResource}
      onUnsubscribeResource={onUnsubscribeResource}
      onRefreshResources={onRefreshResources}
      onCancelTask={onCancelTask}
      onClearCompletedTasks={todoNoop}
      onRefreshTasks={onRefreshTasks}
      onSetLogLevel={onSetLogLevel}
      onClearLogs={onClearLogs}
      onExportLogs={todoNoop}
      onCopyAllLogs={todoNoop}
      onClearHistory={onClearHistory}
      onExportHistory={todoNoop}
      onReplayHistory={todoNoop}
      onTogglePinHistory={todoNoop}
      onSelectApp={todoNoop}
      onOpenApp={todoNoop}
      onCloseApp={todoNoop}
      onRefreshApps={onRefreshTools}
    />
  );
}

export default App;
