import { useMemo, useState, type ReactNode, type Ref } from "react";
import { AppShell, Box, Stack, Transition } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import type {
  InitializeResult,
  LoggingLevel,
  Prompt,
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
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";
import { ServerListScreen } from "../../screens/ServerListScreen/ServerListScreen";
import {
  ToolsScreen,
  type ToolCallState,
} from "../../screens/ToolsScreen/ToolsScreen";
import { AppsScreen } from "../../screens/AppsScreen/AppsScreen";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import {
  PromptsScreen,
  type GetPromptState,
} from "../../screens/PromptsScreen/PromptsScreen";
import {
  ResourcesScreen,
  type ReadResourceState,
} from "../../screens/ResourcesScreen/ResourcesScreen";
import { LoggingScreen } from "../../screens/LoggingScreen/LoggingScreen";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import { TasksScreen } from "../../screens/TasksScreen/TasksScreen";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";
import { HistoryScreen } from "../../screens/HistoryScreen/HistoryScreen";
import { NetworkScreen } from "../../screens/NetworkScreen/NetworkScreen";
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
  "Tools",
  "Apps",
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
  children,
}: {
  active: boolean;
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
        <Box style={styles} pos="absolute" top={0} left={0} right={0}>
          {children}
        </Box>
      )}
    </Transition>
  );
}

export interface InspectorViewProps {
  // Server list (static config; runtime connection state comes from the
  // separate fields below and is merged into each card by this component).
  servers: ServerEntry[];

  // Connection state — driven by the parent via `useInspectorClient`.
  activeServer?: string;
  connectionStatus: ConnectionStatus;
  initializeResult?: InitializeResult;
  latencyMs?: number;

  // Primitive lists, log streams, task state — all sourced from the
  // per-primitive `useManaged*` / `useMessageLog` hooks in the parent.
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];
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

  // Per-primitive actions (route to `inspectorClient` methods / hook refresh).
  onCallTool: (name: string, args: Record<string, unknown>) => void;
  onCancelToolCall?: () => void;
  onClearToolResult?: () => void;
  onRefreshTools: () => void;

  onGetPrompt: (name: string, args: Record<string, string>) => void;
  onCopyPromptMessages?: () => void;
  onRefreshPrompts: () => void;

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

  onCancelTask: (taskId: string) => void;
  onClearCompletedTasks: () => void;
  onRefreshTasks: () => void;

  onSetLogLevel: (level: LoggingLevel) => void;
  onClearLogs: () => void;
  onExportLogs: () => void;

  onClearHistory: () => void;
  onExportHistory: () => void;
  onReplayHistory: (id: string) => void;
  onTogglePinHistory: (id: string) => void;

  onClearNetwork: () => void;
  onExportNetwork: () => void;

  onSelectApp: (name: string) => void;
  onOpenApp: (name: string, args: Record<string, unknown>) => void;
  onCloseApp: () => void;
  onAppError: (err: Error) => void;
  onRefreshApps: () => void;
}

export function InspectorView({
  servers: serversInput,
  activeServer,
  connectionStatus,
  initializeResult,
  latencyMs,
  tools,
  prompts,
  resources,
  resourceTemplates,
  subscriptions,
  logs,
  tasks,
  progressByTaskId,
  history,
  network,
  toolCallState,
  getPromptState,
  readResourceState,
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
  onCallTool,
  onCancelToolCall,
  onClearToolResult,
  onRefreshTools,
  onGetPrompt,
  onCopyPromptMessages,
  onRefreshPrompts,
  onReadResource,
  onSubscribeResource,
  onUnsubscribeResource,
  onRefreshResources,
  onCompleteArgument,
  completionsSupported,
  onCancelTask,
  onClearCompletedTasks,
  onRefreshTasks,
  onSetLogLevel,
  onClearLogs,
  onExportLogs,
  onClearHistory,
  onExportHistory,
  onReplayHistory,
  onTogglePinHistory,
  onClearNetwork,
  onExportNetwork,
  onSelectApp,
  onOpenApp,
  onCloseApp,
  onAppError,
  onRefreshApps,
}: InspectorViewProps) {
  // UI-only state. Connection state, primitive lists, and all action
  // dispatching live in the parent; this component only owns navigation
  // (which tab is visible) and a couple of view-local toggles.
  const [selectedTab, setSelectedTab] = useState<string>(SERVERS_TAB);

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

  // Only show the non-Servers tabs when actually connected. Network is
  // additionally hidden for stdio servers — there is no HTTP traffic to
  // surface there, so the tab would always be empty. Capability-aware
  // tab gating (hide Tools when the server doesn't advertise `tools`, etc.)
  // can layer in later once the parent passes capabilities through.
  const availableTabs = useMemo<string[]>(() => {
    if (connectionStatus !== "connected") return [SERVERS_TAB];
    const active = serversInput.find((s) => s.id === activeServer);
    const isStdio = active ? getServerType(active.config) === "stdio" : false;
    return isStdio ? ALL_TABS.filter((t) => t !== NETWORK_TAB) : ALL_TABS;
  }, [connectionStatus, serversInput, activeServer]);

  // Clamp the rendered tab to whatever's currently available. If the user
  // had "Tools" selected and the connection drops, `availableTabs` becomes
  // `[Servers]` and the view renders Servers without us having to imperatively
  // reset the state (and trip the `set-state-in-effect` lint). When the
  // connection comes back, the previous selection pops in again because
  // `selectedTab` is preserved.
  const activeTab = availableTabs.includes(selectedTab)
    ? selectedTab
    : SERVERS_TAB;

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
        return { ...s, connection: { status: connectionStatus } };
      }),
    [serversInput, activeServer, connectionStatus],
  );

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
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
              compact={serversCompact}
              onToggleCompact={() => setServersCompact((c) => !c)}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Tools"}>
            <ToolsScreen
              tools={tools}
              callState={toolCallState}
              listChanged={false}
              onRefreshList={onRefreshTools}
              onCallTool={onCallTool}
              onCancelCall={onCancelToolCall}
              onClearResult={onClearToolResult}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Apps"}>
            <AppsScreen
              tools={appTools}
              listChanged={false}
              sandboxPath={sandboxPath}
              bridgeFactory={bridgeFactory}
              rendererRef={appRendererRef}
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
              listChanged={false}
              completionsSupported={completionsSupported}
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
              listChanged={false}
              completionsSupported={completionsSupported}
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
              onRefresh={onRefreshTasks}
              onClearCompleted={onClearCompletedTasks}
              onCancel={onCancelTask}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Logs"}>
            <LoggingScreen
              entries={logs}
              currentLevel={currentLogLevel}
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
              onClearAll={onClearHistory}
              onExport={onExportHistory}
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
