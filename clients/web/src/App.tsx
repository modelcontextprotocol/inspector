import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type {
  CreateMessageResult,
  ElicitResult,
  InitializeResult,
  LoggingLevel,
  Tool,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { getServerType } from "@inspector/core/mcp/config.js";
import type { JsonValue } from "@inspector/core/mcp/index.js";

import type { TypedEventGeneric } from "@inspector/core/mcp/typedEventTarget.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  ServerEntry,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { resolveModernLogLevel } from "@inspector/core/mcp/types.js";
import {
  cleanRoots,
  serializeMcpConfig,
} from "@inspector/core/mcp/serverList.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  loadClientConfigRemote,
  saveClientConfigRemote,
} from "@inspector/core/client/remote.js";
import { formatClientConfigLoadError } from "@inspector/core/client/config-parse.js";
import type { FetchRequestLogStateEventMap } from "@inspector/core/mcp/state/fetchRequestLogState.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import {
  ServerListReloadError,
  useServers,
} from "@inspector/core/react/useServers.js";
import { useSettingsDraft } from "@inspector/core/react/useSettingsDraft.js";
import { useClientSettingsDraft } from "@inspector/core/react/useClientSettingsDraft.js";
import { useEmaIdpLoginState } from "@inspector/core/react/useEmaIdpLoginState.js";
import { useLastPersistedSettings } from "./hooks/useLastPersistedSettings";
import { usePaginatedListsOverride } from "./hooks/usePaginatedListsOverride";
import { useValueChange } from "./hooks/useValueChange";
import { useThemeToggle } from "./hooks/useThemeToggle";
import { useTabUiState } from "./hooks/useTabUiState";
import { useSessionRef } from "./hooks/useSessionRef";
import {
  useOAuthRecovery,
  type SetupClientForServer,
} from "./hooks/useOAuthRecovery";
import { useInspectorStores } from "./hooks/useInspectorStores";
import {
  useConnectionLifecycle,
  useHandshakeTelemetry,
} from "./hooks/useConnectionLifecycle";
import { useMcpApps } from "./hooks/useMcpApps";
import { useResultPanels, useServerCommands } from "./hooks/useServerCommands";
import { useExportActions } from "./hooks/useExportActions";
import { useProgressToasts } from "./hooks/useProgressToasts";
import { useTaskToasts } from "./hooks/useTaskToasts";
import type { ListPaginationControlsProps } from "./components/elements/ListPaginationControls/ListPaginationControls";
import { useInitialConfig } from "@inspector/core/react/useInitialConfig.js";
import { refreshingPersist } from "./lib/refreshingPersist";
import { usePendingClientRequests } from "@inspector/core/react/usePendingClientRequests.js";
import { InspectorView } from "./components/views/InspectorView/InspectorView";
import type {
  AppsPanelProps,
  ConnectionProps,
  ConsolePanelProps,
  LogsPanelProps,
  NetworkPanelProps,
  PromptsPanelProps,
  ProtocolPanelProps,
  ResourcesPanelProps,
  ServerListProps,
  ShellProps,
  SkillsPanelProps,
  TasksPanelProps,
  ToolsPanelProps,
} from "./components/views/InspectorView/types";
import type { ReadResourceState } from "./components/screens/ResourcesScreen/ResourcesScreen";
import { AppElicitationHost } from "./components/elements/AppElicitation/AppElicitationHost";
import type { LogEntryData } from "./components/elements/LogEntry/LogEntry";
import {
  ServerConfigModal,
  type ServerConfigModalMode,
} from "./components/groups/ServerConfigModal/ServerConfigModal";
import { ServerSettingsModal } from "./components/groups/ServerSettingsModal/ServerSettingsModal";
import { ClientSettingsModal } from "./components/groups/ClientSettingsModal/ClientSettingsModal";
import {
  canPersistClientSettingsDraft,
  clientConfigToFormValues,
  EMPTY_CLIENT_SETTINGS,
  formValuesToClientConfig,
} from "./components/groups/ClientSettingsForm/clientSettingsValues";
import { ServerImportConfigModal } from "./components/groups/ServerImportConfigModal/ServerImportConfigModal";
import { ServerImportJsonModal } from "./components/groups/ServerImportJsonModal/ServerImportJsonModal";
import { ConnectionInfoModal } from "./components/groups/ConnectionInfoModal/ConnectionInfoModal";
import { OutputValidationModal } from "./components/groups/OutputValidationModal/OutputValidationModal";
import { UrlElicitationErrorModal } from "./components/groups/UrlElicitationErrorModal/UrlElicitationErrorModal";
import { ServerRemoveConfirmModal } from "./components/groups/ServerRemoveConfirmModal/ServerRemoveConfirmModal";
import { StepUpAuthModal } from "./components/groups/StepUpAuthModal/StepUpAuthModal";
import { ReAuthBanner } from "./components/groups/ReAuthBanner/ReAuthBanner";
import {
  PendingClientRequestModal,
  type PendingClientRequestContent,
} from "./components/groups/PendingClientRequestModal/PendingClientRequestModal";
import { downloadJsonFile } from "./lib/downloadFile";
import { serverWithDraftSettings } from "./utils/serverWithDraftSettings";
import { enrichProtocolEntries } from "./utils/correlateTransportErrors";
import { visibleMalformedListItems } from "./utils/malformedListReport";
import { parseDeepLink, deepLinkParseStatus } from "./utils/deepLink";
import type { DeepLink, DeepLinkParseStatus } from "./utils/deepLink";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { getAuthToken } from "./lib/authToken";
import { messagesToLogEntries } from "./lib/protocolReplay";
import { EMPTY_SETTINGS } from "./utils/serverSettingsDefaults";
import { resolveOAuthClearIdentity } from "./utils/oauthClearKey";
import {
  bodyDroppedToastId,
  CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID,
} from "./utils/toasts/toastIds";
import { FetchBodyDroppedToastMessage } from "./components/elements/Toasts/FetchBodyDroppedToastMessage";
import { OutputValidationToastMessage } from "./components/elements/Toasts/OutputValidationToastMessage";
import { ReAuthBannerBar } from "./components/groups/ReAuthBanner/ReAuthBannerBar";

/**
 * Terminates a dispatched handler's promise by reporting the failure, for the
 * `InspectorView` action wrappers below. Module scope because it closes over
 * nothing — the title is the only thing that varies per action.
 */
function reportDispatchFailure(title: string) {
  return (err: unknown) => {
    notifications.show({
      title,
      message: err instanceof Error ? err.message : String(err),
      color: "red",
    });
  };
}

function App() {
  const { onToggleTheme } = useThemeToggle();

  // Server list — sourced from ~/.mcp-inspector/mcp.json via the backend's
  // `/api/servers` routes. First-launch seeds are written by the backend when
  // the file is absent, so this hook returns a non-empty list on first load.
  const {
    servers,
    addServer,
    updateServer,
    updateServerSettings,
    removeServer,
    reorderServers,
    importSource,
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
  // Import-flow modals (#1348): "Import from client config" (other-client
  // config merge) and "Import from registry config" (registry single-server
  // import).
  const [importConfigOpen, setImportConfigOpen] = useState(false);
  const [importJsonOpen, setImportJsonOpen] = useState(false);
  // Ids of freshly-added servers (manual or import) — their cards draw an
  // animated border (and the first scrolls into view) until clicked. A batch
  // import accumulates all of its ids here; opening an add/import modal starts a
  // fresh batch. (#1348)
  const [highlightedServerIds, setHighlightedServerIds] = useState<string[]>(
    [],
  );
  const clearHighlight = useCallback(
    (id: string) =>
      setHighlightedServerIds((ids) => ids.filter((x) => x !== id)),
    [],
  );
  const [settingsModalTargetId, setSettingsModalTargetId] = useState<
    string | undefined
  >(undefined);
  const [clientSettingsOpen, setClientSettingsOpen] = useState(false);
  const [connectionInfoModalOpen, setConnectionInfoModalOpen] = useState(false);
  const closeConnectionInfoModal = useCallback(
    () => setConnectionInfoModalOpen(false),
    [],
  );
  const [removeTarget, setRemoveTarget] = useState<ServerEntry | null>(null);
  // Details for the output-schema-mismatch modal opened from the warning toast.
  const [outputValidationDetails, setOutputValidationDetails] = useState<{
    toolName: string;
    message: string;
  } | null>(null);
  // Raw body for the non-spec URLElicitationRequired (-32042, no elicitations)
  // modal opened from its warning toast.
  const [urlElicitationErrorDetails, setUrlElicitationErrorDetails] = useState<{
    toolName: string;
    details: string;
  } | null>(null);

  // The active connection target. `null` between sessions; set as soon as
  // the user toggles a server card on. Drives state-manager lifetime.
  const [activeServerId, setActiveServerId] = useState<string | undefined>(
    undefined,
  );

  // Id of the server whose last connection attempt failed (#1621). Drives the
  // red border on that ServerCard. It is deliberately NOT reset by
  // `resetSessionScopedUiState` (a failed connect fires the `disconnect` event,
  // which would otherwise clear the flag the same tick we set it); instead it is
  // cleared when a new connection attempt starts, and re-set if that attempt
  // also fails.
  const [failedServerId, setFailedServerId] = useState<string | undefined>(
    undefined,
  );

  // InspectorClient + per-primitive state managers. All recreated together
  // whenever the user switches active servers, then destroyed when the
  // next switch happens (or when the component unmounts).
  const [inspectorClient, setInspectorClient] =
    useState<InspectorClient | null>(null);

  const configBaseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  // One `GET /api/config` fetch recovers every static payload field the app
  // reads: the MCP Apps `sandboxUrl`, the session's `writable` flag (read-only
  // `--config` / ad-hoc sessions hide catalog CRUD; the default catalog and
  // `--catalog` stay writable), and the Inspector `version` shown in the
  // lower-right corner (the browser can't read it off disk).
  const {
    sandboxUrl,
    writable: serverListWritable,
    version: inspectorVersion,
    secretStorage,
    refresh: refreshInitialConfig,
    loading: initialConfigLoading,
  } = useInitialConfig({
    baseUrl: configBaseUrl,
    authToken: getAuthToken(),
  });

  const [clientConfig, setClientConfig] = useState<ClientConfig>({});
  useEffect(() => {
    if (typeof window === "undefined") return;
    void loadClientConfigRemote({
      baseUrl: configBaseUrl,
      authToken: getAuthToken(),
    })
      .then(setClientConfig)
      .catch((err) => {
        setClientConfig({});
        notifications.show({
          id: CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID,
          title: "Could not load Client Settings",
          message: `${formatClientConfigLoadError(err)}\n\nCheck ~/.mcp-inspector/storage/client.json or re-enter settings in Client Settings.`,
          color: "red",
          autoClose: false,
        });
      });
  }, [configBaseUrl]);

  // the answer is baked into the client at construction (it decides whether the
  // nested MCP Apps `elicitation` capability is advertised). So a connect waits
  // for it rather than guessing: guessing "available" over-claims a capability
  // we may not have, and guessing "unavailable" strands the whole session on
  // the native form despite having a sandbox. The wait is a local fetch already
  // in flight since mount.
  const initialConfigSettledRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
  }>(null);
  initialConfigSettledRef.current ??= (() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  })();
  useEffect(() => {
    if (!initialConfigLoading) initialConfigSettledRef.current?.resolve();
  }, [initialConfigLoading]);

  // Optimistic log level — `logging/setLevel` has no echo notification, so
  // the parent keeps the current value locally.
  const [currentLogLevel, setCurrentLogLevel] = useState<LoggingLevel>("info");

  // Modern-era per-request log level (#1629). `null` = not opted in (the modern
  // default: logs stay absent until the user picks a level, which the client
  // then stamps on every request's `_meta`). Separate from `currentLogLevel`
  // because the modern control has an "off" state legacy doesn't.
  const [modernLogLevel, setModernLogLevel] = useState<LoggingLevel | null>(
    null,
  );

  // The three in-flight result panels, plus the `clearResultPanels` /
  // `setSourceScopedError` writers `useOAuthRecovery` needs. Owned by the
  // commands hook's file but called here, ahead of the OAuth hook that reads
  // those two (#2155).
  const panels = useResultPanels();
  const {
    toolCallState,
    getPromptState,
    readResourceState,
    clearResultPanels,
    setSourceScopedError,
  } = panels;

  // Per-screen selection / search / filter state, one object per screen. Lifted
  // here (out of the individual screens) so it persists across tab navigation
  // within a live session — the screens unmount on tab switch, so screen-local
  // state would be lost. Cleared only on disconnect (via
  // `resetSessionScopedUiState`) or an explicit user action, never on plain
  // navigation (#1414/#1417). The in-flight result panels (`toolCallState` /
  // `getPromptState` / `readResourceState`) stay separate — they're written by
  // the async action handlers below, not by the screens.
  const {
    ui,
    setUi,
    activeTab,
    setActiveTab,
    pinnedProtocolIds,
    setPinnedProtocolIds,
    togglePinProtocol,
    resetTabUiState,
  } = useTabUiState();
  // One stable ref mirroring every session value a long-lived callback needs
  // to read *currently* rather than as of the render that created it. Declared
  // here — ahead of its first reader — because a hook return is not provably
  // stable to `react-hooks/exhaustive-deps`, so consumers list it and would hit
  // the temporal dead zone if it came later. The two pending-OAuth slots are
  // written into it by `useOAuthRecovery`, which owns them (#2153).
  const sessionRef = useSessionRef({
    activeServerId,
    servers,
    inspectorClient,
  });

  // The narrow reset surface `useConnectionLifecycle` drops session-scoped UI
  // state through on disconnect — one entry per owner, rather than that
  // owner's individual setters (#2129). The log-level pair stays here because
  // it is App-owned state the connect path also seeds.
  const resetLogLevels = useCallback(() => {
    setCurrentLogLevel("info");
    // Re-seed rather than blank: the client restores its own opt-in from the
    // server setting at connect (`resetSessionState`), so blanking here would
    // leave the control reading Off while every modern request still carries
    // the level — visible on the auth-recovery path, which reconnects the same
    // client instance rather than rebuilding it (#1629, #1797).
    // The session ref is synced in a passive effect, so it still holds the
    // outgoing server's id when this runs from `onDisconnect` — which is what
    // lets the re-seed find its settings. Clearing that ref eagerly would take
    // the no-server branch below and silently drop this to Off.
    // Branch on the *server*, not its settings: an entry with no settings node
    // is the common case (`mcp.json` written by hand, never opened in Server
    // Settings), and there the default is right — it is what the seed and the
    // client both use. Only "no server at all" means Off.
    const outgoing = sessionRef.current.servers.find(
      (s) => s.id === sessionRef.current.activeServerId,
    );
    setModernLogLevel(
      outgoing ? (resolveModernLogLevel(outgoing.settings) ?? null) : null,
    );
  }, [sessionRef]);
  // #1629: seed the live modern per-request log level from the server setting
  // so the Logs-tab control reflects what the client stamps by default (the
  // client is seeded the same way in its constructor). "off" means not opted
  // in (null). Only affects modern connections.
  const seedModernLogLevel = useCallback(
    (settings: InspectorServerSettings | undefined) => {
      setModernLogLevel(resolveModernLogLevel(settings) ?? null);
    },
    [],
  );

  // Progress and task-status toasts, and the taskId → progress map the Tasks
  // screen renders from. Both hooks subscribe to the live client's events and
  // own their own toast-id bookkeeping.
  useProgressToasts(inspectorClient);
  const { progressByTaskId, resetTaskProgress, activeToolCallTaskIdRef } =
    useTaskToasts(inspectorClient);

  // Hook layer. Each hook subscribes to its respective event source and
  // re-renders the App on change. When `inspectorClient` / state managers
  // are null, the hooks degrade to empty results.
  const {
    status: connectionStatus,
    capabilities,
    clientCapabilities,
    serverInfo,
    instructions,
    protocolVersion,
    protocolEra,
    discoverResult,
    excludedTools,
    malformedListItems,
    lastError,
  } = useInspectorClient(inspectorClient);
  // What every settings write that landed on disk actually wrote, so a later
  // failed write can be rolled back to that rather than to a `servers` entry
  // frozen at the last successful list read (#2089).
  const lastPersistedSettings = useLastPersistedSettings(servers);
  // The active server's persisted paginated setting drives the display mode.
  // The sidebar toggle edits it (optimistically, below) and persists it.
  const activeServerEntry = servers.find((s) => s.id === activeServerId);
  const persistedPaginatedLists =
    activeServerEntry?.settings?.paginatedLists ?? false;
  // The optimistic override, held per server and superseded by the first
  // successful list read that rebuilds that server's entry. Per server rather
  // than one app-wide slot cleared on every active-entry change: the previous
  // shape dropped the override on a plain server switch, so an A → B → A round
  // trip fell back to A's stale entry and showed a value neither disk nor the
  // live client held (#2095).
  const paginatedListsOverride = usePaginatedListsOverride(servers);
  const paginatedLists =
    paginatedListsOverride.valueFor(activeServerId) ?? persistedPaginatedLists;
  const connected = connectionStatus === "connected";

  // Handshake telemetry. `connectStartRef` is stamped at the "connecting" edge
  // and consumed at the "connected" edge — a ref (not state) so the
  // intervening rerenders don't reset it. Declared here rather than inside
  // `useConnectionLifecycle` because `useOAuthRecovery`, which runs first,
  // stamps it too (#2154).
  const { connectStartRef, latencyMs } =
    useHandshakeTelemetry(connectionStatus);

  // The per-session state managers and the finished lists they feed. Owns the
  // create / destroy lifecycle, so the connection code below sees two stable
  // callbacks rather than twelve state slots.
  const {
    stores,
    createStores,
    destroyStores,
    fetchLogRef,
    refreshTools,
    refreshPrompts,
    refreshResources,
    loadToolsPage,
    loadPromptsPage,
    loadResourcesPage,
    toolsListChanged,
    clearToolsListChanged,
    promptsListChanged,
    clearPromptsListChanged,
    resourcesListChanged,
    clearResourcesListChanged,
    resourceTemplates,
    resourceTemplatesLoadError,
    refreshResourceTemplates,
    toolsPagination,
    promptsPagination,
    resourcesPagination,
    tasks,
    refreshTasks,
    clearCompletedTasks,
    skills,
    skillsPageCount,
    skillsLoadError,
    refreshSkills,
    subscriptions,
    subscriptionStreamState,
    messages,
    fetchRequests,
    stderrLogs,
  } = useInspectorStores({ inspectorClient, connected, paginatedLists });

  /**
   * Published below, once the connect path's `setupClientForServer` exists —
   * it reads `onBeforeOAuthRedirect` and `sessionStorageAdapter` out of the
   * hook we are about to call, so it cannot be declared before it.
   */
  const setupClientForServerRef = useRef<SetupClientForServer | null>(null);

  // Every path by which a lapsed authorization is noticed and recovered: the
  // re-auth banner, step-up, deferred background-tab recovery, the
  // `/oauth/callback` completion, and the redirect plumbing the connect path
  // below consumes (#2153).
  const {
    webOAuthStorage,
    sessionStorageAdapter,
    onBeforeOAuthRedirect,
    prepareOAuthRedirect,
    reAuthBanner,
    setReAuthBanner,
    resetOAuthRecoveryState,
    pendingStepUp,
    handleStepUpAuthorize,
    handleStepUpCancel,
    handleCommandScopedAuthRecovery,
    runWithCommandAuthRecovery,
    runCommandInBackground,
    connectionInfoOAuth,
    clearServerOAuthAndDisconnect,
    finalizeExplicitDisconnect,
  } = useOAuthRecovery({
    sessionRef,
    servers,
    activeServerId,
    inspectorClient,
    connectionStatus,
    activeTab,
    ui,
    setUi,
    setActiveTab,
    fetchLogRef,
    connectStartRef,
    initialConfigSettledRef,
    setupClientForServerRef,
    setActiveServerId,
    setFailedServerId,
    clearResultPanels,
    setSourceScopedError,
  });

  // The malformed-entry report is written by the aggregate walk's salvage. In
  // paginated mode the tools/prompts/resources panels render the paged stores
  // instead, which never write or clear it — so it would linger above a page it
  // does not describe. See `visibleMalformedListItems` (#1909 + #1721).
  const shownMalformedListItems = useMemo(
    () => visibleMalformedListItems(malformedListItems, paginatedLists),
    [malformedListItems, paginatedLists],
  );
  const tools = toolsPagination.items;
  const prompts = promptsPagination.items;
  const resources = resourcesPagination.items;

  // The session-scoped state each owner drops on disconnect. One `reset()`
  // per owner, handed to `useConnectionLifecycle` as a single object so the
  // connection hook does not take a dependency on every phase-1 hook (#2129).
  const sessionReset = useMemo(
    () => ({
      clearResultPanels,
      resetTabUiState,
      resetTaskProgress,
      resetOAuthRecoveryState,
      resetLogLevels,
      closeConnectionInfoModal,
    }),
    [
      clearResultPanels,
      resetTabUiState,
      resetTaskProgress,
      resetOAuthRecoveryState,
      resetLogLevels,
      closeConnectionInfoModal,
    ],
  );

  // MCP Apps runtime wiring (#2156): the sandbox bridge factories, the renderer
  // handle, and the app-rendered elicitation controller. Called here rather
  // than beside the other client-scoped hooks above because it reads the
  // resource listing, which is only derived at this point.
  const {
    appRendererRef,
    sandboxBridgeFactory,
    elicitationBridgeFactory,
    appElicitations,
    newAppElicitationSession,
    handleAppElicitationSettle,
    handleAppElicitationFail,
  } = useMcpApps({ inspectorClient, configBaseUrl, resources });

  // Deep-link parameters parsed once from the initial URL. Security gating
  // (auth-token match, http(s)-only serverUrl) happens inside `parseDeepLink`,
  // so a `DeepLink` value here is already validated. The parse status is
  // surfaced as `data-deeplink` so an automated driver can tell "no deep link"
  // from "deep link present but rejected" — both leave `data-status` idle.
  const [deepLink, deepLinkStatus] = useMemo<
    [DeepLink | undefined, DeepLinkParseStatus]
  >(() => {
    /* v8 ignore next -- SSR guard: happy-dom always defines window in tests */
    if (typeof window === "undefined") return [undefined, "none"];
    const search = window.location.search;
    const parsed = parseDeepLink(search, getAuthToken());
    return [parsed, deepLinkParseStatus(search, parsed)];
  }, []);

  // Everything about bringing a session up and taking it down: building the
  // client for a server, connecting, disconnecting, the effects that observe
  // those transitions, and the session-scoped reset a disconnect triggers
  // (#2154).
  const {
    connectedServerId,
    connectErrorMessage,
    onToggleConnection,
    onDisconnect,
    onReauthenticateFromBanner,
  } = useConnectionLifecycle({
    sessionRef,
    servers,
    activeServerId,
    inspectorClient,
    connectionStatus,
    addServer,
    updateServer,
    setActiveServerId,
    setFailedServerId,
    setInspectorClient,
    createStores,
    destroyStores,
    lastPersistedSettings,
    clientConfig,
    newAppElicitationSession,
    sandboxUrl,
    initialConfigSettledRef,
    connectStartRef,
    setupClientForServerRef,
    deepLink,
    webOAuthStorage,
    sessionStorageAdapter,
    onBeforeOAuthRedirect,
    prepareOAuthRedirect,
    finalizeExplicitDisconnect,
    reAuthBanner,
    setReAuthBanner,
    sessionReset,
    seedModernLogLevel,
  });

  // Fold the transport errors the SDK throws rather than delivers (e.g. -32601
  // on HTTP 404) onto their still-pending Protocol requests, by correlating with
  // the Network log via JSON-RPC id. Returns `messages` unchanged when nothing
  // matched, so the Protocol view only re-renders when an enrichment applies.
  const protocolEntries = useMemo(
    () => enrichProtocolEntries(messages, fetchRequests),
    [messages, fetchRequests],
  );

  // Surface the otherwise-invisible "response body dropped after rotation" case
  // (#1390) as a deduped toast that links to this server's Network Log Size
  // setting. The state manager only emits this when the drop is genuinely due
  // to rotation (log at capacity), not for benign post-clear stragglers.
  useEffect(() => {
    const fetchRequestLogState = stores?.fetchRequestLogState;
    if (!fetchRequestLogState || activeServerId === undefined) return;
    const onBodyDropped = (
      event: TypedEventGeneric<
        FetchRequestLogStateEventMap,
        "fetchRequestBodyDropped"
      >,
    ) => {
      notifications.show({
        id: bodyDroppedToastId(activeServerId),
        title: "Network log: response body dropped",
        color: "yellow",
        // Stays until dismissed (or the user opens settings via the link) so a
        // single toast represents an ongoing condition rather than flashing per
        // drop; the stable id dedupes a storm into this one toast.
        autoClose: false,
        message: (
          <FetchBodyDroppedToastMessage
            maxFetchRequests={event.detail.maxFetchRequests}
            onAdjust={() => {
              notifications.hide(bodyDroppedToastId(activeServerId));
              setSettingsModalTargetId(activeServerId);
            }}
          />
        ),
      });
    };
    fetchRequestLogState.addEventListener(
      "fetchRequestBodyDropped",
      onBodyDropped,
    );
    return () => {
      fetchRequestLogState.removeEventListener(
        "fetchRequestBodyDropped",
        onBodyDropped,
      );
    };
  }, [stores, activeServerId]);

  // Server-initiated sampling / elicitation requests. These arrive while a call
  // (e.g. a tool execution) is in flight and block it until the user responds.
  const { pendingSamples, pendingElicitations } =
    usePendingClientRequests(inspectorClient);

  // The Server Info modal needs the active server's transport and (optional)
  // OAuth details — both are co-located here so the modal opens against the
  // same connection snapshot the header is reading. Also feeds the
  // `initializeResult` serverInfo fallback below.
  const activeServer = useMemo<ServerEntry | undefined>(
    () => servers.find((s) => s.id === activeServerId),
    [servers, activeServerId],
  );

  // Whether the server actually reported `serverInfo`, vs. the catalog-name
  // fallback synthesized below. Threaded to the Connection Info modal so it can
  // show "not reported" instead of an inferred name that looks server-sent.
  const serverInfoReported = serverInfo !== undefined;

  // Build the InitializeResult the connected ViewHeader / Connection Info
  // modal expect from the hook's split fields. `protocolVersion` is the value
  // the InspectorClient negotiated during initialize (#1324); it's dispatched
  // alongside serverInfo, so in practice it's present whenever we're connected.
  // We gate only on `connectionStatus`, never on serverInfo or protocolVersion:
  // this object also drives the connected header (and its whole tab bar) and the
  // Connection Info modal, so a missing field must not hide those.
  //
  // A modern-era server's `server/discover` makes `serverInfo` OPTIONAL (SHOULD,
  // not MUST — it's stamped in `_meta["io.modelcontextprotocol/serverInfo"]`), so
  // a conforming modern server may omit it and `serverInfo` stays undefined even
  // while connected. Falling back to the catalog name (rather than returning
  // `undefined`) keeps the header + tabs rendered for those servers (#1772). It
  // fires for such a modern server — and, harmlessly, in the batched instant on
  // any connect (legacy included) between the `connected` status dispatch and the
  // `serverInfo` dispatch, which land in a single React render. The modal uses
  // `serverInfoReported` (above), not this name, to stay faithful.
  //
  // This `??` only covers an *absent* serverInfo. A server that *reports* a
  // blank name (`{ name: "" }`) is degraded for display a layer below, in
  // InspectorView's `resolveHeaderServerInfo` (#1774) — kept there so this
  // faithful object (and thus the modal) never carries a borrowed name.
  const initializeResult = useMemo<InitializeResult | undefined>(() => {
    if (connectionStatus !== "connected") return undefined;
    const resolvedServerInfo = serverInfo ?? {
      name: activeServer?.name ?? "",
      version: "",
    };
    return {
      protocolVersion: protocolVersion ?? "",
      capabilities: capabilities ?? {},
      serverInfo: resolvedServerInfo,
      ...(instructions ? { instructions } : {}),
    };
  }, [
    connectionStatus,
    capabilities,
    serverInfo,
    instructions,
    protocolVersion,
    activeServer,
  ]);

  // Surface a mid-session transport failure (stdio crash, SSE drop, HTTP 5xx)
  // as a toast. The handshake case is handled in `onToggleConnection`'s catch;
  // this covers the `status: connected → error` transition that fires the
  // client's `error` event without rejecting any awaited promise (#1323).
  // `lastError` clears at the next connecting edge, so each failure toasts once.
  useEffect(() => {
    if (!lastError) return;
    const name = sessionRef.current.activeServerName;
    notifications.show({
      title: name ? `Connection to "${name}" lost` : "Connection lost",
      message: lastError,
      color: "red",
    });
  }, [sessionRef, lastError]);

  // `config.type` is optional in the schema (a bare `command: ...`
  // entry implies stdio), so we materialize the default here rather
  // than at the render site — the modal's `transport` prop is a
  // required `ServerType`, and we only render the modal once we know
  // there's an active server (see the `{initializeResult && activeServer && …}`
  // guard below).
  const connectionInfoTransport: ServerType =
    activeServer?.config.type ?? "stdio";

  const connectionInfoCanClearOAuth =
    connectionStatus === "connected" &&
    !!inspectorClient &&
    (connectionInfoTransport === "streamable-http" ||
      connectionInfoTransport === "sse");

  // Derive log entries from the message log. Filters for
  // `notifications/message` (the response to `logging/setLevel`).
  const logs = useMemo<LogEntryData[]>(
    () => messagesToLogEntries(messages),
    [messages],
  );

  // Make the live client reflect one settings value, in full. Every path that
  // decides what the active server's settings *are* goes through this: the
  // settings modal's close (#1444), and each write's settled / rolled-back
  // reconciliation (#2089). It is one function because the live surface is more
  // than `setServerSettings` — a partial re-application would leave the Network
  // log sized for, and the server advertised roots from, a value that is not on
  // disk. Reads the client through its ref so a write outliving a reconnect
  // applies to the instance that exists now.
  const applyLiveServerSettings = useCallback(
    (settings: InspectorServerSettings) => {
      const client = sessionRef.current.inspectorClient;
      if (!client) return;
      // Settings the managed state reads at notification time
      // (auto-refresh-on-list-changed) take effect without a reconnect (#1444).
      // Connection-time inputs (transport, OAuth, timeouts) still only apply on
      // the next connect.
      client.setServerSettings(settings);
      // Resize the Network log buffer live so a maxFetchRequests edit takes
      // effect without a reconnect (shrinking trims immediately).
      fetchLogRef.current?.setMaxFetchRequests(settings.maxFetchRequests);
      // Root edits are diffed against what the client currently advertises
      // (both cleaned) and notified only when they differ: `setRoots` fires
      // `notifications/roots/list_changed`, which makes the server re-request
      // `roots/list`.
      const nextRoots = cleanRoots(settings.roots);
      const currentRoots = cleanRoots(client.getRoots());
      if (JSON.stringify(nextRoots) !== JSON.stringify(currentRoots)) {
        void client.setRoots(nextRoots).catch(() => {
          // setRoots swallows notification failures internally; a throw here
          // only means the client is mid-teardown — the persisted roots will
          // re-advertise on the next connect, so nothing to surface.
        });
      }
    },
    [sessionRef, fetchLogRef],
  );

  // --- Action handlers that route directly to the InspectorClient. Every one
  // of them routes through the command-scoped auth recovery above, which is
  // why they sit after it (#2155). ---
  const {
    onCallTool,
    onClearToolResult,
    onToolsUiChange,
    onGetPrompt,
    onReadResource,
    onReadResourceContents,
    onSubscribeResource,
    onUnsubscribeResource,
    onCompleteArgument,
    onCancelTask,
    onCancelToolCall,
    onClearCompletedTasks,
    onSetLogLevel,
    onSetModernLogLevel,
    onRefreshTools,
    onRefreshPrompts,
    onRefreshResources,
    onRefreshSkills,
    onReadSkillFile,
    onRefreshTasks,
    onTogglePaginatedLists,
    onLoadMoreTools,
    onLoadMorePrompts,
    onLoadMoreResources,
  } = useServerCommands({
    sessionRef,
    servers,
    activeServerId,
    activeServer,
    inspectorClient,
    connected,
    capabilities,
    tools,
    panels,
    selectedToolKey: ui.toolsUi.selectedToolKey,
    setToolsUi: setUi.setToolsUi,
    setUrlElicitationErrorDetails,
    setCurrentLogLevel,
    setModernLogLevel,
    activeToolCallTaskIdRef,
    clearCompletedTasks,
    refreshTasks,
    refreshSkills,
    paginatedLists,
    paginatedListsOverride,
    toolsPagination,
    promptsPagination,
    resourcesPagination,
    refreshTools,
    refreshPrompts,
    refreshResources,
    refreshResourceTemplates,
    clearToolsListChanged,
    clearPromptsListChanged,
    clearResourcesListChanged,
    loadToolsPage,
    loadPromptsPage,
    loadResourcesPage,
    lastPersistedSettings,
    applyLiveServerSettings,
    updateServerSettings,
    refreshInitialConfig,
    handleCommandScopedAuthRecovery,
    runWithCommandAuthRecovery,
    runCommandInBackground,
  });

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
        if (err instanceof AuthRecoveryRequiredError) {
          if (activeServerId) {
            const satisfied = await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "app",
            });
            if (!satisfied) {
              onAppError(
                new Error(
                  "Authorization required. Complete sign-in, then reopen the app.",
                ),
              );
            }
          }
          return;
        }
        // Transport-level failure (the call never returned a result). Surface it
        // so the user isn't left staring at a blank/partial app frame.
        onAppError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [
      inspectorClient,
      tools,
      onAppError,
      activeServerId,
      handleCommandScopedAuthRecovery,
      appRendererRef,
    ],
  );

  const onCloseApp = useCallback(() => {
    void appRendererRef.current?.teardown();
  }, [appRendererRef]);

  const toolsPaginationControls: ListPaginationControlsProps = {
    paginated: toolsPagination.paginated,
    onPaginatedChange: onTogglePaginatedLists,
    canLoadMore: toolsPagination.canLoadMore,
    loadedPages: toolsPagination.loadedPages,
    onLoadMore: onLoadMoreTools,
  };
  const promptsPaginationControls: ListPaginationControlsProps = {
    paginated: promptsPagination.paginated,
    onPaginatedChange: onTogglePaginatedLists,
    canLoadMore: promptsPagination.canLoadMore,
    loadedPages: promptsPagination.loadedPages,
    onLoadMore: onLoadMorePrompts,
  };
  const resourcesPaginationControls: ListPaginationControlsProps = {
    paginated: resourcesPagination.paginated,
    onPaginatedChange: onTogglePaginatedLists,
    canLoadMore: resourcesPagination.canLoadMore,
    loadedPages: resourcesPagination.loadedPages,
    onLoadMore: onLoadMoreResources,
  };

  // Clear / Export / Replay for the four log-ish views (Logs, Protocol,
  // Network, Console), plus the Protocol per-section variants.
  const {
    onClearLogs,
    onClearProtocol,
    onClearNetwork,
    onClearConsole,
    onExportLogs,
    onExportProtocol,
    onExportNetwork,
    onExportConsole,
    onClearProtocolSection,
    onExportProtocolSection,
    onReplayProtocol,
  } = useExportActions({
    activeServerId,
    messageLogState: stores?.messageLogState ?? null,
    fetchRequestLogState: stores?.fetchRequestLogState ?? null,
    stderrLogState: stores?.stderrLogState ?? null,
    messages,
    fetchRequests,
    logs,
    stderrLogs,
    pinnedProtocolIds,
    setPinnedProtocolIds,
    inspectorClient,
    tools,
  });

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
      destroyStores();
      setInspectorClient(null);
      setActiveServerId(undefined);
    }
    // Deleting sweeps the server's secrets from the store, which for a
    // file-backed store is a write — and a write is what performs the pending
    // plaintext-to-encrypted upgrade (#1950 review r22).
    await refreshingPersist(removeServer, refreshInitialConfig)(id);
    setRemoveTarget(null);
  }, [
    removeTarget,
    activeServerId,
    inspectorClient,
    destroyStores,
    removeServer,
    refreshInitialConfig,
  ]);

  // Submit handler for the Add / Edit / Clone modal. Add and Clone both go
  // through addServer; Edit uses updateServer (which supports id rename).
  // Add a server, then mark it as the freshly-added one so the list scrolls to
  // it and highlights it. Used by manual add/clone and both import flows; edits
  // and conflict-overwrites (updateServer) intentionally don't highlight.
  // Accumulates into the current highlight batch (a multi-server import adds
  // each id), deduped. The batch is reset to empty when an add/import modal
  // opens (see the menu handlers).
  const addServerHighlighted = useCallback(
    async (id: string, config: MCPServerConfig) => {
      const markAdded = () =>
        setHighlightedServerIds((ids) =>
          ids.includes(id) ? ids : [...ids, id],
        );
      try {
        await addServer(id, config);
      } catch (err) {
        // A failed list reload still means the row is on disk, so it belongs
        // in the highlight batch — the next successful refresh is what
        // renders it, and it would otherwise arrive unmarked (#1914 r2).
        if (err instanceof ServerListReloadError) markAdded();
        throw err;
      }
      markAdded();
    },
    [addServer],
  );

  // On rename of the active server, keep activeServerId pointed at the new id.
  const onConfigSubmit = useCallback(
    async (id: string, config: MCPServerConfig) => {
      if (configModal?.mode === "edit" && configModal.targetId) {
        const originalId = configModal.targetId;
        const followRename = () => {
          if (originalId === activeServerId && id !== originalId) {
            setActiveServerId(id);
          }
        };
        try {
          await updateServer(originalId, id, config);
        } catch (err) {
          // A `ServerListReloadError` means the PUT landed and only reading
          // the list back failed — the rename IS on disk. The active
          // selection has to follow it anyway, or the next successful
          // refresh leaves `activeServerId` pointing at an id that no longer
          // exists (#1914 r2). Still rethrow, so the modal shows the reload
          // error rather than closing as if nothing happened.
          if (err instanceof ServerListReloadError) followRename();
          throw err;
        }
        followRename();
        return;
      }
      // add or clone
      await addServerHighlighted(id, config);
    },
    [configModal, addServerHighlighted, updateServer, activeServerId],
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

  // An edit/clone modal whose target has left the list can no longer render a
  // coherent form: `initialId`/`initialConfig` go undefined, and
  // ServerConfigModal's own `useValueChange` reset then blanks the open form
  // *and* clears the error it is showing.
  //
  // Only reachable since #1914 made the modal stay open on a failed post-write
  // reload: rename A → B, the PUT lands, the reload fails, and the modal sits
  // there targeting A. The write itself is what triggers the backend's change
  // broadcast, so the SSE-driven background refresh that lands B (and drops A)
  // is the *likely* next event, not a remote one. Closing is right — the edit
  // is on disk and the list now agrees — and it covers the ordinary case too,
  // where an external mcp.json edit removes the server being edited.
  //
  // Adjusted during render rather than in an effect (see `useValueChange`), so
  // no frame ever paints the blanked form.
  useValueChange(
    configModal?.mode === "add" || configModal?.targetId === undefined
      ? true
      : servers.some((s) => s.id === configModal.targetId),
    (targetPresent) => {
      if (!targetPresent) setConfigModal(null);
    },
  );

  const settingsModalTarget = useMemo(() => {
    if (!settingsModalTargetId) return undefined;
    return servers.find((s) => s.id === settingsModalTargetId);
  }, [settingsModalTargetId, servers]);

  const settingsModalServerType = settingsModalTarget
    ? getServerType(settingsModalTarget.config)
    : "stdio";

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
    // Through the tracker rather than off `servers` directly: after a write
    // lands whose list reload failed, that entry still describes the previous
    // value, so seeding from it and saving an unrelated field would write the
    // superseded value straight back to disk (#2089). `resolve` falls back to
    // the entry when nothing has landed, so the ordinary case is unchanged.
    resolveInitial: (id) => lastPersistedSettings.resolve(id) ?? EMPTY_SETTINGS,
    // The saved settings may include an OAuth client secret or a stdio `env:`
    // value, and writing one can change what the secrets file *is* — the first
    // save under a newly-set passphrase re-encrypts a pre-existing plaintext
    // file. `refreshingPersist` re-asks the backend afterwards; it is a named
    // unit rather than an inline `await …; refresh()` because this file is
    // outside the coverage gate, so wiring written here is tested by nothing
    // (#1950 review r17).
    onPersist: async (id: string, value: InspectorServerSettings) => {
      // Announced before the request, like the toggle's own write: the debounced
      // flush can put two saves for one server in flight, and the later-issued
      // one describes disk however the two happen to finish (#2089).
      const write = lastPersistedSettings.begin(id);
      const settleSettingsWrite = () => {
        const settled = write.landed(value);
        if (!settled) return;
        paginatedListsOverride.record(id, value.paginatedLists ?? false);
        if (sessionRef.current.activeServerId === id) {
          applyLiveServerSettings(value);
        }
      };
      try {
        await refreshingPersist(updateServerSettings, refreshInitialConfig)(
          id,
          value,
        );
      } catch (err) {
        // A `ServerListReloadError` means the PUT landed and only reading the
        // list back failed, so this write did reach disk (#1914): record it
        // like the success path below instead of rolling anything back, and
        // rethrow so `onError` can say the reload — not the save — failed.
        if (err instanceof ServerListReloadError) {
          settleSettingsWrite();
          throw err;
        }
        // Stop counting as in flight before the rejection goes on to
        // `onError` — an earlier write still running settles the state once it
        // lands, and cannot know that while this one looks pending (#2089).
        write.failed();
        // A write that landed while this one was pending was told it was not
        // settled and so applied nothing; this save never reached disk, so that
        // write is the account of it and nothing else will re-apply it. Same
        // reconciliation the toggle's own failure path does.
        const baseline = lastPersistedSettings.resolve(id);
        if (baseline) {
          paginatedListsOverride.record(id, baseline.paginatedLists ?? false);
          if (sessionRef.current.activeServerId === id) {
            applyLiveServerSettings(baseline);
          }
        }
        throw err;
      }
      // Recorded for the same reason the pagination toggle records its own
      // write: this is what disk holds now, and the `servers` entry it was
      // edited from will keep describing the previous value for as long as list
      // reads keep failing. Both settings writers feed the same per-server
      // record, so a rollback in either takes the most recent write for that
      // server, not just the most recent write *of its own kind*.
      //
      // And the reconciliation is shared too, for the mixed-writer overlap: a
      // toggle failing while this save is in flight rolls the UI and the live
      // client back to a baseline this save then replaces on disk, so a settled
      // save has to re-apply itself exactly as a settled toggle does (#2089).
      settleSettingsWrite();
    },
    // Surface failures via toast — the modal usually closes
    // immediately on user dismiss, so a silent fail-on-flush would
    // leave the user thinking their last edits saved when they
    // didn't (especially painful for the OAuth client secret).
    onError: (id, err) => {
      notifications.show({
        // A `ServerListReloadError` means the PUT landed and only reading the
        // list back failed, so "Failed to save" would be false — and this
        // toast is the user's only signal here, since the modal has usually
        // closed by the time a flush rejects (#1914 r3).
        title:
          err instanceof ServerListReloadError
            ? `Saved settings for "${id}", but the server list did not reload`
            : `Failed to save settings for "${id}"`,
        message: err instanceof Error ? err.message : String(err),
        color: "red",
      });
    },
  });

  const settingsModalValue: InspectorServerSettings =
    settingsDraft ?? EMPTY_SETTINGS;

  const {
    draft: clientSettingsDraft,
    onChange: onClientSettingsChange,
    flush: flushClientSettingsDraft,
  } = useClientSettingsDraft({
    opened: clientSettingsOpen,
    resolveInitial: () => clientConfigToFormValues(clientConfig),
    // Wrapped for the same reason as the server-settings persist above: this
    // one can carry the enterprise IdP client secret, and that write is what
    // flips a pending-encryption file to encrypted.
    onPersist: refreshingPersist(async (values) => {
      if (!canPersistClientSettingsDraft(values)) return;
      const next = formValuesToClientConfig(values);
      await saveClientConfigRemote(next, {
        baseUrl: configBaseUrl,
        authToken: getAuthToken(),
      });
      setClientConfig(next);
    }, refreshInitialConfig),
    onError: (err) => {
      notifications.show({
        title: "Failed to save client settings",
        message: formatClientConfigLoadError(err),
        color: "red",
      });
    },
  });

  const clientSettingsModalValue = clientSettingsDraft ?? EMPTY_CLIENT_SETTINGS;

  const { loginState: emaIdpLoginState, logout: logoutEmaIdp } =
    useEmaIdpLoginState(
      webOAuthStorage,
      clientSettingsModalValue.emaEnabled
        ? clientSettingsModalValue.issuer
        : undefined,
      clientSettingsOpen,
    );

  const onClientSettingsModalClose = useCallback(() => {
    // Only fires when ClientSettingsModal allows the close (it blocks on an
    // invalid issuer and reveals the error instead). The implicit "save" is the
    // flush below; the persist gate drops anything still incomplete.
    flushClientSettingsDraft();
    setClientSettingsOpen(false);
  }, [flushClientSettingsDraft]);

  // Gate the stdio-only Working Directory / Environment Variables controls in
  // the settings modal. Derived from the resolved target server's transport
  // (see `settingsModalServerType` above), which defaults to "stdio" when the
  // target isn't resolvable.
  const settingsModalIsStdio = settingsModalServerType === "stdio";

  /**
   * Servers whose clear is in flight (#2144). Keyed per server, not a single
   * flag: the callback explicitly supports clearing a server other than the
   * active one, so a global lock would silently drop B's click while A's
   * revocation was still out. See `runClear`.
   */
  const clearOAuthInFlightRef = useRef<Set<string>>(new Set());

  /**
   * Run a clear from a key/click handler, which cannot await.
   *
   * `clearServerOAuthAndDisconnect` does **not** own its failures — the store
   * write or the disconnect can reject — so a bare `void` would produce an
   * unhandled rejection and leave the user with a control that silently did
   * nothing. (An RFC 7009 failure is not this: those come back as an outcome
   * and are already reported in the success toast.)
   */
  const runClear = useCallback(
    (server: Parameters<typeof clearServerOAuthAndDisconnect>[0]) => {
      // Shared by BOTH clear controls (Connection Info and Server Settings),
      // because for one server they drive the same client and the same store
      // entry. A ref rather than state: a double click delivers both events
      // before React re-renders, so a state-based guard would let both through
      // — and with revocation taking up to five seconds, that means concurrent
      // RFC 7009 requests, concurrent store writes, and two contradictory
      // toasts. Keyed by server so a *different* server's clear is unaffected.
      //
      // "Different server" is the OAuth storage key, not the catalog id
      // (#2217, Copilot): two entries against one URL share one blob, one
      // grant and one revocation, so an id-keyed guard lets exactly the race
      // above through between them. And for anything touching the live
      // session the key is the *client's*, not the entry's — an entry edited
      // while connected reads a URL the session never authorized against, so
      // an entry-keyed lock would name an operation nobody is performing.
      // `resolveOAuthClearIdentity` is the same call the clear itself makes,
      // so the two cannot disagree.
      const { inFlightKey } = resolveOAuthClearIdentity({
        server,
        activeServerId,
        activeClientConfig: inspectorClient?.getTransportConfig(),
        activeEntryConfig: activeServer?.config,
      });
      if (clearOAuthInFlightRef.current.has(inFlightKey)) return;
      clearOAuthInFlightRef.current.add(inFlightKey);
      clearServerOAuthAndDisconnect(server)
        .finally(() => {
          clearOAuthInFlightRef.current.delete(inFlightKey);
        })
        .catch((err: unknown) => {
          notifications.show({
            title: "Could not clear the stored OAuth state",
            message: err instanceof Error ? err.message : String(err),
            color: "red",
            // The tokens may still be on disk and the session may still be up,
            // so this is not a notice to let time out.
            autoClose: false,
          });
        });
    },
    [
      clearServerOAuthAndDisconnect,
      activeServerId,
      inspectorClient,
      activeServer,
    ],
  );

  const handleClearConnectionOAuth = useCallback(() => {
    if (!activeServer) return;
    runClear(activeServer);
  }, [activeServer, runClear]);

  const handleClearStoredOAuthFromSettings = useCallback(() => {
    if (!settingsModalTarget) return;
    // Clear from *inside* the settings modal, so the draft is what the user is
    // looking at rather than what the debounced save has persisted (#2144).
    runClear(serverWithDraftSettings(settingsModalTarget, settingsDraft));
  }, [settingsModalTarget, settingsDraft, runClear]);

  const onSettingsModalClose = useCallback(() => {
    flushSettingsDraft();
    // Apply root edits to the live client once, on close — not on every
    // keystroke. `setRoots` fires `notifications/roots/list_changed`, which
    // makes the server re-request `roots/list`; doing that per character while
    // the user types a URI would flood the wire. We diff the final draft roots
    // against what the client currently advertises (both cleaned) and notify
    // only when they actually differ, and only for the connected server.
    if (
      inspectorClient &&
      settingsModalTargetId !== undefined &&
      settingsModalTargetId === activeServerId &&
      settingsDraft
    ) {
      // Normally the draft is what the user just saved, so it is also what is
      // on disk. When this server's last write *rejected* it is not: the draft
      // still holds the failed edit, and applying it here would contradict disk
      // and undo the rollback that reported the failure — so apply what landed
      // instead. `EMPTY_SETTINGS`, not the draft, when nothing has ever landed
      // for this server: falling back to the draft would re-apply the very
      // values that failed (#2089).
      const applied = lastPersistedSettings.lastWriteFailed(
        settingsModalTargetId,
      )
        ? (lastPersistedSettings.resolve(settingsModalTargetId) ??
          EMPTY_SETTINGS)
        : settingsDraft;
      applyLiveServerSettings(applied);
    }
    setSettingsModalTargetId(undefined);
  }, [
    flushSettingsDraft,
    inspectorClient,
    settingsModalTargetId,
    activeServerId,
    settingsDraft,
    lastPersistedSettings,
    applyLiveServerSettings,
  ]);

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

  // Surface one pending server-initiated request at a time in the modal,
  // sampling-first. Responding (below) removes it from the client's queue,
  // which re-renders this with the next request or closes the modal.
  const totalPendingRequests =
    pendingSamples.length + pendingElicitations.length;

  // Derive the head request inside the memo (depending on the source arrays)
  // so the memo actually caches — an inline `activeElicitation` would have a
  // fresh identity every render and defeat it.
  const pendingRequestContent =
    useMemo<PendingClientRequestContent | null>(() => {
      const activeSample = pendingSamples[0];
      if (activeSample) {
        return {
          kind: "sampling",
          id: activeSample.id,
          request: activeSample.request.params,
          origin: activeSample.origin,
        };
      }
      const activeElicitation = pendingElicitations[0];
      if (activeElicitation) {
        const params = activeElicitation.request.params;
        if ("url" in params) {
          return {
            kind: "elicitation-url",
            id: activeElicitation.id,
            message: params.message,
            url: params.url,
            origin: activeElicitation.origin,
          };
        }
        return {
          kind: "elicitation-form",
          id: activeElicitation.id,
          request: params,
          origin: activeElicitation.origin,
        };
      }
      return null;
    }, [pendingSamples, pendingElicitations]);

  // A remaining-count hint shown only when more than the displayed head is
  // queued. The modal always shows the head, so a "1 of N" position would be
  // misleading — the leading "1" never changes.
  const queueLabel =
    totalPendingRequests > 1 ? `${totalPendingRequests} pending` : "";

  const onSamplingRespond = useCallback(
    (result: CreateMessageResult) => {
      void pendingSamples[0]?.respond(result);
    },
    [pendingSamples],
  );

  const onSamplingReject = useCallback(() => {
    void pendingSamples[0]?.reject(
      new Error("Sampling request rejected by user."),
    );
  }, [pendingSamples]);

  const onElicitationRespond = useCallback(
    (result: ElicitResult) => {
      const pending = pendingElicitations[0];
      if (!pending) return;
      // "Cancel" on a MODERN task's input_required request means "give up on the
      // task" — not "send a cancel answer" (which a non-advancing server would
      // just re-prompt on). Cancel the underlying task instead; that aborts the
      // pending request, closes this modal, and lets the poll settle as
      // cancelled (#1631). Submit/Decline still answer the task normally.
      if (
        result.action === "cancel" &&
        pending.origin === "task-input-required" &&
        pending.taskId &&
        inspectorClient
      ) {
        void inspectorClient.cancelRequestorTask(pending.taskId);
        return;
      }
      void pending.respond(result);
    },
    [pendingElicitations, inspectorClient],
  );

  // --- InspectorView prop bundles (#2130) -----------------------------------
  //
  // The view takes one prop per domain, so the JSX below reads as a component
  // tree rather than a wall of ~130 props. Everything the bundles need is
  // assembled here: the handlers that used to be multi-line closures declared
  // inline in the JSX are named callbacks, and the `void`-discarding wrappers
  // carry their justification once rather than at a call site.

  const onServerAdd = useCallback(() => {
    setHighlightedServerIds([]);
    setConfigModal({ mode: "add" });
  }, []);

  const onServerImportConfig = useCallback(() => {
    setHighlightedServerIds([]);
    setImportConfigOpen(true);
  }, []);

  const onServerImportJson = useCallback(() => {
    setHighlightedServerIds([]);
    setImportJsonOpen(true);
  }, []);

  const onServerEdit = useCallback((id: string) => {
    setConfigModal({ mode: "edit", targetId: id });
  }, []);

  const onServerClone = useCallback((id: string) => {
    setHighlightedServerIds([]);
    setConfigModal({ mode: "clone", targetId: id });
  }, []);

  const onServerRemove = useCallback(
    (id: string) => {
      const target = servers.find((s) => s.id === id);
      if (target) setRemoveTarget(target);
    },
    [servers],
  );

  const onServerReorderFromList = useCallback(
    (orderedIds: string[]) => {
      // reorderServers reverts the optimistic order via an internal refresh()
      // and re-throws on failure (409 from a racing external edit, or a network
      // error). Surface that to the user so the drag doesn't silently bounce
      // back — matching the toast pattern every other mutation here uses.
      reorderServers(orderedIds).catch((err: unknown) => {
        notifications.show({
          title: "Failed to reorder servers",
          message: err instanceof Error ? err.message : String(err),
          color: "red",
        });
      });
    },
    [reorderServers],
  );

  const openClientSettings = useCallback(() => setClientSettingsOpen(true), []);
  const openConnectionInfo = useCallback(
    () => setConnectionInfoModalOpen(true),
    [],
  );
  const openServerSettings = useCallback(
    (id: string) => setSettingsModalTargetId(id),
    [],
  );

  // Every `InspectorView` action prop is synchronous while the handler behind
  // it is async, so each wrapper below has to terminate its promise somehow.
  // They all do it the same way: a reporting `.catch`, never a bare `void`.
  //
  // The uniformity is the point. Deciding per handler whether it "owns its
  // failures" is a judgement this PR got wrong twice (#2130 review) — the
  // handlers really do catch their ordinary errors, but a rejection can still
  // escape by a route the reading misses:
  //
  //   - `onToggleConnection` awaits `initialConfigSettledRef` and constructs
  //     the client via `setupClientForServer` outside its own try/catch, and
  //     its already-connected branch is a `try/finally` that lets a failed
  //     transport close propagate. `onDisconnect` is that `try/finally` alone.
  //   - `onCallTool` / `onGetPrompt` / `onReadResource` / `onOpenApp` await
  //     `handleCommandScopedAuthRecovery` from *inside* their catch blocks, and
  //     a rejection thrown from a catch is not caught by that same catch. That
  //     helper awaits `checkAuthChallengeSatisfied` and `pushRemoteAuthState`,
  //     both of which reach the backend and can reject.
  //
  // A handler that does surface its own failure resolves, so it never reaches
  // this `.catch` and there is no double-toast; what lands here is only the
  // escape, which would otherwise be a global unhandled rejection with nothing
  // shown to the user.
  const dispatchToggleConnection = useCallback(
    (id: string) => {
      onToggleConnection(id).catch(
        reportDispatchFailure("Failed to change the connection"),
      );
    },
    [onToggleConnection],
  );
  const dispatchDisconnect = useCallback(() => {
    onDisconnect().catch(reportDispatchFailure("Failed to disconnect"));
  }, [onDisconnect]);
  const dispatchCallTool = useCallback(
    (name: string, args: Record<string, unknown>, runAsTask?: boolean) => {
      onCallTool(name, args, runAsTask).catch(
        reportDispatchFailure("Tool call failed"),
      );
    },
    [onCallTool],
  );
  const dispatchGetPrompt = useCallback(
    (name: string, args: Record<string, string>) => {
      onGetPrompt(name, args).catch(
        reportDispatchFailure("Failed to get prompt"),
      );
    },
    [onGetPrompt],
  );
  const dispatchReadResource = useCallback(
    (uri: string) => {
      onReadResource(uri).catch(
        reportDispatchFailure("Failed to read resource"),
      );
    },
    [onReadResource],
  );
  const dispatchCancelTask = useCallback(
    (taskId: string) => {
      onCancelTask(taskId).catch(
        reportDispatchFailure("Failed to cancel task"),
      );
    },
    [onCancelTask],
  );
  const dispatchOpenApp = useCallback(
    (name: string, args: Record<string, unknown>) => {
      onOpenApp(name, args).catch(reportDispatchFailure("Failed to open app"));
    },
    [onOpenApp],
  );

  const shellProps: ShellProps = {
    deepLink,
    deepLinkStatus,
    version: inspectorVersion,
    malformedListItems: shownMalformedListItems,
    activeTab,
    onActiveTabChange: setActiveTab,
    onToggleTheme,
    onOpenClientSettings: openClientSettings,
  };

  const connectionProps: ConnectionProps = {
    activeServer: activeServerId,
    erroredServerId: failedServerId,
    connectedServerId,
    connectionStatus,
    connectErrorMessage,
    initializeResult,
    latencyMs,
    protocolEra,
    onCompleteArgument,
    completionsSupported: capabilities?.completions !== undefined,
    onToggleConnection: dispatchToggleConnection,
    onDisconnect: dispatchDisconnect,
  };

  const serverListProps: ServerListProps = {
    servers,
    serverListWritable,
    highlightedServerIds,
    onClearHighlight: clearHighlight,
    onServerAdd,
    onServerImportConfig,
    onServerImportJson,
    onServerExport,
    onConnectionInfo: openConnectionInfo,
    onServerSettings: openServerSettings,
    onServerEdit,
    onServerClone,
    onServerRemove,
    onServerReorder: onServerReorderFromList,
  };

  const toolsPanelProps: ToolsPanelProps = {
    tools,
    excludedTools,
    toolsListChanged,
    toolsLoadError: toolsPagination.error,
    toolsUi: ui.toolsUi,
    toolCallState,
    toolsPagination: toolsPaginationControls,
    serverSupportsTaskToolCalls:
      !!capabilities?.tasks?.requests?.tools?.call ||
      (inspectorClient?.isTasksExtensionNegotiated() ?? false),
    onToolsUiChange,
    onCallTool: dispatchCallTool,
    onCancelToolCall,
    onClearToolResult,
    onRefreshTools,
    onReadResourceContents,
  };

  const promptsPanelProps: PromptsPanelProps = {
    prompts,
    promptsListChanged,
    promptsLoadError: promptsPagination.error,
    promptsUi: ui.promptsUi,
    getPromptState,
    promptsPagination: promptsPaginationControls,
    onPromptsUiChange: setUi.setPromptsUi,
    onGetPrompt: dispatchGetPrompt,
    onRefreshPrompts,
  };

  const resourcesPanelProps: ResourcesPanelProps = {
    resources,
    resourceTemplates,
    subscriptions,
    subscriptionStreamState,
    subscriptionsSupported: capabilities?.resources?.subscribe === true,
    resourcesListChanged,
    resourcesLoadError: resourcesPagination.error ?? resourceTemplatesLoadError,
    resourcesUi: ui.resourcesUi,
    readResourceState: effectiveReadResourceState,
    resourcesPagination: resourcesPaginationControls,
    onResourcesUiChange: setUi.setResourcesUi,
    onReadResource: dispatchReadResource,
    onSubscribeResource,
    onUnsubscribeResource,
    onRefreshResources,
  };

  const appsPanelProps: AppsPanelProps = {
    appsUi: ui.appsUi,
    sandboxPath: sandboxUrl,
    bridgeFactory: sandboxBridgeFactory,
    appRendererRef,
    onAppsUiChange: setUi.setAppsUi,
    onSelectApp,
    onOpenApp: dispatchOpenApp,
    onCloseApp,
    onAppError,
    // The Apps tab is a filtered view of the tools list, so refreshing it is
    // refreshing tools.
    onRefreshApps: onRefreshTools,
  };

  const skillsPanelProps: SkillsPanelProps = {
    skills,
    skillsPageCount,
    skillsLoadError,
    skillsUi: ui.skillsUi,
    onSkillsUiChange: setUi.setSkillsUi,
    onRefreshSkills,
    onReadSkillFile,
  };

  const tasksPanelProps: TasksPanelProps = {
    tasks,
    progressByTaskId,
    tasksUi: ui.tasksUi,
    onTasksUiChange: setUi.setTasksUi,
    onCancelTask: dispatchCancelTask,
    onClearCompletedTasks,
    onRefreshTasks,
  };

  const logsPanelProps: LogsPanelProps = {
    logs,
    logsUi: ui.logsUi,
    currentLogLevel,
    modernLogLevel,
    onSetLogLevel,
    onSetModernLogLevel,
    onLogsUiChange: setUi.setLogsUi,
    onClearLogs,
    onExportLogs,
  };

  const protocolPanelProps: ProtocolPanelProps = {
    protocol: protocolEntries,
    protocolUi: ui.protocolUi,
    pinnedProtocolIds,
    onProtocolUiChange: setUi.setProtocolUi,
    onClearProtocol,
    onExportProtocol,
    onClearProtocolSection,
    onExportProtocolSection,
    onReplayProtocol,
    onTogglePinProtocol: togglePinProtocol,
  };

  const networkPanelProps: NetworkPanelProps = {
    network: fetchRequests,
    networkUi: ui.networkUi,
    onNetworkUiChange: setUi.setNetworkUi,
    onClearNetwork,
    onExportNetwork,
  };

  const consolePanelProps: ConsolePanelProps = {
    stderrLogs,
    consoleUi: ui.consoleUi,
    onConsoleUiChange: setUi.setConsoleUi,
    onClearConsole,
    onExportConsole,
  };

  return (
    <>
      <Box>
        {reAuthBanner ? (
          <ReAuthBannerBar>
            <ReAuthBanner
              message={reAuthBanner.message}
              title={reAuthBanner.title}
              actionLabel={reAuthBanner.actionLabel}
              onReauthenticate={onReauthenticateFromBanner}
              onDismiss={() => setReAuthBanner(null)}
            />
          </ReAuthBannerBar>
        ) : null}
        <InspectorView
          shell={shellProps}
          connection={connectionProps}
          servers={serverListProps}
          tools={toolsPanelProps}
          prompts={promptsPanelProps}
          resources={resourcesPanelProps}
          apps={appsPanelProps}
          skills={skillsPanelProps}
          tasks={tasksPanelProps}
          logs={logsPanelProps}
          protocol={protocolPanelProps}
          network={networkPanelProps}
          console={consolePanelProps}
        />
      </Box>
      <AppElicitationHost
        entries={appElicitations}
        sandboxPath={sandboxUrl}
        bridgeFactory={elicitationBridgeFactory}
        onSettle={handleAppElicitationSettle}
        onFail={handleAppElicitationFail}
      />
      <ServerConfigModal
        opened={configModal !== null}
        mode={configModal?.mode ?? "add"}
        initialId={configModalTarget?.id}
        initialConfig={configModalTarget?.config}
        existingIds={existingIds}
        onClose={() => setConfigModal(null)}
        // Wrapped like the settings persists: this submit carries stdio `env`
        // values, so it can perform the pending plaintext-to-encrypted
        // upgrade and change the descriptor the footer reports.
        onSubmit={refreshingPersist(onConfigSubmit, refreshInitialConfig)}
        secretStorage={secretStorage}
      />
      <ServerImportConfigModal
        opened={importConfigOpen}
        existingIds={existingIds}
        // Refreshed once per import batch, not per entry. `useImportClientConfig`
        // applies every addition and conflict sequentially, and on an encrypted
        // file store each `/api/config` authenticates the whole file with a
        // scrypt derivation — so wrapping the per-entry callbacks made a
        // 20-server import pay 20 serialized KDFs and round trips. Closing is
        // the batch boundary: the modal must be dismissed before the settings
        // footer that reads this descriptor can be reached, and closing also
        // covers a partially-failed batch (#1950 review r26).
        onClose={() => {
          setImportConfigOpen(false);
          refreshInitialConfig();
        }}
        onFetchSource={importSource}
        onAddServer={addServerHighlighted}
        onUpdateServer={updateServer}
      />
      <ServerImportJsonModal
        opened={importJsonOpen}
        existingIds={existingIds}
        onClose={() => setImportJsonOpen(false)}
        onAddServer={refreshingPersist(
          addServerHighlighted,
          refreshInitialConfig,
        )}
      />
      <ServerSettingsModal
        // Remount per open (and per target server) so the accordion resets to
        // its initial "options" section — the body-dropped toast deep-links
        // here expecting the Network Log Size control to be visible.
        key={settingsModalTargetId ?? "server-settings-closed"}
        opened={settingsModalTargetId !== undefined}
        settings={settingsModalValue}
        serverType={settingsModalServerType}
        isStdio={settingsModalIsStdio}
        // The negotiated era only applies when this settings modal targets the
        // live-connected server; otherwise the server isn't connected and the
        // era is unknown (#1629). Lets the form hide the modern log-level control
        // once an `auto` server resolves to legacy.
        negotiatedEra={
          connectionStatus === "connected" &&
          settingsModalTargetId === activeServerId
            ? protocolEra
            : undefined
        }
        onClose={onSettingsModalClose}
        onSettingsChange={onSettingsChange}
        onClearStoredOAuth={
          settingsModalIsStdio ? undefined : handleClearStoredOAuthFromSettings
        }
        secretStorage={secretStorage}
      />
      <ClientSettingsModal
        key={
          clientSettingsOpen ? "client-settings-open" : "client-settings-closed"
        }
        opened={clientSettingsOpen}
        settings={clientSettingsModalValue}
        onClose={onClientSettingsModalClose}
        onSettingsChange={onClientSettingsChange}
        emaIdpLoginState={emaIdpLoginState}
        onEmaIdpLogout={logoutEmaIdp}
        secretStorage={secretStorage}
      />
      {initializeResult && activeServer && (
        <ConnectionInfoModal
          opened={connectionInfoModalOpen}
          onClose={() => setConnectionInfoModalOpen(false)}
          initializeResult={initializeResult}
          serverInfoReported={serverInfoReported}
          clientCapabilities={clientCapabilities}
          transport={connectionInfoTransport}
          protocolEra={protocolEra}
          discoverResult={discoverResult}
          oauth={connectionInfoOAuth}
          onClearOAuth={
            connectionInfoCanClearOAuth ? handleClearConnectionOAuth : undefined
          }
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
      <UrlElicitationErrorModal
        opened={urlElicitationErrorDetails !== null}
        toolName={urlElicitationErrorDetails?.toolName}
        details={urlElicitationErrorDetails?.details}
        onClose={() => setUrlElicitationErrorDetails(null)}
      />
      <PendingClientRequestModal
        request={pendingRequestContent}
        serverName={activeServer?.name ?? "this server"}
        queuePosition={queueLabel}
        onSamplingRespond={onSamplingRespond}
        onSamplingReject={onSamplingReject}
        onElicitationRespond={onElicitationRespond}
      />
      <StepUpAuthModal
        opened={
          pendingStepUp !== null && pendingStepUp.serverId === activeServerId
        }
        challenge={pendingStepUp?.challenge ?? null}
        authorizationScopes={pendingStepUp?.challenge?.authorizationScopes}
        enterpriseManaged={pendingStepUp?.enterpriseManaged}
        onAuthorize={handleStepUpAuthorize}
        onCancel={handleStepUpCancel}
      />
    </>
  );
}

export default App;
