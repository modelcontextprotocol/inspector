import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  Box,
  List,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type {
  CreateMessageResult,
  ElicitResult,
  InitializeResult,
  LoggingLevel,
  LoggingMessageNotification,
  Progress,
  ProgressToken,
  Task,
  Tool,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { getServerType } from "@inspector/core/mcp/config.js";
import type {
  InspectorClientEventMap,
  JsonValue,
} from "@inspector/core/mcp/index.js";
import type { TypedEvent } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import {
  getUrlElicitationsFromError,
  UrlElicitationLoopError,
} from "@inspector/core/mcp/urlElicitation.js";
import { ToolCallCancelledError } from "@inspector/core/mcp/toolCallCancelledError.js";
import type { TypedEventGeneric } from "@inspector/core/mcp/typedEventTarget.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  MessageEntry,
  ServerEntry,
  ServerType,
} from "@inspector/core/mcp/types.js";
import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
  eraToVersionNegotiation,
} from "@inspector/core/mcp/types.js";
import {
  API_SERVER_ENV_VARS,
  INSPECTOR_API_TOKEN_GLOBAL,
} from "@inspector/core/mcp/remote/constants.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState.js";
import { PagedToolsState } from "@inspector/core/mcp/state/pagedToolsState.js";
import { PagedPromptsState } from "@inspector/core/mcp/state/pagedPromptsState.js";
import { PagedResourcesState } from "@inspector/core/mcp/state/pagedResourcesState.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState.js";
import { ResourceSubscriptionsState } from "@inspector/core/mcp/state/resourceSubscriptionsState.js";
import {
  cleanRoots,
  serializeMcpConfig,
} from "@inspector/core/mcp/serverList.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  getActiveCimdClientMetadataUrl,
  getActiveEnterpriseManagedAuthIdp,
} from "@inspector/core/client/types.js";
import { isEmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import {
  loadClientConfigRemote,
  saveClientConfigRemote,
} from "@inspector/core/client/remote.js";
import { formatClientConfigLoadError } from "@inspector/core/client/config-parse.js";
import { MessageLogState } from "@inspector/core/mcp/state/messageLogState.js";
import { FetchRequestLogState } from "@inspector/core/mcp/state/fetchRequestLogState.js";
import type { FetchRequestLogStateEventMap } from "@inspector/core/mcp/state/fetchRequestLogState.js";
import { StderrLogState } from "@inspector/core/mcp/state/stderrLogState.js";
import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";
import {
  parseOAuthCallbackParams,
  parseOAuthState,
  generateOAuthErrorDescription,
  formatOAuthFailureDetail,
} from "@inspector/core/auth/index.js";
import { RemoteInspectorClientStorage } from "@inspector/core/mcp/remote/index.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import { useServers } from "@inspector/core/react/useServers.js";
import { useSettingsDraft } from "@inspector/core/react/useSettingsDraft.js";
import { useClientSettingsDraft } from "@inspector/core/react/useClientSettingsDraft.js";
import { useEmaIdpLoginState } from "@inspector/core/react/useEmaIdpLoginState.js";
import { getWebRemoteOAuthStorage } from "./lib/remoteOAuthStorage";
import { useManagedTools } from "@inspector/core/react/useManagedTools.js";
import { useManagedPrompts } from "@inspector/core/react/useManagedPrompts.js";
import { useManagedResources } from "@inspector/core/react/useManagedResources.js";
import { usePagedTools } from "@inspector/core/react/usePagedTools.js";
import { usePagedPrompts } from "@inspector/core/react/usePagedPrompts.js";
import { usePagedResources } from "@inspector/core/react/usePagedResources.js";
import { usePaginatedList } from "./hooks/usePaginatedList";
import type { ListPaginationControlsProps } from "./components/elements/ListPaginationControls/ListPaginationControls";
import { useManagedResourceTemplates } from "@inspector/core/react/useManagedResourceTemplates.js";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks.js";
import { useResourceSubscriptions } from "@inspector/core/react/useResourceSubscriptions.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useFetchRequestLog } from "@inspector/core/react/useFetchRequestLog.js";
import { useStderrLog } from "@inspector/core/react/useStderrLog.js";
import { useSandboxUrl } from "@inspector/core/react/useSandboxUrl.js";
import { useServerListWritable } from "@inspector/core/react/useServerListWritable.js";
import { useInspectorVersion } from "@inspector/core/react/useInspectorVersion.js";
import { usePendingClientRequests } from "@inspector/core/react/usePendingClientRequests.js";
import { InspectorView } from "./components/views/InspectorView/InspectorView";
import type {
  ToolCallState,
  ToolsUiState,
} from "./components/screens/ToolsScreen/ToolsScreen";
import type { GetPromptState } from "./components/screens/PromptsScreen/PromptsScreen";
import type { ReadResourceState } from "./components/screens/ResourcesScreen/ResourcesScreen";
import type { TaskProgress } from "./components/groups/TaskCard/TaskCard";
import {
  EMPTY_TOOLS_UI,
  EMPTY_PROMPTS_UI,
  EMPTY_RESOURCES_UI,
  EMPTY_APPS_UI,
  EMPTY_TASKS_UI,
  EMPTY_LOGS_UI,
  EMPTY_PROTOCOL_UI,
  EMPTY_NETWORK_UI,
  EMPTY_CONSOLE_UI,
} from "./components/screens/screenUiState";
import { clearScrollMemory } from "./hooks/useScrollMemory";
import type { AppRendererHandle } from "./components/elements/AppRenderer/AppRenderer";
import { createAppBridgeFactory } from "./components/elements/AppRenderer/createAppBridgeFactory";
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
import { oauthDetailsFromConnectionState } from "./components/groups/ConnectionInfoContent/oauthDetailsFromConnectionState";
import { OutputValidationModal } from "./components/groups/OutputValidationModal/OutputValidationModal";
import { UrlElicitationErrorModal } from "./components/groups/UrlElicitationErrorModal/UrlElicitationErrorModal";
import { isReplayableProtocolMethod } from "./components/groups/protocolUtils.js";
import type { OAuthDetails } from "./components/groups/ConnectionInfoContent/ConnectionInfoContent";
import { ServerRemoveConfirmModal } from "./components/groups/ServerRemoveConfirmModal/ServerRemoveConfirmModal";
import { StepUpAuthModal } from "./components/groups/StepUpAuthModal/StepUpAuthModal";
import { ReAuthBanner } from "./components/groups/ReAuthBanner/ReAuthBanner";
import {
  PendingClientRequestModal,
  type PendingClientRequestContent,
} from "./components/groups/PendingClientRequestModal/PendingClientRequestModal";
import { buildExportFilename, downloadJsonFile } from "./lib/downloadFile";
import { INSPECTOR_SERVERS_TAB } from "./utils/inspectorTabs";
import { enrichProtocolEntries } from "./utils/correlateTransportErrors";
import {
  parseDeepLink,
  deepLinkConfigEquals,
  deepLinkParseStatus,
} from "./utils/deepLink";
import type { DeepLink, DeepLinkParseStatus } from "./utils/deepLink";
import {
  applyOAuthResumeUi,
  buildTabUiSnapshot,
  clearOAuthResumeSnapshot,
  consumeOAuthResumeSnapshot,
  oauthResumeInsufficientScopeMessage,
  oauthResumeToastMessage,
  writeOAuthResumeSnapshot,
  type OAuthResumeAuthKind,
} from "./utils/oauthResume";
import { createWebEnvironment } from "./lib/environmentFactory";
import { OAUTH_CALLBACK_PATH, isUnauthorizedError } from "./utils/oauthFlow";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import type {
  AuthChallenge,
  AuthChallengeReason,
} from "@inspector/core/auth/challenge.js";
import {
  emaStepUpFailureMessage,
  emaStepUpInProgressMessage,
  emaStepUpSuccessMessage,
  isEmaStepUp as isCoreEmaStepUp,
  isStepUpConfirmation as isCoreStepUpConfirmation,
} from "@inspector/core/auth/oauthUx.js";
import { clearServerOAuthState } from "./utils/clearServerOAuthState";
import {
  authRecoveryRestoredMessage,
  isReAuthBannerReason,
  oauthPreRedirectToastCopy,
  oauthResumeAbandonedMessage,
  reAuthBannerMessage,
  type OAuthPreRedirectContext,
  type OAuthRecoverySource,
} from "./utils/oauthUx";
import {
  isBrowserTabVisible,
  onBrowserTabVisible,
} from "./utils/browserTabVisibility";
import type { PendingReauth } from "./utils/pendingReauth";

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

// Re-issue the original request behind a Protocol entry. The call goes through
// InspectorClient → tracked transport → message log, so the replayed
// request+response surface as a fresh Protocol entry (protocol-local) — it
// intentionally does NOT touch the Tools/Prompts/Resources panels. Returns a
// human-readable reason when the entry can't be replayed (unsupported method,
// or a tool that's no longer present), or null on a dispatched replay.
async function replayProtocolRequest(
  client: InspectorClient,
  method: string,
  params: Record<string, unknown> | undefined,
  tools: Tool[],
): Promise<string | null> {
  // Gate on the shared replayable-method set (the same one ProtocolEntry uses to
  // show/hide the Replay button) so the two can't drift.
  if (!isReplayableProtocolMethod(method)) {
    return `Replay isn't supported for "${method}".`;
  }
  // Pagination cursor carried by the */list requests; replaying the same page
  // reproduces the original call.
  const cursor = typeof params?.cursor === "string" ? params.cursor : undefined;
  switch (method) {
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : undefined;
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return `Tool "${name ?? "?"}" is no longer available to replay.`;
      }
      await client.callTool(
        tool,
        (params?.arguments ?? {}) as Record<string, JsonValue>,
      );
      return null;
    }
    case "prompts/get": {
      const name = typeof params?.name === "string" ? params.name : undefined;
      if (!name) return "Prompt name is missing; cannot replay.";
      await client.getPrompt(
        name,
        (params?.arguments ?? {}) as Record<string, JsonValue>,
      );
      return null;
    }
    case "resources/read": {
      const uri = typeof params?.uri === "string" ? params.uri : undefined;
      if (!uri) return "Resource URI is missing; cannot replay.";
      await client.readResource(uri);
      return null;
    }
    case "tools/list":
      await client.listTools(cursor);
      return null;
    case "prompts/list":
      await client.listPrompts(cursor);
      return null;
    case "resources/list":
      await client.listResources(cursor);
      return null;
    case "resources/templates/list":
      await client.listResourceTemplates(cursor);
      return null;
    case "tasks/list":
      await client.listRequestorTasks(cursor);
      return null;
    case "ping":
      await client.ping();
      return null;
    default:
      return `Replay isn't supported for "${method}".`;
  }
}

// Stable empty-shell for `InspectorServerSettings`. Used both as the
// initial draft for a server entry that hasn't been touched yet, and as
// the fallback the settings modal renders against when it's closed
// (Mantine renders the dialog shell regardless of `opened`). Hoisted to
// module scope so both call sites share the same object identity and so
// React doesn't re-allocate on every render.
const EMPTY_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: DEFAULT_TASK_TTL_MS,
  autoRefreshOnListChanged: false,
  paginatedLists: false,
  maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
  roots: [],
};

// Stable toast id for the "response body dropped" warning, keyed per server so
// a request storm updates one persistent toast rather than stacking thousands
// (the drop event can fire rapidly). Mirrors the progress-toast dedupe pattern.
function bodyDroppedToastId(serverId: string): string {
  return `fetch-body-dropped-${serverId}`;
}

const CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID = "client-config-load-error";

// Body of the "response body dropped" warning toast: a one-line summary of what
// happened, the likely causes, and a link that opens this server's settings
// (on the Options section) so the user can raise the Network Log Size if it's
// just a high-traffic server. Surfaces the otherwise-invisible rotation drop
// described in #1390.
const FetchBodyDroppedToastMessage = ({
  maxFetchRequests,
  onAdjust,
}: {
  maxFetchRequests: number;
  onAdjust: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      A response body arrived after its Network log entry had already rotated
      out (the log hit its {maxFetchRequests}-request limit), so the body
      couldn&apos;t be shown. This usually indicates:
    </Text>
    <List size="sm" spacing={2}>
      <List.Item>
        a chatty or misbehaving server (notification storms, rapid polling)
      </List.Item>
      <List.Item>an SSE/transport reconnect or retry storm</List.Item>
      <List.Item>
        a slow streaming call racing against high request volume
      </List.Item>
      <List.Item>
        the Network Log Size set too low for this server&apos;s traffic
      </List.Item>
    </List>
    <Anchor component="button" type="button" size="sm" onClick={onAdjust}>
      Adjust Network Log Size for this server
    </Anchor>
  </Stack>
);

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

// Body of the non-spec URLElicitationRequired toast: the server returned a
// -32042 error with no `elicitations` list, so there's no URL to open. We keep
// the toast short and link to a modal with the raw error body.
const UrlElicitationErrorToastMessage = ({
  onViewDetails,
}: {
  onViewDetails: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      The server reported a URLElicitationRequired error but listed no required
      elicitations, so there&apos;s nothing to open.
    </Text>
    <Anchor component="button" type="button" size="sm" onClick={onViewDetails}>
      View error details
    </Anchor>
  </Stack>
);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Pretty-print a thrown error for the URL-elicitation details modal: a ProtocolError
// carries a `code`/`data` worth showing alongside the message, so include them
// when present; otherwise fall back to the plain message.
function formatErrorDetails(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; data?: unknown };
    if (e.code !== undefined || e.data !== undefined) {
      return JSON.stringify(
        { code: e.code, message: e.message, data: e.data },
        null,
        2,
      );
    }
  }
  return errorMessage(err);
}

// How long a progress toast lingers after its last tick. Each new tick on the
// same progress stream resets this window (via `notifications.update`), so a
// steady stream keeps one toast alive; the toast clears a few seconds after
// progress stops (i.e. the call finished or went quiet).
const PROGRESS_TOAST_AUTOCLOSE_MS = 5000;

// A task cancellation is a one-shot confirmation (unlike the live status toast,
// which stays open while the task runs), so it auto-dismisses after a moment.
const TASK_CANCELLED_TOAST_AUTOCLOSE_MS = 5000;

// Stable toast id for a progress stream. Notifications keyed by this id are
// replaced (not stacked) so a chatty server updates one toast per stream
// rather than flooding the corner. The injected `progressToken` correlates a
// stream with the request that triggered it; when absent (the common case —
// the inspector doesn't expose a caller token), all ticks share one toast.
function progressToastId(token: ProgressToken | undefined): string {
  return `progress-${String(token ?? "default")}`;
}

// One-line toast body: "<message> — <progress> / <total> (NN%)". The fraction
// and percentage are omitted when the server sends no `total`.
function formatProgressToastMessage(
  detail: Progress & { progressToken?: ProgressToken },
): string {
  const { progress, total, message } = detail;
  const ratio =
    total !== undefined && total > 0
      ? `${progress} / ${total} (${Math.round((progress / total) * 100)}%)`
      : `${progress}`;
  return message ? `${message} — ${ratio}` : ratio;
}

// Terminal task states — once a task reaches one of these it can't change, so
// its toast is dismissed and its per-task progress entry is pruned.
const TERMINAL_TASK_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

function isTerminalTaskStatus(status: Task["status"]): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

// Stable toast id per task so live status updates replace one toast rather than
// stacking a fresh one per `notifications/tasks/status` tick.
function taskToastId(taskId: string): string {
  return `task-${taskId}`;
}

// Toast color per task status — mirrors TaskStatusBadge's mapping so the toast
// and the Tasks-screen badge read consistently.
function taskToastColor(status: Task["status"]): string {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "cancelled":
      return "gray";
    case "input_required":
      return "yellow";
    default:
      return "blue";
  }
}

// The subset of Task fields the toast layer reads. Both task-event payloads —
// the server `taskStatusChange` (full Task) and the client-origin
// `requestorTaskUpdated` (Task with optional createdAt) — satisfy this.
type TaskToastInput = Pick<Task, "status"> & { statusMessage?: string };

// One-line toast body: the task's `statusMessage` when present, else a short
// fallback naming the status. The title carries the status itself.
function formatTaskToastMessage(task: TaskToastInput): string {
  return task.statusMessage ?? `Task ${task.status}`;
}

function isEmaStepUp(
  challenge: AuthChallenge,
  server: ServerEntry | undefined,
): boolean {
  return isCoreEmaStepUp(challenge, {
    enterpriseManaged: server?.settings?.enterpriseManaged,
  });
}

function isStepUpConfirmation(
  challenge: AuthChallenge,
  server: ServerEntry | undefined,
): boolean {
  return isCoreStepUpConfirmation(challenge, {
    enterpriseManaged: server?.settings?.enterpriseManaged,
  });
}

/** Which in-flight action opened the step-up modal (for scoped cancel UX). */
type StepUpSource = "tool" | "prompt" | "resource" | "ambient" | "app";

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

  // Id of the server that just connected successfully (#1682) — the success
  // mirror of `failedServerId`. Drives the green highlight + scroll-into-view on
  // that ServerCard. Set on the →connected transition, cleared when a new
  // connection attempt starts or the session disconnects.
  const [connectedServerId, setConnectedServerId] = useState<
    string | undefined
  >(undefined);

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
  const configBaseUrl =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const { sandboxUrl } = useSandboxUrl({
    baseUrl: configBaseUrl,
    authToken: getAuthToken(),
  });
  // Read-only sessions (launched with `--config` or an ad-hoc server) hide
  // catalog CRUD; the default catalog and `--catalog` stay writable.
  const { writable: serverListWritable } = useServerListWritable({
    baseUrl: configBaseUrl,
    authToken: getAuthToken(),
  });
  // The Inspector version (root package.json), shown in the lower-right corner.
  // The browser can't read it off disk, so the backend sends it via /api/config.
  const { version: inspectorVersion } = useInspectorVersion({
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

  const sandboxBridgeFactory = useMemo(
    () =>
      createAppBridgeFactory({
        getClient: () => inspectorClient?.getAppRendererClient() ?? null,
        readResource: async (uri) => {
          if (!inspectorClient) throw new Error("No MCP client connected.");
          const invocation = await inspectorClient.readResource(uri);
          return invocation.result;
        },
        // The bridge's sandboxready handler reads + posts the UI resource
        // inside a detached async block; without this hook a 404 / malformed
        // resource is console.error-only and the user stares at a blank
        // frame. Surface it as a toast. The renderer separately drives
        // `data-app-status` so an automated driver can time out on
        // never-reaching-"ready" and read the toast.
        onResourceError: (err) => {
          notifications.show({
            title: "App resource failed to load",
            message: err.message,
            color: "red",
          });
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
  // Paged (paginated) counterparts, used when the `paginatedLists` setting
  // is on (#1721). Created/destroyed alongside the managed states.
  const [pagedToolsState, setPagedToolsState] =
    useState<PagedToolsState | null>(null);
  const [pagedPromptsState, setPagedPromptsState] =
    useState<PagedPromptsState | null>(null);
  const [pagedResourcesState, setPagedResourcesState] =
    useState<PagedResourcesState | null>(null);
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

  // Per-screen selection / search / filter state, one object per screen. Lifted
  // here (out of the individual screens) so it persists across tab navigation
  // within a live session — the screens unmount on tab switch, so screen-local
  // state would be lost. Cleared only on disconnect (via
  // `resetSessionScopedUiState`) or an explicit user action, never on plain
  // navigation (#1414/#1417). The in-flight result panels (`toolCallState` /
  // `getPromptState` / `readResourceState`) stay separate — they're written by
  // the async action handlers below, not by the screens.
  const [toolsUi, setToolsUi] = useState(EMPTY_TOOLS_UI);
  const [promptsUi, setPromptsUi] = useState(EMPTY_PROMPTS_UI);
  const [resourcesUi, setResourcesUi] = useState(EMPTY_RESOURCES_UI);
  const [appsUi, setAppsUi] = useState(EMPTY_APPS_UI);
  const [tasksUi, setTasksUi] = useState(EMPTY_TASKS_UI);
  const [logsUi, setLogsUi] = useState(EMPTY_LOGS_UI);
  const [protocolUi, setProtocolUi] = useState(EMPTY_PROTOCOL_UI);
  // Protocol entries the user pinned (by entry id). Session-scoped — the ids
  // reference message-log entries, which clear on disconnect, so this resets
  // with the rest of the per-screen state.
  const [pinnedProtocolIds, setPinnedProtocolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [networkUi, setNetworkUi] = useState(EMPTY_NETWORK_UI);
  const [consoleUi, setConsoleUi] = useState(EMPTY_CONSOLE_UI);
  const [activeTab, setActiveTab] = useState(INSPECTOR_SERVERS_TAB);
  const [pendingStepUp, setPendingStepUp] = useState<{
    challenge: AuthChallenge;
    authorizationUrl: URL;
    serverId: string;
    source: StepUpSource;
    enterpriseManaged?: boolean;
  } | null>(null);
  const pendingStepUpRef = useRef(pendingStepUp);
  const pendingStepUpRetryRef = useRef<(() => Promise<unknown>) | null>(null);
  useEffect(() => {
    pendingStepUpRef.current = pendingStepUp;
  }, [pendingStepUp]);
  const [reAuthBanner, setReAuthBanner] = useState<{
    serverId: string;
    message: string;
  } | null>(null);
  const [pendingReauth, setPendingReauth] = useState<PendingReauth | null>(
    null,
  );
  const pendingReauthRef = useRef(pendingReauth);
  useEffect(() => {
    pendingReauthRef.current = pendingReauth;
  }, [pendingReauth]);
  const reauthResumeInProgressRef = useRef(false);
  const stepUpAuthorizeInProgressRef = useRef(false);

  useEffect(() => {
    const pending = pendingReauthRef.current;
    if (pending && pending.serverId !== activeServerId) {
      setPendingReauth(null);
    }
    const stepUp = pendingStepUpRef.current;
    if (stepUp && stepUp.serverId !== activeServerId) {
      setPendingStepUp(null);
    }
  }, [activeServerId]);

  const trySetPendingStepUp = useCallback(
    (next: NonNullable<typeof pendingStepUp>): boolean => {
      if (pendingStepUpRef.current !== null) {
        notifications.show({
          title: "Step-up authorization in progress",
          message:
            "Complete or cancel the current step-up prompt before starting another.",
          color: "yellow",
          autoClose: 5000,
        });
        return false;
      }
      setPendingStepUp(next);
      return true;
    },
    [],
  );

  // Handshake telemetry. `connectStartRef` is set at the "connecting" edge
  // and consumed at the "connected" edge — a ref (not state) so the
  // intervening rerenders don't reset it.
  const connectStartRef = useRef<number | undefined>(undefined);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);

  // One-shot guard for the `/oauth/callback` handler below. The effect waits
  // for the async `servers` list to hydrate, so it can run on more than one
  // render; this ref ensures the token exchange fires exactly once per load.
  const oauthCallbackHandledRef = useRef(false);
  const staleOAuthCheckedRef = useRef(false);
  /** Guards against applying the same OAuth resume snapshot more than once per load. */
  const oauthResumeUiAppliedRef = useRef(false);

  // Tracks which progress streams currently have a live toast, so each new tick
  // updates the existing toast instead of stacking a fresh one. Entries are
  // removed when their toast closes (auto-dismiss or user). A ref (not state)
  // because it's incidental bookkeeping that must not trigger re-renders.
  const progressToastIdsRef = useRef<Set<string>>(new Set());

  // Same bookkeeping for live task-status toasts (one per taskId), so each
  // `notifications/tasks/status` tick replaces the existing toast.
  const taskToastIdsRef = useRef<Set<string>>(new Set());

  // The taskId of the in-flight task-augmented tool call, captured from the
  // `toolCallTaskUpdated` event `callToolStream` dispatches. Lets the Tool
  // detail panel's Cancel button cancel the underlying task on the server
  // (#1455) instead of no-op'ing. Reset at the start of every call, so an
  // ordinary (non-task) call leaves it undefined and its Cancel doesn't fire a
  // stray task cancellation. A ref (not state) because it's only read at the
  // moment Cancel is clicked and must not trigger re-renders.
  const activeToolCallTaskIdRef = useRef<string | undefined>(undefined);

  // Per-task progress, keyed by taskId. Sourced from the core `requestorTaskProgress`
  // event (emitted by callToolStream, which owns the taskId), fed to the Tasks
  // screen so `TaskCard`'s progress bar renders for active tasks. Pruned on
  // terminal status (below) and reset on disconnect (`resetSessionScopedUiState`).
  const [progressByTaskId, setProgressByTaskId] = useState<
    Record<string, TaskProgress>
  >({});

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
    lastError,
  } = useInspectorClient(inspectorClient);
  const {
    tools: managedTools,
    listChanged: toolsListChanged,
    refresh: refreshTools,
    clearListChanged: clearToolsListChanged,
  } = useManagedTools(inspectorClient, managedToolsState);
  const {
    prompts: managedPrompts,
    listChanged: promptsListChanged,
    refresh: refreshPrompts,
    clearListChanged: clearPromptsListChanged,
  } = useManagedPrompts(inspectorClient, managedPromptsState);
  const {
    resources: managedResources,
    listChanged: resourcesListChanged,
    refresh: refreshResources,
    clearListChanged: clearResourcesListChanged,
  } = useManagedResources(inspectorClient, managedResourcesState);
  const { resourceTemplates, refresh: refreshResourceTemplates } =
    useManagedResourceTemplates(inspectorClient, managedResourceTemplatesState);
  // Paged (paginated) list sources. When `paginatedLists` is on the managed
  // states skip their all-page walk and these drive the sidebar instead (#1721).
  const {
    tools: pagedTools,
    nextCursor: pagedToolsCursor,
    pageCount: pagedToolsPageCount,
    loadPage: loadToolsPage,
  } = usePagedTools(inspectorClient, pagedToolsState);
  const {
    prompts: pagedPrompts,
    nextCursor: pagedPromptsCursor,
    pageCount: pagedPromptsPageCount,
    loadPage: loadPromptsPage,
  } = usePagedPrompts(inspectorClient, pagedPromptsState);
  const {
    resources: pagedResources,
    nextCursor: pagedResourcesCursor,
    pageCount: pagedResourcesPageCount,
    loadPage: loadResourcesPage,
  } = usePagedResources(inspectorClient, pagedResourcesState);
  // The active server's persisted paginated setting drives the display mode.
  // The sidebar toggle edits it (optimistically, below) and persists it.
  const persistedPaginatedLists =
    servers.find((s) => s.id === activeServerId)?.settings?.paginatedLists ??
    false;
  const [paginatedListsOverride, setPaginatedListsOverride] = useState<
    boolean | null
  >(null);
  // Drop the optimistic override once the persisted value catches up (or the
  // active server changes), so the persisted setting is the resting source.
  useEffect(() => {
    setPaginatedListsOverride(null);
  }, [persistedPaginatedLists, activeServerId]);
  const paginatedLists = paginatedListsOverride ?? persistedPaginatedLists;
  const connected = connectionStatus === "connected";
  const toolsPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedTools,
    managedRefresh: refreshTools,
    pagedItems: pagedTools,
    pagedNextCursor: pagedToolsCursor,
    pagedPageCount: pagedToolsPageCount,
    loadPage: loadToolsPage,
  });
  const promptsPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedPrompts,
    managedRefresh: refreshPrompts,
    pagedItems: pagedPrompts,
    pagedNextCursor: pagedPromptsCursor,
    pagedPageCount: pagedPromptsPageCount,
    loadPage: loadPromptsPage,
  });
  const resourcesPagination = usePaginatedList({
    connected,
    paginated: paginatedLists,
    managedItems: managedResources,
    managedRefresh: refreshResources,
    pagedItems: pagedResources,
    pagedNextCursor: pagedResourcesCursor,
    pagedPageCount: pagedResourcesPageCount,
    loadPage: loadResourcesPage,
  });
  const tools = toolsPagination.items;
  const prompts = promptsPagination.items;
  const resources = resourcesPagination.items;
  const {
    tasks,
    refresh: refreshTasks,
    clearCompleted: clearCompletedTasks,
  } = useManagedRequestorTasks(inspectorClient, managedRequestorTasksState);
  const { subscriptions } = useResourceSubscriptions(
    resourceSubscriptionsState,
  );
  const { messages } = useMessageLog(messageLogState);
  const { fetchRequests } = useFetchRequestLog(fetchRequestLogState);
  const { stderrLogs } = useStderrLog(stderrLogState);

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
  }, [fetchRequestLogState, activeServerId]);

  // Server-initiated sampling / elicitation requests. These arrive while a call
  // (e.g. a tool execution) is in flight and block it until the user responds.
  const { pendingSamples, pendingElicitations } =
    usePendingClientRequests(inspectorClient);

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

  // Track the just-connected server so its card gets the green highlight +
  // scroll-into-view (#1682). Unlike `failedServerId` (which must survive the
  // `disconnect` event a failed connect fires), "connected" is a stable status,
  // so a status-driven effect can both set and clear it: set on connect, clear
  // whenever the session isn't connected (disconnect, a new attempt's
  // "connecting", or an error).
  useEffect(() => {
    setConnectedServerId(
      connectionStatus === "connected" ? activeServerId : undefined,
    );
  }, [connectionStatus, activeServerId]);

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
  /** Clears pending OAuth resume state — explicit user disconnect only. */
  const clearOAuthResumeOnExplicitDisconnect = useCallback(() => {
    clearOAuthResumeSnapshot();
    oauthResumeUiAppliedRef.current = false;
  }, []);

  /** Snapshot cleanup plus shell reset when the user explicitly ends a session. */
  const finalizeExplicitDisconnect = useCallback(() => {
    clearOAuthResumeOnExplicitDisconnect();
    setActiveTab(INSPECTOR_SERVERS_TAB);
  }, [clearOAuthResumeOnExplicitDisconnect]);

  // Does not clear the OAuth resume snapshot — that is tied to an in-flight
  // full-page redirect and is cleared on explicit disconnect or consumed on callback.
  const resetSessionScopedUiState = useCallback(() => {
    setToolCallState(undefined);
    setGetPromptState(undefined);
    setReadResourceState(undefined);
    setToolsUi(EMPTY_TOOLS_UI);
    setPromptsUi(EMPTY_PROMPTS_UI);
    setResourcesUi(EMPTY_RESOURCES_UI);
    setAppsUi(EMPTY_APPS_UI);
    setTasksUi(EMPTY_TASKS_UI);
    setLogsUi(EMPTY_LOGS_UI);
    setProtocolUi(EMPTY_PROTOCOL_UI);
    setPinnedProtocolIds(new Set());
    setNetworkUi(EMPTY_NETWORK_UI);
    // Only the search filter resets here; the stderr entries themselves live in
    // StderrLogState, which deliberately survives connect/disconnect so a failed
    // launch's output stays visible for diagnosis (#1621).
    setConsoleUi(EMPTY_CONSOLE_UI);
    setProgressByTaskId({});
    setCurrentLogLevel("info");
    setPendingStepUp(null);
    setPendingReauth(null);
    setReAuthBanner(null);
    // Remembered scroll offsets are session-scoped too — drop them so the next
    // session's screens start at the top (#1417).
    clearScrollMemory();
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

  // Surface incoming `notifications/progress` as toasts so the user can watch a
  // long-running tool's progress while staying on the tool view — the v2
  // replacement for v1's always-visible "Server Notifications" shelf (#1414).
  // The full notification history still lives in the Protocol tab; these toasts
  // are the at-a-glance, in-context signal. Toasts are keyed by progress stream
  // (see `progressToastId`) and replaced per tick so a chatty server updates one
  // toast rather than stacking one per tick.
  useEffect(() => {
    if (!inspectorClient) return;
    const liveToastIds = progressToastIdsRef.current;
    const onProgress = (
      event: TypedEventGeneric<InspectorClientEventMap, "progressNotification">,
    ) => {
      const detail = event.detail;
      const id = progressToastId(detail.progressToken);
      const message = formatProgressToastMessage(detail);
      if (liveToastIds.has(id)) {
        notifications.update({
          id,
          title: "Tool progress",
          message,
          color: "blue",
          autoClose: PROGRESS_TOAST_AUTOCLOSE_MS,
        });
        return;
      }
      liveToastIds.add(id);
      notifications.show({
        id,
        title: "Tool progress",
        message,
        color: "blue",
        autoClose: PROGRESS_TOAST_AUTOCLOSE_MS,
        onClose: () => liveToastIds.delete(id),
      });
    };
    inspectorClient.addEventListener("progressNotification", onProgress);
    return () => {
      inspectorClient.removeEventListener("progressNotification", onProgress);
      // Dismiss any still-visible progress toasts when the client is swapped
      // out, then drop the stream bookkeeping. Hiding them (rather than letting
      // them auto-close up to PROGRESS_TOAST_AUTOCLOSE_MS later) keeps a stale
      // "Tool progress" toast from lingering into the next session, and avoids
      // a race where the lingering toast's `onClose` would later delete an id
      // from the *new* session's set and trigger a duplicate-id re-show.
      liveToastIds.forEach((id) => notifications.hide(id));
      liveToastIds.clear();
    };
  }, [inspectorClient]);

  // Correlate task-call progress to the task it belongs to. `callToolStream`
  // emits `requestorTaskProgress` tagged with the taskId it owns (the generic
  // `progressNotification` above carries only the caller's progressToken), so we
  // build a taskId → progress map the Tasks screen reads to render each active
  // task's progress bar. Entries are pruned on terminal status (in the task-
  // status effect below) and the whole map resets on disconnect.
  useEffect(() => {
    if (!inspectorClient) return;
    const onTaskProgress = (
      event: TypedEventGeneric<
        InspectorClientEventMap,
        "requestorTaskProgress"
      >,
    ) => {
      const { taskId, progress } = event.detail;
      setProgressByTaskId((prev) => ({
        ...prev,
        [taskId]: {
          progress: progress.progress,
          total: progress.total,
          message: progress.message,
        },
      }));
    };
    inspectorClient.addEventListener("requestorTaskProgress", onTaskProgress);
    return () => {
      inspectorClient.removeEventListener(
        "requestorTaskProgress",
        onTaskProgress,
      );
    };
  }, [inspectorClient]);

  // Capture the in-flight task-augmented tool call's taskId so the detail
  // panel's Cancel button can cancel the task on the server (#1455). The id
  // only becomes known mid-call, when `callToolStream` dispatches
  // `toolCallTaskUpdated`, so we stash the latest into the ref the cancel
  // handler reads. `onCallTool` clears it at the start of each call.
  useEffect(() => {
    if (!inspectorClient) return;
    const onToolCallTaskUpdated = (
      event: TypedEventGeneric<InspectorClientEventMap, "toolCallTaskUpdated">,
    ) => {
      activeToolCallTaskIdRef.current = event.detail.taskId;
    };
    inspectorClient.addEventListener(
      "toolCallTaskUpdated",
      onToolCallTaskUpdated,
    );
    return () => {
      inspectorClient.removeEventListener(
        "toolCallTaskUpdated",
        onToolCallTaskUpdated,
      );
    };
  }, [inspectorClient]);

  // Surface live task status as per-task toasts — the v2 replacement for v1/v1.5's
  // inline "Task status: … Polling…" line under the Tool Result (#1422, consistent
  // with #1414). Subscribes to `taskStatusChange` (server `notifications/tasks/status`)
  // and `requestorTaskUpdated` (client-origin updates from `callToolStream`) — the
  // same sources the managed task store consumes; `toolCallTaskUpdated` is redundant
  // with `requestorTaskUpdated` so we skip it to avoid double-firing. One toast per
  // taskId, replaced per tick, dismissed on terminal status (which also prunes the
  // task's progress entry) and on client teardown. The full status history still
  // lives in the Protocol view.
  useEffect(() => {
    if (!inspectorClient) return;
    const liveToastIds = taskToastIdsRef.current;
    const handleTaskUpdate = (taskId: string, task: TaskToastInput) => {
      const id = taskToastId(taskId);
      const terminal = isTerminalTaskStatus(task.status);
      const title = `Task ${task.status}`;
      const message = formatTaskToastMessage(task);
      const color = taskToastColor(task.status);
      if (terminal) {
        // Drop the task's progress entry now that it can't change.
        setProgressByTaskId((prev) => {
          if (!(taskId in prev)) return prev;
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
      }
      if (liveToastIds.has(id)) {
        notifications.update({ id, title, message, color });
        if (terminal) {
          notifications.hide(id);
          liveToastIds.delete(id);
        }
        return;
      }
      // A first sighting that's already terminal needs no toast at all.
      if (terminal) return;
      liveToastIds.add(id);
      notifications.show({
        id,
        title,
        message,
        color,
        autoClose: false,
        onClose: () => liveToastIds.delete(id),
      });
    };
    const onTaskStatusChange = (
      event: TypedEventGeneric<InspectorClientEventMap, "taskStatusChange">,
    ) => {
      handleTaskUpdate(event.detail.taskId, event.detail.task);
    };
    const onRequestorTaskUpdated = (
      event: TypedEventGeneric<InspectorClientEventMap, "requestorTaskUpdated">,
    ) => {
      handleTaskUpdate(event.detail.taskId, event.detail.task);
    };
    // A cancel goes out as `taskCancelled` (dispatched by cancelRequestorTask),
    // not as a status notification, so it would otherwise leave the running
    // task's live "Task <status>" toast hanging with no confirmation. Replace
    // that toast (or show a fresh one) with a short "Task cancelled" toast, and
    // prune the now-dead progress entry. Covers both cancel paths — the Tasks
    // screen and the Tool detail panel — since both route through
    // cancelRequestorTask (#1455).
    const onTaskCancelled = (
      event: TypedEventGeneric<InspectorClientEventMap, "taskCancelled">,
    ) => {
      const { taskId } = event.detail;
      setProgressByTaskId((prev) => {
        if (!(taskId in prev)) return prev;
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      const id = taskToastId(taskId);
      const toast = {
        id,
        title: "Task cancelled",
        message: "The task was cancelled.",
        color: taskToastColor("cancelled"),
        autoClose: TASK_CANCELLED_TOAST_AUTOCLOSE_MS,
      };
      if (liveToastIds.has(id)) {
        // Convert the open status toast into the auto-closing confirmation; drop
        // it from the live set so a trailing "cancelled" status tick (if the
        // server sends one) doesn't re-show it.
        notifications.update(toast);
        liveToastIds.delete(id);
      } else {
        notifications.show(toast);
      }
    };
    inspectorClient.addEventListener("taskStatusChange", onTaskStatusChange);
    inspectorClient.addEventListener(
      "requestorTaskUpdated",
      onRequestorTaskUpdated,
    );
    inspectorClient.addEventListener("taskCancelled", onTaskCancelled);
    return () => {
      inspectorClient.removeEventListener(
        "taskStatusChange",
        onTaskStatusChange,
      );
      inspectorClient.removeEventListener(
        "requestorTaskUpdated",
        onRequestorTaskUpdated,
      );
      inspectorClient.removeEventListener("taskCancelled", onTaskCancelled);
      // Hide any still-visible task toasts on client swap so they don't linger
      // into the next session, then drop the bookkeeping (mirrors the progress-
      // toast teardown above).
      liveToastIds.forEach((id) => notifications.hide(id));
      liveToastIds.clear();
    };
  }, [inspectorClient]);

  // Build the InitializeResult the connected ViewHeader / Connection Info
  // modal expect from the hook's split fields. `protocolVersion` is the value
  // the InspectorClient negotiated during initialize (#1324); it's dispatched
  // alongside serverInfo, so in practice it's present whenever we're connected.
  // We deliberately gate only on serverInfo (not protocolVersion): this object
  // also drives the connected header and Connection Info modal, so a
  // missing/edge-case version must not hide those. It flows through as the
  // optional field it is everywhere downstream (the ServerCard label and the
  // modal value both tolerate an empty string), so "" reads as "unknown".
  const initializeResult = useMemo<InitializeResult | undefined>(() => {
    if (connectionStatus !== "connected" || !serverInfo) return undefined;
    return {
      protocolVersion: protocolVersion ?? "",
      capabilities: capabilities ?? {},
      serverInfo,
      ...(instructions ? { instructions } : {}),
    };
  }, [
    connectionStatus,
    capabilities,
    serverInfo,
    instructions,
    protocolVersion,
  ]);

  // The Server Info modal needs the active server's transport and (optional)
  // OAuth details — both are co-located here so the modal opens against the
  // same connection snapshot the header is reading.
  const activeServer = useMemo<ServerEntry | undefined>(
    () => servers.find((s) => s.id === activeServerId),
    [servers, activeServerId],
  );

  // Mirror the active server's name into a ref so a mid-session failure toast
  // can still name the server: a transport crash dispatches `disconnect`,
  // which clears `activeServerId` (and thus `activeServer`) before the
  // `lastError` effect below runs, so the ref is the only surviving handle.
  const activeServerNameRef = useRef<string | undefined>(undefined);
  const activeServerIdRef = useRef<string | undefined>(activeServerId);
  const serversRef = useRef(servers);
  useEffect(() => {
    if (activeServer) activeServerNameRef.current = activeServer.name;
    activeServerIdRef.current = activeServerId;
    serversRef.current = servers;
  }, [activeServer, activeServerId, servers]);

  // Last connection-level error message, surfaced as `data-error-message` on
  // the InspectorView header so an automated driver can read *why* a connect
  // failed without scraping a transient toast. Cleared on the next connect
  // attempt and on successful connection.
  const [connectErrorMessage, setConnectErrorMessage] = useState<
    string | undefined
  >(undefined);
  // Named writer so a single call site can be extended later (e.g. telemetry)
  // and the intent (record a connection-level failure) stays explicit.
  const recordConnectError = useCallback((message: string) => {
    setConnectErrorMessage(message);
  }, []);

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
  const deepLinkEnsureRef = useRef(false);
  const deepLinkUpdateRef = useRef(false);
  const deepLinkConnectRef = useRef(false);

  const showReAuthBanner = useCallback(
    (
      serverId: string,
      detail?: unknown,
      options?: { reason?: AuthChallengeReason },
    ) => {
      const server = serversRef.current.find((s) => s.id === serverId);
      const message = reAuthBannerMessage({
        serverName: server?.name,
        detail:
          detail !== undefined ? formatOAuthFailureDetail(detail) : undefined,
      });
      const reason = options?.reason;
      if (reason !== undefined && !isReAuthBannerReason(reason)) {
        notifications.show({
          title: "Authorization required",
          message,
          color: "yellow",
          autoClose: false,
        });
        return;
      }
      setReAuthBanner({
        serverId,
        message,
      });
    },
    [],
  );

  // Surface a mid-session transport failure (stdio crash, SSE drop, HTTP 5xx)
  // as a toast. The handshake case is handled in `onToggleConnection`'s catch;
  // this covers the `status: connected → error` transition that fires the
  // client's `error` event without rejecting any awaited promise (#1323).
  // `lastError` clears at the next connecting edge, so each failure toasts once.
  useEffect(() => {
    if (!lastError) return;
    const name = activeServerNameRef.current;
    notifications.show({
      title: name ? `Connection to "${name}" lost` : "Connection lost",
      message: lastError,
      color: "red",
    });
  }, [lastError]);

  // `config.type` is optional in the schema (a bare `command: ...`
  // entry implies stdio), so we materialize the default here rather
  // than at the render site — the modal's `transport` prop is a
  // required `ServerType`, and we only render the modal once we know
  // there's an active server (see the `{initializeResult && activeServer && …}`
  // guard below).
  const connectionInfoTransport: ServerType =
    activeServer?.config.type ?? "stdio";

  const [
    connectionInfoOAuthWhenConnected,
    setConnectionInfoOAuthWhenConnected,
  ] = useState<OAuthDetails | undefined>(undefined);

  const connectionInfoOAuth =
    connectionStatus === "connected" && inspectorClient
      ? connectionInfoOAuthWhenConnected
      : undefined;

  useEffect(() => {
    if (connectionStatus !== "connected" || !inspectorClient) {
      return;
    }

    let cancelled = false;

    const refresh = (): void => {
      void inspectorClient.getOAuthState().then((state) => {
        if (cancelled) return;
        setConnectionInfoOAuthWhenConnected(
          state ? oauthDetailsFromConnectionState(state) : undefined,
        );
      });
    };

    const onAmbientAuthChallenge = (): void => {
      const name = activeServerNameRef.current;
      notifications.show({
        title: name
          ? `Refreshing authorization for "${name}"`
          : "Refreshing authorization",
        message: "Refreshing authorization…",
        color: "blue",
        autoClose: 4000,
      });
    };

    refresh();
    inspectorClient.addEventListener("oauthComplete", refresh);
    inspectorClient.addEventListener(
      "authChallengeAmbient",
      onAmbientAuthChallenge,
    );
    return () => {
      cancelled = true;
      inspectorClient.removeEventListener("oauthComplete", refresh);
      inspectorClient.removeEventListener(
        "authChallengeAmbient",
        onAmbientAuthChallenge,
      );
    };
  }, [connectionStatus, inspectorClient]);

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

  // Shared OAuth runtime store (oauth.json via /api/storage/oauth). Memoized so
  // connect, EMA IdP session, and per-server clear share one in-memory view.
  const webOAuthStorage = useMemo(
    () => getWebRemoteOAuthStorage(getAuthToken()),
    [],
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

  const prepareOAuthRedirect = useCallback(
    ({
      serverId,
      authKind,
      authorizationUrl,
      authChallenge,
      recoverySource,
      preRedirectContext,
      client,
    }: {
      serverId: string;
      authKind: OAuthResumeAuthKind;
      authorizationUrl: URL;
      authChallenge?: AuthChallenge;
      recoverySource?: OAuthRecoverySource;
      preRedirectContext?: OAuthPreRedirectContext;
      client?: InspectorClient;
    }) => {
      setReAuthBanner(null);
      const server = serversRef.current.find((s) => s.id === serverId);
      const preRedirectToast = oauthPreRedirectToastCopy(authKind, {
        serverName: server?.name,
        enterpriseManaged: server?.settings?.enterpriseManaged,
        context: preRedirectContext,
      });
      if (preRedirectToast) {
        notifications.show({
          title: preRedirectToast.title,
          message: preRedirectToast.message,
          color: "blue",
          autoClose: 4000,
        });
      }
      const oauthClient = client ?? inspectorClient;
      const remoteSessionId = oauthClient?.getRemoteBackendSessionId();
      onBeforeOAuthRedirect(authorizationUrl);
      // Write immediately before navigation so implicit client teardown (during
      // connect setup) cannot clear the snapshot after we persist it.
      writeOAuthResumeSnapshot({
        version: 1,
        serverId,
        activeTab,
        authKind,
        tabUi: buildTabUiSnapshot({
          toolsUi,
          promptsUi,
          resourcesUi,
          appsUi,
          tasksUi,
          logsUi,
          protocolUi,
          networkUi,
        }),
        ...(remoteSessionId && { remoteSessionId }),
        ...(authKind === "step_up" && authChallenge && { authChallenge }),
        ...(recoverySource && { recoverySource }),
      });
      void oauthClient?.beginInteractiveAuthorization(authorizationUrl);
    },
    [
      inspectorClient,
      activeTab,
      toolsUi,
      promptsUi,
      resourcesUi,
      appsUi,
      tasksUi,
      logsUi,
      protocolUi,
      networkUi,
      onBeforeOAuthRedirect,
    ],
  );

  const tryApplyStoredAuthRecovery = useCallback(
    async (
      client: InspectorClient,
      challenge: AuthChallenge,
      recoverySource?: OAuthRecoverySource,
    ): Promise<boolean> => {
      if (!(await client.checkAuthChallengeSatisfied(challenge))) {
        return false;
      }
      await client.pushRemoteAuthState();
      notifications.show({
        title: "Authorization restored",
        message: authRecoveryRestoredMessage({ recoverySource }),
        color: "green",
        autoClose: 4000,
      });
      return true;
    },
    [],
  );

  const runVisibleInteractiveAuth = useCallback(
    ({
      serverId,
      challenge,
      authorizationUrl,
      source = "ambient",
    }: {
      serverId: string;
      challenge: AuthChallenge;
      authorizationUrl: URL;
      source?: StepUpSource;
    }) => {
      const server = serversRef.current.find((s) => s.id === serverId);
      if (isStepUpConfirmation(challenge, server)) {
        trySetPendingStepUp({
          challenge,
          authorizationUrl,
          serverId,
          source,
          enterpriseManaged: isEmaStepUp(challenge, server),
        });
        return;
      }
      prepareOAuthRedirect({
        serverId,
        authKind: "reauth",
        authorizationUrl,
        recoverySource: source,
      });
    },
    [prepareOAuthRedirect, trySetPendingStepUp],
  );

  const deferAmbientReauth = useCallback((pending: PendingReauth) => {
    if (pendingReauthRef.current) {
      notifications.show({
        title: "Authorization update pending",
        message:
          "A new authorization request replaced the previous deferred recovery.",
        color: "yellow",
        autoClose: 5000,
      });
    } else {
      notifications.show({
        title: "Authorization pending",
        message: "Return to this tab to continue authorization.",
        color: "blue",
        autoClose: 5000,
      });
    }
    setPendingReauth(pending);
  }, []);

  const handleCommandScopedAuthRecovery = useCallback(
    async (
      error: AuthRecoveryRequiredError,
      options: {
        serverId: string;
        source: StepUpSource;
        retryOperation?: () => Promise<unknown>;
      },
    ): Promise<boolean> => {
      if (!inspectorClient) {
        return false;
      }
      const server = serversRef.current.find((s) => s.id === options.serverId);
      const stepUp =
        error.emaStepUpConfirm ||
        isStepUpConfirmation(error.authChallenge, server);

      if (stepUp) {
        if (
          await tryApplyStoredAuthRecovery(
            inspectorClient,
            error.authChallenge,
            options.source,
          )
        ) {
          return true;
        }
        pendingStepUpRetryRef.current = options.retryOperation ?? null;
        trySetPendingStepUp({
          challenge: error.authChallenge,
          authorizationUrl: error.authorizationUrl,
          serverId: options.serverId,
          source: options.source,
          enterpriseManaged: isEmaStepUp(error.authChallenge, server),
        });
        return false;
      }

      if (
        await tryApplyStoredAuthRecovery(
          inspectorClient,
          error.authChallenge,
          options.source,
        )
      ) {
        return true;
      }

      prepareOAuthRedirect({
        serverId: options.serverId,
        authKind: "reauth",
        authorizationUrl: error.authorizationUrl,
        recoverySource: options.source,
      });
      return false;
    },
    [
      inspectorClient,
      prepareOAuthRedirect,
      tryApplyStoredAuthRecovery,
      trySetPendingStepUp,
    ],
  );

  const runWithCommandAuthRecovery = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      source: StepUpSource,
    ): Promise<T | undefined> => {
      if (!inspectorClient || !activeServerId) {
        return operation();
      }
      try {
        return await operation();
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          const satisfied = await handleCommandScopedAuthRecovery(err, {
            serverId: activeServerId,
            source,
            retryOperation: operation,
          });
          if (satisfied) {
            return operation();
          }
          return undefined;
        }
        throw err;
      }
    },
    [inspectorClient, activeServerId, handleCommandScopedAuthRecovery],
  );

  const resumePendingReauth = useCallback(
    async (pending: PendingReauth) => {
      if (reauthResumeInProgressRef.current) {
        return;
      }
      const client = inspectorClient;
      if (!client) {
        return;
      }
      if (connectionStatus !== "connected") {
        return;
      }
      if (pending.serverId !== activeServerIdRef.current) {
        return;
      }

      reauthResumeInProgressRef.current = true;
      setPendingReauth(null);
      try {
        if (
          await tryApplyStoredAuthRecovery(
            client,
            pending.challenge,
            pending.source,
          )
        ) {
          return;
        }

        if (pending.authKind === "step_up") {
          runVisibleInteractiveAuth({
            serverId: pending.serverId,
            challenge: pending.challenge,
            authorizationUrl: pending.authorizationUrl,
            source: pending.source,
          });
          return;
        }

        const outcome = await client.handleAuthChallenge(pending.challenge);
        if (outcome.kind === "satisfied") {
          await client.pushRemoteAuthState();
          notifications.show({
            title: "Authorization restored",
            message: authRecoveryRestoredMessage({
              recoverySource: pending.source,
            }),
            color: "green",
            autoClose: 4000,
          });
          return;
        }
        if (outcome.kind === "interactive") {
          runVisibleInteractiveAuth({
            serverId: pending.serverId,
            challenge: outcome.challenge,
            authorizationUrl: outcome.authorizationUrl,
            source: pending.source,
          });
          return;
        }
        if (outcome.kind === "failed") {
          showReAuthBanner(pending.serverId, outcome.error, {
            reason: pending.challenge.reason,
          });
        }
      } finally {
        reauthResumeInProgressRef.current = false;
      }
    },
    [
      inspectorClient,
      connectionStatus,
      tryApplyStoredAuthRecovery,
      runVisibleInteractiveAuth,
      showReAuthBanner,
    ],
  );

  useEffect(() => {
    if (connectionStatus !== "connected" || !inspectorClient) {
      return;
    }

    const onAuthChallengeInteractive = (
      event: TypedEvent<"authChallengeInteractive">,
    ): void => {
      void (async () => {
        const { challenge, authorizationUrl } = event.detail;
        const serverId = activeServerIdRef.current;
        if (!serverId) {
          return;
        }
        const server = serversRef.current.find((s) => s.id === serverId);
        const authKind: OAuthResumeAuthKind = isStepUpConfirmation(
          challenge,
          server,
        )
          ? "step_up"
          : "reauth";

        if (!isBrowserTabVisible()) {
          deferAmbientReauth({
            serverId,
            challenge,
            authorizationUrl,
            authKind,
            source: "ambient",
          });
          return;
        }

        if (await tryApplyStoredAuthRecovery(inspectorClient, challenge)) {
          return;
        }

        runVisibleInteractiveAuth({
          serverId,
          challenge,
          authorizationUrl,
          source: "ambient",
        });
      })();
    };

    inspectorClient.addEventListener(
      "authChallengeInteractive",
      onAuthChallengeInteractive,
    );
    return () => {
      inspectorClient.removeEventListener(
        "authChallengeInteractive",
        onAuthChallengeInteractive,
      );
    };
  }, [
    connectionStatus,
    inspectorClient,
    tryApplyStoredAuthRecovery,
    runVisibleInteractiveAuth,
    deferAmbientReauth,
  ]);

  useEffect(() => {
    return onBrowserTabVisible(() => {
      const pending = pendingReauthRef.current;
      if (pending) {
        void resumePendingReauth(pending);
      }
    });
  }, [resumePendingReauth]);

  // Resume deferred background-tab recovery once the session reconnects.
  useEffect(() => {
    if (connectionStatus !== "connected" || !inspectorClient) {
      return;
    }
    if (!isBrowserTabVisible()) {
      return;
    }
    const pending = pendingReauthRef.current;
    if (pending) {
      void resumePendingReauth(pending);
    }
  }, [connectionStatus, inspectorClient, resumePendingReauth]);

  useEffect(() => {
    if (connectionStatus !== "connected" || !inspectorClient) {
      return;
    }

    const onOAuthError = (event: TypedEvent<"oauthError">): void => {
      const serverId = activeServerIdRef.current;
      if (!serverId) {
        return;
      }
      showReAuthBanner(serverId, event.detail.error);
    };

    inspectorClient.addEventListener("oauthError", onOAuthError);
    return () => {
      inspectorClient.removeEventListener("oauthError", onOAuthError);
    };
  }, [connectionStatus, inspectorClient, showReAuthBanner]);

  // Detect an abandoned full-page OAuth redirect (snapshot left, no callback).
  useEffect(() => {
    if (staleOAuthCheckedRef.current) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === OAUTH_CALLBACK_PATH) return;
    if (servers.length === 0) return;
    staleOAuthCheckedRef.current = true;

    const snapshot = consumeOAuthResumeSnapshot();
    if (!snapshot) {
      return;
    }
    queueMicrotask(() => {
      if (snapshot.authKind === "reauth") {
        showReAuthBanner(
          snapshot.serverId,
          oauthResumeAbandonedMessage(snapshot.authKind),
        );
        return;
      }
      if (snapshot.authKind === "step_up") {
        showReAuthBanner(
          snapshot.serverId,
          oauthResumeAbandonedMessage(snapshot.authKind, {
            recoverySource: snapshot.recoverySource,
          }),
        );
      }
    });
  }, [servers, showReAuthBanner]);

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
      pagedToolsState?.destroy();
      pagedPromptsState?.destroy();
      pagedResourcesState?.destroy();
      managedResourceTemplatesState?.destroy();
      managedRequestorTasksState?.destroy();
      resourceSubscriptionsState?.destroy();
      messageLogState?.destroy();
      fetchRequestLogState?.destroy();
      stderrLogState?.destroy();

      const { environment, logger } = createWebEnvironment(
        getAuthToken(),
        redirectUrlProvider,
        onBeforeOAuthRedirect,
      );
      // The settings node persisted in mcp.json for this server — distinct
      // from the InspectorClient options we're about to derive from it.
      const savedSettings = server.settings;
      const activeIdp = getActiveEnterpriseManagedAuthIdp(clientConfig);
      const activeCimdUrl = getActiveCimdClientMetadataUrl(clientConfig);
      // Flatten the persisted settings into the InspectorClient options shape.
      // Empty / zero values stay unset so the SDK defaults apply.
      const defaultMetadata = savedSettings?.metadata
        ? Object.fromEntries(
            savedSettings.metadata
              .filter((m) => m.key.trim() !== "")
              .map((m) => [m.key, m.value]),
          )
        : undefined;
      const oauthFromServer =
        savedSettings &&
        (savedSettings.oauthClientId ||
          savedSettings.oauthClientSecret ||
          savedSettings.oauthScopes ||
          savedSettings.enterpriseManaged)
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
              ...(savedSettings.enterpriseManaged && {
                enterpriseManaged: true,
              }),
            }
          : undefined;
      const oauth =
        oauthFromServer || activeCimdUrl
          ? {
              ...(oauthFromServer ?? {}),
              ...(activeCimdUrl && { clientMetadataUrl: activeCimdUrl }),
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
        // Always advertise the roots capability (even with no configured
        // roots) so the server can issue roots/list and receive
        // roots/list_changed; the configured roots are the answer to
        // roots/list. Empty-uri rows are dropped before they reach the wire.
        roots: cleanRoots(savedSettings?.roots ?? []),
        ...(savedSettings &&
          savedSettings.requestTimeout > 0 && {
            timeout: savedSettings.requestTimeout,
          }),
        ...(defaultMetadata &&
          Object.keys(defaultMetadata).length > 0 && {
            defaultMetadata,
          }),
        ...(oauth && { oauth }),
        ...(activeIdp && {
          enterpriseManagedAuth: { idp: activeIdp },
        }),
        ...(clientConfig.enterpriseManagedAuth && {
          installEnterpriseManagedAuth: clientConfig.enterpriseManagedAuth,
        }),
        ...(savedSettings && { serverSettings: savedSettings }),
        // Per-server protocol era (SEP §7.8) → SDK versionNegotiation. Absent
        // settings or an unset era default to legacy inside
        // eraToVersionNegotiation / the InspectorClient constructor (#1626).
        ...(savedSettings?.protocolEra && {
          versionNegotiation: eraToVersionNegotiation(
            savedSettings.protocolEra,
          ),
        }),
        // Set on the `/oauth/callback` rebuild so the client's `saveSession`
        // events (and any later persistence) key off the same OAuth authId
        // the pre-redirect page saved under.
        ...(sessionId && { sessionId }),
      });

      setInspectorClient(client);
      setManagedToolsState(new ManagedToolsState(client));
      setPagedToolsState(new PagedToolsState(client));
      setPagedPromptsState(new PagedPromptsState(client));
      setPagedResourcesState(new PagedResourcesState(client));
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
        logger,
        maxFetchRequests:
          savedSettings?.maxFetchRequests ?? DEFAULT_MAX_FETCH_REQUESTS,
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
      pagedToolsState,
      pagedPromptsState,
      pagedResourcesState,
      managedResourceTemplatesState,
      managedRequestorTasksState,
      resourceSubscriptionsState,
      messageLogState,
      fetchRequestLogState,
      stderrLogState,
      sessionStorageAdapter,
      onBeforeOAuthRedirect,
      clientConfig,
    ],
  );

  // Finish the OAuth authorization-code flow when the auth server redirects
  // back to `/oauth/callback`. This runs on a fresh page load (the redirect in
  // `onToggleConnection` unloaded the previous one), so all React state is
  // reset and we recover the initiating server from sessionStorage. We wait for
  // `servers` to hydrate before acting; the ref guard keeps the exchange to a
  // single run. The persisted PKCE verifier + DCR client info live in shared
  // `RemoteOAuthStorage` (`oauth.json`) and survive the redirect, so
  // `completeOAuthFlow` exchanges the code without needing the original
  // in-memory state machine.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== OAUTH_CALLBACK_PATH) return;
    if (oauthCallbackHandledRef.current) return;
    // `useServers` returns [] until the first fetch resolves; defer until the
    // list is populated so `find` can resolve the pending server.
    if (servers.length === 0) return;
    oauthCallbackHandledRef.current = true;

    const params = parseOAuthCallbackParams(window.location.search);
    // The OAuth `state` round-trips the auth session id; the authId is the
    // session key the pre-redirect page saved the fetch log under, so the
    // rebuilt client can restore those `auth` entries. Read it before the
    // URL is cleared below.
    //
    // Defense-in-depth: a `state` that is present but does not parse to our
    // expected 64-char-hex authId shape did not originate from
    // `generateOAuthState`, so reject the callback instead of silently
    // proceeding with an undefined sessionId. This is a shape check, not full
    // state-matching — the primary CSRF protection remains PKCE
    // (`code_verifier`); this layer catches malformed/forged `state` early.
    //
    // Intentional asymmetry: a present-but-malformed `state` (including the
    // empty string `?state=`) is rejected, but a wholly absent `state`
    // (`stateParam === null`) is *not* — it falls through with
    // `sessionId = undefined` and is matched via the OAuth resume snapshot
    // (`resumeSnapshot.serverId`) instead. Rejecting the null case would turn any provider error redirect
    // that omits `state` into a misleading "rejected" toast, hiding the real
    // OAuth error surfaced by the `!params.successful` branch below.
    const stateParam = new URLSearchParams(window.location.search).get("state");
    const parsedState = stateParam ? parseOAuthState(stateParam) : null;
    const stateRejected = stateParam !== null && parsedState === null;
    const sessionId = parsedState?.authId ?? undefined;
    const resumeSnapshot = consumeOAuthResumeSnapshot();

    // Strip the code/state off the URL immediately so a reload can't replay
    // the (now single-use) authorization code through the exchange again.
    window.history.replaceState({}, "", "/");

    if (stateRejected) {
      notifications.show({
        title: "OAuth callback rejected",
        message:
          "OAuth callback carried an unrecognized state parameter that did not originate from this session. Please try connecting again.",
        color: "red",
      });
      return;
    }

    const applyResumeUiOnce = (
      snapshot: NonNullable<typeof resumeSnapshot>,
    ) => {
      if (oauthResumeUiAppliedRef.current) {
        return;
      }
      applyOAuthResumeUi(snapshot, {
        setToolsUi,
        setPromptsUi,
        setResourcesUi,
        setAppsUi,
        setTasksUi,
        setLogsUi,
        setProtocolUi,
        setNetworkUi,
        setActiveTab,
        clearToolCallState: () => setToolCallState(undefined),
        clearGetPromptState: () => setGetPromptState(undefined),
        clearReadResourceState: () => setReadResourceState(undefined),
      });
      oauthResumeUiAppliedRef.current = true;
    };

    if (resumeSnapshot && params.successful) {
      applyResumeUiOnce(resumeSnapshot);
    }

    if (!params.successful) {
      const pendingId = resumeSnapshot?.serverId;
      if (pendingId) {
        queueMicrotask(() => {
          showReAuthBanner(pendingId, generateOAuthErrorDescription(params));
        });
      } else {
        notifications.show({
          title: "OAuth authorization failed",
          message: generateOAuthErrorDescription(params),
          color: "red",
        });
      }
      return;
    }

    const pendingId = resumeSnapshot?.serverId;
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
      try {
        await webOAuthStorage.load();
      } catch (err) {
        connectStartRef.current = undefined;
        queueMicrotask(() => {
          showReAuthBanner(server.id, err instanceof Error ? err : String(err));
        });
        return;
      }
      const client = setupClientForServer(server, sessionId);
      setActiveServerId(server.id);
      try {
        connectStartRef.current = Date.now();
        await client.resumeAfterOAuth(params.code, {
          remoteSessionId: resumeSnapshot?.remoteSessionId,
          iss: params.iss,
        });
      } catch (err) {
        connectStartRef.current = undefined;
        if (isEmaClientNotConfiguredError(err)) {
          notifications.show({
            title: `Cannot connect to "${server.name}"`,
            message: err.message,
            color: "red",
            autoClose: false,
          });
          return;
        }
        queueMicrotask(() => {
          showReAuthBanner(server.id, err instanceof Error ? err : String(err));
        });
        return;
      }

      setReAuthBanner(null);

      if (resumeSnapshot) {
        const stepUpChallenge =
          resumeSnapshot.authKind === "step_up"
            ? resumeSnapshot.authChallenge
            : undefined;
        const stepUpScopesGranted =
          !stepUpChallenge ||
          (await client.checkAuthChallengeSatisfied(stepUpChallenge));

        if (stepUpChallenge && !stepUpScopesGranted) {
          notifications.show({
            title: "Additional permissions not granted",
            message: oauthResumeInsufficientScopeMessage(stepUpChallenge),
            color: "yellow",
            autoClose: false,
          });
          return;
        }

        notifications.show({
          title: "Authorization complete",
          message: oauthResumeToastMessage(resumeSnapshot.authKind, {
            recoverySource: resumeSnapshot.recoverySource,
          }),
          color: "green",
          autoClose: 6000,
        });
      }
    })();
  }, [servers, setupClientForServer, showReAuthBanner, webOAuthStorage]);

  const onToggleConnection = useCallback(
    async (id: string) => {
      // Same server, already connected → disconnect.
      if (
        id === activeServerId &&
        connectionStatus === "connected" &&
        inspectorClient
      ) {
        try {
          await inspectorClient.disconnect();
        } finally {
          finalizeExplicitDisconnect();
        }
        return;
      }

      // Read from the ref so a caller that already awaited an
      // addServer/updateServer in the same async tick (e.g. the deep-link
      // auto-connect IIFE) sees the freshly-mutated list, not the stale array
      // captured by this callback's closure.
      const target = serversRef.current.find((s) => s.id === id);
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
      // A new connection attempt has begun: clear any previous failure flag so
      // the red border on the last-failed card is removed (#1621). If this
      // attempt also fails, the catch below re-sets it for this server.
      setFailedServerId(undefined);
      // Clear the machine-readable connect error for the same reason; a fresh
      // attempt starts from a clean `data-error-message`.
      setConnectErrorMessage(undefined);

      connectStartRef.current = Date.now();
      try {
        // `settings.connectionTimeout` is consumed inside InspectorClient.connect
        // (Promise.race + transport teardown live there now), so this branch
        // stays unaware of the per-server timeout. TUI/CLI consumers get the
        // same behavior by reading from `serverSettings` on the client.
        await client.connect();
      } catch (err) {
        // Handshake-only. A mid-session transport failure does not throw; the
        // client's `error` event surfaces those, consumed via
        // `useInspectorClient`'s `lastError` and toasted in the effect above
        // (#1323).
        connectStartRef.current = undefined;

        if (isEmaClientNotConfiguredError(err)) {
          notifications.show({
            title: `Cannot connect to "${target.name}"`,
            message: err.message,
            color: "red",
            autoClose: false,
          });
          return;
        }

        // A 401 from an OAuth-protected server means we have no (valid) token
        // yet. Kick off the authorization-code flow: `authenticate()` runs
        // discovery + DCR (proxied through the backend), then redirects the
        // whole page to the auth server via `BrowserNavigation`. Persist the
        // initiating server id first so the `/oauth/callback` load can resume
        // against the right client. The redirect unloads this page, so there's
        // nothing to do after the await on the success path.
        if (err instanceof AuthRecoveryRequiredError) {
          if (await client.checkAuthChallengeSatisfied(err.authChallenge)) {
            connectStartRef.current = Date.now();
            await client.connect();
            return;
          }
          prepareOAuthRedirect({
            serverId: id,
            authKind: "reauth",
            authorizationUrl: err.authorizationUrl,
            preRedirectContext: "connect",
            client,
          });
          return;
        }

        if (isUnauthorizedError(err)) {
          try {
            const authUrl = await client.authenticate();
            if (authUrl === undefined) {
              connectStartRef.current = Date.now();
              await client.connect();
            } else {
              prepareOAuthRedirect({
                serverId: id,
                authKind: "reauth",
                authorizationUrl: authUrl,
                preRedirectContext: "connect",
                client,
              });
            }
            return;
          } catch (authErr) {
            clearOAuthResumeSnapshot();
            await client.disconnect().catch(() => {});
            if (isEmaClientNotConfiguredError(authErr)) {
              notifications.show({
                title: `Cannot connect to "${target.name}"`,
                message: authErr.message,
                color: "red",
                autoClose: false,
              });
              return;
            }
            const message =
              authErr instanceof Error ? authErr.message : String(authErr);
            setConnectErrorMessage(message);
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
        // "disconnected", and flag the card with a red border (#1621).
        setFailedServerId(id);
        const message = err instanceof Error ? err.message : String(err);
        setConnectErrorMessage(message);
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
      setupClientForServer,
      prepareOAuthRedirect,
      finalizeExplicitDisconnect,
    ],
  );

  const onDisconnect = useCallback(async () => {
    if (!inspectorClient) return;
    try {
      await inspectorClient.disconnect();
    } finally {
      finalizeExplicitDisconnect();
    }
  }, [inspectorClient, finalizeExplicitDisconnect]);

  // Deep-link auto-connect (the URL-driven case of #1183). `useServers`
  // hydrates asynchronously (initial `servers` is `[]`), so this effect runs in
  // discrete phases keyed on what `servers` currently reflects, one per render:
  //   1. ensure — no row yet: one-shot `addServer`.
  //   2. update — row present but its persisted config differs from the deep
  //      link (a stale transport/url from an earlier load under the stable
  //      `deep-link` id): `updateServer`, then return so the effect re-runs.
  //   3. connect — row present AND its config already matches: connect.
  // Splitting update and connect across renders (rather than awaiting both in
  // one closure) is what makes the connect correct: `onToggleConnection` reads
  // the target from `serversRef`, which an earlier passive effect syncs from
  // `servers` — so connecting only once `servers` reflects the updated config
  // guarantees the client is built from the fresh transport, not the stale one.
  // The OAuth callback path takes precedence; a deep link on `/oauth/callback`
  // would be a misconfiguration, and the callback handler clears the URL.
  useEffect(() => {
    if (!deepLink) return;
    if (window.location.pathname === OAUTH_CALLBACK_PATH) return;

    const existing = servers.find((s) => s.id === deepLink.serverId);
    if (!existing) {
      if (deepLinkEnsureRef.current) return;
      deepLinkEnsureRef.current = true;
      void addServer(deepLink.serverId, deepLink.serverConfig).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        // A 409 ("already exists") means the row is on disk and hydration will
        // surface it on a later render, so the connect phase still proceeds —
        // swallow it. Any other failure (read-only catalog, backend 5xx) would
        // otherwise leave the deep link permanently stuck at this guard with no
        // signal, so record it on the machine-readable error surface.
        if (!message.includes("already exists")) recordConnectError(message);
      });
      return;
    }

    if (!deepLinkConfigEquals(existing.config, deepLink.serverConfig)) {
      if (deepLinkUpdateRef.current) return;
      deepLinkUpdateRef.current = true;
      void updateServer(
        deepLink.serverId,
        deepLink.serverId,
        deepLink.serverConfig,
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        recordConnectError(message);
      });
      return;
    }

    if (deepLinkConnectRef.current) return;
    deepLinkConnectRef.current = true;
    // Connect unless we're already *connected* to the deep-link server. Gating
    // on `activeServerId` identity alone would skip the connect when a prior
    // session restored `activeServerId` to the `deep-link` id while the socket
    // is disconnected — a reload of the same deep-link URL would then silently
    // never connect. `onToggleConnection` only disconnects when the id is the
    // active one AND the status is connected, so this condition also avoids
    // toggling a live connection off.
    const alreadyConnected =
      activeServerId === deepLink.serverId && connectionStatus === "connected";
    if (!alreadyConnected) {
      void onToggleConnection(deepLink.serverId).catch((err) => {
        // The toast fires from inside `onToggleConnection` for the common
        // cases; this catch covers the rest (surfaced on `data-error-message`).
        const message = err instanceof Error ? err.message : String(err);
        recordConnectError(message);
      });
    }
  }, [
    deepLink,
    servers,
    activeServerId,
    connectionStatus,
    addServer,
    updateServer,
    onToggleConnection,
    recordConnectError,
  ]);

  const onReauthenticateFromBanner = useCallback(() => {
    if (!reAuthBanner) return;
    const serverId = reAuthBanner.serverId;
    setReAuthBanner(null);

    if (
      serverId === activeServerId &&
      connectionStatus === "connected" &&
      inspectorClient
    ) {
      void (async () => {
        const server = servers.find((s) => s.id === serverId);
        try {
          const authUrl = await inspectorClient.authenticate();
          if (authUrl === undefined) {
            await inspectorClient.pushRemoteAuthState();
            notifications.show({
              title: "Authorization restored",
              message: authRecoveryRestoredMessage(),
              color: "green",
              autoClose: 4000,
            });
            return;
          }
          prepareOAuthRedirect({
            serverId,
            authKind: "reauth",
            authorizationUrl: authUrl,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          notifications.show({
            title: server
              ? `OAuth authorization failed for "${server.name}"`
              : "OAuth authorization failed",
            message,
            color: "red",
          });
        }
      })();
      return;
    }

    void onToggleConnection(serverId);
  }, [
    reAuthBanner,
    activeServerId,
    connectionStatus,
    inspectorClient,
    servers,
    prepareOAuthRedirect,
    onToggleConnection,
  ]);

  // --- Action handlers that route directly to the InspectorClient. ---

  const onCallTool = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      runAsTask?: boolean,
    ) => {
      if (!inspectorClient) return;
      const tool = tools.find((t: Tool) => t.name === name);
      if (!tool) return;
      // Route through the task pipeline when the caller asked to (or the tool
      // requires it) — but only if the server advertises task tool calls. Per
      // spec a tool's `taskSupport` is considered only when the server declares
      // `tasks.requests.tools.call`, so without it we never task-augment (even a
      // "required" tool, which then surfaces callTool's "requires task support"
      // error). The created task shows up on the Tasks screen via the
      // `requestorTaskUpdated` events callToolStream dispatches, and its live
      // status/progress surface as toasts + progress bar.
      const serverSupportsTaskToolCalls =
        !!capabilities?.tasks?.requests?.tools?.call;
      const asTask =
        serverSupportsTaskToolCalls &&
        (runAsTask || tool.execution?.taskSupport === "required");
      // Drop any prior call's task id before starting; a task-augmented call
      // repopulates it via the `toolCallTaskUpdated` listener below, an ordinary
      // call leaves it cleared (#1455).
      activeToolCallTaskIdRef.current = undefined;
      setToolCallState({ status: "pending" });
      try {
        // ToolsScreen types the args as `Record<string, unknown>` (it accepts
        // anything the user types into the schema form). `callTool` requires
        // `Record<string, JsonValue>` — narrow at the boundary instead of
        // claiming the object is empty (which the previous `as Record<string,
        // never>` cast did, misleadingly).
        const invocation = asTask
          ? await inspectorClient.callToolStream(
              tool,
              args as Record<string, JsonValue>,
              undefined,
              undefined,
              { ttl: activeServer?.settings?.taskTtl || DEFAULT_TASK_TTL_MS },
            )
          : await inspectorClient.callTool(
              tool,
              args as Record<string, JsonValue>,
            );
        setToolCallState({
          status: invocation.success ? "ok" : "error",
          result: invocation.result ?? undefined,
          error: invocation.error,
        });
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          setToolCallState(undefined);
          if (activeServerId) {
            await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "tool",
            });
          }
          return;
        }
        // The user cancelled the in-flight call (Cancel button → cancelToolCall).
        // The cancellation notification was already sent to the server, so just
        // clear the executing state — surfacing it as an error would read as a
        // failure rather than the deliberate cancel it was (#1458).
        if (err instanceof ToolCallCancelledError) {
          setToolCallState(undefined);
          notifications.show({
            title: "Tool call cancelled",
            message: "A cancellation request was sent to the server.",
            color: "gray",
            autoClose: 3000,
          });
          return;
        }
        // The server kept asking for a URL the user already completed this call,
        // so callTool aborted to avoid an endless re-prompt loop. Surface that
        // explicitly rather than as a generic failure.
        if (err instanceof UrlElicitationLoopError) {
          setToolCallState({ status: "error", error: err.message });
          notifications.show({
            autoClose: false,
            title: "URL elicitation loop",
            color: "yellow",
            message: (
              <Text size="sm">
                The server requested the same URL again after you completed it (
                {err.url}), so the call was cancelled to avoid an endless loop.
              </Text>
            ),
          });
          return;
        }
        // A URLElicitationRequired (-32042) error that reaches here carried no
        // elicitations (a non-spec response — the with-list case is handled and
        // retried inside callTool). There's no URL to open, so surface a short
        // toast that links to the raw error rather than a bare error panel.
        const urlElicitations = getUrlElicitationsFromError(err);
        if (urlElicitations !== null && urlElicitations.length === 0) {
          const details = {
            toolName: name,
            details: formatErrorDetails(err),
          };
          setToolCallState({ status: "error", error: errorMessage(err) });
          notifications.show({
            autoClose: false,
            title: "URL elicitation required",
            color: "yellow",
            message: (
              <UrlElicitationErrorToastMessage
                onViewDetails={() => setUrlElicitationErrorDetails(details)}
              />
            ),
          });
          return;
        }
        setToolCallState({
          status: "error",
          error: errorMessage(err),
        });
      }
    },
    [
      inspectorClient,
      tools,
      activeServer,
      capabilities,
      activeServerId,
      handleCommandScopedAuthRecovery,
    ],
  );

  const onClearToolResult = useCallback(() => {
    setToolCallState(undefined);
  }, []);

  // Tools UI changes flow through here so selecting a *different* tool also
  // drops the previous tool's result — the result panel renders `toolCallState`
  // regardless of selection, so without this a stale result would linger under
  // the newly-selected tool (which has no result of its own yet). Search and
  // form edits keep `selectedToolName` unchanged, so they leave the result be.
  // Depends on `selectedToolName` only (not the whole `toolsUi`), so a search
  // keystroke doesn't churn the callback identity.
  const onToolsUiChange = useCallback(
    (next: ToolsUiState) => {
      if (next.selectedToolName !== toolsUi.selectedToolName) {
        setToolCallState(undefined);
      }
      setToolsUi(next);
    },
    [toolsUi.selectedToolName],
  );

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
    ],
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
        if (err instanceof AuthRecoveryRequiredError) {
          setGetPromptState(undefined);
          if (activeServerId) {
            await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "prompt",
            });
          }
          return;
        }
        setGetPromptState({
          status: "error",
          promptName: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [inspectorClient, activeServerId, handleCommandScopedAuthRecovery],
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
        if (err instanceof AuthRecoveryRequiredError) {
          setReadResourceState(undefined);
          if (activeServerId) {
            await handleCommandScopedAuthRecovery(err, {
              serverId: activeServerId,
              source: "resource",
            });
          }
          return;
        }
        setReadResourceState({
          status: "error",
          uri,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [inspectorClient, activeServerId, handleCommandScopedAuthRecovery],
  );

  // Read-on-demand handler for `resource_link` blocks in a tool result. Unlike
  // `onReadResource` (which drives the Resources screen's preview panel via
  // shared state), this returns the contents directly so each ResourceLink can
  // own and inline its own fetched content.
  const onReadResourceContents = useCallback(
    async (uri: string) => {
      if (!inspectorClient) throw new Error("Client is not connected");
      const read = () => inspectorClient.readResource(uri);
      try {
        const invocation = await read();
        return invocation.result;
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError && activeServerId) {
          const satisfied = await handleCommandScopedAuthRecovery(err, {
            serverId: activeServerId,
            source: "resource",
          });
          if (satisfied) {
            const retry = await read();
            return retry.result;
          }
        }
        throw err;
      }
    },
    [inspectorClient, activeServerId, handleCommandScopedAuthRecovery],
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
      const result = await runWithCommandAuthRecovery(
        () =>
          inspectorClient.getCompletions(
            ref,
            argumentName,
            argumentValue,
            context,
          ),
        "tool",
      );
      return result?.values ?? [];
    },
    [inspectorClient, runWithCommandAuthRecovery],
  );

  const onCancelTask = useCallback(
    async (taskId: string) => {
      if (!inspectorClient) return;
      try {
        await runWithCommandAuthRecovery(
          () => inspectorClient.cancelRequestorTask(taskId),
          "tool",
        );
      } catch (err) {
        if (err instanceof AuthRecoveryRequiredError) {
          return;
        }
        notifications.show({
          title: "Failed to cancel task",
          message: err instanceof Error ? err.message : String(err),
          color: "red",
        });
      }
    },
    [inspectorClient, runWithCommandAuthRecovery],
  );

  // Cancel the in-flight tool call. A task-augmented call (run-as-task) has a
  // server-side task, so cancel that via the tasks API (#1455) — the cancelled
  // status then flows back through the managed task store and toasts, the same
  // as cancelling from the Tasks screen. An ordinary call has no task, so abort
  // its request: the SDK sends a `notifications/cancelled` to the server (the
  // MCP cancellation flow) and the pending call rejects with a
  // ToolCallCancelledError that `onCallTool` clears as a cancellation (#1458).
  const onCancelToolCall = useCallback(() => {
    if (!inspectorClient) return;
    const taskId = activeToolCallTaskIdRef.current;
    if (taskId) {
      // Clear the ref before the call resolves so a rapid second Cancel click
      // doesn't re-cancel the now-terminating task (which would surface a
      // spurious "Failed to cancel task" toast).
      activeToolCallTaskIdRef.current = undefined;
      void onCancelTask(taskId);
      return;
    }
    inspectorClient.cancelToolCall();
  }, [inspectorClient, onCancelTask]);

  const onClearCompletedTasks = useCallback(() => {
    clearCompletedTasks();
  }, [clearCompletedTasks]);

  const onSetLogLevel = useCallback(
    (level: LoggingLevel) => {
      setCurrentLogLevel(level);
      if (!inspectorClient) return;
      void runWithCommandAuthRecovery(
        () => inspectorClient.setLoggingLevel(level),
        "ambient",
      );
    },
    [inspectorClient, runWithCommandAuthRecovery],
  );

  // Refresh acts per pagination mode: in paginated mode reload page 1 (the
  // paged state); in all-pages mode re-fetch the whole aggregate with auth
  // recovery (the pre-existing path). See usePaginatedList / #1721.
  const onRefreshTools = useCallback(() => {
    if (paginatedLists) {
      // Paginated refresh reloads page 1 of the paged store, bypassing the
      // managed hook's refresh — so acknowledge the list-changed indicator here
      // (the managed state lit it on `list_changed`; nothing else clears it in
      // paginated mode) (#1721).
      clearToolsListChanged();
      void runWithCommandAuthRecovery(
        () => toolsPagination.onRefresh(),
        "ambient",
      );
    } else {
      void runWithCommandAuthRecovery(() => refreshTools(), "ambient");
    }
  }, [
    paginatedLists,
    toolsPagination,
    refreshTools,
    clearToolsListChanged,
    runWithCommandAuthRecovery,
  ]);
  const onRefreshPrompts = useCallback(() => {
    if (paginatedLists) {
      clearPromptsListChanged();
      void runWithCommandAuthRecovery(
        () => promptsPagination.onRefresh(),
        "ambient",
      );
    } else {
      void runWithCommandAuthRecovery(() => refreshPrompts(), "ambient");
    }
  }, [
    paginatedLists,
    promptsPagination,
    refreshPrompts,
    clearPromptsListChanged,
    runWithCommandAuthRecovery,
  ]);
  const onRefreshResources = useCallback(() => {
    if (paginatedLists) {
      clearResourcesListChanged();
      void runWithCommandAuthRecovery(
        () => resourcesPagination.onRefresh(),
        "ambient",
      );
      // Resource templates always use the managed (aggregate) path.
      void runWithCommandAuthRecovery(
        () => refreshResourceTemplates(),
        "ambient",
      );
    } else {
      void runWithCommandAuthRecovery(async () => {
        await refreshResources();
        await refreshResourceTemplates();
      }, "ambient");
    }
  }, [
    paginatedLists,
    resourcesPagination,
    refreshResources,
    refreshResourceTemplates,
    clearResourcesListChanged,
    runWithCommandAuthRecovery,
  ]);
  // The per-list sidebar toggle edits the server-wide `paginatedLists` setting:
  // optimistic override for an instant flip, live push so the managed state's
  // gating reads it now, and a persisted PUT so it survives reconnects (#1721).
  const onTogglePaginatedLists = useCallback(
    (value: boolean) => {
      setPaginatedListsOverride(value);
      const current = servers.find((s) => s.id === activeServerId);
      if (!current || activeServerId === undefined) return;
      const prevSettings = current.settings ?? EMPTY_SETTINGS;
      const next: InspectorServerSettings = {
        ...prevSettings,
        paginatedLists: value,
      };
      inspectorClient?.setServerSettings(next);
      // Drive the load that the mode change implies (data-loading stays out of
      // React effects; the paged stores own only the connect-time load). To
      // paginated: pull page 1 into each paged store. To all-pages: refetch
      // each managed aggregate that was gated off. Only when connected.
      if (connected) {
        // Wrap in ambient auth recovery so a mid-session 401 triggers re-auth
        // rather than surfacing raw, matching the all-pages refresh path.
        if (value) {
          void runWithCommandAuthRecovery(
            () => loadToolsPage(undefined),
            "ambient",
          );
          void runWithCommandAuthRecovery(
            () => loadPromptsPage(undefined),
            "ambient",
          );
          void runWithCommandAuthRecovery(
            () => loadResourcesPage(undefined),
            "ambient",
          );
        } else {
          void runWithCommandAuthRecovery(() => refreshTools(), "ambient");
          void runWithCommandAuthRecovery(() => refreshPrompts(), "ambient");
          void runWithCommandAuthRecovery(() => refreshResources(), "ambient");
        }
      }
      void updateServerSettings(activeServerId, next).catch((err: unknown) => {
        // Persist failed: revert the optimistic override (the effect only
        // clears it when the persisted value changes, which won't happen here)
        // and roll the live client setting back, so the UI and client reflect
        // the value that's actually on disk rather than the failed edit (#1721).
        setPaginatedListsOverride(null);
        inspectorClient?.setServerSettings(prevSettings);
        notifications.show({
          title: "Failed to save pagination setting",
          message: err instanceof Error ? err.message : String(err),
          color: "red",
        });
      });
    },
    [
      servers,
      activeServerId,
      inspectorClient,
      updateServerSettings,
      connected,
      loadToolsPage,
      loadPromptsPage,
      loadResourcesPage,
      refreshTools,
      refreshPrompts,
      refreshResources,
      runWithCommandAuthRecovery,
    ],
  );
  // Wrap Load-next-page in ambient auth recovery too, so a paginated
  // paginated fetch that hits a 401 recovers like the all-pages path (#1721).
  const onLoadMoreTools = useCallback(
    () =>
      void runWithCommandAuthRecovery(
        () => toolsPagination.onLoadMore(),
        "ambient",
      ),
    [toolsPagination, runWithCommandAuthRecovery],
  );
  const onLoadMorePrompts = useCallback(
    () =>
      void runWithCommandAuthRecovery(
        () => promptsPagination.onLoadMore(),
        "ambient",
      ),
    [promptsPagination, runWithCommandAuthRecovery],
  );
  const onLoadMoreResources = useCallback(
    () =>
      void runWithCommandAuthRecovery(
        () => resourcesPagination.onLoadMore(),
        "ambient",
      ),
    [resourcesPagination, runWithCommandAuthRecovery],
  );
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
  const onRefreshTasks = useCallback(() => {
    void runWithCommandAuthRecovery(() => refreshTasks(), "ambient")?.catch(
      (err: unknown) => {
        notifications.show({
          title: "Failed to refresh tasks",
          message: err instanceof Error ? err.message : String(err),
          color: "red",
        });
      },
    );
  }, [refreshTasks, runWithCommandAuthRecovery]);

  const onClearLogs = useCallback(() => {
    if (!messageLogState) return;
    // Clear only the log notifications, not the entire request/response
    // history (which the Protocol screen renders from the same source).
    messageLogState.clearMessages(
      (m) =>
        m.direction === "notification" &&
        "method" in m.message &&
        m.message.method === "notifications/message",
    );
  }, [messageLogState]);

  // Panel-level Clear clears the (unpinned) history and keeps pinned entries —
  // pinning is the way to protect an entry from Clear. This matches the button's
  // `disabled={unpinnedEntries.length === 0}` gating and the per-section model,
  // and leaves pinnedProtocolIds valid (the pins it references still exist).
  const onClearProtocol = useCallback(() => {
    messageLogState?.clearMessages((m) => !pinnedProtocolIds.has(m.id));
  }, [messageLogState, pinnedProtocolIds]);

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

  const onExportProtocol = useCallback(() => {
    if (messages.length === 0) return;
    downloadJsonFile(
      buildExportFilename("protocol", activeServerId),
      JSON.stringify(messages, null, 2),
    );
  }, [messages, activeServerId]);

  // Clear just one section: remove its entries from the log by pin membership.
  // Clearing the pinned section also drops the (now-stale) pinned id set.
  const onClearProtocolSection = useCallback(
    (section: "pinned" | "history") => {
      const isPinned = section === "pinned";
      messageLogState?.clearMessages((m) =>
        isPinned ? pinnedProtocolIds.has(m.id) : !pinnedProtocolIds.has(m.id),
      );
      if (isPinned) setPinnedProtocolIds(new Set());
    },
    [messageLogState, pinnedProtocolIds],
  );

  // Export just one section's entries (by pin membership) to a JSON file.
  const onExportProtocolSection = useCallback(
    (section: "pinned" | "history") => {
      const isPinned = section === "pinned";
      const subset = messages.filter((m) =>
        isPinned ? pinnedProtocolIds.has(m.id) : !pinnedProtocolIds.has(m.id),
      );
      if (subset.length === 0) return;
      downloadJsonFile(
        buildExportFilename(
          isPinned ? "protocol-pinned" : "protocol-unpinned",
          activeServerId,
        ),
        JSON.stringify(subset, null, 2),
      );
    },
    [messages, pinnedProtocolIds, activeServerId],
  );

  // Pin/unpin a Protocol entry by id. ProtocolListPanel sorts pinned entries to
  // the top; the set is session-scoped (see resetSessionScopedUiState).
  const onTogglePinProtocol = useCallback((id: string) => {
    setPinnedProtocolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Replay a Protocol entry: re-issue its original request so the fresh
  // request+response appear as a new Protocol entry (protocol-local). A reason
  // string (unsupported method / missing tool) surfaces as a toast; a genuine
  // call error already shows up as the replayed entry's Error status, so only a
  // pre-flight failure (nothing logged) needs the fallback toast.
  const onReplayProtocol = useCallback(
    (id: string) => {
      if (!inspectorClient) return;
      const entry = messages.find((m) => m.id === id);
      if (!entry || !("method" in entry.message)) return;
      const { method } = entry.message;
      const params =
        "params" in entry.message
          ? (entry.message.params as Record<string, unknown> | undefined)
          : undefined;
      void replayProtocolRequest(inspectorClient, method, params, tools)
        .then((reason) => {
          if (reason) {
            notifications.show({
              title: "Can't replay",
              message: reason,
              color: "yellow",
            });
          }
        })
        .catch((err: unknown) => {
          notifications.show({
            title: "Replay failed",
            message: err instanceof Error ? err.message : String(err),
            color: "red",
          });
        });
    },
    [inspectorClient, messages, tools],
  );

  const onExportLogs = useCallback(() => {
    if (logs.length === 0) return;
    downloadJsonFile(
      buildExportFilename("logs", activeServerId),
      JSON.stringify(logs, null, 2),
    );
  }, [logs, activeServerId]);

  const onClearConsole = useCallback(() => {
    stderrLogState?.clearStderrLogs();
  }, [stderrLogState]);

  const onExportConsole = useCallback(() => {
    if (stderrLogs.length === 0) return;
    downloadJsonFile(
      buildExportFilename("console", activeServerId),
      JSON.stringify(stderrLogs, null, 2),
    );
  }, [stderrLogs, activeServerId]);

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
      pagedToolsState?.destroy();
      pagedPromptsState?.destroy();
      pagedResourcesState?.destroy();
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
      setPagedToolsState(null);
      setPagedPromptsState(null);
      setPagedResourcesState(null);
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
    pagedToolsState,
    pagedPromptsState,
    pagedResourcesState,
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
  // Add a server, then mark it as the freshly-added one so the list scrolls to
  // it and highlights it. Used by manual add/clone and both import flows; edits
  // and conflict-overwrites (updateServer) intentionally don't highlight.
  // Accumulates into the current highlight batch (a multi-server import adds
  // each id), deduped. The batch is reset to empty when an add/import modal
  // opens (see the menu handlers).
  const addServerHighlighted = useCallback(
    async (id: string, config: MCPServerConfig) => {
      await addServer(id, config);
      setHighlightedServerIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    },
    [addServer],
  );

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

  const {
    draft: clientSettingsDraft,
    onChange: onClientSettingsChange,
    flush: flushClientSettingsDraft,
  } = useClientSettingsDraft({
    opened: clientSettingsOpen,
    resolveInitial: () => clientConfigToFormValues(clientConfig),
    onPersist: async (values) => {
      if (!canPersistClientSettingsDraft(values)) return;
      const next = formValuesToClientConfig(values);
      await saveClientConfigRemote(next, {
        baseUrl: configBaseUrl,
        authToken: getAuthToken(),
      });
      setClientConfig(next);
    },
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

  const clearServerOAuthAndDisconnect = useCallback(
    async (server: { id: string; name: string; config: MCPServerConfig }) => {
      const isActive = server.id === activeServerId;
      const cleared = await clearServerOAuthState({
        config: server.config,
        inspectorClient: isActive ? inspectorClient : null,
        isActiveConnection: isActive,
        oauthStorage: webOAuthStorage,
      });
      if (!cleared) return;

      if (isActive && inspectorClient) {
        try {
          await inspectorClient.disconnect();
        } finally {
          setConnectionInfoOAuthWhenConnected(undefined);
          finalizeExplicitDisconnect();
        }
      } else {
        clearOAuthResumeOnExplicitDisconnect();
      }

      notifications.show({
        title: "OAuth state cleared",
        message: isActive
          ? "Stored tokens and client registration were removed. Reconnect to run a fresh authorization flow."
          : `Stored OAuth state was removed for "${server.name}". Connect to authorize again.`,
        color: "blue",
      });
    },
    [
      activeServerId,
      inspectorClient,
      webOAuthStorage,
      finalizeExplicitDisconnect,
      clearOAuthResumeOnExplicitDisconnect,
    ],
  );

  const handleClearConnectionOAuth = useCallback(() => {
    if (!activeServer) return;
    void clearServerOAuthAndDisconnect(activeServer);
  }, [activeServer, clearServerOAuthAndDisconnect]);

  const handleClearStoredOAuthFromSettings = useCallback(() => {
    if (!settingsModalTarget) return;
    void clearServerOAuthAndDisconnect(settingsModalTarget);
  }, [settingsModalTarget, clearServerOAuthAndDisconnect]);

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
      // Push the edited settings onto the live client so settings the managed
      // state reads at notification time (auto-refresh-on-list-changed) take
      // effect without a reconnect (#1444). Connection-time inputs (transport,
      // OAuth, timeouts) still only apply on the next connect.
      inspectorClient.setServerSettings(settingsDraft);
      // Resize the Network log buffer live so a maxFetchRequests edit takes
      // effect without a reconnect (shrinking trims immediately). Connect-time
      // construction also reads this, so a reconnect would apply it anyway —
      // this just makes the toast→adjust flow responsive.
      fetchLogRef.current?.setMaxFetchRequests(settingsDraft.maxFetchRequests);
      const nextRoots = cleanRoots(settingsDraft.roots);
      const currentRoots = cleanRoots(inspectorClient.getRoots());
      if (JSON.stringify(nextRoots) !== JSON.stringify(currentRoots)) {
        void inspectorClient.setRoots(nextRoots).catch(() => {
          // setRoots swallows notification failures internally; a throw here
          // only means the client is mid-teardown — the persisted roots will
          // re-advertise on the next connect, so nothing to surface.
        });
      }
    }
    setSettingsModalTargetId(undefined);
  }, [
    flushSettingsDraft,
    inspectorClient,
    settingsModalTargetId,
    activeServerId,
    settingsDraft,
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
      void pendingElicitations[0]?.respond(result);
    },
    [pendingElicitations],
  );

  const handleStepUpAuthorize = async () => {
    if (!pendingStepUp || stepUpAuthorizeInProgressRef.current) {
      return;
    }
    const stepUp = pendingStepUp;
    const client = inspectorClient;
    if (!client) {
      return;
    }

    if (stepUp.enterpriseManaged) {
      stepUpAuthorizeInProgressRef.current = true;
      setPendingStepUp(null);
      notifications.show({
        title: "Organization permissions",
        message: emaStepUpInProgressMessage(),
        color: "blue",
        autoClose: 4000,
      });
      try {
        const outcome = await client.handleAuthChallenge(stepUp.challenge, {
          confirmedStepUp: true,
        });
        if (outcome.kind === "satisfied") {
          await client.pushRemoteAuthState();
          notifications.show({
            title: "Permissions updated",
            message: emaStepUpSuccessMessage({
              recoverySource: stepUp.source,
            }),
            color: "green",
            autoClose: 5000,
          });
          const retry = pendingStepUpRetryRef.current;
          pendingStepUpRetryRef.current = null;
          if (retry) {
            await retry();
          }
          return;
        }
        if (outcome.kind === "interactive") {
          prepareOAuthRedirect({
            serverId: stepUp.serverId,
            authKind: "step_up",
            authorizationUrl: outcome.authorizationUrl,
            authChallenge: outcome.challenge,
            recoverySource: stepUp.source,
          });
          return;
        }
        if (outcome.kind === "failed") {
          const failureMessage = emaStepUpFailureMessage(outcome.error.message);
          notifications.show({
            title: "Organization permissions",
            message: failureMessage,
            color: "red",
            autoClose: 6000,
          });
          switch (stepUp.source) {
            case "tool":
              setToolCallState({
                status: "error",
                error: failureMessage,
              });
              break;
            case "prompt":
              setGetPromptState((prev) =>
                prev
                  ? { ...prev, status: "error", error: failureMessage }
                  : prev,
              );
              break;
            case "resource":
              setReadResourceState((prev) =>
                prev
                  ? { ...prev, status: "error", error: failureMessage }
                  : prev,
              );
              break;
            default:
              break;
          }
        }
      } finally {
        stepUpAuthorizeInProgressRef.current = false;
      }
      return;
    }

    stepUpAuthorizeInProgressRef.current = true;
    prepareOAuthRedirect({
      serverId: stepUp.serverId,
      authKind: "step_up",
      authorizationUrl: stepUp.authorizationUrl,
      authChallenge: stepUp.challenge,
      recoverySource: stepUp.source,
    });
    setPendingStepUp(null);
    pendingStepUpRetryRef.current = null;
    stepUpAuthorizeInProgressRef.current = false;
  };

  const handleStepUpCancel = () => {
    const stepUp = pendingStepUpRef.current;
    setPendingStepUp(null);
    pendingStepUpRetryRef.current = null;
    if (!stepUp) {
      return;
    }
    const cancelled = "Authorization cancelled.";
    switch (stepUp.source) {
      case "tool":
        setToolCallState({ status: "error", error: cancelled });
        break;
      case "prompt":
        setGetPromptState((prev) =>
          prev ? { ...prev, status: "error", error: cancelled } : prev,
        );
        break;
      case "resource":
        setReadResourceState((prev) =>
          prev ? { ...prev, status: "error", error: cancelled } : prev,
        );
        break;
      case "app":
        notifications.show({
          title: "Authorization cancelled",
          message: cancelled,
          color: "gray",
          autoClose: 4000,
        });
        break;
      case "ambient":
        break;
    }
  };

  return (
    <>
      <Box>
        {reAuthBanner ? (
          <Box
            className="reauth-banner-bar"
            px="md"
            pt="xs"
            pos="sticky"
            top={60}
            bg="var(--mantine-color-body)"
          >
            <ReAuthBanner
              message={reAuthBanner.message}
              onReauthenticate={onReauthenticateFromBanner}
              onDismiss={() => setReAuthBanner(null)}
            />
          </Box>
        ) : null}
        <InspectorView
          deepLink={deepLink}
          deepLinkStatus={deepLinkStatus}
          servers={servers}
          serverListWritable={serverListWritable}
          activeServer={activeServerId}
          erroredServerId={failedServerId}
          connectedServerId={connectedServerId}
          version={inspectorVersion}
          connectionStatus={connectionStatus}
          connectErrorMessage={connectErrorMessage}
          initializeResult={initializeResult}
          latencyMs={latencyMs}
          tools={tools}
          prompts={prompts}
          resources={resources}
          resourceTemplates={resourceTemplates}
          toolsListChanged={toolsListChanged}
          promptsListChanged={promptsListChanged}
          resourcesListChanged={resourcesListChanged}
          subscriptions={subscriptions}
          logs={logs}
          tasks={tasks}
          progressByTaskId={progressByTaskId}
          protocol={protocolEntries}
          protocolEra={protocolEra}
          network={fetchRequests}
          stderrLogs={stderrLogs}
          toolCallState={toolCallState}
          getPromptState={getPromptState}
          readResourceState={effectiveReadResourceState}
          toolsUi={toolsUi}
          promptsUi={promptsUi}
          resourcesUi={resourcesUi}
          appsUi={appsUi}
          tasksUi={tasksUi}
          logsUi={logsUi}
          protocolUi={protocolUi}
          networkUi={networkUi}
          consoleUi={consoleUi}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          currentLogLevel={currentLogLevel}
          sandboxPath={sandboxUrl}
          bridgeFactory={sandboxBridgeFactory}
          appRendererRef={appRendererRef}
          onToggleTheme={onToggleTheme}
          onOpenClientSettings={() => setClientSettingsOpen(true)}
          onToggleConnection={(id) => {
            void onToggleConnection(id);
          }}
          onDisconnect={() => {
            void onDisconnect();
          }}
          onServerAdd={() => {
            setHighlightedServerIds([]);
            setConfigModal({ mode: "add" });
          }}
          onServerImportConfig={() => {
            setHighlightedServerIds([]);
            setImportConfigOpen(true);
          }}
          onServerImportJson={() => {
            setHighlightedServerIds([]);
            setImportJsonOpen(true);
          }}
          onServerExport={onServerExport}
          onConnectionInfo={() => setConnectionInfoModalOpen(true)}
          onServerSettings={(id) => setSettingsModalTargetId(id)}
          onServerEdit={(id) => setConfigModal({ mode: "edit", targetId: id })}
          onServerClone={(id) => {
            setHighlightedServerIds([]);
            setConfigModal({ mode: "clone", targetId: id });
          }}
          onServerRemove={(id) => {
            const target = servers.find((s) => s.id === id);
            if (target) setRemoveTarget(target);
          }}
          onServerReorder={(orderedIds) => {
            // reorderServers reverts the optimistic order via an internal
            // refresh() and re-throws on failure (409 from a racing external
            // edit, or a network error). Surface that to the user so the drag
            // doesn't silently bounce back — matching the toast pattern every
            // other mutation here uses.
            reorderServers(orderedIds).catch((err: unknown) => {
              notifications.show({
                title: "Failed to reorder servers",
                message: err instanceof Error ? err.message : String(err),
                color: "red",
              });
            });
          }}
          highlightedServerIds={highlightedServerIds}
          onClearHighlight={clearHighlight}
          serverSupportsTaskToolCalls={
            !!capabilities?.tasks?.requests?.tools?.call
          }
          onToolsUiChange={onToolsUiChange}
          onCallTool={(name, args, runAsTask) => {
            void onCallTool(name, args, runAsTask);
          }}
          onCancelToolCall={onCancelToolCall}
          onClearToolResult={onClearToolResult}
          onReadResourceContents={onReadResourceContents}
          onRefreshTools={onRefreshTools}
          toolsPagination={toolsPaginationControls}
          promptsPagination={promptsPaginationControls}
          resourcesPagination={resourcesPaginationControls}
          onPromptsUiChange={setPromptsUi}
          onGetPrompt={(name, args) => {
            void onGetPrompt(name, args);
          }}
          onRefreshPrompts={onRefreshPrompts}
          onResourcesUiChange={setResourcesUi}
          onReadResource={(uri) => {
            void onReadResource(uri);
          }}
          onSubscribeResource={onSubscribeResource}
          onUnsubscribeResource={onUnsubscribeResource}
          onRefreshResources={onRefreshResources}
          onCompleteArgument={onCompleteArgument}
          completionsSupported={capabilities?.completions !== undefined}
          subscriptionsSupported={capabilities?.resources?.subscribe === true}
          onTasksUiChange={setTasksUi}
          onCancelTask={(taskId) => {
            void onCancelTask(taskId);
          }}
          onClearCompletedTasks={onClearCompletedTasks}
          onRefreshTasks={onRefreshTasks}
          onSetLogLevel={onSetLogLevel}
          onLogsUiChange={setLogsUi}
          onClearLogs={onClearLogs}
          onExportLogs={onExportLogs}
          onProtocolUiChange={setProtocolUi}
          onClearProtocol={onClearProtocol}
          onExportProtocol={onExportProtocol}
          onClearProtocolSection={onClearProtocolSection}
          onExportProtocolSection={onExportProtocolSection}
          onReplayProtocol={onReplayProtocol}
          onTogglePinProtocol={onTogglePinProtocol}
          pinnedProtocolIds={pinnedProtocolIds}
          onNetworkUiChange={setNetworkUi}
          onClearNetwork={onClearNetwork}
          onExportNetwork={onExportNetwork}
          onConsoleUiChange={setConsoleUi}
          onClearConsole={onClearConsole}
          onExportConsole={onExportConsole}
          onAppsUiChange={setAppsUi}
          onSelectApp={onSelectApp}
          onOpenApp={(name, args) => {
            void onOpenApp(name, args);
          }}
          onCloseApp={onCloseApp}
          onAppError={onAppError}
          onRefreshApps={onRefreshTools}
        />
      </Box>
      <ServerConfigModal
        opened={configModal !== null}
        mode={configModal?.mode ?? "add"}
        initialId={configModalTarget?.id}
        initialConfig={configModalTarget?.config}
        existingIds={existingIds}
        onClose={() => setConfigModal(null)}
        onSubmit={onConfigSubmit}
      />
      <ServerImportConfigModal
        opened={importConfigOpen}
        existingIds={existingIds}
        onClose={() => setImportConfigOpen(false)}
        onFetchSource={importSource}
        onAddServer={addServerHighlighted}
        onUpdateServer={updateServer}
      />
      <ServerImportJsonModal
        opened={importJsonOpen}
        existingIds={existingIds}
        onClose={() => setImportJsonOpen(false)}
        onAddServer={addServerHighlighted}
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
        onClose={onSettingsModalClose}
        onSettingsChange={onSettingsChange}
        onClearStoredOAuth={
          settingsModalIsStdio ? undefined : handleClearStoredOAuthFromSettings
        }
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
      />
      {initializeResult && activeServer && (
        <ConnectionInfoModal
          opened={connectionInfoModalOpen}
          onClose={() => setConnectionInfoModalOpen(false)}
          initializeResult={initializeResult}
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
