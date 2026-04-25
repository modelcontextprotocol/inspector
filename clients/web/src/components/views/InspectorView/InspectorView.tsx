import { useMemo, useState, type ReactNode } from "react";
import { AppShell, Box, Stack, Transition } from "@mantine/core";
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
  InspectorResourceSubscription,
  MessageEntry,
} from "@inspector/core/mcp/types.js";
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";
import {
  ServerListScreen,
  type ServerEntry,
} from "../../screens/ServerListScreen/ServerListScreen";
import { ToolsScreen } from "../../screens/ToolsScreen/ToolsScreen";
import { PromptsScreen } from "../../screens/PromptsScreen/PromptsScreen";
import { ResourcesScreen } from "../../screens/ResourcesScreen/ResourcesScreen";
import { LoggingScreen } from "../../screens/LoggingScreen/LoggingScreen";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import { TasksScreen } from "../../screens/TasksScreen/TasksScreen";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";
import { HistoryScreen } from "../../screens/HistoryScreen/HistoryScreen";

const SERVERS_TAB = "Servers";

const ALL_TABS: string[] = [
  SERVERS_TAB,
  "Tools",
  "Prompts",
  "Resources",
  "Tasks",
  "Logs",
  "History",
];

const SCREEN_TRANSITION_MS = 350;

const ScreenStageContainer = Stack.withProps({
  pos: "relative",
  gap: 0,
  flex: 1,
  mih: "100%",
});

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
      duration={SCREEN_TRANSITION_MS}
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

// Demo stub: every screen-action callback below resolves to noop. Phase 3
// wiring will replace each with its real `useManaged*` / `useConnection`
// hook call. Anything still pointing here in Phase 3 is unfinished.
const noop = () => undefined;

// Demo stub: simulated handshake delays and a sample of plausible failure
// reasons. Replace with real handshake telemetry once `useConnection` is wired.
const STUB_MIN_DELAY_MS = 50;
const STUB_MAX_DELAY_MS = 500;
const STUB_SUCCESS_RATE = 0.85;
const STUB_ERROR_MESSAGES = [
  "Connection refused",
  "Handshake timeout",
  "Protocol version mismatch",
  "Authentication required",
  "Server returned invalid response",
];

export interface InspectorViewProps {
  servers: ServerEntry[];
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  subscriptions: InspectorResourceSubscription[];
  logs: LogEntryData[];
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
  history: MessageEntry[];
  onToggleTheme: () => void;
}

export function InspectorView({
  servers: serversInput,
  tools,
  prompts,
  resources,
  resourceTemplates,
  subscriptions,
  logs,
  tasks,
  progressByTaskId,
  history,
  onToggleTheme,
}: InspectorViewProps) {
  const [activeServer, setActiveServer] = useState<string | undefined>(
    undefined,
  );
  const [initializeResult, setInitializeResult] = useState<
    InitializeResult | undefined
  >(undefined);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  const [activeTab, setActiveTab] = useState<string>(SERVERS_TAB);
  const [availableTabs, setAvailableTabs] = useState<string[]>([SERVERS_TAB]);
  const [logLevel, setLogLevel] = useState<LoggingLevel>("info");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // The view is the single source of truth for connection state. Any
  // `connection` field on incoming `serversInput` items is intentionally
  // ignored — cards mirror the global `connectionStatus` for the active
  // server and render as `disconnected` otherwise.
  const servers = useMemo<ServerEntry[]>(
    () =>
      serversInput.map((s) => {
        if (s.id !== activeServer) {
          return { ...s, connection: { status: "disconnected" } };
        }
        if (connectionStatus === "error" && errorMessage) {
          return {
            ...s,
            connection: {
              status: "error",
              error: { message: errorMessage },
            },
          };
        }
        return { ...s, connection: { status: connectionStatus } };
      }),
    [serversInput, activeServer, connectionStatus, errorMessage],
  );

  function disconnect() {
    setActiveServer(undefined);
    setConnectionStatus("disconnected");
    setInitializeResult(undefined);
    setLatencyMs(undefined);
    setErrorMessage(undefined);
    setAvailableTabs([SERVERS_TAB]);
    setActiveTab(SERVERS_TAB);
  }

  // Demo stub: simulates the full connect → connecting → connected/error
  // transition with a randomized handshake delay. Real wiring will dispatch
  // `useConnection.connect(id)` and let the hook drive these state changes.
  // The `protocolVersion`, `capabilities`, and `serverInfo` populated below
  // are placeholders until a real `InitializeResult` arrives from the server.
  function handleToggleConnection(id: string) {
    if (id === activeServer && connectionStatus === "connected") {
      disconnect();
      return;
    }
    const target = serversInput.find((s) => s.id === id);
    if (!target) return;

    // Capture `start` at the "connecting" edge and compute observed
    // latency at the "connected" edge. Both edges are owned by this
    // handler so the timing is deterministic — no useEffect chain needed
    // (which would otherwise trip `react-hooks/set-state-in-effect`).
    const start = Date.now();
    setActiveServer(id);
    setLatencyMs(undefined);
    setErrorMessage(undefined);
    setConnectionStatus("connecting");

    const delay =
      STUB_MIN_DELAY_MS +
      Math.floor(Math.random() * (STUB_MAX_DELAY_MS - STUB_MIN_DELAY_MS + 1));

    window.setTimeout(() => {
      if (Math.random() < STUB_SUCCESS_RATE) {
        setInitializeResult({
          protocolVersion: "2025-06-18",
          capabilities: {},
          serverInfo: target.info ?? { name: target.name, version: "0.0.0" },
        });
        setAvailableTabs(ALL_TABS);
        setLatencyMs(Date.now() - start);
        setConnectionStatus("connected");
      } else {
        setErrorMessage(
          STUB_ERROR_MESSAGES[
            Math.floor(Math.random() * STUB_ERROR_MESSAGES.length)
          ],
        );
        setConnectionStatus("error");
      }
    }, delay);
  }

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
            onTabChange={setActiveTab}
            onDisconnect={disconnect}
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
              onAddManually={noop}
              onImportConfig={noop}
              onImportServerJson={noop}
              onToggleConnection={handleToggleConnection}
              onServerInfo={noop}
              onSettings={noop}
              onEdit={noop}
              onClone={noop}
              onRemove={noop}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Tools"}>
            <ToolsScreen
              tools={tools}
              listChanged={false}
              onRefreshList={noop}
              onSelectTool={noop}
              onCallTool={noop}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Prompts"}>
            <PromptsScreen
              prompts={prompts}
              listChanged={false}
              onRefreshList={noop}
              onSelectPrompt={noop}
              onGetPrompt={noop}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Resources"}>
            <ResourcesScreen
              resources={resources}
              templates={resourceTemplates}
              subscriptions={subscriptions}
              listChanged={false}
              onRefreshList={noop}
              onSelectUri={noop}
              onSelectTemplate={noop}
              onReadResource={noop}
              onSubscribeResource={noop}
              onUnsubscribeResource={noop}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Tasks"}>
            <TasksScreen
              tasks={tasks}
              progressByTaskId={progressByTaskId}
              onRefresh={noop}
              onClearCompleted={noop}
              onCancel={noop}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "Logs"}>
            <LoggingScreen
              entries={logs}
              currentLevel={logLevel}
              onSetLevel={setLogLevel}
              onClear={noop}
              onExport={noop}
              autoScroll={autoScroll}
              onToggleAutoScroll={() => setAutoScroll((prev) => !prev)}
              onCopyAll={noop}
            />
          </ScreenStage>
          <ScreenStage active={activeTab === "History"}>
            <HistoryScreen
              entries={history}
              pinnedIds={new Set()}
              onClearAll={noop}
              onExport={noop}
              onReplay={noop}
              onTogglePin={noop}
            />
          </ScreenStage>
        </ScreenStageContainer>
      </AppShell.Main>
    </AppShell>
  );
}
