import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp, type Key } from "ink";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { MessageEntry } from "../../shared/mcp/index.js";
import { loadMcpServersConfig } from "../../shared/mcp/index.js";
import { InspectorClient } from "../../shared/mcp/index.js";
import { useInspectorClient } from "../../shared/react/useInspectorClient.js";
import { Tabs, type TabType, tabs as tabList } from "./components/Tabs.js";
import { InfoTab } from "./components/InfoTab.js";
import { ResourcesTab } from "./components/ResourcesTab.js";
import { PromptsTab } from "./components/PromptsTab.js";
import { ToolsTab } from "./components/ToolsTab.js";
import { NotificationsTab } from "./components/NotificationsTab.js";
import { HistoryTab } from "./components/HistoryTab.js";
import { ToolTestModal } from "./components/ToolTestModal.js";
import { DetailsModal } from "./components/DetailsModal.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get project info
// Strategy: Try multiple paths to handle both local dev and global install
// - Local dev (tsx): __dirname = src/, package.json is one level up
// - Global install: __dirname = dist/src/, package.json is two levels up
let packagePath: string;
let packageJson: { name: string; description: string; version: string };

try {
  // Try two levels up first (global install case)
  packagePath = join(__dirname, "..", "..", "package.json");
  packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
    name: string;
    description: string;
    version: string;
  };
} catch {
  // Fall back to one level up (local dev case)
  packagePath = join(__dirname, "..", "package.json");
  packageJson = JSON.parse(readFileSync(packagePath, "utf-8")) as {
    name: string;
    description: string;
    version: string;
  };
}

// Focus management types
type FocusArea =
  | "serverList"
  | "tabs"
  // Used by Resources/Prompts/Tools - list pane
  | "tabContentList"
  // Used by Resources/Prompts/Tools - details pane
  | "tabContentDetails"
  // Used only when activeTab === 'messages'
  | "messagesList"
  | "messagesDetail";

interface AppProps {
  configFile: string;
}

function App({ configFile }: AppProps) {
  const { exit } = useApp();

  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("info");
  const [focus, setFocus] = useState<FocusArea>("serverList");
  const [tabCounts, setTabCounts] = useState<{
    info?: number;
    resources?: number;
    prompts?: number;
    tools?: number;
    messages?: number;
    logging?: number;
  }>({});

  // Tool test modal state
  const [toolTestModal, setToolTestModal] = useState<{
    tool: any;
    client: Client | null;
  } | null>(null);

  // Details modal state
  const [detailsModal, setDetailsModal] = useState<{
    title: string;
    content: React.ReactNode;
  } | null>(null);

  // InspectorClient instances for each server
  const [inspectorClients, setInspectorClients] = useState<
    Record<string, InspectorClient>
  >({});
  const [dimensions, setDimensions] = useState({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      });
    };

    process.stdout.on("resize", updateDimensions);
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, []);

  // Parse MCP configuration
  const mcpConfig = useMemo(() => {
    try {
      return loadMcpServersConfig(configFile);
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error("Error loading configuration: Unknown error");
      }
      process.exit(1);
    }
  }, [configFile]);

  const serverNames = Object.keys(mcpConfig.mcpServers);
  const selectedServerConfig = selectedServer
    ? mcpConfig.mcpServers[selectedServer]
    : null;

  // Create InspectorClient instances for each server on mount
  useEffect(() => {
    const newClients: Record<string, InspectorClient> = {};
    for (const serverName of serverNames) {
      if (!(serverName in inspectorClients)) {
        const serverConfig = mcpConfig.mcpServers[serverName];
        newClients[serverName] = new InspectorClient(serverConfig, {
          maxMessages: 1000,
          maxStderrLogEvents: 1000,
          pipeStderr: true,
        });
      }
    }
    if (Object.keys(newClients).length > 0) {
      setInspectorClients((prev) => ({ ...prev, ...newClients }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup: disconnect all clients on unmount
  useEffect(() => {
    return () => {
      Object.values(inspectorClients).forEach((client) => {
        client.disconnect().catch(() => {
          // Ignore errors during cleanup
        });
      });
    };
  }, [inspectorClients]);

  // Preselect the first server on mount
  useEffect(() => {
    if (serverNames.length > 0 && selectedServer === null) {
      setSelectedServer(serverNames[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get InspectorClient for selected server
  const selectedInspectorClient = useMemo(
    () => (selectedServer ? inspectorClients[selectedServer] : null),
    [selectedServer, inspectorClients],
  );

  // Use the hook to get reactive state from InspectorClient
  const {
    status: inspectorStatus,
    messages: inspectorMessages,
    stderrLogs: inspectorStderrLogs,
    tools: inspectorTools,
    resources: inspectorResources,
    prompts: inspectorPrompts,
    capabilities: inspectorCapabilities,
    serverInfo: inspectorServerInfo,
    instructions: inspectorInstructions,
    client: inspectorClient,
    connect: connectInspector,
    disconnect: disconnectInspector,
  } = useInspectorClient(selectedInspectorClient);

  // Connect handler - InspectorClient now handles fetching server data automatically
  const handleConnect = useCallback(async () => {
    if (!selectedServer || !selectedInspectorClient) return;

    try {
      await connectInspector();
      // InspectorClient automatically fetches server data (capabilities, tools, resources, prompts, etc.)
      // on connect, so we don't need to do anything here
    } catch (error) {
      // Error handling is done by InspectorClient and will be reflected in status
    }
  }, [selectedServer, selectedInspectorClient, connectInspector]);

  // Disconnect handler
  const handleDisconnect = useCallback(async () => {
    if (!selectedServer) return;
    await disconnectInspector();
    // InspectorClient will update status automatically, and data is preserved
  }, [selectedServer, disconnectInspector]);

  // Build current server state from InspectorClient data
  const currentServerState = useMemo(() => {
    if (!selectedServer) return null;
    return {
      status: inspectorStatus,
      error: null, // InspectorClient doesn't track error in state, only emits error events
      capabilities: inspectorCapabilities,
      serverInfo: inspectorServerInfo,
      instructions: inspectorInstructions,
      resources: inspectorResources,
      prompts: inspectorPrompts,
      tools: inspectorTools,
      stderrLogs: inspectorStderrLogs, // InspectorClient manages this
    };
  }, [
    selectedServer,
    inspectorStatus,
    inspectorCapabilities,
    inspectorServerInfo,
    inspectorInstructions,
    inspectorResources,
    inspectorPrompts,
    inspectorTools,
    inspectorStderrLogs,
  ]);

  // Helper functions to render details modal content
  const renderResourceDetails = (resource: any) => (
    <>
      {resource.description && (
        <>
          {resource.description.split("\n").map((line: string, idx: number) => (
            <Box
              key={`desc-${idx}`}
              marginTop={idx === 0 ? 0 : 0}
              flexShrink={0}
            >
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}
      {resource.uri && (
        <Box marginTop={1} flexShrink={0}>
          <Text bold>URI:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{resource.uri}</Text>
          </Box>
        </Box>
      )}
      {resource.mimeType && (
        <Box marginTop={1} flexShrink={0}>
          <Text bold>MIME Type:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{resource.mimeType}</Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1} flexShrink={0} flexDirection="column">
        <Text bold>Full JSON:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(resource, null, 2)}</Text>
        </Box>
      </Box>
    </>
  );

  const renderPromptDetails = (prompt: any) => (
    <>
      {prompt.description && (
        <>
          {prompt.description.split("\n").map((line: string, idx: number) => (
            <Box
              key={`desc-${idx}`}
              marginTop={idx === 0 ? 0 : 0}
              flexShrink={0}
            >
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}
      {prompt.arguments && prompt.arguments.length > 0 && (
        <>
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Arguments:</Text>
          </Box>
          {prompt.arguments.map((arg: any, idx: number) => (
            <Box
              key={`arg-${idx}`}
              marginTop={1}
              paddingLeft={2}
              flexShrink={0}
            >
              <Text dimColor>
                - {arg.name}: {arg.description || arg.type || "string"}
              </Text>
            </Box>
          ))}
        </>
      )}
      <Box marginTop={1} flexShrink={0} flexDirection="column">
        <Text bold>Full JSON:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(prompt, null, 2)}</Text>
        </Box>
      </Box>
    </>
  );

  const renderToolDetails = (tool: any) => (
    <>
      {tool.description && (
        <>
          {tool.description.split("\n").map((line: string, idx: number) => (
            <Box
              key={`desc-${idx}`}
              marginTop={idx === 0 ? 0 : 0}
              flexShrink={0}
            >
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}
      {tool.inputSchema && (
        <Box marginTop={1} flexShrink={0} flexDirection="column">
          <Text bold>Input Schema:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{JSON.stringify(tool.inputSchema, null, 2)}</Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1} flexShrink={0} flexDirection="column">
        <Text bold>Full JSON:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(tool, null, 2)}</Text>
        </Box>
      </Box>
    </>
  );

  const renderMessageDetails = (message: MessageEntry) => (
    <>
      <Box flexShrink={0}>
        <Text bold>Direction: {message.direction}</Text>
      </Box>
      {message.duration !== undefined && (
        <Box marginTop={1} flexShrink={0}>
          <Text dimColor>Duration: {message.duration}ms</Text>
        </Box>
      )}
      {message.direction === "request" ? (
        <>
          <Box marginTop={1} flexShrink={0} flexDirection="column">
            <Text bold>Request:</Text>
            <Box paddingLeft={2}>
              <Text dimColor>{JSON.stringify(message.message, null, 2)}</Text>
            </Box>
          </Box>
          {message.response && (
            <Box marginTop={1} flexShrink={0} flexDirection="column">
              <Text bold>Response:</Text>
              <Box paddingLeft={2}>
                <Text dimColor>
                  {JSON.stringify(message.response, null, 2)}
                </Text>
              </Box>
            </Box>
          )}
        </>
      ) : (
        <Box marginTop={1} flexShrink={0} flexDirection="column">
          <Text bold>
            {message.direction === "response" ? "Response:" : "Notification:"}
          </Text>
          <Box paddingLeft={2}>
            <Text dimColor>{JSON.stringify(message.message, null, 2)}</Text>
          </Box>
        </Box>
      )}
    </>
  );

  // Update tab counts when selected server changes or InspectorClient state changes
  // Just reflect InspectorClient state - don't try to be clever
  useEffect(() => {
    if (!selectedServer) {
      return;
    }

    setTabCounts({
      resources: inspectorResources.length || 0,
      prompts: inspectorPrompts.length || 0,
      tools: inspectorTools.length || 0,
      messages: inspectorMessages.length || 0,
      logging: inspectorStderrLogs.length || 0,
    });
  }, [
    selectedServer,
    inspectorResources,
    inspectorPrompts,
    inspectorTools,
    inspectorMessages,
    inspectorStderrLogs,
  ]);

  // Keep focus state consistent when switching tabs
  useEffect(() => {
    if (activeTab === "messages") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("messagesList");
      }
    } else {
      if (focus === "messagesList" || focus === "messagesDetail") {
        setFocus("tabContentList");
      }
    }
  }, [activeTab]); // intentionally not depending on focus to avoid loops

  // Switch away from logging tab if server is not stdio
  useEffect(() => {
    if (activeTab === "logging" && selectedServer) {
      const client = inspectorClients[selectedServer];
      if (client && client.getServerType() !== "stdio") {
        setActiveTab("info");
      }
    }
  }, [selectedServer, activeTab, inspectorClients]);

  useInput((input: string, key: Key) => {
    // Don't process input when modal is open
    if (toolTestModal || detailsModal) {
      return;
    }

    if (key.ctrl && input === "c") {
      exit();
    }

    // Exit accelerators
    if (key.escape) {
      exit();
    }

    // Tab switching with accelerator keys (first character of tab name)
    const tabAccelerators: Record<string, TabType> = Object.fromEntries(
      tabList.map(
        (tab: { id: TabType; label: string; accelerator: string }) => [
          tab.accelerator,
          tab.id,
        ],
      ),
    );
    if (tabAccelerators[input.toLowerCase()]) {
      setActiveTab(tabAccelerators[input.toLowerCase()]);
      setFocus("tabs");
    } else if (key.tab && !key.shift) {
      // Flat focus order: servers -> tabs -> list -> details -> wrap to servers
      const focusOrder: FocusArea[] =
        activeTab === "messages"
          ? ["serverList", "tabs", "messagesList", "messagesDetail"]
          : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const nextIndex = (currentIndex + 1) % focusOrder.length;
      setFocus(focusOrder[nextIndex]);
    } else if (key.tab && key.shift) {
      // Reverse order: servers <- tabs <- list <- details <- wrap to servers
      const focusOrder: FocusArea[] =
        activeTab === "messages"
          ? ["serverList", "tabs", "messagesList", "messagesDetail"]
          : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const prevIndex =
        currentIndex > 0 ? currentIndex - 1 : focusOrder.length - 1;
      setFocus(focusOrder[prevIndex]);
    } else if (key.upArrow || key.downArrow) {
      // Arrow keys only work in the focused pane
      if (focus === "serverList") {
        // Arrow key navigation for server list
        if (key.upArrow) {
          if (selectedServer === null) {
            setSelectedServer(serverNames[serverNames.length - 1] || null);
          } else {
            const currentIndex = serverNames.indexOf(selectedServer);
            const newIndex =
              currentIndex > 0 ? currentIndex - 1 : serverNames.length - 1;
            setSelectedServer(serverNames[newIndex] || null);
          }
        } else if (key.downArrow) {
          if (selectedServer === null) {
            setSelectedServer(serverNames[0] || null);
          } else {
            const currentIndex = serverNames.indexOf(selectedServer);
            const newIndex =
              currentIndex < serverNames.length - 1 ? currentIndex + 1 : 0;
            setSelectedServer(serverNames[newIndex] || null);
          }
        }
        return; // Handled, don't let other handlers process
      }
      // If focus is on tabs, tabContentList, tabContentDetails, messagesList, or messagesDetail,
      // arrow keys will be handled by those components - don't do anything here
    } else if (focus === "tabs" && (key.leftArrow || key.rightArrow)) {
      // Left/Right arrows switch tabs when tabs are focused
      const tabs: TabType[] = [
        "info",
        "resources",
        "prompts",
        "tools",
        "messages",
        "logging",
      ];
      const currentIndex = tabs.indexOf(activeTab);
      if (key.leftArrow) {
        const newIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        setActiveTab(tabs[newIndex]);
      } else if (key.rightArrow) {
        const newIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        setActiveTab(tabs[newIndex]);
      }
    }

    // Accelerator keys for connect/disconnect (work from anywhere)
    if (selectedServer) {
      if (
        input.toLowerCase() === "c" &&
        (inspectorStatus === "disconnected" || inspectorStatus === "error")
      ) {
        handleConnect();
      } else if (
        input.toLowerCase() === "d" &&
        (inspectorStatus === "connected" || inspectorStatus === "connecting")
      ) {
        handleDisconnect();
      }
    }
  });

  // Calculate layout dimensions
  const headerHeight = 1;
  const tabsHeight = 1;
  // Server details will be flexible - calculate remaining space for content
  const availableHeight = dimensions.height - headerHeight - tabsHeight;
  // Reserve space for server details (will grow as needed, but we'll use flexGrow)
  const serverDetailsMinHeight = 3;
  const contentHeight = availableHeight - serverDetailsMinHeight;
  const serverListWidth = Math.floor(dimensions.width * 0.3);
  const contentWidth = dimensions.width - serverListWidth;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "green";
      case "connecting":
        return "yellow";
      case "error":
        return "red";
      default:
        return "gray";
    }
  };

  const getStatusSymbol = (status: string) => {
    switch (status) {
      case "connected":
        return "●";
      case "connecting":
        return "◐";
      case "error":
        return "✗";
      default:
        return "○";
    }
  };

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
    >
      {/* Header row across the top */}
      <Box
        width={dimensions.width}
        height={headerHeight}
        borderStyle="single"
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Text bold color="cyan">
            {packageJson.name}
          </Text>
          <Text dimColor> - {packageJson.description}</Text>
        </Box>
        <Text dimColor>v{packageJson.version}</Text>
      </Box>

      {/* Main content area */}
      <Box
        flexDirection="row"
        height={availableHeight + tabsHeight}
        width={dimensions.width}
      >
        {/* Left column - Server list */}
        <Box
          width={serverListWidth}
          height={availableHeight + tabsHeight}
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          borderRight={true}
          flexDirection="column"
          paddingX={1}
        >
          <Box marginTop={1} marginBottom={1}>
            <Text
              bold
              backgroundColor={focus === "serverList" ? "yellow" : undefined}
            >
              MCP Servers
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {serverNames.map((serverName) => {
              const isSelected = selectedServer === serverName;
              return (
                <Box key={serverName} paddingY={0}>
                  <Text>
                    {isSelected ? "▶ " : "  "}
                    {serverName}
                  </Text>
                </Box>
              );
            })}
          </Box>

          {/* Fixed footer */}
          <Box
            flexShrink={0}
            height={1}
            justifyContent="center"
            backgroundColor="gray"
          >
            <Text bold color="white">
              ESC to exit
            </Text>
          </Box>
        </Box>

        {/* Right column - Server details, Tabs and content */}
        <Box
          flexGrow={1}
          height={availableHeight + tabsHeight}
          flexDirection="column"
        >
          {/* Server Details - Flexible height */}
          <Box
            width={contentWidth}
            borderStyle="single"
            borderTop={false}
            borderLeft={false}
            borderRight={false}
            borderBottom={true}
            paddingX={1}
            paddingY={1}
            flexDirection="column"
            flexShrink={0}
          >
            <Box flexDirection="column">
              <Box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Text bold color="cyan">
                  {selectedServer}
                </Text>
                <Box flexDirection="row" alignItems="center">
                  {currentServerState && (
                    <>
                      <Text color={getStatusColor(currentServerState.status)}>
                        {getStatusSymbol(currentServerState.status)}{" "}
                        {currentServerState.status}
                      </Text>
                      <Text> </Text>
                      {(currentServerState?.status === "disconnected" ||
                        currentServerState?.status === "error") && (
                        <Text color="cyan" bold>
                          [<Text underline>C</Text>onnect]
                        </Text>
                      )}
                      {(currentServerState?.status === "connected" ||
                        currentServerState?.status === "connecting") && (
                        <Text color="red" bold>
                          [<Text underline>D</Text>isconnect]
                        </Text>
                      )}
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Tabs */}
          <Tabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            width={contentWidth}
            counts={tabCounts}
            focused={focus === "tabs"}
            showLogging={
              selectedServer && inspectorClients[selectedServer]
                ? inspectorClients[selectedServer].getServerType() === "stdio"
                : false
            }
          />

          {/* Tab Content */}
          <Box
            flexGrow={1}
            width={contentWidth}
            borderTop={false}
            borderLeft={false}
            borderRight={false}
            borderBottom={false}
          >
            {activeTab === "info" && (
              <InfoTab
                serverName={selectedServer}
                serverConfig={selectedServerConfig}
                serverState={currentServerState}
                width={contentWidth}
                height={contentHeight}
                focused={
                  focus === "tabContentList" || focus === "tabContentDetails"
                }
              />
            )}
            {activeTab === "resources" &&
            currentServerState?.status === "connected" &&
            inspectorClient ? (
              <ResourcesTab
                key={`resources-${selectedServer}`}
                resources={currentServerState.resources}
                client={inspectorClient}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, resources: count }))
                }
                focusedPane={
                  focus === "tabContentDetails"
                    ? "details"
                    : focus === "tabContentList"
                      ? "list"
                      : null
                }
                onViewDetails={(resource) =>
                  setDetailsModal({
                    title: `Resource: ${resource.name || resource.uri || "Unknown"}`,
                    content: renderResourceDetails(resource),
                  })
                }
                modalOpen={!!(toolTestModal || detailsModal)}
              />
            ) : activeTab === "prompts" &&
              currentServerState?.status === "connected" &&
              inspectorClient ? (
              <PromptsTab
                key={`prompts-${selectedServer}`}
                prompts={currentServerState.prompts}
                client={inspectorClient}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, prompts: count }))
                }
                focusedPane={
                  focus === "tabContentDetails"
                    ? "details"
                    : focus === "tabContentList"
                      ? "list"
                      : null
                }
                onViewDetails={(prompt) =>
                  setDetailsModal({
                    title: `Prompt: ${prompt.name || "Unknown"}`,
                    content: renderPromptDetails(prompt),
                  })
                }
                modalOpen={!!(toolTestModal || detailsModal)}
              />
            ) : activeTab === "tools" &&
              currentServerState?.status === "connected" &&
              inspectorClient ? (
              <ToolsTab
                key={`tools-${selectedServer}`}
                tools={currentServerState.tools}
                client={inspectorClient}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, tools: count }))
                }
                focusedPane={
                  focus === "tabContentDetails"
                    ? "details"
                    : focus === "tabContentList"
                      ? "list"
                      : null
                }
                onTestTool={(tool) =>
                  setToolTestModal({ tool, client: inspectorClient })
                }
                onViewDetails={(tool) =>
                  setDetailsModal({
                    title: `Tool: ${tool.name || "Unknown"}`,
                    content: renderToolDetails(tool),
                  })
                }
                modalOpen={!!(toolTestModal || detailsModal)}
              />
            ) : activeTab === "messages" && selectedInspectorClient ? (
              <HistoryTab
                serverName={selectedServer}
                messages={inspectorMessages}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, messages: count }))
                }
                focusedPane={
                  focus === "messagesDetail"
                    ? "details"
                    : focus === "messagesList"
                      ? "messages"
                      : null
                }
                modalOpen={!!(toolTestModal || detailsModal)}
                onViewDetails={(message) => {
                  const label =
                    message.direction === "request" &&
                    "method" in message.message
                      ? message.message.method
                      : message.direction === "response"
                        ? "Response"
                        : message.direction === "notification" &&
                            "method" in message.message
                          ? message.message.method
                          : "Message";
                  setDetailsModal({
                    title: `Message: ${label}`,
                    content: renderMessageDetails(message),
                  });
                }}
              />
            ) : activeTab === "logging" && selectedInspectorClient ? (
              <NotificationsTab
                client={inspectorClient}
                stderrLogs={inspectorStderrLogs}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, logging: count }))
                }
                focused={
                  focus === "tabContentList" || focus === "tabContentDetails"
                }
              />
            ) : activeTab !== "info" && selectedServer ? (
              <Box paddingX={1} paddingY={1}>
                <Text dimColor>Server not connected</Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>

      {/* Tool Test Modal - rendered at App level for full screen overlay */}
      {toolTestModal && (
        <ToolTestModal
          tool={toolTestModal.tool}
          client={toolTestModal.client}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setToolTestModal(null)}
        />
      )}

      {/* Details Modal - rendered at App level for full screen overlay */}
      {detailsModal && (
        <DetailsModal
          title={detailsModal.title}
          content={detailsModal.content}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setDetailsModal(null)}
        />
      )}
    </Box>
  );
}

export default App;
