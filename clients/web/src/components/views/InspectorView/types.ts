// Domain prop bundles for `InspectorView` (#2130).
//
// The view used to take ~130 flat props, which made App.tsx's JSX a prop wall
// rather than a component tree. Each bundle below groups one domain's data,
// UI state, and actions into a single object, so the call site reads as the
// tree it is and a hook can hand over exactly one bundle.
//
// Two conventions keep the change reviewable and keep it from rippling
// downward:
//
//   - **Field names are unchanged.** Every field carries the exact name it had
//     as a flat prop, so the bundles are a regrouping, not a rename.
//   - **The bundles stop here.** `InspectorView` destructures them back into
//     the same locals and passes them down to the screens as before, so
//     nothing below the view knows they exist.
import type { Ref } from "react";
import type {
  InitializeResult,
  LoggingLevel,
  Prompt,
  ProtocolEra,
  ReadResourceResult,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  Task,
  Tool,
} from "@modelcontextprotocol/client";
import type { MalformedListItem } from "@inspector/core/mcp";
import type {
  ConnectionStatus,
  ExcludedTool,
  FetchRequestEntry,
  InspectorResourceSubscription,
  MessageEntry,
  ResourceSubscriptionStreamState,
  ServerEntry,
  StderrLogEntry,
} from "@inspector/core/mcp/types.js";
import type { ReplayParamsOverride } from "../../../lib/protocolReplay";
import type { DeepLink, DeepLinkParseStatus } from "../../../utils/deepLink";
import type { ListPaginationControlsProps } from "../../elements/ListPaginationControls/ListPaginationControls";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";
import type {
  ToolCallState,
  ToolsUiState,
} from "../../screens/ToolsScreen/ToolsScreen";
import type { AppsUiState } from "../../screens/AppsScreen/AppsScreen";
import type {
  GetPromptState,
  PromptsUiState,
} from "../../screens/PromptsScreen/PromptsScreen";
import type {
  ReadResourceState,
  ResourcesUiState,
} from "../../screens/ResourcesScreen/ResourcesScreen";
import type { LogsUiState } from "../../screens/LoggingScreen/LoggingScreen";
import type { SkillsUiState } from "../../screens/SkillsScreen/SkillsScreen";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas.js";
import type { SkillFileContents } from "../../../utils/skillFileBytes";
import type { TasksUiState } from "../../screens/TasksScreen/TasksScreen";
import type { ProtocolUiState } from "../../screens/ProtocolScreen/ProtocolScreen";
import type { NetworkUiState } from "../../screens/NetworkScreen/NetworkScreen";
import type { ConsoleUiState } from "../../screens/ConsoleScreen/ConsoleScreen";

/**
 * App chrome and the few things that belong to no single screen: the active
 * tab, the theme/client-settings entry points, the footer version, the
 * deep-link parameters, and the malformed-list-item log that three separate
 * screens each filter for their own entries.
 */
export interface ShellProps {
  /**
   * Validated deep-link parameters from the page URL. When present and
   * `openApp` is set, the parent switches to the Apps tab and pre-selects that
   * app (with `appArgs` as the form values) once the connection is up and the
   * app list contains it. The connect itself is driven by the parent.
   */
  deepLink?: DeepLink;
  /**
   * Outcome of parsing the initial-URL deep link, surfaced as `data-deeplink`
   * on the `connection-status` testid. Distinguishes "no deep link" from
   * "rejected" (token mismatch / bad serverUrl) — both leave `data-status`
   * idle, so an automated driver otherwise cannot tell them apart.
   */
  deepLinkStatus?: DeepLinkParseStatus;
  /**
   * The Inspector build version (root `package.json`), shown at the left of the
   * footer row (#1682). Absent on a legacy backend that omits it — the version
   * label then renders nothing.
   */
  version?: string;
  /**
   * Entries dropped from a list result as malformed, across every list method.
   * Each list panel filters for its own and warns about them (#1909). It spans
   * three screens, so it has no single domain owner.
   */
  malformedListItems?: MalformedListItem[];
  /** Active inspector tab (lifted to App for OAuth resume). */
  activeTab: string;
  onActiveTabChange: (tab: string) => void;
  /**
   * Theme toggle (lives in the parent so the color scheme can also flow into
   * other top-level UI later).
   */
  onToggleTheme: () => void;
  /** Open install-level client settings (client.json / EMA IdP). */
  onOpenClientSettings: () => void;
}

/**
 * Live connection state and the capability facts more than one screen reads.
 * Driven by the parent via `useInspectorClient`.
 */
export interface ConnectionProps {
  activeServer?: string;
  /**
   * Id of the server whose last connection attempt failed (#1621). Its card in
   * the Servers screen draws a red border until another server is connected or
   * a new connection is attempted. Independent of `activeServer`, which the
   * parent clears on the failure's `disconnect` event.
   *
   * It is also the sole signal that opens the monitoring sidebar onto the
   * failure's diagnostics (#2108). That used to be gated on the `"error"`
   * connection status, which an OAuth failure never reaches — the parent drives
   * that leg and tears the client down itself, settling the session at
   * `"disconnected"`. So the parent must set this for *every* connect-attempt
   * failure, auth legs included, and clear it as each new attempt starts.
   */
  erroredServerId?: string;
  /**
   * Id of the server that just connected successfully (#1682). Its card draws
   * the green highlight border and scrolls into view once the monitoring
   * sidebar has opened — the success mirror of `erroredServerId`.
   */
  connectedServerId?: string;
  connectionStatus: ConnectionStatus;
  /**
   * Last connection-level error message (handshake failure, OAuth start
   * failure, deep-link automation failure). Surfaced as `data-error-message`
   * on the header's `connection-status` testid so an automated driver can read
   * *why* a connect failed without scraping a transient toast.
   */
  connectErrorMessage?: string;
  initializeResult?: InitializeResult;
  latencyMs?: number;
  /** Negotiated protocol era (SEP §7.8), for the Protocol view's era badge. */
  protocolEra?: ProtocolEra;
  /**
   * Argument completion, shared by the Prompts and Resources screens — hence
   * here rather than in either one.
   */
  onCompleteArgument?: (
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argumentName: string,
    argumentValue: string,
    context: Record<string, string>,
  ) => Promise<string[]>;
  completionsSupported?: boolean;
  // Connection lifecycle (dispatched to `useInspectorClient.connect/disconnect`).
  onToggleConnection: (id: string) => void;
  onDisconnect: () => void;
}

/**
 * The server catalog and every action on it. Static config only — the runtime
 * connection state comes from {@link ConnectionProps} and is merged into each
 * card by the view.
 */
export interface ServerListProps {
  servers: ServerEntry[];
  /**
   * Whether the server list is writable (catalog) or read-only (a `--config`
   * session file / ad-hoc launch). When false, the Servers screen hides all
   * catalog mutation controls. Defaults to true.
   */
  serverListWritable?: boolean;
  /** Ids of freshly-added servers to highlight on the list (first is scrolled to). */
  highlightedServerIds?: string[];
  /** Clears the freshly-added highlight for a server (on click of its card). */
  onClearHighlight?: (id: string) => void;
  onServerAdd: () => void;
  onServerImportConfig: () => void;
  onServerImportJson: () => void;
  /** Download the current server list as a canonical `mcp.json` file. */
  onServerExport: () => void;
  onConnectionInfo: (id: string) => void;
  onServerSettings: (id: string) => void;
  onServerEdit: (id: string) => void;
  onServerClone: (id: string) => void;
  onServerRemove: (id: string) => void;
  /** Persist a new server ordering (drag-and-drop / keyboard reorder). */
  onServerReorder: (orderedIds: string[]) => void;
}

/** The Tools screen: its list, lifted UI state, and actions. */
export interface ToolsPanelProps {
  tools: Tool[];
  /**
   * Tools excluded from `tools/list` for invalid `x-mcp-header` annotations
   * (SEP-2243); shown in the Tools sidebar with the reason (#1632).
   */
  excludedTools?: ExcludedTool[];
  /** "List changed since last refresh", from the managed-state layer (#1402). */
  toolsListChanged: boolean;
  /**
   * Last list-load failure, rendered above the sidebar list so a failed load
   * (including the connect-time one) can't read as "this server has none"
   * (#1953).
   */
  toolsLoadError?: Error | null;
  /**
   * Lifted selection / search / filter state. Owned by the parent so it
   * persists across tab navigation within a live session — the screens unmount
   * on tab switch, so screen-local state would be lost (#1417).
   */
  toolsUi: ToolsUiState;
  /** Panel-level "operation in flight" state. */
  toolCallState?: ToolCallState;
  /** Pagination controls for the Tools list (#1721). */
  toolsPagination: ListPaginationControlsProps;
  /** Whether the connected server advertises task-augmented tool calls. */
  serverSupportsTaskToolCalls: boolean;
  onToolsUiChange: (next: ToolsUiState) => void;
  onCallTool: (
    name: string,
    args: Record<string, unknown>,
    runAsTask?: boolean,
  ) => void;
  onCancelToolCall?: () => void;
  onClearToolResult?: () => void;
  onRefreshTools: () => void;
  /**
   * Read-on-demand handler for `resource_link` blocks in a tool result.
   * Returns the linked resource's contents so the result panel can inline them.
   */
  onReadResourceContents?: (uri: string) => Promise<ReadResourceResult>;
}

/** The Prompts screen: its list, lifted UI state, and actions. */
export interface PromptsPanelProps {
  prompts: Prompt[];
  promptsListChanged: boolean;
  promptsLoadError?: Error | null;
  promptsUi: PromptsUiState;
  getPromptState?: GetPromptState;
  /** Pagination controls for the Prompts list (#1721). */
  promptsPagination: ListPaginationControlsProps;
  onPromptsUiChange: (next: PromptsUiState) => void;
  onGetPrompt: (name: string, args: Record<string, string>) => void;
  onCopyPromptMessages?: () => void;
  onRefreshPrompts: () => void;
}

/** The Resources screen: resources, templates, subscriptions, and actions. */
export interface ResourcesPanelProps {
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];
  /**
   * Modern-era `subscriptions/listen` stream state (#1630). Drives the
   * Resources screen's stream badge/dot; `active: false` (or omitted) on the
   * legacy era.
   */
  subscriptionStreamState?: ResourceSubscriptionStreamState;
  /**
   * Whether the connected server advertises the `resources.subscribe`
   * capability. When false, the Resources screen hides the Subscribe/
   * Unsubscribe button and the Subscriptions accordion section.
   */
  subscriptionsSupported?: boolean;
  resourcesListChanged: boolean;
  /**
   * The Resources sidebar lists resources AND templates behind a single
   * Refresh, so App passes whichever of the two loads failed.
   */
  resourcesLoadError?: Error | null;
  resourcesUi: ResourcesUiState;
  readResourceState?: ReadResourceState;
  /** Pagination controls for the Resources list (#1721). */
  resourcesPagination: ListPaginationControlsProps;
  onResourcesUiChange: (next: ResourcesUiState) => void;
  onReadResource: (uri: string) => void;
  onSubscribeResource: (uri: string) => void;
  onUnsubscribeResource: (uri: string) => void;
  onRefreshResources: () => void;
}

/**
 * The Apps screen and its sandbox wiring. The parent's web environment
 * provides the sandbox iframe URL (undefined when the sandbox controller is
 * unavailable), the per-app bridge factory, and the renderer handle the parent
 * uses to push tool input/result into the running app and tear it down.
 */
export interface AppsPanelProps {
  appsUi: AppsUiState;
  sandboxPath?: string;
  bridgeFactory: BridgeFactory;
  appRendererRef: Ref<AppRendererHandle>;
  onAppsUiChange: (next: AppsUiState) => void;
  onSelectApp: (name: string) => void;
  onOpenApp: (name: string, args: Record<string, unknown>) => void;
  onCloseApp: () => void;
  onAppError: (err: Error) => void;
  onRefreshApps: () => void;
}

/** The Skills screen (SEP-2640): the enumerated skills and their verification. */
export interface SkillsPanelProps {
  skills: SkillEntry[];
  /** Pages the last `skills/list` walk took. */
  skillsPageCount: number;
  skillsLoadError?: Error | null;
  skillsUi: SkillsUiState;
  onSkillsUiChange: (next: SkillsUiState) => void;
  onRefreshSkills: () => void;
  /** Read one skill file (`resources/read`) so its digest can be checked. */
  onReadSkillFile: (uri: string) => Promise<SkillFileContents>;
  /** Re-fetch the selected entry through `skills/get`. */
  onGetSkill: (uri: string) => Promise<SkillEntry>;
}

/** The Tasks monitor: the task list, its progress map, and actions. */
export interface TasksPanelProps {
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
  tasksUi: TasksUiState;
  onTasksUiChange: (next: TasksUiState) => void;
  onCancelTask: (taskId: string) => void;
  onClearCompletedTasks: () => void;
  onRefreshTasks: () => void;
}

/** The Logs monitor, including both eras' log-level controls. */
export interface LogsPanelProps {
  logs: LogEntryData[];
  logsUi: LogsUiState;
  /**
   * The MCP `logging/setLevel` request has no echo notification, so the parent
   * keeps the optimistic current value.
   */
  currentLogLevel: LoggingLevel;
  /**
   * Modern-era per-request log level currently stamped, or `null` when opted
   * out (#1629). On modern connections the Logs sidebar shows a per-request
   * opt-in control instead of the legacy `logging/setLevel` selector.
   */
  modernLogLevel?: LoggingLevel | null;
  onSetLogLevel: (level: LoggingLevel) => void;
  /** Set (or clear, with `null`) the modern per-request log level. */
  onSetModernLogLevel?: (level: LoggingLevel | null) => void;
  onLogsUiChange: (next: LogsUiState) => void;
  onClearLogs: () => void;
  onExportLogs: () => void;
}

/** The Protocol monitor: the message log, pinning, replay, and exports. */
export interface ProtocolPanelProps {
  protocol: MessageEntry[];
  protocolUi: ProtocolUiState;
  /**
   * Pinned message ids. Optional because pin state isn't persisted yet (#1244
   * is single-PR; persistence is a separate concern).
   */
  pinnedProtocolIds?: Set<string>;
  onProtocolUiChange: (next: ProtocolUiState) => void;
  onClearProtocol: () => void;
  onExportProtocol: () => void;
  onClearProtocolSection: (section: "pinned" | "history") => void;
  onExportProtocolSection: (section: "pinned" | "history") => void;
  onReplayProtocol: (id: string, overrideParams?: ReplayParamsOverride) => void;
  onTogglePinProtocol: (id: string) => void;
}

/** The Network monitor: captured HTTP traffic and its actions. */
export interface NetworkPanelProps {
  network: FetchRequestEntry[];
  networkUi: NetworkUiState;
  onNetworkUiChange: (next: NetworkUiState) => void;
  onClearNetwork: () => void;
  onExportNetwork: () => void;
}

/** The Console monitor: captured stdio stderr. Empty for HTTP servers (#1621). */
export interface ConsolePanelProps {
  stderrLogs: StderrLogEntry[];
  consoleUi: ConsoleUiState;
  onConsoleUiChange: (next: ConsoleUiState) => void;
  onClearConsole: () => void;
  onExportConsole: () => void;
}
