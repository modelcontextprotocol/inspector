import { useMemo, useState } from "react";
import { AppShell } from "@mantine/core";
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
  "Logs",
  "Tasks",
  "History",
];

const noop = () => undefined;

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
  const [activeTab, setActiveTab] = useState<string>(SERVERS_TAB);
  const [availableTabs, setAvailableTabs] = useState<string[]>([SERVERS_TAB]);
  const [logLevel, setLogLevel] = useState<LoggingLevel>("info");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // Per-card connection state derives from "is this the active server,
  // and what's our current global connection status?". Cards that aren't
  // the active server always render as disconnected.
  const servers = useMemo<ServerEntry[]>(
    () =>
      serversInput.map((s) => ({
        ...s,
        connection:
          s.id === activeServer
            ? { status: connectionStatus }
            : { status: "disconnected" },
      })),
    [serversInput, activeServer, connectionStatus],
  );

  function disconnect() {
    setActiveServer(undefined);
    setConnectionStatus("disconnected");
    setInitializeResult(undefined);
    setLatencyMs(undefined);
    setAvailableTabs([SERVERS_TAB]);
    setActiveTab(SERVERS_TAB);
  }

  function handleToggleConnection(id: string) {
    if (id === activeServer && connectionStatus === "connected") {
      disconnect();
      return;
    }
    const target = serversInput.find((s) => s.id === id);
    if (!target) return;
    setActiveServer(id);
    setConnectionStatus("connected");
    setInitializeResult({
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: target.info ?? { name: target.name, version: "0.0.0" },
    });
    setLatencyMs(42);
    setAvailableTabs(ALL_TABS);
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
        {activeTab === SERVERS_TAB && (
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
        )}
        {activeTab === "Tools" && (
          <ToolsScreen
            tools={tools}
            listChanged={false}
            onRefreshList={noop}
            onSelectTool={noop}
            onCallTool={noop}
          />
        )}
        {activeTab === "Prompts" && (
          <PromptsScreen
            prompts={prompts}
            listChanged={false}
            onRefreshList={noop}
            onSelectPrompt={noop}
            onGetPrompt={noop}
          />
        )}
        {activeTab === "Resources" && (
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
        )}
        {activeTab === "Logs" && (
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
        )}
        {activeTab === "Tasks" && (
          <TasksScreen
            tasks={tasks}
            progressByTaskId={progressByTaskId}
            onRefresh={noop}
            onClearCompleted={noop}
            onCancel={noop}
          />
        )}
        {activeTab === "History" && (
          <HistoryScreen
            entries={history}
            pinnedIds={new Set()}
            onClearAll={noop}
            onExport={noop}
            onReplay={noop}
            onTogglePin={noop}
          />
        )}
      </AppShell.Main>
    </AppShell>
  );
}
