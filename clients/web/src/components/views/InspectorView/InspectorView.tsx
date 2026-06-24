import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import type { DeepLink } from "../../../utils/deepLink";
import { AppShell, Box, Stack, Transition } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import type {
  InitializeResult,
  LoggingLevel,
  Prompt,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  Task,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ConnectionStatus,
  FetchRequestEntry,
  InspectorResourceSubscription,
  MessageEntry,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import { isAppTool } from "@inspector/core/mcp/apps.js";
import { collectSchemaDefaults } from "../../../utils/jsonUtils";
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";
import { ServerListScreen } from "../../screens/ServerListScreen/ServerListScreen";
import {
  ToolsScreen,
  type ToolCallState,
  type ToolsUiState,
} from "../../screens/ToolsScreen/ToolsScreen";
import {
  AppsScreen,
  type AppsUiState,
} from "../../screens/AppsScreen/AppsScreen";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import {
  PromptsScreen,
  type GetPromptState,
  type PromptsUiState,
} from "../../screens/PromptsScreen/PromptsScreen";
import {
  ResourcesScreen,
  type ReadResourceState,
  type ResourcesUiState,
} from "../../screens/ResourcesScreen/ResourcesScreen";
import {
  LoggingScreen,
  type LogsUiState,
} from "../../screens/LoggingScreen/LoggingScreen";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import {
  TasksScreen,
  type TasksUiState,
} from "../../screens/TasksScreen/TasksScreen";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";
import {
  HistoryScreen,
  type HistoryUiState,
} from "../../screens/HistoryScreen/HistoryScreen";
import {
  NetworkScreen,
  type NetworkUiState,
} from "../../screens/NetworkScreen/NetworkScreen";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";
import { getServerType } from "@inspector/core/mcp/config.js";

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
function useSortDirection(scope: "logs" | "history" | "network") {
  return useLocalStorage<SortDirection>({
    key: `inspector.sortDirection.${scope}`,
    defaultValue: SORT_DEFAULT,
    deserialize: deserializeSortDirection,
    serialize: serializeSortDirection,
    getInitialValueInEffect: false,
  });
}

function useListCompact(
  scope: "history" | "network" | "servers" | "resources",
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

const SERVERS_TAB = "Servers";
const NETWORK_TAB = "Network";

const ALL_TABS: string[] = [
  SERVERS_TAB,
  "Apps",
  "Tools",
  "Prompts",
  "Resources",
  "Tasks",
  "Logs",
  "History",
  NETWORK_TAB,
];

const SCREEN_ENTER_MS = 350;
const SCREEN_EXIT_MS = 250;

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
});

// Wraps each screen in a Mantine Transition. With Transition's default
// (`keepMounted={false}`), the outgoing screen unmounts after its exit
// animation — any local screen state (search filters, scroll position,
// expanded sections) is reset on tab switch.
function ScreenStage({
  active,
  testId,
  children,
}: {
  active: boolean;
  /** Stable hook for automated drivers; only present in the DOM while mounted. */
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Transition
      mounted={active}
      transition="fade-up"
      duration={SCREEN_ENTER_MS}
      exitDuration={SCREEN_EXIT_MS}
      timingFunction="ease"
    >
      {(styles) => (
        // `style={styles}` is the runtime transition state from Mantine's
        // Transition API — these are interpolated values, not static styling.
        <Box
          style={styles}
          pos="absolute"
          top={0}
          left={0}
          right={0}
          data-testid={testId}
        >
          {children}
        </Box>
      )}
    </Transition>
  );
}

export interface InspectorViewProps {
  /**
   * Validated deep-link parameters from the page URL. When present and
   * `openApp` is set, this component switches to the Apps tab and pre-selects
   * that app (with `appArgs` as the form values) once the connection is up and
   * the app list contains it. The connect itself is driven by the parent.
   */
  deepLink?: DeepLink;

  // Server list (static config; runtime connection state comes from the
  // separate fields below and is merged into each card by this component).
  servers: ServerEntry[];
  /**
   * Whether the server list is writable (catalog) or read-only (a `--config`
   * session file / ad-hoc launch). When false, the Servers screen hides all
   * catalog mutation controls. Defaults to true.
   */
  serverListWritable?: boolean;

  // Connection state — driven by the parent via `useInspectorClient`.
  activeServer?: string;
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

  // Primitive lists, log streams, task state — all sourced from the
  // per-primitive `useManaged*` / `useMessageLog` hooks in the parent.
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];

  // "List changed since last refresh" flags, sourced from the managed-state
  // layer (#1402). They light the per-screen list-changed indicator. Apps is a
  // filtered view of tools, so it shares the tools flag.
  toolsListChanged: boolean;
  promptsListChanged: boolean;
  resourcesListChanged: boolean;
  logs: LogEntryData[];
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
  history: MessageEntry[];
  network: FetchRequestEntry[];

  // Per-screen "operation in flight" states (panel-level; optional because
  // the underlying screens accept them as optional).
  toolCallState?: ToolCallState;
  getPromptState?: GetPromptState;
  readResourceState?: ReadResourceState;

  // Per-screen selection / search / filter state, one object per screen. Owned
  // by the parent (App) so it persists across tab navigation within a live
  // session — the screens unmount on tab switch, so screen-local state would be
  // lost (#1417). Each is paired with an `on{Screen}UiChange` setter below.
  toolsUi: ToolsUiState;
  promptsUi: PromptsUiState;
  resourcesUi: ResourcesUiState;
  appsUi: AppsUiState;
  tasksUi: TasksUiState;
  logsUi: LogsUiState;
  historyUi: HistoryUiState;
  networkUi: NetworkUiState;

  // Logging level. The MCP `logging/setLevel` request has no echo
  // notification, so the parent keeps the optimistic current value.
  currentLogLevel: LoggingLevel;

  // MCP Apps sandbox. The parent's web environment provides the sandbox iframe
  // URL (undefined when the sandbox controller is unavailable), the per-app
  // bridge factory, and the renderer handle the parent uses to push tool
  // input/result into the running app and tear it down.
  sandboxPath?: string;
  bridgeFactory: BridgeFactory;
  appRendererRef: Ref<AppRendererHandle>;

  // History pinning. Optional because pin state isn't persisted yet (#1244
  // is single-PR; persistence is a separate concern).
  pinnedHistoryIds?: Set<string>;

  // Theme toggle (lives in the parent so the color scheme can also flow
  // into other top-level UI later).
  onToggleTheme: () => void;

  // Connection lifecycle (dispatched to `useInspectorClient.connect/disconnect`).
  onToggleConnection: (id: string) => void;
  onDisconnect: () => void;

  // Server list actions.
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

  // Per-primitive actions (route to `inspectorClient` methods / hook refresh).
  // Each `on{Screen}UiChange` persists that screen's lifted UI state (#1417).
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

  onPromptsUiChange: (next: PromptsUiState) => void;
  onGetPrompt: (name: string, args: Record<string, string>) => void;
  onCopyPromptMessages?: () => void;
  onRefreshPrompts: () => void;

  onResourcesUiChange: (next: ResourcesUiState) => void;
  onReadResource: (uri: string) => void;
  onSubscribeResource: (uri: string) => void;
  onUnsubscribeResource: (uri: string) => void;
  onRefreshResources: () => void;
  onCompleteArgument?: (
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argumentName: string,
    argumentValue: string,
    context: Record<string, string>,
  ) => Promise<string[]>;
  completionsSupported?: boolean;
  /**
   * Whether the connected server advertises the `resources.subscribe`
   * capability. When false, the Resources screen hides the Subscribe/
   * Unsubscribe button and the Subscriptions accordion section.
   */
  subscriptionsSupported?: boolean;

  onTasksUiChange: (next: TasksUiState) => void;
  onCancelTask: (taskId: string) => void;
  onClearCompletedTasks: () => void;
  onRefreshTasks: () => void;

  onSetLogLevel: (level: LoggingLevel) => void;
  onLogsUiChange: (next: LogsUiState) => void;
  onClearLogs: () => void;
  onExportLogs: () => void;

  onHistoryUiChange: (next: HistoryUiState) => void;
  onClearHistory: () => void;
  onExportHistory: () => void;
  onClearHistorySection: (section: "pinned" | "history") => void;
  onExportHistorySection: (section: "pinned" | "history") => void;
  onReplayHistory: (id: string) => void;
  onTogglePinHistory: (id: string) => void;

  onNetworkUiChange: (next: NetworkUiState) => void;
  onClearNetwork: () => void;
  onExportNetwork: () => void;

  onAppsUiChange: (next: AppsUiState) => void;
  onSelectApp: (name: string) => void;
  onOpenApp: (name: string, args: Record<string, unknown>) => void;
  onCloseApp: () => void;
  onAppError: (err: Error) => void;
  onRefreshApps: () => void;
}

export function InspectorView({
  deepLink,
  servers: serversInput,
  serverListWritable = true,
  activeServer,
  connectionStatus,
  connectErrorMessage,
  initializeResult,
  latencyMs,
  tools,
  prompts,
  resources,
  resourceTemplates,
  toolsListChanged,
  promptsListChanged,
  resourcesListChanged,
  subscriptions,
  logs,
  tasks,
  progressByTaskId,
  history,
  network,
  toolCallState,
  getPromptState,
  readResourceState,
  toolsUi,
  promptsUi,
  resourcesUi,
  appsUi,
  tasksUi,
  logsUi,
  historyUi,
  networkUi,
  currentLogLevel,
  sandboxPath,
  bridgeFactory,
  appRendererRef,
  pinnedHistoryIds,
  onToggleTheme,
  onToggleConnection,
  onDisconnect,
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
  serverSupportsTaskToolCalls,
  onToolsUiChange,
  onCallTool,
  onCancelToolCall,
  onClearToolResult,
  onReadResourceContents,
  onRefreshTools,
  onPromptsUiChange,
  onGetPrompt,
  onCopyPromptMessages,
  onRefreshPrompts,
  onResourcesUiChange,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
  onRefreshResources,
  onCompleteArgument,
  completionsSupported,
  subscriptionsSupported,
  onTasksUiChange,
  onCancelTask,
  onClearCompletedTasks,
  onRefreshTasks,
  onSetLogLevel,
  onLogsUiChange,
  onClearLogs,
  onExportLogs,
  onHistoryUiChange,
  onClearHistory,
  onExportHistory,
  onClearHistorySection,
  onExportHistorySection,
  onReplayHistory,
  onTogglePinHistory,
  onNetworkUiChange,
  onClearNetwork,
  onExportNetwork,
  onAppsUiChange,
  onSelectApp,
  onOpenApp,
  onCloseApp,
  onAppError,
  onRefreshApps,
}: InspectorViewProps) {
  // UI-only state. Connection state, primitive lists, and all action
  // dispatching live in the parent; this component only owns navigation
  // (which tab is visible) and a couple of view-local toggles. A deep link
  // with `openApp` seeds the selection at "Apps" — the `availableTabs` clamp
  // below shows Servers until the connection is up and the Apps tab becomes
  // available, at which point the seeded selection takes effect.
  const [selectedTab, setSelectedTab] = useState<string>(
    deepLink?.openApp ? "Apps" : SERVERS_TAB,
  );

  const [logsSort, setLogsSort] = useSortDirection("logs");
  const [historySort, setHistorySort] = useSortDirection("history");
  const [networkSort, setNetworkSort] = useSortDirection("network");

  // Servers and Resources default to expanded (collapsed=false) so new
  // users see content on first paint; History/Network default to
  // collapsed (the lists are long enough that compact is the better
  // first-paint state).
  const [historyCompact, setHistoryCompact] = useListCompact(
    "history",
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

  // Only show the non-Servers tabs when actually connected. Network is
  // additionally hidden for stdio servers — there is no HTTP traffic to
  // surface there, so the tab would always be empty. Apps, Prompts,
  // Resources, and Tasks are content-gated (#1450): each is hidden unless its
  // list has at least one entry, so an empty screen is never reachable.
  // Resources is gated on resources OR templates, since a server may expose
  // only templates; Tasks appear once a task-augmented tool call creates one
  // (the "run as task" affordance lives on the Tools screen, gated by the
  // server's task support). These memo dependencies make the tabs
  // appear/disappear live as the lists change (list-changed refresh, server
  // switch) — when app tools exist but the sandbox is unavailable the Apps
  // tab stays visible so its "unavailable" message remains reachable. Users
  // who want to inspect a server's advertised capabilities regardless of
  // current contents can open the Connection Info modal.
  const availableTabs = useMemo<string[]>(() => {
    if (connectionStatus !== "connected") return [SERVERS_TAB];
    const active = serversInput.find((s) => s.id === activeServer);
    const isStdio = active ? getServerType(active.config) === "stdio" : false;
    const hasApps = appTools.length > 0;
    const hasPrompts = prompts.length > 0;
    const hasResources = resources.length > 0 || resourceTemplates.length > 0;
    const hasTasks = tasks.length > 0;
    return ALL_TABS.filter((t) => {
      if (t === NETWORK_TAB && isStdio) return false;
      if (t === "Apps" && !hasApps) return false;
      if (t === "Prompts" && !hasPrompts) return false;
      if (t === "Resources" && !hasResources) return false;
      if (t === "Tasks" && !hasTasks) return false;
      return true;
    });
  }, [
    connectionStatus,
    serversInput,
    activeServer,
    appTools,
    prompts,
    resources,
    resourceTemplates,
    tasks,
  ]);

  // Clamp the rendered tab to whatever's currently available. If the user
  // had "Tools" selected and the connection drops, `availableTabs` becomes
  // `[Servers]` and the view renders Servers without us having to imperatively
  // reset the state (and trip the `set-state-in-effect` lint). When the
  // connection comes back, the previous selection pops in again because
  // `selectedTab` is preserved.
  const activeTab = availableTabs.includes(selectedTab)
    ? selectedTab
    : SERVERS_TAB;

  // Deep-link auto-open: once connected and the requested app appears in the
  // app-tools list, pre-select it with the supplied form values (the tab
  // itself is seeded above). AppsScreen owns the running/iframe state
  // internally, so the remaining "click Open" is one explicit user (or
  // automated driver) action away.
  const deepLinkOpenAppRef = useRef(false);
  useEffect(() => {
    if (!deepLink?.openApp) return;
    if (deepLinkOpenAppRef.current) return;
    if (connectionStatus !== "connected") return;
    if (!availableTabs.includes("Apps")) return;
    const target = appTools.find((t) => t.name === deepLink.openApp);
    if (!target) return;
    deepLinkOpenAppRef.current = true;
    // Seed with the schema's defaults THEN overlay the deep-link's appArgs.
    // Without the defaults, a required field that the form would display with
    // its default value is absent from `formValues`, the schema-form's
    // validity check fails, and the Open App button is silently disabled —
    // an automated driver's click then no-ops and the iframe-wait spins
    // forever.
    const formValues = {
      ...collectSchemaDefaults(target.inputSchema),
      ...deepLink.appArgs,
    };
    onAppsUiChange({
      ...appsUi,
      selectedAppName: target.name,
      formValues,
    });
    onSelectApp(target.name);
    // `deepLink.autoOpen` is parsed and exposed for AppsScreen to consume
    // (the screen owns its `running` state and the iframe mount); calling
    // `onOpenApp` here would fire the tool call without mounting the
    // renderer, so the open is left to the screen layer.
  }, [
    deepLink,
    connectionStatus,
    availableTabs,
    appTools,
    appsUi,
    onAppsUiChange,
    onSelectApp,
  ]);

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

  return (
    // padding={0}: each screen fills `calc(100dvh - header)` and supplies its
    // own `xl` padding, so Main must contribute only the fixed-header offset.
    // Mantine's default `padding="md"` added an extra inset that pushed content
    // past the viewport and made the whole InspectorView scroll — the theme's
    // Main-slot height clamp + overflow:hidden keep that scroll on the inner
    // ScrollArea regions only.
    <AppShell header={{ height: 60 }} padding={0}>
      <AppShell.Header
        data-testid="connection-status"
        data-status={connectionStatus}
        data-error-message={connectErrorMessage}
      >
        {connectionStatus === "connected" && initializeResult ? (
          <ViewHeader
            connected
            serverInfo={initializeResult.serverInfo}
            status={connectionStatus}
            latencyMs={latencyMs}
            activeTab={activeTab}
            availableTabs={availableTabs}
            onTabChange={setSelectedTab}
            onDisconnect={onDisconnect}
            onToggleTheme={onToggleTheme}
          />
        ) : (
          <ViewHeader connected={false} onToggleTheme={onToggleTheme} />
        )}
      </AppShell.Header>
      <AppShell.Main>
        <ScreenStageContainer>
          <ScreenStage active={activeTab === SERVERS_TAB}>
            <ServerListScreen
              servers={servers}
              writable={serverListWritable}
              activeServer={activeServer}
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
              compact={serversCompact}
              onToggleCompact={() => setServersCompact((c) => !c)}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Tools"}>
            <ToolsScreen
              tools={tools}
              callState={toolCallState}
              ui={toolsUi}
              listChanged={toolsListChanged}
              serverSupportsTaskToolCalls={serverSupportsTaskToolCalls}
              onUiChange={onToolsUiChange}
              onRefreshList={onRefreshTools}
              onCallTool={onCallTool}
              onCancelCall={onCancelToolCall}
              onClearResult={onClearToolResult}
              onReadResource={onReadResourceContents}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Apps"} testId="apps-stage">
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
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Prompts"}>
            <PromptsScreen
              prompts={prompts}
              getPromptState={getPromptState}
              ui={promptsUi}
              listChanged={promptsListChanged}
              completionsSupported={completionsSupported}
              onUiChange={onPromptsUiChange}
              onRefreshList={onRefreshPrompts}
              onGetPrompt={onGetPrompt}
              onCopyMessages={onCopyPromptMessages}
              onCompleteArgument={onCompleteArgument}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Resources"}>
            <ResourcesScreen
              resources={resources}
              templates={resourceTemplates}
              subscriptions={subscriptions}
              readState={readResourceState}
              ui={resourcesUi}
              listChanged={resourcesListChanged}
              completionsSupported={completionsSupported}
              subscriptionsSupported={subscriptionsSupported}
              onUiChange={onResourcesUiChange}
              onRefreshList={onRefreshResources}
              onReadResource={onReadResource}
              onSubscribeResource={onSubscribeResource}
              onUnsubscribeResource={onUnsubscribeResource}
              onCompleteArgument={onCompleteArgument}
              compact={resourcesCompact}
              onCompactChange={setResourcesCompact}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Tasks"}>
            <TasksScreen
              tasks={tasks}
              progressByTaskId={progressByTaskId}
              ui={tasksUi}
              onUiChange={onTasksUiChange}
              onRefresh={onRefreshTasks}
              onClearCompleted={onClearCompletedTasks}
              onCancel={onCancelTask}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Logs"}>
            <LoggingScreen
              entries={logs}
              currentLevel={currentLogLevel}
              ui={logsUi}
              onUiChange={onLogsUiChange}
              onSetLevel={onSetLogLevel}
              onClear={onClearLogs}
              onExport={onExportLogs}
              sortDirection={logsSort}
              onSortChange={setLogsSort}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "History"}>
            <HistoryScreen
              entries={history}
              pinnedIds={pinnedHistoryIds ?? new Set()}
              ui={historyUi}
              onUiChange={onHistoryUiChange}
              onClearAll={onClearHistory}
              onExport={onExportHistory}
              onClearSection={onClearHistorySection}
              onExportSection={onExportHistorySection}
              onReplay={onReplayHistory}
              onTogglePin={onTogglePinHistory}
              sortDirection={historySort}
              onSortChange={setHistorySort}
              compact={historyCompact}
              onToggleCompact={() => setHistoryCompact((c) => !c)}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Network"}>
            <NetworkScreen
              entries={network}
              ui={networkUi}
              onUiChange={onNetworkUiChange}
              onClear={onClearNetwork}
              onExport={onExportNetwork}
              sortDirection={networkSort}
              onSortChange={setNetworkSort}
              compact={networkCompact}
              onToggleCompact={() => setNetworkCompact((c) => !c)}
            />
          </ScreenStage>
        </ScreenStageContainer>
      </AppShell.Main>
    </AppShell>
  );
}
