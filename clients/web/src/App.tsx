import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type {
  InitializeResult,
  LoggingLevel,
  LoggingMessageNotification,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  MessageEntry,
  ServerEntry,
  ServerType,
} from "@inspector/core/mcp/types.js";
import {
  API_SERVER_ENV_VARS,
  INSPECTOR_API_TOKEN_GLOBAL,
} from "@inspector/core/mcp/remote/constants.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState.js";
import { ResourceSubscriptionsState } from "@inspector/core/mcp/state/resourceSubscriptionsState.js";
import { serializeMcpConfig } from "@inspector/core/mcp/serverList.js";
import { MessageLogState } from "@inspector/core/mcp/state/messageLogState.js";
import { FetchRequestLogState } from "@inspector/core/mcp/state/fetchRequestLogState.js";
import { StderrLogState } from "@inspector/core/mcp/state/stderrLogState.js";
import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";
import {
  parseOAuthCallbackParams,
  parseOAuthState,
  generateOAuthErrorDescription,
} from "@inspector/core/auth/index.js";
import { RemoteInspectorClientStorage } from "@inspector/core/mcp/remote/index.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import { useServers } from "@inspector/core/react/useServers.js";
import { useSettingsDraft } from "@inspector/core/react/useSettingsDraft.js";
import { useManagedTools } from "@inspector/core/react/useManagedTools.js";
import { useManagedPrompts } from "@inspector/core/react/useManagedPrompts.js";
import { useManagedResources } from "@inspector/core/react/useManagedResources.js";
import { useManagedResourceTemplates } from "@inspector/core/react/useManagedResourceTemplates.js";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks.js";
import { useResourceSubscriptions } from "@inspector/core/react/useResourceSubscriptions.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useFetchRequestLog } from "@inspector/core/react/useFetchRequestLog.js";
import { useSandboxUrl } from "@inspector/core/react/useSandboxUrl.js";
import { InspectorView } from "./components/views/InspectorView/InspectorView";
import type { ToolCallState } from "./components/screens/ToolsScreen/ToolsScreen";
import type { GetPromptState } from "./components/screens/PromptsScreen/PromptsScreen";
import type { ReadResourceState } from "./components/screens/ResourcesScreen/ResourcesScreen";
import type { AppRendererHandle } from "./components/elements/AppRenderer/AppRenderer";
import { createAppBridgeFactory } from "./components/elements/AppRenderer/createAppBridgeFactory";
import type { LogEntryData } from "./components/elements/LogEntry/LogEntry";
import {
  ServerConfigModal,
  type ServerConfigModalMode,
} from "./components/groups/ServerConfigModal/ServerConfigModal";
import { ServerSettingsModal } from "./components/groups/ServerSettingsModal/ServerSettingsModal";
import { ConnectionInfoModal } from "./components/groups/ConnectionInfoModal/ConnectionInfoModal";
import { OutputValidationModal } from "./components/groups/OutputValidationModal/OutputValidationModal";
import type { OAuthDetails } from "./components/groups/ConnectionInfoContent/ConnectionInfoContent";
import { ServerRemoveConfirmModal } from "./components/groups/ServerRemoveConfirmModal/ServerRemoveConfirmModal";
import { buildExportFilename, downloadJsonFile } from "./lib/downloadFile";
import { createWebEnvironment } from "./lib/environmentFactory";
import {
  OAUTH_CALLBACK_PATH,
  OAUTH_PENDING_SERVER_KEY,
  isUnauthorizedError,
} from "./utils/oauthFlow";

// OAuth redirect URL provider — points at the dev backend's `/oauth/callback`
// handler. The InspectorClient only consults this when the active server
// requires OAuth; for stdio MCP servers it's never used. Created once and
// reused so `BrowserOAuthClientProvider` doesn't re-instantiate per render.
const redirectUrlProvider: RedirectUrlProvider = {
  getRedirectUrl: () => `${window.location.origin}${OAUTH_CALLBACK_PATH}`,
};

// Recover the backend's auth token. Every browser request to /api/* needs it
// in the `x-mcp-remote-auth: Bearer …` header or the Hono backend returns 401.
// Three sources, in priority order:
//   1. `window.__INSPECTOR_API_TOKEN__` — injected into index.html by the
//      backend on every page load (dev Vite plugin + prod Hono server). This
//      is the robust path: it survives a bare-URL reload, a bookmark, or a
//      cleared sessionStorage, none of which carry the query string.
//   2. `?MCP_INSPECTOR_API_TOKEN=…` — the URL the launcher banner prints. Kept
//      as a fallback for pasted full URLs and older integrations.
//   3. sessionStorage — backstop for SPA navigations / OAuth round-trips that
//      land without either of the above.
// Both the injected global and the URL value are persisted to sessionStorage
// so a later navigation that drops them (e.g. a deep-link load that wasn't
// injected, or an iframe) still authenticates from the backstop.
function getAuthToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const STORAGE_KEY = API_SERVER_ENV_VARS.AUTH_TOKEN;
  // Best-effort persistence — sessionStorage may be unavailable (privacy
  // mode, iframe sandboxing, etc.); the resolved value still works for the
  // current page load regardless.
  const persist = (token: string): void => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      // ignore — see note above
    }
  };
  const fromGlobal = (window as unknown as Record<string, unknown>)[
    INSPECTOR_API_TOKEN_GLOBAL
  ];
  if (typeof fromGlobal === "string" && fromGlobal) {
    persist(fromGlobal);
    return fromGlobal;
  }
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(API_SERVER_ENV_VARS.AUTH_TOKEN);
  if (fromUrl) {
    persist(fromUrl);
    return fromUrl;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

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

// Stable empty-shell for `InspectorServerSettings`. Used both as the
// initial draft for a server entry that hasn't been touched yet, and as
// the fallback the settings modal renders against when it's closed
// (Mantine renders the dialog shell regardless of `opened`). Hoisted to
// module scope so both call sites share the same object identity and so
// React doesn't re-allocate on every render.
const EMPTY_SETTINGS: InspectorServerSettings = {
  headers: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
};

// Body of the output-schema-mismatch warning toast: a one-line summary plus a
// link that opens the full validation details in a modal (the raw error is far
// too long for a toast).
const OutputValidationToastMessage = ({
  onViewDetails,
}: {
  onViewDetails: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      The tool result&apos;s structuredContent doesn&apos;t match the
      tool&apos;s outputSchema. The inspector renders it anyway, but strict MCP
      clients may not.
    </Text>
    <Anchor component="button" type="button" size="sm" onClick={onViewDetails}>
      View validation details
    </Anchor>
  </Stack>
);

function App() {
  // Theme toggle plumbing (preserved from the pre-wire placeholder).
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";
  const onToggleTheme = useCallback(() => {
    setColorScheme(isDark ? "light" : "dark");
  }, [isDark, setColorScheme]);

  // Server list — sourced from ~/.mcp-inspector/mcp.json via the backend's
  // `/api/servers` routes. First-launch seeds are written by the backend when
  // the file is absent, so this hook returns a non-empty list on first load.
  const {
    servers,
    addServer,
    updateServer,
    updateServerSettings,
    removeServer,
  } = useServers({
    baseUrl:
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost",
    authToken: getAuthToken(),
  });

  // CRUD-modal state. `configModal` drives Add / Edit / Clone via a single
  // shared form modal; `removeTarget` drives the remove-confirmation modal.
  const [configModal, setConfigModal] = useState<{
    mode: ServerConfigModalMode;
    targetId?: string;
  } | null>(null);
  const [settingsModalTargetId, setSettingsModalTargetId] = useState<
    string | undefined
  >(undefined);
  const [connectionInfoModalOpen, setConnectionInfoModalOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ServerEntry | null>(null);
  // Details for the output-schema-mismatch modal opened from the warning toast.
  const [outputValidationDetails, setOutputValidationDetails] = useState<{
    toolName: string;
    message: string;
  } | null>(null);

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

  // MCP Apps runtime wiring. `sandboxUrl` is the inspector's sandbox-proxy page
  // (the trusted outer iframe); `appRendererRef` lets the app handlers push tool
  // input/result into the running app and tear it down. The bridge factory wraps
  // the active client's underlying SDK client so the running view can call the
  // server, and reads the tool's UI resource into the sandbox on handshake.
  const appRendererRef = useRef<AppRendererHandle>(null);
  const { sandboxUrl } = useSandboxUrl({
    baseUrl:
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost",
    authToken: getAuthToken(),
  });
  const sandboxBridgeFactory = useMemo(
    () =>
      createAppBridgeFactory({
        getClient: () => inspectorClient?.getAppRendererClient() ?? null,
        readResource: async (uri) => {
          if (!inspectorClient) throw new Error("No MCP client connected.");
          const invocation = await inspectorClient.readResource(uri);
          return invocation.result;
        },
      }),
    [inspectorClient],
  );

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

  // One-shot guard for the `/oauth/callback` handler below. The effect waits
  // for the async `servers` list to hydrate, so it can run on more than one
  // render; this ref ensures the token exchange fires exactly once per load.
  const oauthCallbackHandledRef = useRef(false);

  // Hook layer. Each hook subscribes to its respective event source and
  // re-renders the App on change. When `inspectorClient` / state managers
  // are null, the hooks degrade to empty results.
  const {
    status: connectionStatus,
    capabilities,
    clientCapabilities,
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
  const { fetchRequests } = useFetchRequestLog(fetchRequestLogState);

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

  // Reset the session-scoped UI state that lives in App.tsx (rather than
  // inside the per-server state managers), so the next server's screens don't
  // show server A's last result. The per-call panels (`toolCallState` /
  // `getPromptState` / `readResourceState`) and the optimistic
  // `currentLogLevel` all survive a disconnect/reconnect cycle otherwise —
  // see #1368. `latencyMs` is intentionally excluded: it resets via the
  // `connectionStatus` effect above, which has its own connecting-edge ref to
  // coordinate with. Colocated with the setters it touches so this is the
  // single place to extend as App.tsx accrues more per-session state (#1394).
  // Setters are stable, so the callback identity never changes.
  const resetSessionScopedUiState = useCallback(() => {
    setToolCallState(undefined);
    setGetPromptState(undefined);
    setReadResourceState(undefined);
    setCurrentLogLevel("info");
  }, []);

  // Reset activeServerId whenever the live session ends. Without this the
  // other ServerCards stay `inert` after disconnect — ServerCard dims any
  // card whose id differs from `activeServer`. Subscribing to
  // InspectorClient's own `disconnect` event covers all three paths
  // (explicit toggle, header Disconnect button, mid-session transport
  // failure / process exit) and avoids the first-render-clobbers-new-id
  // trap that watching connectionStatus has (status starts as
  // "disconnected" for the new client before connect() runs). The
  // session-scoped panel/level reset rides along here too via
  // `resetSessionScopedUiState`.
  useEffect(() => {
    if (!inspectorClient) return;
    const onDisconnect = () => {
      setActiveServerId(undefined);
      // Drop the open flag too — without this the modal would pop back the
      // next time `initializeResult` re-becomes truthy (e.g. reconnect).
      setConnectionInfoModalOpen(false);
      resetSessionScopedUiState();
    };
    inspectorClient.addEventListener("disconnect", onDisconnect);
    return () => {
      inspectorClient.removeEventListener("disconnect", onDisconnect);
    };
  }, [inspectorClient, resetSessionScopedUiState]);

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

  // The Server Info modal needs the active server's transport and (optional)
  // OAuth details — both are co-located here so the modal opens against the
  // same connection snapshot the header is reading.
  const activeServer = useMemo<ServerEntry | undefined>(
    () => servers.find((s) => s.id === activeServerId),
    [servers, activeServerId],
  );

  // `config.type` is optional in the schema (a bare `command: ...`
  // entry implies stdio), so we materialize the default here rather
  // than at the render site — the modal's `transport` prop is a
  // required `ServerType`, and we only render the modal once we know
  // there's an active server (see the `{initializeResult && activeServer && …}`
  // guard below).
  const connectionInfoTransport: ServerType =
    activeServer?.config.type ?? "stdio";

  // OAuth details rendered in the Connection Info modal — read from the
  // active InspectorClient's guided-OAuth state machine snapshot
  // (synchronous), with configured scopes pulled from the server's
  // persisted settings. All three fields are independently optional; if
  // none are populated we return undefined so the modal hides the OAuth
  // section entirely.
  //
  // Snapshot-at-last-derivation semantics: the memo deps
  // (`connectionStatus`, `inspectorClient`, `activeServer`) don't
  // include `oauthStepChange` / `oauthComplete`, so a token refresh
  // that happens while none of those change won't update the rendered
  // token. The memo will still re-run on the natural triggers — server
  // switch, reconnect, or a settings edit that re-references
  // `activeServer` — which matches the modal's overall framing
  // ("info about the connection at this moment") and avoids
  // subscribing to a third event source from a dialog whose primary
  // job is read-only. If we ever surface live token refresh state,
  // switch to subscribing on those events.
  //
  // For `authUrl` we prefer the authorization-server-advertised
  // `authorization_endpoint` over the full `authorizationUrl`. The
  // latter is the per-flight URL the user was redirected to (with
  // `state`, `code_challenge`, etc.) — informative for a debugger,
  // noisy for a connection summary; the endpoint is the stable
  // identifier of "which AS is in use here."
  //
  // Scope splitter: OAuth 2.1 §3.3 specifies space-separated scopes;
  // the persisted value is config-controlled (user-typed into the
  // server settings form), so the literal `" "` split is sufficient
  // and matches the spec.
  const connectionInfoOAuth = useMemo<OAuthDetails | undefined>(() => {
    if (connectionStatus !== "connected" || !inspectorClient) return undefined;
    const oauthState = inspectorClient.getOAuthState();
    const authUrl =
      oauthState?.oauthMetadata?.authorization_endpoint ??
      oauthState?.authorizationUrl?.toString();
    const accessToken = oauthState?.oauthTokens?.access_token;
    const scopes = activeServer?.settings?.oauthScopes
      ?.split(" ")
      .filter(Boolean);
    if (!authUrl && !accessToken && !(scopes && scopes.length > 0)) {
      return undefined;
    }
    return {
      ...(authUrl && { authUrl }),
      ...(scopes && scopes.length > 0 && { scopes }),
      ...(accessToken && { accessToken }),
    };
  }, [connectionStatus, inspectorClient, activeServer]);

  // Derive log entries from the message log. Filters for
  // `notifications/message` (the response to `logging/setLevel`).
  const logs = useMemo<LogEntryData[]>(
    () => messagesToLogEntries(messages),
    [messages],
  );

  // Backend-backed session storage used to carry the fetch (Network) log
  // across the OAuth full-page redirect. The auth handshake's first half —
  // protected-resource + auth-server discovery and Dynamic Client
  // Registration — happens on the pre-redirect page; without persisting it
  // those `auth` entries would vanish when the browser navigates to the
  // authorization server. `FetchRequestLogState` saves to this on the
  // client's `saveSession` event (fired in `onBeforeOAuthRedirect`) keyed by
  // the OAuth authId, and restores from it when rebuilt on `/oauth/callback`.
  // Created once; `getAuthToken()` is stable for the page's lifetime.
  const sessionStorageAdapter = useMemo(
    () =>
      new RemoteInspectorClientStorage({
        baseUrl:
          typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost",
        authToken: getAuthToken(),
      }),
    [],
  );

  // Always points at the live `FetchRequestLogState` so the synchronous
  // pre-redirect hook below can read the current Network log without being
  // rebound every time the active server (and its log state) changes.
  const fetchLogRef = useRef<FetchRequestLogState | null>(null);

  // Flush the pre-redirect Network log to backend storage, keyed by the OAuth
  // authId carried in the authorization URL's `state`. Runs synchronously from
  // `BrowserNavigation` right before `window.location.href`, so the keepalive
  // POST it kicks off outlives the unloading page. The `/oauth/callback`
  // rebuild restores these entries via `FetchRequestLogState`'s `sessionId`.
  // Stable identity: it reads mutable refs, so it never needs to be rebuilt.
  const onBeforeOAuthRedirect = useCallback(
    (authorizationUrl: URL) => {
      const stateParam = authorizationUrl.searchParams.get("state");
      const authId = stateParam
        ? (parseOAuthState(stateParam)?.authId ?? undefined)
        : undefined;
      if (!authId) return;
      const fetchRequests = fetchLogRef.current?.getFetchRequests() ?? [];
      if (fetchRequests.length === 0) return;
      const now = Date.now();
      // Fire-and-forget: the keepalive request inside `saveSession` is
      // dispatched synchronously here, before navigation commits.
      void sessionStorageAdapter
        .saveSession(authId, {
          fetchRequests,
          createdAt: now,
          updatedAt: now,
        })
        .catch(() => {
          // Best-effort; losing the pre-redirect log is non-fatal.
        });
    },
    [sessionStorageAdapter],
  );

  // Wire up + tear down per active server. Called by `onToggleConnection`
  // when the user switches targets. Returns the new client so the toggle
  // can call `connect()` against it before React re-renders.
  const setupClientForServer = useCallback(
    (server: ServerEntry, sessionId?: string): InspectorClient => {
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
        onBeforeOAuthRedirect,
      );
      // The settings node persisted in mcp.json for this server — distinct
      // from the InspectorClient options we're about to derive from it.
      const savedSettings = server.settings;
      // Flatten the persisted settings into the InspectorClient options shape.
      // Empty / zero values stay unset so the SDK defaults apply.
      const defaultMetadata = savedSettings?.metadata
        ? Object.fromEntries(
            savedSettings.metadata
              .filter((m) => m.key.trim() !== "")
              .map((m) => [m.key, m.value]),
          )
        : undefined;
      const oauth =
        savedSettings &&
        (savedSettings.oauthClientId ||
          savedSettings.oauthClientSecret ||
          savedSettings.oauthScopes)
          ? {
              ...(savedSettings.oauthClientId && {
                clientId: savedSettings.oauthClientId,
              }),
              ...(savedSettings.oauthClientSecret && {
                clientSecret: savedSettings.oauthClientSecret,
              }),
              ...(savedSettings.oauthScopes && {
                scope: savedSettings.oauthScopes,
              }),
            }
          : undefined;
      const client = new InspectorClient(server.config, {
        environment,
        // The Tasks tab needs the receiver-task pipeline; the
        // requestor-task list comes from the client's task store.
        receiverTasks: true,
        // Sampling / elicitation are on by default; keep the parameterized
        // options off until the UI grows the surface to render them.
        elicit: { form: true, url: true },
        ...(savedSettings &&
          savedSettings.requestTimeout > 0 && {
            timeout: savedSettings.requestTimeout,
          }),
        ...(defaultMetadata &&
          Object.keys(defaultMetadata).length > 0 && {
            defaultMetadata,
          }),
        ...(oauth && { oauth }),
        ...(savedSettings && { serverSettings: savedSettings }),
        // Set on the `/oauth/callback` rebuild so the client's `saveSession`
        // events (and any later persistence) key off the same OAuth authId
        // the pre-redirect page saved under.
        ...(sessionId && { sessionId }),
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
      // Wire session storage so the fetch log survives the OAuth redirect.
      // When `sessionId` is supplied (the `/oauth/callback` rebuild) the prior
      // page's `auth` entries are restored on construction; the actual save is
      // driven synchronously from `onBeforeOAuthRedirect` above (keyed by the
      // same authId). Keep `fetchLogRef` pointed at this instance so that hook
      // reads the current log.
      const nextFetchLog = new FetchRequestLogState(client, {
        sessionStorage: sessionStorageAdapter,
        ...(sessionId && { sessionId }),
      });
      fetchLogRef.current = nextFetchLog;
      setFetchRequestLogState(nextFetchLog);
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
      sessionStorageAdapter,
      onBeforeOAuthRedirect,
    ],
  );

  // Finish the OAuth authorization-code flow when the auth server redirects
  // back to `/oauth/callback`. This runs on a fresh page load (the redirect in
  // `onToggleConnection` unloaded the previous one), so all React state is
  // reset and we recover the initiating server from sessionStorage. We wait for
  // `servers` to hydrate before acting; the ref guard keeps the exchange to a
  // single run. The persisted PKCE verifier + DCR client info live in
  // `BrowserOAuthStorage` and survive the redirect, so `completeOAuthFlow`
  // exchanges the code without needing the original in-memory state machine.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== OAUTH_CALLBACK_PATH) return;
    if (oauthCallbackHandledRef.current) return;
    // `useServers` returns [] until the first fetch resolves; defer until the
    // list is populated so `find` can resolve the pending server.
    if (servers.length === 0) return;
    oauthCallbackHandledRef.current = true;

    const params = parseOAuthCallbackParams(window.location.search);
    // The OAuth `state` round-trips `{mode}:{authId}`; the authId is the
    // session key the pre-redirect page saved the fetch log under, so the
    // rebuilt client can restore those `auth` entries. Read it before the
    // URL is cleared below.
    const stateParam = new URLSearchParams(window.location.search).get("state");
    const sessionId = stateParam
      ? (parseOAuthState(stateParam)?.authId ?? undefined)
      : undefined;
    const pendingId =
      window.sessionStorage.getItem(OAUTH_PENDING_SERVER_KEY) ?? undefined;
    window.sessionStorage.removeItem(OAUTH_PENDING_SERVER_KEY);

    // Strip the code/state off the URL immediately so a reload can't replay
    // the (now single-use) authorization code through the exchange again.
    window.history.replaceState({}, "", "/");

    if (!params.successful) {
      notifications.show({
        title: "OAuth authorization failed",
        message: generateOAuthErrorDescription(params),
        color: "red",
      });
      return;
    }

    // By design, the pending id and URL are cleared above before this lookup:
    // if the server was deleted/renamed (e.g. in another tab) mid-flow, there's
    // nothing to resume against, so we surface the error and require a fresh
    // Connect rather than leaving stale callback state lying around.
    const server = pendingId
      ? servers.find((s) => s.id === pendingId)
      : undefined;
    if (!server) {
      notifications.show({
        title: "OAuth callback could not be matched",
        message:
          "Could not determine which server started the OAuth flow. Please try connecting again.",
        color: "red",
      });
      return;
    }

    void (async () => {
      const client = setupClientForServer(server, sessionId);
      setActiveServerId(server.id);
      // Two distinct failure modes get distinct toasts. A token-exchange
      // failure means OAuth did NOT complete — and since the single-use code
      // is spent and the URL was already cleared, a reload can't retry, so we
      // tell the user to start over. A failure in the subsequent connect()
      // means OAuth DID complete (tokens are persisted): it's a transport
      // problem, and re-clicking Connect reuses the saved tokens (no second
      // authorization). Conflating them would mislead the user into
      // re-authorizing when they don't need to.
      try {
        await client.completeOAuthFlow(params.code);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notifications.show({
          title: `OAuth token exchange failed for "${server.name}"`,
          message: `${message}\n\nPlease try connecting again.`,
          color: "red",
        });
        return;
      }
      try {
        connectStartRef.current = Date.now();
        await client.connect();
      } catch (err) {
        connectStartRef.current = undefined;
        const message = err instanceof Error ? err.message : String(err);
        notifications.show({
          title: `Failed to connect to "${server.name}"`,
          message,
          color: "red",
        });
      }
    })();
  }, [servers, setupClientForServer]);

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

      // Always rebuild the InspectorClient on a (re)connect so the latest
      // `target.settings` (headers, metadata, timeouts, OAuth credentials)
      // are picked up. Reusing the previous client object would freeze the
      // settings at the moment it was first constructed, which would be
      // surprising right after the user edited them in the settings modal.
      const client = setupClientForServer(target);
      if (id !== activeServerId) {
        setActiveServerId(id);
      }

      connectStartRef.current = Date.now();
      try {
        // `settings.connectionTimeout` is consumed inside InspectorClient.connect
        // (Promise.race + transport teardown live there now), so this branch
        // stays unaware of the per-server timeout. TUI/CLI consumers get the
        // same behavior by reading from `serverSettings` on the client.
        await client.connect();
      } catch (err) {
        // Handshake-only. A mid-session transport failure does not throw,
        // so a future error event from InspectorClient is the right hook
        // for surfacing those (TODO(#1323)).
        connectStartRef.current = undefined;

        // A 401 from an OAuth-protected server means we have no (valid) token
        // yet. Kick off the authorization-code flow: `authenticate()` runs
        // discovery + DCR (proxied through the backend), then redirects the
        // whole page to the auth server via `BrowserNavigation`. Persist the
        // initiating server id first so the `/oauth/callback` load can resume
        // against the right client. The redirect unloads this page, so there's
        // nothing to do after the await on the success path.
        if (isUnauthorizedError(err)) {
          try {
            window.sessionStorage.setItem(OAUTH_PENDING_SERVER_KEY, id);
            await client.authenticate();
            return;
          } catch (authErr) {
            window.sessionStorage.removeItem(OAUTH_PENDING_SERVER_KEY);
            const message =
              authErr instanceof Error ? authErr.message : String(authErr);
            notifications.show({
              title: `OAuth authorization failed for "${target.name}"`,
              message,
              color: "red",
            });
            return;
          }
        }

        // Non-auth handshake error: toast so the user sees what went wrong
        // instead of the ConnectionToggle silently reverting to
        // "disconnected".
        const message = err instanceof Error ? err.message : String(err);
        notifications.show({
          title: `Failed to connect to "${target.name}"`,
          message,
          color: "red",
        });
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

  // --- MCP Apps handlers. Unlike onCallTool (which feeds the Tools panel),
  // these route the tool input/result into the running app via the renderer's
  // imperative handle. ---

  // Surfaces bridge/runtime failures (factory throw — e.g. no client after a
  // disconnect — late bridge rejection, or a failed tools/call) that would
  // otherwise leave a silently blank app iframe.
  const onAppError = useCallback((err: Error) => {
    notifications.show({
      title: "MCP App error",
      message: err.message,
      color: "red",
    });
  }, []);

  // Selection is owned by AppsScreen's local state; App.tsx has nothing to do
  // on select, but the prop is required so the screen stays prop-driven.
  const onSelectApp = useCallback(() => {}, []);

  const onOpenApp = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!inspectorClient) return;
      const tool = tools.find((t: Tool) => t.name === name);
      if (!tool) return;
      // AppsScreen flips `running` -> mounts AppRenderer in the same tick it
      // calls this, so the renderer handle isn't wired yet. Yield one microtask
      // (after React commits the mount) before pushing input; the renderer then
      // buffers it until the view's `initialized` event, releasing input before
      // result.
      await Promise.resolve();
      void appRendererRef.current?.sendToolInput(args);
      try {
        // skipOutputValidation: the result is forwarded verbatim to the running
        // app (the real consumer), so the host must not reject it on its own
        // outputSchema validation — that would deny the app a result the server
        // actually returned and legacy hosts render fine.
        const invocation = await inspectorClient.callTool(
          tool,
          args as Record<string, JsonValue>,
          undefined,
          undefined,
          undefined,
          { skipOutputValidation: true },
        );
        if (invocation.success && invocation.result) {
          void appRendererRef.current?.sendToolResult(invocation.result);
        }
        // Leniency above keeps the app rendering, but surface the schema
        // mismatch so a server developer knows strict MCP clients may refuse
        // to render this app. The full validation error is too long for a
        // toast, so summarize and link to a modal with the details.
        if (invocation.outputValidationError) {
          const details = {
            toolName: tool.name,
            message: invocation.outputValidationError,
          };
          notifications.show({
            // Don't auto-dismiss: the message is advisory and the details modal
            // is one click away — let the user close it when they've read it.
            autoClose: false,
            title: "App output doesn't match its schema",
            color: "yellow",
            message: (
              <OutputValidationToastMessage
                onViewDetails={() => setOutputValidationDetails(details)}
              />
            ),
          });
        }
      } catch (err) {
        // Transport-level failure (the call never returned a result). Surface it
        // so the user isn't left staring at a blank/partial app frame.
        onAppError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [inspectorClient, tools, onAppError],
  );

  const onCloseApp = useCallback(() => {
    void appRendererRef.current?.teardown();
  }, []);

  const onGetPrompt = useCallback(
    async (name: string, args: Record<string, string>) => {
      if (!inspectorClient) return;
      // Tag the in-flight + final state with the prompt name so the
      // PromptsScreen can guard against showing a stale result for a
      // prompt the user has already navigated away from.
      setGetPromptState({ status: "pending", promptName: name });
      try {
        const invocation = await inspectorClient.getPrompt(name, args);
        setGetPromptState({
          status: "ok",
          promptName: name,
          result: invocation.result,
        });
      } catch (err) {
        setGetPromptState({
          status: "error",
          promptName: name,
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

  const onCompleteArgument = useCallback(
    async (
      ref:
        | { type: "ref/resource"; uri: string }
        | { type: "ref/prompt"; name: string },
      argumentName: string,
      argumentValue: string,
      context: Record<string, string>,
    ): Promise<string[]> => {
      if (!inspectorClient) return [];
      const result = await inspectorClient.getCompletions(
        ref,
        argumentName,
        argumentValue,
        context,
      );
      return result.values;
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

  const onClearNetwork = useCallback(() => {
    fetchRequestLogState?.clearFetchRequests();
  }, [fetchRequestLogState]);

  const onExportNetwork = useCallback(() => {
    if (fetchRequests.length === 0) return;
    downloadJsonFile(
      buildExportFilename("network", activeServerId),
      JSON.stringify(fetchRequests, null, 2),
    );
  }, [fetchRequests, activeServerId]);

  const onExportHistory = useCallback(() => {
    if (messages.length === 0) return;
    downloadJsonFile(
      buildExportFilename("history", activeServerId),
      JSON.stringify(messages, null, 2),
    );
  }, [messages, activeServerId]);

  const onExportLogs = useCallback(() => {
    if (logs.length === 0) return;
    downloadJsonFile(
      buildExportFilename("logs", activeServerId),
      JSON.stringify(logs, null, 2),
    );
  }, [logs, activeServerId]);

  // Action stubs — these UI affordances exist but require additional
  // wiring (server CRUD, history pinning, app sandbox round-trip, log
  // export). Tracked separately; the noop keeps the prop interface
  // satisfied without lying about behavior.
  const todoNoop = useCallback(() => {
    /* TODO: not wired yet */
  }, []);

  // Download the current server list as a canonical mcp.json file. Uses the
  // in-memory `servers` list (kept in sync with disk by useServers' refresh-
  // after-mutate flow) so there's no extra HTTP roundtrip. Serialization
  // format (2-space indent) lives in serializeMcpConfig so the export
  // matches what serializeStore writes on the backend. The button is
  // disabled when the list is empty, but the guard here keeps the handler
  // locally correct against any future programmatic caller.
  const onServerExport = useCallback(() => {
    if (servers.length === 0) return;
    downloadJsonFile("mcp.json", serializeMcpConfig(servers));
  }, [servers]);

  // Remove handler — runs after the user confirms in the modal. When removing
  // the active server, also tear down the session in-place so the client and
  // its 9 state managers can be GC'd now instead of lingering until the next
  // server switch. Mirrors the destroy sequence at the top of
  // `setupClientForServer` (lines ~304-312) but additionally nulls every ref.
  const onConfirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    const id = removeTarget.id;
    if (id === activeServerId) {
      if (inspectorClient) {
        await inspectorClient.disconnect();
      }
      managedToolsState?.destroy();
      managedPromptsState?.destroy();
      managedResourcesState?.destroy();
      managedResourceTemplatesState?.destroy();
      managedRequestorTasksState?.destroy();
      resourceSubscriptionsState?.destroy();
      messageLogState?.destroy();
      fetchRequestLogState?.destroy();
      stderrLogState?.destroy();
      setInspectorClient(null);
      setManagedToolsState(null);
      setManagedPromptsState(null);
      setManagedResourcesState(null);
      setManagedResourceTemplatesState(null);
      setManagedRequestorTasksState(null);
      setResourceSubscriptionsState(null);
      setMessageLogState(null);
      setFetchRequestLogState(null);
      setStderrLogState(null);
      setActiveServerId(undefined);
    }
    await removeServer(id);
    setRemoveTarget(null);
  }, [
    removeTarget,
    activeServerId,
    inspectorClient,
    managedToolsState,
    managedPromptsState,
    managedResourcesState,
    managedResourceTemplatesState,
    managedRequestorTasksState,
    resourceSubscriptionsState,
    messageLogState,
    fetchRequestLogState,
    stderrLogState,
    removeServer,
  ]);

  // Submit handler for the Add / Edit / Clone modal. Add and Clone both go
  // through addServer; Edit uses updateServer (which supports id rename).
  // On rename of the active server, keep activeServerId pointed at the new id.
  const onConfigSubmit = useCallback(
    async (id: string, config: MCPServerConfig) => {
      if (configModal?.mode === "edit" && configModal.targetId) {
        const originalId = configModal.targetId;
        await updateServer(originalId, id, config);
        if (originalId === activeServerId && id !== originalId) {
          setActiveServerId(id);
        }
        return;
      }
      // add or clone
      await addServer(id, config);
    },
    [configModal, addServer, updateServer, activeServerId],
  );

  // Derive the existingIds list the modal uses for uniqueness validation.
  // In edit mode the target's own id must be excluded so saving without
  // renaming doesn't trip the "already exists" check.
  const existingIds = useMemo(() => {
    const ids = servers.map((s) => s.id);
    if (configModal?.mode === "edit" && configModal.targetId) {
      return ids.filter((id) => id !== configModal.targetId);
    }
    return ids;
  }, [servers, configModal]);

  const configModalTarget = useMemo(() => {
    if (!configModal?.targetId) return undefined;
    return servers.find((s) => s.id === configModal.targetId);
  }, [configModal, servers]);

  // The settings modal is fully controlled — every input change fires
  // `onSettingsChange` back up here, and the input's `value` prop only
  // updates when this component re-renders with a new `settings` prop.
  // We hold the in-progress draft in `useSettingsDraft` so every change
  // re-renders synchronously; the hook also debounces the PUT and
  // exposes `flush` for the close handler to call. The draft is
  // (re)initialized only when the modal opens to a *different* server,
  // which is why a background refresh of `servers` can run without
  // clobbering in-progress edits.
  //
  // `resolveInitial` reads `servers` from this render's closure — that
  // works because the settings entry point is the "Settings" button on
  // a rendered server card, so `servers` is always non-empty by the
  // time this hook is called. A future caller that opens the modal
  // from elsewhere (e.g. a keyboard shortcut on initial load) would
  // need a different initialization path; the empty-shell fallback at
  // least keeps the form renderable while `servers` hydrates.
  const {
    draft: settingsDraft,
    onChange: onSettingsChange,
    flush: flushSettingsDraft,
  } = useSettingsDraft<InspectorServerSettings>({
    targetId: settingsModalTargetId,
    resolveInitial: (id) =>
      servers.find((s) => s.id === id)?.settings ?? EMPTY_SETTINGS,
    onPersist: updateServerSettings,
    // Surface failures via toast — the modal usually closes
    // immediately on user dismiss, so a silent fail-on-flush would
    // leave the user thinking their last edits saved when they
    // didn't (especially painful for the OAuth client secret).
    onError: (id, err) => {
      notifications.show({
        title: `Failed to save settings for "${id}"`,
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    },
  });

  const settingsModalValue: InspectorServerSettings =
    settingsDraft ?? EMPTY_SETTINGS;

  const onSettingsModalClose = useCallback(() => {
    flushSettingsDraft();
    setSettingsModalTargetId(undefined);
  }, [flushSettingsDraft]);

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
    <>
      <InspectorView
        servers={servers}
        activeServer={activeServerId}
        connectionStatus={connectionStatus}
        initializeResult={initializeResult}
        latencyMs={latencyMs}
        tools={tools}
        prompts={prompts}
        resources={resources}
        resourceTemplates={resourceTemplates}
        subscriptions={subscriptions}
        logs={logs}
        tasks={tasks}
        history={messages}
        network={fetchRequests}
        toolCallState={toolCallState}
        getPromptState={getPromptState}
        readResourceState={effectiveReadResourceState}
        currentLogLevel={currentLogLevel}
        sandboxPath={sandboxUrl}
        bridgeFactory={sandboxBridgeFactory}
        appRendererRef={appRendererRef}
        onToggleTheme={onToggleTheme}
        onToggleConnection={(id) => {
          void onToggleConnection(id);
        }}
        onDisconnect={() => {
          void onDisconnect();
        }}
        onServerAdd={() => setConfigModal({ mode: "add" })}
        onServerImportConfig={todoNoop}
        onServerImportJson={todoNoop}
        onServerExport={onServerExport}
        onConnectionInfo={() => setConnectionInfoModalOpen(true)}
        onServerSettings={(id) => setSettingsModalTargetId(id)}
        onServerEdit={(id) => setConfigModal({ mode: "edit", targetId: id })}
        onServerClone={(id) => setConfigModal({ mode: "clone", targetId: id })}
        onServerRemove={(id) => {
          const target = servers.find((s) => s.id === id);
          if (target) setRemoveTarget(target);
        }}
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
        onCompleteArgument={onCompleteArgument}
        completionsSupported={capabilities?.completions !== undefined}
        onCancelTask={onCancelTask}
        onClearCompletedTasks={todoNoop}
        onRefreshTasks={onRefreshTasks}
        onSetLogLevel={onSetLogLevel}
        onClearLogs={onClearLogs}
        onExportLogs={onExportLogs}
        onClearHistory={onClearHistory}
        onExportHistory={onExportHistory}
        onReplayHistory={todoNoop}
        onTogglePinHistory={todoNoop}
        onClearNetwork={onClearNetwork}
        onExportNetwork={onExportNetwork}
        onSelectApp={onSelectApp}
        onOpenApp={(name, args) => {
          void onOpenApp(name, args);
        }}
        onCloseApp={onCloseApp}
        onAppError={onAppError}
        onRefreshApps={onRefreshTools}
      />
      <ServerConfigModal
        opened={configModal !== null}
        mode={configModal?.mode ?? "add"}
        initialId={configModalTarget?.id}
        initialConfig={configModalTarget?.config}
        existingIds={existingIds}
        onClose={() => setConfigModal(null)}
        onSubmit={onConfigSubmit}
      />
      <ServerSettingsModal
        opened={settingsModalTargetId !== undefined}
        settings={settingsModalValue}
        onClose={onSettingsModalClose}
        onSettingsChange={onSettingsChange}
      />
      {initializeResult && activeServer && (
        <ConnectionInfoModal
          opened={connectionInfoModalOpen}
          onClose={() => setConnectionInfoModalOpen(false)}
          initializeResult={initializeResult}
          clientCapabilities={clientCapabilities}
          transport={connectionInfoTransport}
          oauth={connectionInfoOAuth}
        />
      )}
      <ServerRemoveConfirmModal
        opened={removeTarget !== null}
        target={removeTarget}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={onConfirmRemove}
      />
      <OutputValidationModal
        opened={outputValidationDetails !== null}
        toolName={outputValidationDetails?.toolName}
        message={outputValidationDetails?.message}
        onClose={() => setOutputValidationDetails(null)}
      />
    </>
  );
}

export default App;
