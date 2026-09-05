import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppShell,
  Flex,
  Group,
  Stack,
  Transition,
  type MantineTransition,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import type { Implementation, Tool } from "@modelcontextprotocol/client";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { isTerminalStatus } from "@inspector/core/mcp/types.js";
import { isAppTool } from "@inspector/core/mcp/apps.js";
import { TASKS_EXTENSION_KEY } from "@inspector/core/mcp/modernTaskSchemas.js";
import { isSkillsExtensionSupported } from "@inspector/core/mcp/skills.js";
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";
import { VersionBadge } from "../../elements/VersionBadge/VersionBadge";
import { CopyrightBadge } from "../../elements/CopyrightBadge/CopyrightBadge";
import { ServerListScreen } from "../../screens/ServerListScreen/ServerListScreen";
import { ToolsScreen } from "../../screens/ToolsScreen/ToolsScreen";
import { AppsScreen } from "../../screens/AppsScreen/AppsScreen";
import { PromptsScreen } from "../../screens/PromptsScreen/PromptsScreen";
import { ResourcesScreen } from "../../screens/ResourcesScreen/ResourcesScreen";
import { LoggingScreen } from "../../screens/LoggingScreen/LoggingScreen";
import { SkillsScreen } from "../../screens/SkillsScreen/SkillsScreen";
import { TasksScreen } from "../../screens/TasksScreen/TasksScreen";
import { ProtocolScreen } from "../../screens/ProtocolScreen/ProtocolScreen";
import { NetworkScreen } from "../../screens/NetworkScreen/NetworkScreen";
import { ConsoleScreen } from "../../screens/ConsoleScreen/ConsoleScreen";
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
} from "./types";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";
import { ScreenStage } from "../../elements/ScreenStage/ScreenStage";
import { MonitoringScreen } from "../../groups/MonitoringScreen/MonitoringScreen";
import { ResizeHandle } from "../../elements/ResizeHandle/ResizeHandle";
import { getServerType } from "@inspector/core/mcp/config.js";
import { INSPECTOR_SERVERS_TAB } from "../../../utils/inspectorTabs";
import {
  correlateFetchEntry,
  correlatedFetchStatusById,
  revealableMessageIds,
} from "../../../utils/correlateTransportErrors";
import {
  applySchemaConstants,
  seedSchemaValues,
  toFormSchema,
} from "../../../utils/jsonUtils";
import { MONITOR_COLUMN_ANIM_MS } from "./monitorColumnAnimation";

const SORT_DEFAULT: SortDirection = "newest-first";

// Storage adapters live alongside the view. The deserializer accepts anything
// (manual edit, schema drift, future option removed) and clamps to the default
// so the toggle never renders an unselectable state.
function deserializeSortDirection(raw: string | undefined): SortDirection {
  return raw === "oldest-first" || raw === "newest-first" ? raw : SORT_DEFAULT;
}

// Overrides Mantine's default `JSON.stringify` so the stored value is the
// raw enum literal (`"oldest-first"`), not a JSON-quoted string. Keeps the
// localStorage value human-readable and lets tests assert on it directly.
function serializeSortDirection(value: SortDirection): string {
  return value;
}

const LIST_COMPACT_DEFAULT = true;

// Same shape as the sort adapters: store the boolean as `"true"` / `"false"`
// so the localStorage value stays human-readable, and clamp any other value
// back to the default rather than coercing it to `false`.
function deserializeListCompact(raw: string | undefined): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return LIST_COMPACT_DEFAULT;
}

function serializeListCompact(value: boolean): string {
  return value ? "true" : "false";
}

// One useLocalStorage call per scope, all with the same persistence shape.
// `getInitialValueInEffect: false` reads synchronously on first render —
// SPA only, no SSR — so the persisted value lands without a one-frame
// flicker through the default. The `inspector.<kind>.<scope>` namespace
// keeps related preferences grouped and easy to clear in bulk.
function useSortDirection(scope: "logs" | "protocol" | "network" | "console") {
  return useLocalStorage<SortDirection>({
    key: `inspector.sortDirection.${scope}`,
    defaultValue: SORT_DEFAULT,
    deserialize: deserializeSortDirection,
    serialize: serializeSortDirection,
    getInitialValueInEffect: false,
  });
}

function useListCompact(
  scope: "protocol" | "network" | "servers" | "resources",
  defaultValue: boolean,
) {
  return useLocalStorage<boolean>({
    key: `inspector.listCompact.${scope}`,
    defaultValue,
    deserialize: deserializeListCompact,
    serialize: serializeListCompact,
    getInitialValueInEffect: false,
  });
}

const SERVERS_TAB = INSPECTOR_SERVERS_TAB;
const SKILLS_TAB = "Skills";
const TASKS_TAB = "Tasks";
const LOGS_TAB = "Logs";
const PROTOCOL_TAB = "Protocol";
const NETWORK_TAB = "Network";
const CONSOLE_TAB = "Console";

// Resolve the server name the connected header renders. A server may report
// `serverInfo` with a blank `name` (#1774) — empty or whitespace-only — and the
// header must never show a nameless title, so fall back to the active server's
// catalog name when the reported name is blank (`.trim()` catches "   ", the
// same non-conforming class an empty string is). This is a display-only
// fallback: the Connection Info modal stays faithful to the raw report because
// it reads App's untouched `initializeResult` + `serverInfoReported`, not this
// resolved value. (App already folds the catalog name into
// `initializeResult.serverInfo` for the modern-omitted case where serverInfo is
// absent entirely (#1772); this covers the reported-but-blank-name case that
// `??` fallback doesn't reach.)
function resolveHeaderServerInfo(
  serverInfo: Implementation,
  servers: ServerEntry[],
  activeServerId: string | undefined,
): Implementation {
  if (serverInfo.name?.trim()) return serverInfo;
  const catalogName = servers.find((s) => s.id === activeServerId)?.name;
  return catalogName ? { ...serverInfo, name: catalogName } : serverInfo;
}

const ALL_TABS: string[] = [
  SERVERS_TAB,
  "Apps",
  "Tools",
  "Prompts",
  "Resources",
  SKILLS_TAB,
  TASKS_TAB,
  LOGS_TAB,
  PROTOCOL_TAB,
  NETWORK_TAB,
  CONSOLE_TAB,
];

// The screens that can be pinned into the monitoring sidebar (#1616). Pinning is
// a group action: opening the column removes all *available* monitor tabs from
// the header and hosts them in the column instead. Console (#1621) is the
// stdio server's stderr stream — mutually exclusive with Network (Console shows
// for stdio, Network for HTTP), but both live in the monitor group. Tasks
// (#1680) joins the group so a live task list can be watched beside any screen.
type MonitorTab = "Tasks" | "Logs" | "Protocol" | "Network" | "Console";
const MONITOR_TABS: string[] = [
  TASKS_TAB,
  LOGS_TAB,
  PROTOCOL_TAB,
  NETWORK_TAB,
  CONSOLE_TAB,
];

function isMonitorTab(tab: string): tab is MonitorTab {
  return (
    tab === TASKS_TAB ||
    tab === LOGS_TAB ||
    tab === PROTOCOL_TAB ||
    tab === NETWORK_TAB ||
    tab === CONSOLE_TAB
  );
}

// Monitoring sidebar width bounds (px). MIN keeps the stream readable; MAX stops
// the column from crowding out the primary area.
const MONITOR_WIDTH_MIN = 320;
const MONITOR_WIDTH_MAX = 720;
const MONITOR_WIDTH_DEFAULT = 420;
const MONITOR_WIDTH_STEP = 16;

function clampMonitorWidth(value: number): number {
  return Math.min(MONITOR_WIDTH_MAX, Math.max(MONITOR_WIDTH_MIN, value));
}

// localStorage adapters for the monitoring-column preferences, matching the
// human-readable / clamp-on-read shape of the sort + compact adapters above.
const MONITOR_PINNED_DEFAULT = false;

function deserializeMonitorPinned(raw: string | undefined): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return MONITOR_PINNED_DEFAULT;
}

function serializeMonitorPinned(value: boolean): string {
  return value ? "true" : "false";
}

const MONITOR_TAB_DEFAULT: MonitorTab = LOGS_TAB;

function deserializeMonitorTab(raw: string | undefined): MonitorTab {
  return raw !== undefined && isMonitorTab(raw) ? raw : MONITOR_TAB_DEFAULT;
}

function serializeMonitorTab(value: MonitorTab): string {
  return value;
}

function deserializeMonitorWidth(raw: string | undefined): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampMonitorWidth(parsed)
    : MONITOR_WIDTH_DEFAULT;
}

function serializeMonitorWidth(value: number): string {
  return String(value);
}

// Relative-positioned wrapper for the absolutely-positioned `ScreenStage`
// children. `mih: "100%"` requires `AppShell.Main` to provide a definite
// height for the stack itself to fill — the absolute children render
// regardless, but nested ScrollArea screens need a non-collapsing parent
// for their scroll containment to work.
const ScreenStageContainer = Stack.withProps({
  pos: "relative",
  gap: 0,
  flex: 1,
  mih: "100%",
  // Let the pane shrink below its content's intrinsic width when the monitoring
  // column opens — without this the Servers grid / SegmentedControl refuse to
  // shrink and squeeze the column (or force a page scrollbar). (#1616)
  miw: 0,
});

// Row wrapper turning AppShell.Main into a [primary | handle | column] split.
// `h/w: 100%` inherit the header-offset height AppShell.Main provides, matching
// the screens' own `calc(100dvh - header)`. (#1616)
const SplitRow = Flex.withProps({
  direction: "row",
  gap: 0,
  h: "100%",
  w: "100%",
});

// Footer row (#1682): a full-width AppShell.Footer band, styled like the header
// (Mantine gives AppShell.Footer the same `--mantine-color-body` background and
// a matching top border by default). Because it's a real AppShell region it
// reserves its own height (`--app-shell-footer-height`), so the primary screen
// and the monitoring sidebar both stop above it instead of the old fixed badges
// overlapping the sidebar. `32` keeps it the same height as the previous badge
// band (`spacing.xl`). The version sits at the left, the copyright at the right.
const FOOTER_HEIGHT = 32;
const FooterRow = Group.withProps({
  h: "100%",
  px: "xl",
  justify: "space-between",
  align: "center",
  wrap: "nowrap",
});

// The pinned monitoring sidebar. Fixed-basis (its width is driven live via the
// `w` style prop at the call site); `miw: 0` so its inner ScrollArea can bound.
const MonitoringColumn = Stack.withProps({
  flex: "0 0 auto",
  h: "100%",
  gap: 0,
  miw: 0,
});

// Column open/close animation (#1616): the handle + column slide in from the
// right edge and fade as they mount, reversing on close, so pinning reads as a
// side column sliding open rather than snapping in. The primary screen keeps its
// standard `ScreenStage` transition. Mantine plays `out → in` on enter and
// `in → out` on exit. `AppShell.Main`'s `overflow: hidden` clips the off-screen
// portion during the slide. The duration is shared (`ServerCard` waits on it
// before scrolling a failed card into view) so the two can't drift.
const COLUMN_ANIM_MS = MONITOR_COLUMN_ANIM_MS;
const columnSlide: MantineTransition = {
  in: { opacity: 1, transform: "translateX(0)" },
  out: { opacity: 0, transform: "translateX(100%)" },
  common: { transformOrigin: "right center" },
  transitionProperty: "transform, opacity",
};

// Flex-row wrapper holding the resize handle + column so the whole unit animates
// as one (the Transition interpolation is applied to it via `style`). `align:
// stretch` overrides Group's default `center` so the full-height resize handle
// (which has no intrinsic height) fills the column instead of collapsing.
const MonitorColumnGroup = Group.withProps({
  wrap: "nowrap",
  align: "stretch",
  gap: 0,
  h: "100%",
  flex: "0 0 auto",
});

/**
 * `InspectorView` takes one prop per domain rather than a wall of ~130 flat
 * ones (#2130). Each bundle's shape lives in `./types`; the fields inside keep
 * the names they had as flat props, so this is a regrouping rather than a
 * rename.
 *
 * The bundles stop here: the function below destructures each one back into
 * the same locals it already used, and the screens beneath receive the same
 * individual props they always did.
 */
export interface InspectorViewProps {
  /** App chrome: active tab, theme/settings entry points, footer, deep link. */
  shell: ShellProps;
  /** Live connection state plus the capability facts several screens read. */
  connection: ConnectionProps;
  /** The server catalog and every action on it. */
  servers: ServerListProps;
  tools: ToolsPanelProps;
  prompts: PromptsPanelProps;
  resources: ResourcesPanelProps;
  apps: AppsPanelProps;
  skills: SkillsPanelProps;
  tasks: TasksPanelProps;
  logs: LogsPanelProps;
  protocol: ProtocolPanelProps;
  network: NetworkPanelProps;
  console: ConsolePanelProps;
}

export function InspectorView({
  shell,
  connection,
  servers: serverList,
  tools: toolsPanel,
  prompts: promptsPanel,
  resources: resourcesPanel,
  apps: appsPanel,
  skills: skillsPanel,
  tasks: tasksPanel,
  logs: logsPanel,
  protocol: protocolPanel,
  network: networkPanel,
  console: consolePanel,
}: InspectorViewProps) {
  // Unpack the bundles back into the locals the body already uses, so the
  // grouping is confined to the prop boundary.
  const {
    deepLink,
    deepLinkStatus,
    version,
    malformedListItems = [],
    activeTab: activeTabProp,
    onActiveTabChange,
    onToggleTheme,
    onOpenClientSettings,
  } = shell;
  const {
    activeServer,
    erroredServerId,
    connectedServerId,
    connectionStatus,
    connectErrorMessage,
    initializeResult,
    latencyMs,
    protocolEra,
    onCompleteArgument,
    completionsSupported,
    onToggleConnection,
    onDisconnect,
  } = connection;
  const {
    servers: serversInput,
    serverListWritable = true,
    highlightedServerIds,
    onClearHighlight,
    onServerAdd,
    onServerImportConfig,
    onServerImportJson,
    onServerExport,
    onConnectionInfo,
    onServerSettings,
    onServerEdit,
    onServerClone,
    onServerRemove,
    onServerReorder,
  } = serverList;
  const {
    tools,
    excludedTools = [],
    toolsListChanged,
    toolsLoadError,
    toolsUi,
    toolCallState,
    toolsPagination,
    serverSupportsTaskToolCalls,
    onToolsUiChange,
    onCallTool,
    onCancelToolCall,
    onClearToolResult,
    onRefreshTools,
    onReadResourceContents,
  } = toolsPanel;
  const {
    prompts,
    promptsListChanged,
    promptsLoadError,
    promptsUi,
    getPromptState,
    promptsPagination,
    onPromptsUiChange,
    onGetPrompt,
    onCopyPromptMessages,
    onRefreshPrompts,
  } = promptsPanel;
  const {
    resources,
    resourceTemplates,
    subscriptions,
    subscriptionStreamState,
    subscriptionsSupported,
    resourcesListChanged,
    resourcesLoadError,
    resourcesUi,
    readResourceState,
    resourcesPagination,
    onResourcesUiChange,
    onReadResource,
    onSubscribeResource,
    onUnsubscribeResource,
    onRefreshResources,
  } = resourcesPanel;
  const {
    appsUi,
    sandboxPath,
    bridgeFactory,
    appRendererRef,
    onAppsUiChange,
    onSelectApp,
    onOpenApp,
    onCloseApp,
    onAppError,
    onRefreshApps,
  } = appsPanel;
  const {
    skills,
    skillsPageCount,
    skillsLoadError,
    skillsUi,
    onSkillsUiChange,
    onRefreshSkills,
    onReadSkillFile,
  } = skillsPanel;
  const {
    tasks,
    progressByTaskId,
    tasksUi,
    onTasksUiChange,
    onCancelTask,
    onClearCompletedTasks,
    onRefreshTasks,
  } = tasksPanel;
  const {
    logs,
    logsUi,
    currentLogLevel,
    modernLogLevel = null,
    onSetLogLevel,
    onSetModernLogLevel,
    onLogsUiChange,
    onClearLogs,
    onExportLogs,
  } = logsPanel;
  const {
    protocol,
    protocolUi,
    pinnedProtocolIds,
    onProtocolUiChange,
    onClearProtocol,
    onExportProtocol,
    onClearProtocolSection,
    onExportProtocolSection,
    onReplayProtocol,
    onTogglePinProtocol,
  } = protocolPanel;
  const {
    network,
    networkUi,
    onNetworkUiChange,
    onClearNetwork,
    onExportNetwork,
  } = networkPanel;
  const {
    stderrLogs,
    consoleUi,
    onConsoleUiChange,
    onClearConsole,
    onExportConsole,
  } = consolePanel;
  // UI-only state. Connection state, primitive lists, and all action
  // dispatching live in the parent; this component only owns view-local
  // toggles (sort direction, list compact). Tab selection is lifted (#1417).

  const [logsSort, setLogsSort] = useSortDirection("logs");
  const [protocolSort, setProtocolSort] = useSortDirection("protocol");
  const [networkSort, setNetworkSort] = useSortDirection("network");
  const [consoleSort, setConsoleSort] = useSortDirection("console");

  // Servers and Resources default to expanded (collapsed=false) so new
  // users see content on first paint; Protocol/Network default to
  // collapsed (the lists are long enough that compact is the better
  // first-paint state).
  const [protocolCompact, setProtocolCompact] = useListCompact(
    "protocol",
    LIST_COMPACT_DEFAULT,
  );
  const [networkCompact, setNetworkCompact] = useListCompact(
    "network",
    LIST_COMPACT_DEFAULT,
  );
  const [serversCompact, setServersCompact] = useListCompact("servers", false);
  const [resourcesCompact, setResourcesCompact] = useListCompact(
    "resources",
    false,
  );

  // Monitoring-column state (#1616): whether Logs/Protocol/Network are pinned to
  // the right column, which one is active there, and the column width. All
  // persisted (view-layout preferences), same shape as the sort/compact hooks.
  const [monitorPinned, setMonitorPinned] = useLocalStorage<boolean>({
    key: "inspector.monitor.pinned",
    defaultValue: MONITOR_PINNED_DEFAULT,
    deserialize: deserializeMonitorPinned,
    serialize: serializeMonitorPinned,
    getInitialValueInEffect: false,
  });
  const [monitorTab, setMonitorTab] = useLocalStorage<MonitorTab>({
    key: "inspector.monitor.tab",
    defaultValue: MONITOR_TAB_DEFAULT,
    deserialize: deserializeMonitorTab,
    serialize: serializeMonitorTab,
    getInitialValueInEffect: false,
  });
  const [monitorWidth, setMonitorWidth] = useLocalStorage<number>({
    key: "inspector.monitor.width",
    defaultValue: MONITOR_WIDTH_DEFAULT,
    deserialize: deserializeMonitorWidth,
    serialize: serializeMonitorWidth,
    getInitialValueInEffect: false,
  });
  // Transient width during a drag; committed to `monitorWidth` on release so
  // localStorage takes a single write per drag rather than one per pointer move.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const columnWidth = dragWidth ?? monitorWidth;

  // Open the monitoring sidebar when a connection is established (#1616) OR when a
  // connect *attempt* fails (#1621). Gated on the *transition into* the target
  // status (via the ref) rather than the status itself, so it fires once on an
  // actual connect/failure — not on every render, and not on a mount that starts
  // already in that status (which would fight a user who closed it). On success
  // the column surfaces the live stream; on failure it surfaces the diagnostics
  // that explain what went wrong. The column still only *appears* when wide + a
  // monitor tab is available (`effectivePinned`); this just sets the preference.
  //
  // `"error"` is also the resting status of a *mid-session crash* of a
  // previously-connected server (per isTerminalStatus/#1490), but that is NOT a
  // connect attempt: reopening a column the user closed mid-session (and swapping
  // their live tab set for the failure set) would be surprising. So the error
  // arm requires the previous status to NOT be `connected` — i.e. we went
  // connecting/disconnected → error, never connected → error. This keeps the
  // auto-open aligned with the red-border (`erroredServerId`), which the parent
  // also sets only for connect-attempt failures.
  //
  // A connect attempt that fails *during OAuth* (#2108) never reaches the
  // `"error"` status at all: the auth leg is driven from the parent, which
  // tears the client down on failure, so the session settles at
  // `"disconnected"`. So the failure arm also fires on the parent raising
  // `erroredServerId` — the canonical "this server's last connect attempt
  // failed" flag, which the parent clears at the start of every new attempt.
  // Tracked through a ref for the same reason as the status: a mount that
  // starts already flagged must not re-open a column the user closed.
  const prevStatusRef = useRef(connectionStatus);
  const prevErroredServerIdRef = useRef(erroredServerId);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = connectionStatus;
    const prevErrored = prevErroredServerIdRef.current;
    prevErroredServerIdRef.current = erroredServerId;
    const becameConnected =
      connectionStatus === "connected" && prev !== "connected";
    const becameError =
      (connectionStatus === "error" &&
        prev !== "error" &&
        prev !== "connected") ||
      (erroredServerId !== undefined && prevErrored !== erroredServerId);
    if (becameConnected || becameError) {
      setMonitorPinned(true);
    }
  }, [connectionStatus, erroredServerId, setMonitorPinned]);

  const appTools = useMemo<Tool[]>(() => {
    return tools.filter((tool) => {
      try {
        return isAppTool(tool);
      } catch {
        // `isAppTool` throws on malformed `_meta.ui.resourceUri`; tolerate
        // mixed-validity tool lists by skipping the bad tool rather than
        // halting the filter (and hiding every following App).
        return false;
      }
    });
  }, [tools]);

  // Only show the non-Servers tabs when actually connected. Each
  // server-capability tab is gated on the matching field of the server's
  // advertised `capabilities` (from the MCP `initialize` result), not on
  // current content (#1516): a server that advertises a capability but
  // currently has zero items still shows its tab, and a server that doesn't
  // advertise the capability never does — even if a stale/optimistic list is
  // briefly non-empty. The capability object rides along on `initializeResult`
  // (App builds it from the handshake), which is only truthy while connected.
  //
  //   Tools     → capabilities.tools
  //   Logs      → capabilities.logging
  //   Prompts   → capabilities.prompts
  //   Resources → capabilities.resources
  //   Tasks     → capabilities.tasks (legacy) OR the
  //               io.modelcontextprotocol/tasks extension (modern, SEP-2663).
  //               The "run as task" affordance on the Tools screen separately
  //               keys off tasks.requests.tools.call (legacy) / the negotiated
  //               extension (modern).
  //   Apps      → capabilities.tools (MCP Apps build on tools) AND at least one
  //               app tool — Apps is a filtered view of tools, not its own
  //               capability, so it keeps the content check; when app tools
  //               exist but the sandbox is unavailable the tab stays visible so
  //               its "unavailable" message remains reachable.
  //
  // Network is hidden for stdio servers (no HTTP traffic to surface).
  // Servers and Protocol are never capability-gated — Protocol is a local
  // client-side log, and any future client capabilities (sampling /
  // elicitation / roots) are inspector-offered, not server-advertised, so
  // they must not be gated here either. These memo dependencies make the tabs
  // recompute live as capabilities change (server switch, reconnect).
  const availableTabs = useMemo<string[]>(() => {
    if (connectionStatus !== "connected") return [SERVERS_TAB];
    const active = serversInput.find((s) => s.id === activeServer);
    const isStdio = active ? getServerType(active.config) === "stdio" : false;
    const capabilities = initializeResult?.capabilities;
    const hasTools = capabilities?.tools !== undefined;
    const hasApps = hasTools && appTools.length > 0;
    const hasPrompts = capabilities?.prompts !== undefined;
    const hasResources = capabilities?.resources !== undefined;
    // Legacy servers gate Tasks on `capabilities.tasks`; modern servers
    // (SEP-2663) advertise the `io.modelcontextprotocol/tasks` extension in
    // `server/discover` instead, so gate on either being present.
    const hasTasks =
      capabilities?.tasks !== undefined ||
      capabilities?.extensions?.[TASKS_EXTENSION_KEY] !== undefined;
    const hasLogging = capabilities?.logging !== undefined;
    // Skills (SEP-2640) is a server-declared *extension*, and unlike Tasks it
    // is not era-gated: `skills/*` are not spec method names in either codec,
    // so a legacy-era server that declares the extension is serving it.
    const hasSkills = isSkillsExtensionSupported(capabilities);
    return ALL_TABS.filter((t) => {
      if (t === NETWORK_TAB && isStdio) return false;
      // Console is the stdio process's stderr stream — shown only for stdio
      // servers (HTTP transports have no child process to capture). (#1621)
      if (t === CONSOLE_TAB && !isStdio) return false;
      if (t === "Tools" && !hasTools) return false;
      if (t === "Apps" && !hasApps) return false;
      if (t === "Prompts" && !hasPrompts) return false;
      if (t === "Resources" && !hasResources) return false;
      if (t === SKILLS_TAB && !hasSkills) return false;
      if (t === "Tasks" && !hasTasks) return false;
      if (t === "Logs" && !hasLogging) return false;
      return true;
    });
  }, [
    connectionStatus,
    serversInput,
    activeServer,
    initializeResult,
    appTools,
  ]);

  // Monitoring sidebar, derived (#1616, #1621). The monitor group is pinned into
  // the right column only when: the user asked for it, the viewport is wide
  // enough, the session is connected OR a connect attempt failed, and at least
  // one monitor tab is actually available (capability/stdio aware). Narrowing,
  // returning to a clean disconnect, or losing the last monitor capability flips
  // `effectivePinned` false and closes the column — WITHOUT clearing
  // `monitorPinned`, so it re-opens when the condition returns. Only the column's
  // close button writes `monitorPinned = false`.
  const connected = connectionStatus === "connected";
  // A failed connection *attempt* (#1621) keeps the column available so the user
  // can see why, even though no live session exists. Gated on `erroredServerId`
  // (set by the parent only for connect-attempt failures, not mid-session
  // crashes) so a crash of a previously-connected server doesn't reorganize the
  // column into the failure tab set — matching the auto-open effect above.
  //
  // Keyed on `erroredServerId` alone rather than on the `"error"` status
  // (#2108): an OAuth leg that fails is torn down by the parent, so the session
  // rests at `"disconnected"` and a status gate would never see the failure —
  // which is exactly the case a server developer needs the Network tab for.
  // `!connected` is the only status condition left, and it holds vacuously
  // whenever the flag is set (the parent clears it as each new attempt starts).
  const failed = !connected && erroredServerId !== undefined;
  const monitorAvailable = useMemo<string[]>(() => {
    if (connected) return availableTabs.filter((t) => MONITOR_TABS.includes(t));
    if (failed) {
      // A failed connect never negotiated capabilities, so Logs (gated on the
      // server's `logging` capability) isn't meaningful. Offer exactly the tabs
      // whose diagnostic actually *captured something* — keyed on content, not
      // the declared transport (a connect failure fires the client `disconnect`
      // event, which clears `activeServer`, so transport can't be read back):
      //   • stdio → the process's stderr (Console): the spawn/startup error the
      //     child printed before dying.
      //   • HTTP  → the failed requests (Network).
      //   • Protocol only if it has entries — the message log is cleared on the
      //     error transition, so on a fresh connect failure it's empty; offering
      //     it anyway would let an empty tab lead over (and hide) the real
      //     diagnostic. Content-gating it keeps the actual diagnostic first.
      // If nothing captured anything yet, `monitorAvailable` is empty and the
      // column stays closed rather than opening onto an empty pane; this memo
      // re-runs as stderr/fetch entries stream in, so the column opens (and the
      // diagnostic tab appears) the moment the failing process/request emits.
      const tabs: string[] = [];
      if (stderrLogs.length > 0) tabs.push(CONSOLE_TAB);
      if (network.length > 0) tabs.push(NETWORK_TAB);
      if (protocol.length > 0) tabs.push(PROTOCOL_TAB);
      return tabs;
    }
    return [];
  }, [connected, failed, availableTabs, stderrLogs, network, protocol]);
  // The column can exist when the session is connected OR a connect attempt
  // failed, and at least one monitor tab is actually available. (The app floors
  // at a 1280px min-width, so there's always room for the split — no viewport
  // gate.) This also gates the header MonitoringToggle (#1661) — the toggle is
  // hidden entirely when the column can't exist.
  const monitorColumnAvailable =
    (connected || failed) && monitorAvailable.length > 0;
  const effectivePinned = monitorPinned && monitorColumnAvailable;

  // The header loses the monitor group while the column is open (its screens
  // live in the column instead); otherwise it shows every available tab.
  const headerTabs = useMemo<string[]>(
    () =>
      effectivePinned
        ? availableTabs.filter((t) => !MONITOR_TABS.includes(t))
        : availableTabs,
    [effectivePinned, availableTabs],
  );

  // Clamp the rendered primary tab to whatever the header currently shows. If
  // the user had "Tools" selected and the connection drops, `headerTabs` becomes
  // `[Servers]` and the view renders Servers without us having to imperatively
  // reset the state (and trip the `set-state-in-effect` lint). When pinning
  // moves a monitor tab out of the header, the primary falls back to the first
  // non-Servers tab; the lifted `activeTabProp` is left intact so closing the
  // column restores the user's prior selection.
  const firstNonServersTab =
    headerTabs.find((t) => t !== SERVERS_TAB) ?? SERVERS_TAB;
  const activeTab = headerTabs.includes(activeTabProp)
    ? activeTabProp
    : effectivePinned
      ? firstNonServersTab
      : SERVERS_TAB;

  // Deep-link auto-open (#1577): once connected and the requested app appears in
  // the app-tools list, switch to the Apps tab and pre-select it with the
  // supplied form values. The `autoOpen` flag is forwarded to AppsScreen (which
  // owns the running/iframe state) to fire the actual "Open App" — see its
  // `autoOpen` prop. Guarded by a ref so it fires exactly once even though the
  // effect re-runs as `appTools`/`availableTabs` settle.
  const deepLinkOpenAppRef = useRef(false);
  useEffect(() => {
    if (!deepLink?.openApp) return;
    if (deepLinkOpenAppRef.current) return;
    if (connectionStatus !== "connected") return;
    if (!availableTabs.includes("Apps")) return;
    const target = appTools.find((t) => t.name === deepLink.openApp);
    if (!target) return;
    deepLinkOpenAppRef.current = true;
    // Seed the schema's defaults THEN overlay the deep-link's appArgs. Without
    // the defaults, a required field the form would display with its default
    // value is absent from `formValues`, the schema-form's validity check
    // fails, and Open App is silently disabled — an automated driver's click
    // then no-ops and the iframe-wait spins forever.
    // The args are passed to the seeding too, not just overlaid on it: for a
    // schema whose arguments are a root union they can name a branch other
    // than the first, and defaults seeded from the wrong branch would sit in
    // the submitted arguments where the form — showing the branch the args
    // identify — never displays them (#2123).
    // …and the schema's constants are re-applied *after* the overlay: a field
    // the form renders read-only cannot be corrected by the user, so a deep
    // link disagreeing with one would otherwise auto-open with a hidden value
    // contradicting the shape on screen.
    const appFormSchema = toFormSchema(target.inputSchema) ?? {};
    const formValues = applySchemaConstants(
      appFormSchema,
      // Merged per level, not with one shallow spread: a nested object in the
      // args would otherwise replace the whole seeded object, discarding the
      // nested defaults the form goes on displaying.
      seedSchemaValues(appFormSchema, deepLink.appArgs ?? {}),
    );
    // Seed the selection directly rather than routing through
    // AppsScreen.handleSelect. This deliberately bypasses handleSelect's
    // no-input-app auto-launch: a deep link must never invoke a tool against
    // the target server unless the token-gated `autoOpen` is set — even a
    // no-input app waits for that explicit signal (or a manual "Open App"
    // click), matching the security stance that a crafted URL alone can't fire
    // a tool call.
    onActiveTabChange("Apps");
    onAppsUiChange({
      ...appsUi,
      selectedAppName: target.name,
      formValues,
    });
    onSelectApp(target.name);
  }, [
    deepLink,
    connectionStatus,
    availableTabs,
    appTools,
    appsUi,
    onActiveTabChange,
    onAppsUiChange,
    onSelectApp,
  ]);

  // The monitor tab shown in the column, clamped to what's available (e.g. a
  // switch to a stdio server drops Network). `?? LOGS_TAB` is a types-only
  // fallback: the column only renders while `monitorAvailable.length > 0`.
  const effectiveMonitorTab: MonitorTab =
    monitorAvailable.includes(monitorTab) && isMonitorTab(monitorTab)
      ? monitorTab
      : (monitorAvailable.find(isMonitorTab) ?? LOGS_TAB);

  // Pinning is a group action: remember which tab to show and open the column.
  function pinMonitor(tab: MonitorTab) {
    setMonitorTab(tab);
    setMonitorPinned(true);
  }
  // Jump from a Protocol spec error to its correlated Network HTTP entry:
  // reveal the Network view (in whichever mode is active), un-hide the target by
  // clearing whatever filter would drop it, then hand the fetch id to the panel
  // which scrolls to and expands that entry.
  function handleRevealInNetwork(messageId: string) {
    const entry = protocol.find((m) => m.id === messageId);
    if (!entry) return;
    const fetchEntry = correlateFetchEntry(entry, network);
    if (!fetchEntry) return;
    onNetworkUiChange({
      filterText: "",
      visibleCategories: {
        ...networkUi.visibleCategories,
        [fetchEntry.category]: true,
      },
    });
    setMonitorSearch("");
    if (effectivePinned) {
      pinMonitor(NETWORK_TAB);
    } else {
      onActiveTabChange(NETWORK_TAB);
    }
    setRevealNetworkId(fetchEntry.id);
  }
  function handleMonitorTabChange(tab: string) {
    // The SegmentedControl's data only holds valid monitor tabs, so the guard's
    // false arm is unreachable through the UI.
    /* v8 ignore next */
    if (isMonitorTab(tab)) setMonitorTab(tab);
  }
  // Closing the column leaves the primary area on whatever screen is currently
  // selected in the header — it does not swap in the column's screen. We commit
  // the current `activeTab` to the lifted state first so unpinning can't resurrect
  // the (now stale) monitor tab that was selected before pinning.
  function closeMonitorColumn() {
    onActiveTabChange(activeTab);
    setMonitorPinned(false);
  }
  // The single header toggle (#1661): open the column onto the last-used monitor
  // tab (clamped to what's available) when closed, close it when open.
  function toggleMonitorColumn() {
    if (effectivePinned) {
      closeMonitorColumn();
    } else {
      pinMonitor(effectiveMonitorTab);
    }
  }
  // Only offer the toggle while the column can actually exist; otherwise the
  // header shows nothing to toggle.
  const monitorToggle = monitorColumnAvailable
    ? { open: effectivePinned, onToggle: toggleMonitorColumn }
    : undefined;
  function commitMonitorWidth(next: number) {
    setMonitorWidth(next);
    setDragWidth(null);
  }

  // A single search shared across the column's tabs (kept as you move between
  // Logs/Protocol/Network so it filters each one), distinct from the full-size
  // screens' own searches. The embedded panels apply only this text; their other
  // filters (levels / categories / directions / method) have no control in the
  // column and are bypassed there.
  const [monitorSearch, setMonitorSearch] = useState("");

  // "Reveal in Network": a fetch-entry id to scroll to + expand, set when the
  // user clicks through from a correlated Protocol spec error. `revealableIds`
  // is the set of Protocol entries that have a Network counterpart (link shown).
  const [revealNetworkId, setRevealNetworkId] = useState<string | undefined>(
    undefined,
  );
  const revealableProtocolIds = useMemo(
    () => revealableMessageIds(protocol, network),
    [protocol, network],
  );
  // Correlated HTTP status per Protocol entry, so the Protocol view can gate the
  // generic `-32601` to a genuine modern 404 (an in-band `-32601` on a 200 is an
  // ordinary error, not the modern transport taxonomy).
  const protocolStatusById = useMemo(
    () => correlatedFetchStatusById(protocol, network),
    [protocol, network],
  );

  // Merge the parent's `serversInput` (static config) with the runtime
  // connection state owned by the parent — only the active server reflects
  // the live status; the rest render as `disconnected`. Handshake errors
  // are surfaced via a toast at the App level (see App.tsx); the card
  // itself stays focused on the live status indicator.
  const servers = useMemo<ServerEntry[]>(
    () =>
      serversInput.map((s) => {
        if (s.id !== activeServer) {
          return { ...s, connection: { status: "disconnected" } };
        }
        return {
          ...s,
          connection: {
            status: connectionStatus,
            // Surface the negotiated protocol version on the active card.
            // initializeResult carries it (App builds it from the
            // InspectorClient handshake, #1324) and is only ever truthy when
            // connected — it's derived from connectionStatus in the same memo
            // — so its presence already implies a live connection. App uses ""
            // for an unknown version, so only set the field when it's present.
            ...(initializeResult?.protocolVersion
              ? { protocolVersion: initializeResult.protocolVersion }
              : {}),
          },
        };
      }),
    [serversInput, activeServer, connectionStatus, initializeResult],
  );

  // The other server cards are dimmed/`inert` only while a connection is
  // actively live (connecting or connected), so the user can't kick off a
  // second connection mid-session. Once the active session settles into a
  // terminal state — `disconnected` or `error` — the rest must re-enable
  // (#1521). A connect-time handshake failure (and a mid-session transport
  // `onerror`) resolves to `error` *without* firing the InspectorClient
  // `disconnect` event that App uses to clear `activeServerId`, so the id
  // lingers; gating the dim source on liveness here is what un-dims the
  // others. The errored card itself still shows its real status via the
  // merged `servers` list above (keyed off the real `activeServer`), so
  // passing `undefined` here lifts only the *other* cards' dimming, not the
  // error indicator on the active one. `isTerminalStatus` (the #1490 teardown
  // convention) is the single source of truth for "session is over" so this
  // gate can't silently desync from a future status addition.
  const dimCardsAgainst = isTerminalStatus(connectionStatus)
    ? undefined
    : activeServer;

  // Shared props for each monitor screen, spread into both its primary
  // (header-tab) instance and its embedded (column) instance so the two can't
  // drift. The embedded instance adds `embedded`; the column is opened/closed
  // from the single header MonitoringToggle (#1661), not per-screen. (#1616)
  const loggingScreenProps = {
    entries: logs,
    currentLevel: currentLogLevel,
    ui: logsUi,
    onUiChange: onLogsUiChange,
    onSetLevel: onSetLogLevel,
    protocolEra,
    modernLogLevel,
    onSetModernLogLevel,
    onClear: onClearLogs,
    onExport: onExportLogs,
    sortDirection: logsSort,
    onSortChange: setLogsSort,
  };
  const protocolScreenProps = {
    entries: protocol,
    protocolEra,
    pinnedIds: pinnedProtocolIds ?? new Set<string>(),
    ui: protocolUi,
    onUiChange: onProtocolUiChange,
    onClearAll: onClearProtocol,
    onExport: onExportProtocol,
    onClearSection: onClearProtocolSection,
    onExportSection: onExportProtocolSection,
    onReplay: onReplayProtocol,
    onTogglePin: onTogglePinProtocol,
    // Only so an edited `tools/call` replay can tell whether an argument would
    // be coerced by the schema on the way out (#2151).
    tools,
    sortDirection: protocolSort,
    onSortChange: setProtocolSort,
    compact: protocolCompact,
    onToggleCompact: () => setProtocolCompact((c) => !c),
    onRevealInNetwork: handleRevealInNetwork,
    revealableIds: revealableProtocolIds,
    correlatedStatusById: protocolStatusById,
  };
  const networkScreenProps = {
    entries: network,
    ui: networkUi,
    onUiChange: onNetworkUiChange,
    onClear: onClearNetwork,
    onExport: onExportNetwork,
    sortDirection: networkSort,
    onSortChange: setNetworkSort,
    compact: networkCompact,
    onToggleCompact: () => setNetworkCompact((c) => !c),
    // `revealId` is spread into both the pinned-sidebar monitor instance and the
    // primary full-screen ScreenStage instance, and ScreenStage keeps inactive
    // children mounted — so when the sidebar is pinned two NetworkEntry instances
    // match this id. Both fire (the hidden one's scrollIntoView is a no-op) and
    // both call onRevealComplete; the clear is idempotent, so the double-fire is
    // expected and harmless.
    revealId: revealNetworkId,
    onRevealComplete: () => setRevealNetworkId(undefined),
  };
  const consoleScreenProps = {
    entries: stderrLogs,
    ui: consoleUi,
    onUiChange: onConsoleUiChange,
    onClear: onClearConsole,
    onExport: onExportConsole,
    sortDirection: consoleSort,
    onSortChange: setConsoleSort,
  };
  const skillsScreenProps = {
    skills,
    pageCount: skillsPageCount,
    loadError: skillsLoadError,
    ui: skillsUi,
    onUiChange: onSkillsUiChange,
    onRefreshList: onRefreshSkills,
    onReadSkillFile,
  };
  const tasksScreenProps = {
    tasks,
    progressByTaskId,
    ui: tasksUi,
    onUiChange: onTasksUiChange,
    onRefresh: onRefreshTasks,
    onClearCompleted: onClearCompletedTasks,
    onCancel: onCancelTask,
  };

  // Embedded instances for the pinned column, keyed by tab. MonitoringScreen
  // renders only the active one; the rest are unmounted element values. Each
  // screen's search field is overridden with the shared column search so it
  // filters whichever tab is showing, and carries over as tabs change.
  const monitorScreens: Record<string, ReactNode> = {
    [TASKS_TAB]: (
      <TasksScreen
        {...tasksScreenProps}
        ui={{ ...tasksUi, search: monitorSearch }}
        embedded
      />
    ),
    [LOGS_TAB]: (
      <LoggingScreen
        {...loggingScreenProps}
        ui={{ ...logsUi, filterText: monitorSearch }}
        embedded
      />
    ),
    [PROTOCOL_TAB]: (
      <ProtocolScreen
        {...protocolScreenProps}
        ui={{ ...protocolUi, search: monitorSearch }}
        embedded
      />
    ),
    [NETWORK_TAB]: (
      <NetworkScreen
        {...networkScreenProps}
        ui={{ ...networkUi, filterText: monitorSearch }}
        embedded
      />
    ),
    [CONSOLE_TAB]: (
      <ConsoleScreen
        {...consoleScreenProps}
        ui={{ filterText: monitorSearch }}
        embedded
      />
    ),
  };

  return (
    // padding={0}: each screen fills `calc(100dvh - header)` and supplies its
    // own `xl` padding, so Main must contribute only the fixed-header offset.
    // Mantine's default `padding="md"` added an extra inset that pushed content
    // past the viewport and made the whole InspectorView scroll — the theme's
    // Main-slot height clamp + overflow:hidden keep that scroll on the inner
    // ScrollArea regions only.
    <AppShell
      header={{ height: 60 }}
      footer={{ height: FOOTER_HEIGHT }}
      padding={0}
    >
      <AppShell.Header
        data-testid="connection-status"
        data-status={connectionStatus}
        data-error-message={connectErrorMessage}
        data-deeplink={deepLinkStatus}
      >
        {connectionStatus === "connected" && initializeResult ? (
          <ViewHeader
            connected
            serverInfo={resolveHeaderServerInfo(
              initializeResult.serverInfo,
              serversInput,
              activeServer,
            )}
            status={connectionStatus}
            latencyMs={latencyMs}
            activeTab={activeTab}
            availableTabs={headerTabs}
            onTabChange={onActiveTabChange}
            onDisconnect={onDisconnect}
            onToggleTheme={onToggleTheme}
            onOpenClientSettings={onOpenClientSettings}
            monitorToggle={monitorToggle}
          />
        ) : (
          <ViewHeader
            connected={false}
            onToggleTheme={onToggleTheme}
            onOpenClientSettings={onOpenClientSettings}
            monitorToggle={monitorToggle}
          />
        )}
      </AppShell.Header>
      <AppShell.Main>
        <SplitRow>
          <ScreenStageContainer>
            <ScreenStage active={activeTab === SERVERS_TAB}>
              <ServerListScreen
                servers={servers}
                writable={serverListWritable}
                activeServer={dimCardsAgainst}
                erroredServerId={erroredServerId}
                connectedServerId={connectedServerId}
                onAddManually={onServerAdd}
                onImportConfig={onServerImportConfig}
                onImportServerJson={onServerImportJson}
                onExport={onServerExport}
                onToggleConnection={onToggleConnection}
                onConnectionInfo={onConnectionInfo}
                onSettings={onServerSettings}
                onEdit={onServerEdit}
                onClone={onServerClone}
                onRemove={onServerRemove}
                onReorder={onServerReorder}
                highlightedServerIds={highlightedServerIds}
                onClearHighlight={onClearHighlight}
                compact={serversCompact}
                onToggleCompact={() => setServersCompact((c) => !c)}
              />
            </ScreenStage>
            <ScreenStage active={activeTab === "Tools"}>
              <ToolsScreen
                tools={tools}
                excludedTools={excludedTools}
                malformedListItems={malformedListItems}
                callState={toolCallState}
                ui={toolsUi}
                listChanged={toolsListChanged}
                loadError={toolsLoadError}
                serverSupportsTaskToolCalls={serverSupportsTaskToolCalls}
                modernTasks={
                  protocolEra === "modern" &&
                  initializeResult?.capabilities?.extensions?.[
                    TASKS_EXTENSION_KEY
                  ] !== undefined
                }
                onUiChange={onToolsUiChange}
                onRefreshList={onRefreshTools}
                pagination={toolsPagination}
                onCallTool={onCallTool}
                onCancelCall={onCancelToolCall}
                onClearResult={onClearToolResult}
                onReadResource={onReadResourceContents}
              />
            </ScreenStage>
            <ScreenStage active={activeTab === "Apps"}>
              <AppsScreen
                tools={appTools}
                listChanged={toolsListChanged}
                sandboxPath={sandboxPath}
                bridgeFactory={bridgeFactory}
                rendererRef={appRendererRef}
                ui={appsUi}
                onUiChange={onAppsUiChange}
                onRefreshList={onRefreshApps}
                onSelectApp={onSelectApp}
                onOpenApp={onOpenApp}
                onCloseApp={onCloseApp}
                onError={onAppError}
                autoOpen={Boolean(deepLink?.openApp && deepLink.autoOpen)}
              />
            </ScreenStage>
            <ScreenStage active={activeTab === "Prompts"}>
              <PromptsScreen
                prompts={prompts}
                malformedListItems={malformedListItems}
                getPromptState={getPromptState}
                ui={promptsUi}
                listChanged={promptsListChanged}
                loadError={promptsLoadError}
                completionsSupported={completionsSupported}
                onUiChange={onPromptsUiChange}
                onRefreshList={onRefreshPrompts}
                pagination={promptsPagination}
                onGetPrompt={onGetPrompt}
                onCopyMessages={onCopyPromptMessages}
                onCompleteArgument={onCompleteArgument}
              />
            </ScreenStage>
            <ScreenStage active={activeTab === "Resources"}>
              <ResourcesScreen
                resources={resources}
                malformedListItems={malformedListItems}
                templates={resourceTemplates}
                subscriptions={subscriptions}
                subscriptionStreamState={subscriptionStreamState}
                protocolEra={protocolEra}
                readState={readResourceState}
                ui={resourcesUi}
                listChanged={resourcesListChanged}
                loadError={resourcesLoadError}
                completionsSupported={completionsSupported}
                subscriptionsSupported={subscriptionsSupported}
                onUiChange={onResourcesUiChange}
                onRefreshList={onRefreshResources}
                pagination={resourcesPagination}
                onReadResource={onReadResource}
                onSubscribeResource={onSubscribeResource}
                onUnsubscribeResource={onUnsubscribeResource}
                onCompleteArgument={onCompleteArgument}
                compact={resourcesCompact}
                onCompactChange={setResourcesCompact}
              />
            </ScreenStage>
            <ScreenStage active={activeTab === SKILLS_TAB}>
              <SkillsScreen {...skillsScreenProps} />
            </ScreenStage>
            <ScreenStage active={activeTab === TASKS_TAB}>
              <TasksScreen {...tasksScreenProps} />
            </ScreenStage>
            <ScreenStage active={activeTab === LOGS_TAB}>
              <LoggingScreen {...loggingScreenProps} />
            </ScreenStage>
            <ScreenStage active={activeTab === PROTOCOL_TAB}>
              <ProtocolScreen {...protocolScreenProps} />
            </ScreenStage>
            <ScreenStage active={activeTab === NETWORK_TAB}>
              <NetworkScreen {...networkScreenProps} />
            </ScreenStage>
            <ScreenStage active={activeTab === CONSOLE_TAB}>
              <ConsoleScreen {...consoleScreenProps} />
            </ScreenStage>
          </ScreenStageContainer>
          <Transition
            mounted={effectivePinned}
            transition={columnSlide}
            duration={COLUMN_ANIM_MS}
            exitDuration={COLUMN_ANIM_MS}
            timingFunction="ease"
          >
            {(styles) => (
              // `style={styles}` is Mantine's runtime Transition interpolation,
              // not static styling — same pattern as ScreenStage above.
              <MonitorColumnGroup style={styles}>
                <ResizeHandle
                  value={columnWidth}
                  min={MONITOR_WIDTH_MIN}
                  max={MONITOR_WIDTH_MAX}
                  step={MONITOR_WIDTH_STEP}
                  onChange={setDragWidth}
                  onCommit={commitMonitorWidth}
                  aria-label="Resize monitoring sidebar"
                />
                <MonitoringColumn w={columnWidth}>
                  <MonitoringScreen
                    tabs={monitorAvailable}
                    value={effectiveMonitorTab}
                    onChange={handleMonitorTabChange}
                    searchValue={monitorSearch}
                    onSearchChange={setMonitorSearch}
                    screens={monitorScreens}
                  />
                </MonitoringColumn>
              </MonitorColumnGroup>
            )}
          </Transition>
        </SplitRow>
      </AppShell.Main>
      <AppShell.Footer>
        <FooterRow>
          <VersionBadge version={version} />
          <CopyrightBadge />
        </FooterRow>
      </AppShell.Footer>
    </AppShell>
  );
}
