import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp, type Key } from "ink";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type {
  MCPConfig,
  ServerState,
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "./types.js";
import { loadMcpServersConfig } from "./utils/config.js";
import type { FocusArea } from "./types/focus.js";
import { useMCPClient, LoggingProxyTransport } from "./hooks/useMCPClient.js";
import { useMessageTracking } from "./hooks/useMessageTracking.js";
import { Tabs, type TabType, tabs as tabList } from "./components/Tabs.js";
import { InfoTab } from "./components/InfoTab.js";
import { ResourcesTab } from "./components/ResourcesTab.js";
import { PromptsTab } from "./components/PromptsTab.js";
import { ToolsTab } from "./components/ToolsTab.js";
import { NotificationsTab } from "./components/NotificationsTab.js";
import { HistoryTab } from "./components/HistoryTab.js";
import { ToolTestModal } from "./components/ToolTestModal.js";
import { DetailsModal } from "./components/DetailsModal.js";
import type { MessageEntry } from "./types/messages.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createTransport, getServerType } from "./utils/transport.js";
import { createClient } from "./utils/client.js";

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

  // Server state management - store state for all servers
  const [serverStates, setServerStates] = useState<Record<string, ServerState>>(
    {},
  );
  const [serverClients, setServerClients] = useState<
    Record<string, Client | null>
  >({});

  // Message tracking
  const {
    history: messageHistory,
    trackRequest,
    trackResponse,
    trackNotification,
    clearHistory,
  } = useMessageTracking();
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

  // Preselect the first server on mount
  useEffect(() => {
    if (serverNames.length > 0 && selectedServer === null) {
      setSelectedServer(serverNames[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize server states for all configured servers on mount
  useEffect(() => {
    const initialStates: Record<string, ServerState> = {};
    for (const serverName of serverNames) {
      if (!(serverName in serverStates)) {
        initialStates[serverName] = {
          status: "disconnected",
          error: null,
          capabilities: {},
          serverInfo: undefined,
          instructions: undefined,
          resources: [],
          prompts: [],
          tools: [],
          stderrLogs: [],
        };
      }
    }
    if (Object.keys(initialStates).length > 0) {
      setServerStates((prev) => ({ ...prev, ...initialStates }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoize message tracking callbacks to prevent unnecessary re-renders
  const messageTracking = useMemo(() => {
    if (!selectedServer) return undefined;
    return {
      trackRequest: (msg: any) => trackRequest(selectedServer, msg),
      trackResponse: (msg: any) => trackResponse(selectedServer, msg),
      trackNotification: (msg: any) => trackNotification(selectedServer, msg),
    };
  }, [selectedServer, trackRequest, trackResponse, trackNotification]);

  // Get client for selected server (for connection management)
  const {
    connection,
    connect: connectClient,
    disconnect: disconnectClient,
  } = useMCPClient(selectedServer, selectedServerConfig, messageTracking);

  // Helper function to create the appropriate transport with stderr logging
  const createTransportWithLogging = useCallback(
    (config: MCPServerConfig, serverName: string) => {
      return createTransport(config, {
        pipeStderr: true,
        onStderr: (entry) => {
          setServerStates((prev) => {
            const existingState = prev[serverName];
            if (!existingState) {
              // Initialize state if it doesn't exist yet
              return {
                ...prev,
                [serverName]: {
                  status: "connecting" as const,
                  error: null,
                  capabilities: {},
                  serverInfo: undefined,
                  instructions: undefined,
                  resources: [],
                  prompts: [],
                  tools: [],
                  stderrLogs: [entry],
                },
              };
            }

            return {
              ...prev,
              [serverName]: {
                ...existingState,
                stderrLogs: [...(existingState.stderrLogs || []), entry].slice(
                  -1000,
                ), // Keep last 1000 log entries
              },
            };
          });
        },
      });
    },
    [],
  );

  // Connect handler - connects, gets capabilities, and queries resources/prompts/tools
  const handleConnect = useCallback(async () => {
    if (!selectedServer || !selectedServerConfig) return;

    // Capture server name immediately to avoid closure issues
    const serverName = selectedServer;
    const serverConfig = selectedServerConfig;

    // Clear all data when connecting/reconnecting to start fresh
    clearHistory(serverName);

    // Clear stderr logs BEFORE connecting
    setServerStates((prev) => ({
      ...prev,
      [serverName]: {
        ...(prev[serverName] || {
          status: "disconnected" as const,
          error: null,
          capabilities: {},
          resources: [],
          prompts: [],
          tools: [],
        }),
        status: "connecting" as const,
        stderrLogs: [], // Clear logs before connecting
      },
    }));

    // Create the appropriate transport with stderr logging
    const { transport: baseTransport } = createTransportWithLogging(
      serverConfig,
      serverName,
    );

    // Wrap with proxy transport if message tracking is enabled
    const transport = messageTracking
      ? new LoggingProxyTransport(baseTransport, messageTracking)
      : baseTransport;

    const client = createClient(transport);

    try {
      await client.connect(transport);

      // Store client immediately
      setServerClients((prev) => ({ ...prev, [serverName]: client }));

      // Get server capabilities
      const serverCapabilities = client.getServerCapabilities() || {};
      const capabilities = {
        resources: !!serverCapabilities.resources,
        prompts: !!serverCapabilities.prompts,
        tools: !!serverCapabilities.tools,
      };

      // Get server info (name, version) and instructions
      const serverVersion = client.getServerVersion();
      const serverInfo = serverVersion
        ? {
            name: serverVersion.name,
            version: serverVersion.version,
          }
        : undefined;
      const instructions = client.getInstructions();

      // Query resources, prompts, and tools based on capabilities
      let resources: any[] = [];
      let prompts: any[] = [];
      let tools: any[] = [];

      if (capabilities.resources) {
        try {
          const result = await client.listResources();
          resources = result.resources || [];
        } catch (err) {
          // Ignore errors, just leave empty
        }
      }

      if (capabilities.prompts) {
        try {
          const result = await client.listPrompts();
          prompts = result.prompts || [];
        } catch (err) {
          // Ignore errors, just leave empty
        }
      }

      if (capabilities.tools) {
        try {
          const result = await client.listTools();
          tools = result.tools || [];
        } catch (err) {
          // Ignore errors, just leave empty
        }
      }

      // Update server state - use captured serverName to ensure we update the correct server
      // Preserve stderrLogs that were captured during connection (after we cleared them before connecting)
      setServerStates((prev) => ({
        ...prev,
        [serverName]: {
          status: "connected" as const,
          error: null,
          capabilities,
          serverInfo,
          instructions,
          resources,
          prompts,
          tools,
          stderrLogs: prev[serverName]?.stderrLogs || [], // Preserve logs captured during connection
        },
      }));
    } catch (error) {
      // Make sure we clean up the client on error
      try {
        await client.close();
      } catch (closeErr) {
        // Ignore close errors
      }

      setServerStates((prev) => ({
        ...prev,
        [serverName]: {
          ...(prev[serverName] || {
            status: "disconnected" as const,
            error: null,
            capabilities: {},
            resources: [],
            prompts: [],
            tools: [],
          }),
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      }));
    }
  }, [selectedServer, selectedServerConfig, messageTracking]);

  // Disconnect handler
  const handleDisconnect = useCallback(async () => {
    if (!selectedServer) return;

    await disconnectClient();

    setServerClients((prev) => {
      const newClients = { ...prev };
      delete newClients[selectedServer];
      return newClients;
    });

    // Preserve all data when disconnecting - only change status
    setServerStates((prev) => ({
      ...prev,
      [selectedServer]: {
        ...prev[selectedServer],
        status: "disconnected",
        error: null,
        // Keep all existing data: capabilities, serverInfo, instructions, resources, prompts, tools, stderrLogs
      },
    }));

    // Update tab counts based on preserved data
    const preservedState = serverStates[selectedServer];
    if (preservedState) {
      setTabCounts((prev) => ({
        ...prev,
        resources: preservedState.resources?.length || 0,
        prompts: preservedState.prompts?.length || 0,
        tools: preservedState.tools?.length || 0,
        messages: messageHistory[selectedServer]?.length || 0,
        logging: preservedState.stderrLogs?.length || 0,
      }));
    }
  }, [selectedServer, disconnectClient, serverStates, messageHistory]);

  const currentServerMessages = useMemo(
    () => (selectedServer ? messageHistory[selectedServer] || [] : []),
    [selectedServer, messageHistory],
  );

  const currentServerState = useMemo(
    () => (selectedServer ? serverStates[selectedServer] || null : null),
    [selectedServer, serverStates],
  );

  const currentServerClient = useMemo(
    () => (selectedServer ? serverClients[selectedServer] || null : null),
    [selectedServer, serverClients],
  );

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

  // Update tab counts when selected server changes
  useEffect(() => {
    if (!selectedServer) {
      return;
    }

    const serverState = serverStates[selectedServer];
    if (serverState?.status === "connected") {
      setTabCounts({
        resources: serverState.resources?.length || 0,
        prompts: serverState.prompts?.length || 0,
        tools: serverState.tools?.length || 0,
        messages: messageHistory[selectedServer]?.length || 0,
      });
    } else if (serverState?.status !== "connecting") {
      // Reset counts for disconnected or error states
      setTabCounts({
        resources: 0,
        prompts: 0,
        tools: 0,
        messages: messageHistory[selectedServer]?.length || 0,
      });
    }
  }, [selectedServer, serverStates, messageHistory]);

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
    if (activeTab === "logging" && selectedServerConfig) {
      const serverType = getServerType(selectedServerConfig);
      if (serverType !== "stdio") {
        setActiveTab("info");
      }
    }
  }, [selectedServerConfig, activeTab, getServerType]);

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
      const serverState = serverStates[selectedServer];
      if (
        input.toLowerCase() === "c" &&
        (serverState?.status === "disconnected" ||
          serverState?.status === "error")
      ) {
        handleConnect();
      } else if (
        input.toLowerCase() === "d" &&
        (serverState?.status === "connected" ||
          serverState?.status === "connecting")
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
              selectedServerConfig
                ? getServerType(selectedServerConfig) === "stdio"
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
            {currentServerState?.status === "connected" &&
            currentServerClient ? (
              <>
                {activeTab === "resources" && (
                  <ResourcesTab
                    key={`resources-${selectedServer}`}
                    resources={currentServerState.resources}
                    client={currentServerClient}
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
                )}
                {activeTab === "prompts" && (
                  <PromptsTab
                    key={`prompts-${selectedServer}`}
                    prompts={currentServerState.prompts}
                    client={currentServerClient}
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
                )}
                {activeTab === "tools" && (
                  <ToolsTab
                    key={`tools-${selectedServer}`}
                    tools={currentServerState.tools}
                    client={currentServerClient}
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
                      setToolTestModal({ tool, client: currentServerClient })
                    }
                    onViewDetails={(tool) =>
                      setDetailsModal({
                        title: `Tool: ${tool.name || "Unknown"}`,
                        content: renderToolDetails(tool),
                      })
                    }
                    modalOpen={!!(toolTestModal || detailsModal)}
                  />
                )}
                {activeTab === "messages" && (
                  <HistoryTab
                    serverName={selectedServer}
                    messages={currentServerMessages}
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
                )}
                {activeTab === "logging" && (
                  <NotificationsTab
                    client={currentServerClient}
                    stderrLogs={currentServerState?.stderrLogs || []}
                    width={contentWidth}
                    height={contentHeight}
                    onCountChange={(count) =>
                      setTabCounts((prev) => ({ ...prev, logging: count }))
                    }
                    focused={
                      focus === "tabContentList" ||
                      focus === "tabContentDetails"
                    }
                  />
                )}
              </>
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
