import {
  jsx as _jsx,
  Fragment as _Fragment,
  jsxs as _jsxs,
} from "react/jsx-runtime";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadMcpServersConfig } from "./utils/config.js";
import { InspectorClient } from "./utils/inspectorClient.js";
import { useInspectorClient } from "./hooks/useInspectorClient.js";
import { Tabs, tabs as tabList } from "./components/Tabs.js";
import { InfoTab } from "./components/InfoTab.js";
import { ResourcesTab } from "./components/ResourcesTab.js";
import { PromptsTab } from "./components/PromptsTab.js";
import { ToolsTab } from "./components/ToolsTab.js";
import { NotificationsTab } from "./components/NotificationsTab.js";
import { HistoryTab } from "./components/HistoryTab.js";
import { ToolTestModal } from "./components/ToolTestModal.js";
import { DetailsModal } from "./components/DetailsModal.js";
import { getServerType } from "./utils/transport.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Read package.json to get project info
// Strategy: Try multiple paths to handle both local dev and global install
// - Local dev (tsx): __dirname = src/, package.json is one level up
// - Global install: __dirname = dist/src/, package.json is two levels up
let packagePath;
let packageJson;
try {
  // Try two levels up first (global install case)
  packagePath = join(__dirname, "..", "..", "package.json");
  packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
} catch {
  // Fall back to one level up (local dev case)
  packagePath = join(__dirname, "..", "package.json");
  packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
}
function App({ configFile }) {
  const { exit } = useApp();
  const [selectedServer, setSelectedServer] = useState(null);
  const [activeTab, setActiveTab] = useState("info");
  const [focus, setFocus] = useState("serverList");
  const [tabCounts, setTabCounts] = useState({});
  // Tool test modal state
  const [toolTestModal, setToolTestModal] = useState(null);
  // Details modal state
  const [detailsModal, setDetailsModal] = useState(null);
  // InspectorClient instances for each server
  const [inspectorClients, setInspectorClients] = useState({});
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
    const newClients = {};
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
    clearMessages: clearInspectorMessages,
    clearStderrLogs: clearInspectorStderrLogs,
  } = useInspectorClient(selectedInspectorClient);
  // Connect handler - InspectorClient now handles fetching server data automatically
  const handleConnect = useCallback(async () => {
    if (!selectedServer || !selectedInspectorClient) return;
    // Clear messages and stderr logs when connecting/reconnecting
    clearInspectorMessages();
    clearInspectorStderrLogs();
    try {
      await connectInspector();
      // InspectorClient automatically fetches server data (capabilities, tools, resources, prompts, etc.)
      // on connect, so we don't need to do anything here
    } catch (error) {
      // Error handling is done by InspectorClient and will be reflected in status
    }
  }, [
    selectedServer,
    selectedInspectorClient,
    connectInspector,
    clearInspectorMessages,
    clearInspectorStderrLogs,
  ]);
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
  const renderResourceDetails = (resource) =>
    _jsxs(_Fragment, {
      children: [
        resource.description &&
          _jsx(_Fragment, {
            children: resource.description
              .split("\n")
              .map((line, idx) =>
                _jsx(
                  Box,
                  {
                    marginTop: idx === 0 ? 0 : 0,
                    flexShrink: 0,
                    children: _jsx(Text, { dimColor: true, children: line }),
                  },
                  `desc-${idx}`,
                ),
              ),
          }),
        resource.uri &&
          _jsxs(Box, {
            marginTop: 1,
            flexShrink: 0,
            children: [
              _jsx(Text, { bold: true, children: "URI:" }),
              _jsx(Box, {
                paddingLeft: 2,
                children: _jsx(Text, {
                  dimColor: true,
                  children: resource.uri,
                }),
              }),
            ],
          }),
        resource.mimeType &&
          _jsxs(Box, {
            marginTop: 1,
            flexShrink: 0,
            children: [
              _jsx(Text, { bold: true, children: "MIME Type:" }),
              _jsx(Box, {
                paddingLeft: 2,
                children: _jsx(Text, {
                  dimColor: true,
                  children: resource.mimeType,
                }),
              }),
            ],
          }),
        _jsxs(Box, {
          marginTop: 1,
          flexShrink: 0,
          flexDirection: "column",
          children: [
            _jsx(Text, { bold: true, children: "Full JSON:" }),
            _jsx(Box, {
              paddingLeft: 2,
              children: _jsx(Text, {
                dimColor: true,
                children: JSON.stringify(resource, null, 2),
              }),
            }),
          ],
        }),
      ],
    });
  const renderPromptDetails = (prompt) =>
    _jsxs(_Fragment, {
      children: [
        prompt.description &&
          _jsx(_Fragment, {
            children: prompt.description
              .split("\n")
              .map((line, idx) =>
                _jsx(
                  Box,
                  {
                    marginTop: idx === 0 ? 0 : 0,
                    flexShrink: 0,
                    children: _jsx(Text, { dimColor: true, children: line }),
                  },
                  `desc-${idx}`,
                ),
              ),
          }),
        prompt.arguments &&
          prompt.arguments.length > 0 &&
          _jsxs(_Fragment, {
            children: [
              _jsx(Box, {
                marginTop: 1,
                flexShrink: 0,
                children: _jsx(Text, { bold: true, children: "Arguments:" }),
              }),
              prompt.arguments.map((arg, idx) =>
                _jsx(
                  Box,
                  {
                    marginTop: 1,
                    paddingLeft: 2,
                    flexShrink: 0,
                    children: _jsxs(Text, {
                      dimColor: true,
                      children: [
                        "- ",
                        arg.name,
                        ": ",
                        arg.description || arg.type || "string",
                      ],
                    }),
                  },
                  `arg-${idx}`,
                ),
              ),
            ],
          }),
        _jsxs(Box, {
          marginTop: 1,
          flexShrink: 0,
          flexDirection: "column",
          children: [
            _jsx(Text, { bold: true, children: "Full JSON:" }),
            _jsx(Box, {
              paddingLeft: 2,
              children: _jsx(Text, {
                dimColor: true,
                children: JSON.stringify(prompt, null, 2),
              }),
            }),
          ],
        }),
      ],
    });
  const renderToolDetails = (tool) =>
    _jsxs(_Fragment, {
      children: [
        tool.description &&
          _jsx(_Fragment, {
            children: tool.description
              .split("\n")
              .map((line, idx) =>
                _jsx(
                  Box,
                  {
                    marginTop: idx === 0 ? 0 : 0,
                    flexShrink: 0,
                    children: _jsx(Text, { dimColor: true, children: line }),
                  },
                  `desc-${idx}`,
                ),
              ),
          }),
        tool.inputSchema &&
          _jsxs(Box, {
            marginTop: 1,
            flexShrink: 0,
            flexDirection: "column",
            children: [
              _jsx(Text, { bold: true, children: "Input Schema:" }),
              _jsx(Box, {
                paddingLeft: 2,
                children: _jsx(Text, {
                  dimColor: true,
                  children: JSON.stringify(tool.inputSchema, null, 2),
                }),
              }),
            ],
          }),
        _jsxs(Box, {
          marginTop: 1,
          flexShrink: 0,
          flexDirection: "column",
          children: [
            _jsx(Text, { bold: true, children: "Full JSON:" }),
            _jsx(Box, {
              paddingLeft: 2,
              children: _jsx(Text, {
                dimColor: true,
                children: JSON.stringify(tool, null, 2),
              }),
            }),
          ],
        }),
      ],
    });
  const renderMessageDetails = (message) =>
    _jsxs(_Fragment, {
      children: [
        _jsx(Box, {
          flexShrink: 0,
          children: _jsxs(Text, {
            bold: true,
            children: ["Direction: ", message.direction],
          }),
        }),
        message.duration !== undefined &&
          _jsx(Box, {
            marginTop: 1,
            flexShrink: 0,
            children: _jsxs(Text, {
              dimColor: true,
              children: ["Duration: ", message.duration, "ms"],
            }),
          }),
        message.direction === "request"
          ? _jsxs(_Fragment, {
              children: [
                _jsxs(Box, {
                  marginTop: 1,
                  flexShrink: 0,
                  flexDirection: "column",
                  children: [
                    _jsx(Text, { bold: true, children: "Request:" }),
                    _jsx(Box, {
                      paddingLeft: 2,
                      children: _jsx(Text, {
                        dimColor: true,
                        children: JSON.stringify(message.message, null, 2),
                      }),
                    }),
                  ],
                }),
                message.response &&
                  _jsxs(Box, {
                    marginTop: 1,
                    flexShrink: 0,
                    flexDirection: "column",
                    children: [
                      _jsx(Text, { bold: true, children: "Response:" }),
                      _jsx(Box, {
                        paddingLeft: 2,
                        children: _jsx(Text, {
                          dimColor: true,
                          children: JSON.stringify(message.response, null, 2),
                        }),
                      }),
                    ],
                  }),
              ],
            })
          : _jsxs(Box, {
              marginTop: 1,
              flexShrink: 0,
              flexDirection: "column",
              children: [
                _jsx(Text, {
                  bold: true,
                  children:
                    message.direction === "response"
                      ? "Response:"
                      : "Notification:",
                }),
                _jsx(Box, {
                  paddingLeft: 2,
                  children: _jsx(Text, {
                    dimColor: true,
                    children: JSON.stringify(message.message, null, 2),
                  }),
                }),
              ],
            }),
      ],
    });
  // Update tab counts when selected server changes or InspectorClient state changes
  useEffect(() => {
    if (!selectedServer) {
      return;
    }
    if (inspectorStatus === "connected") {
      setTabCounts({
        resources: inspectorResources.length || 0,
        prompts: inspectorPrompts.length || 0,
        tools: inspectorTools.length || 0,
        messages: inspectorMessages.length || 0,
        logging: inspectorStderrLogs.length || 0,
      });
    } else if (inspectorStatus !== "connecting") {
      // Reset counts for disconnected or error states
      setTabCounts({
        resources: 0,
        prompts: 0,
        tools: 0,
        messages: inspectorMessages.length || 0,
        logging: inspectorStderrLogs.length || 0,
      });
    }
  }, [
    selectedServer,
    inspectorStatus,
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
    if (activeTab === "logging" && selectedServerConfig) {
      const serverType = getServerType(selectedServerConfig);
      if (serverType !== "stdio") {
        setActiveTab("info");
      }
    }
  }, [selectedServerConfig, activeTab, getServerType]);
  useInput((input, key) => {
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
    const tabAccelerators = Object.fromEntries(
      tabList.map((tab) => [tab.accelerator, tab.id]),
    );
    if (tabAccelerators[input.toLowerCase()]) {
      setActiveTab(tabAccelerators[input.toLowerCase()]);
      setFocus("tabs");
    } else if (key.tab && !key.shift) {
      // Flat focus order: servers -> tabs -> list -> details -> wrap to servers
      const focusOrder =
        activeTab === "messages"
          ? ["serverList", "tabs", "messagesList", "messagesDetail"]
          : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const nextIndex = (currentIndex + 1) % focusOrder.length;
      setFocus(focusOrder[nextIndex]);
    } else if (key.tab && key.shift) {
      // Reverse order: servers <- tabs <- list <- details <- wrap to servers
      const focusOrder =
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
      const tabs = [
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
  const getStatusColor = (status) => {
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
  const getStatusSymbol = (status) => {
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
  return _jsxs(Box, {
    flexDirection: "column",
    width: dimensions.width,
    height: dimensions.height,
    children: [
      _jsxs(Box, {
        width: dimensions.width,
        height: headerHeight,
        borderStyle: "single",
        borderTop: false,
        borderLeft: false,
        borderRight: false,
        paddingX: 1,
        justifyContent: "space-between",
        alignItems: "center",
        children: [
          _jsxs(Box, {
            children: [
              _jsx(Text, {
                bold: true,
                color: "cyan",
                children: packageJson.name,
              }),
              _jsxs(Text, {
                dimColor: true,
                children: [" - ", packageJson.description],
              }),
            ],
          }),
          _jsxs(Text, { dimColor: true, children: ["v", packageJson.version] }),
        ],
      }),
      _jsxs(Box, {
        flexDirection: "row",
        height: availableHeight + tabsHeight,
        width: dimensions.width,
        children: [
          _jsxs(Box, {
            width: serverListWidth,
            height: availableHeight + tabsHeight,
            borderStyle: "single",
            borderTop: false,
            borderBottom: false,
            borderLeft: false,
            borderRight: true,
            flexDirection: "column",
            paddingX: 1,
            children: [
              _jsx(Box, {
                marginTop: 1,
                marginBottom: 1,
                children: _jsx(Text, {
                  bold: true,
                  backgroundColor:
                    focus === "serverList" ? "yellow" : undefined,
                  children: "MCP Servers",
                }),
              }),
              _jsx(Box, {
                flexDirection: "column",
                flexGrow: 1,
                children: serverNames.map((serverName) => {
                  const isSelected = selectedServer === serverName;
                  return _jsx(
                    Box,
                    {
                      paddingY: 0,
                      children: _jsxs(Text, {
                        children: [isSelected ? "▶ " : "  ", serverName],
                      }),
                    },
                    serverName,
                  );
                }),
              }),
              _jsx(Box, {
                flexShrink: 0,
                height: 1,
                justifyContent: "center",
                backgroundColor: "gray",
                children: _jsx(Text, {
                  bold: true,
                  color: "white",
                  children: "ESC to exit",
                }),
              }),
            ],
          }),
          _jsxs(Box, {
            flexGrow: 1,
            height: availableHeight + tabsHeight,
            flexDirection: "column",
            children: [
              _jsx(Box, {
                width: contentWidth,
                borderStyle: "single",
                borderTop: false,
                borderLeft: false,
                borderRight: false,
                borderBottom: true,
                paddingX: 1,
                paddingY: 1,
                flexDirection: "column",
                flexShrink: 0,
                children: _jsx(Box, {
                  flexDirection: "column",
                  children: _jsxs(Box, {
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    children: [
                      _jsx(Text, {
                        bold: true,
                        color: "cyan",
                        children: selectedServer,
                      }),
                      _jsx(Box, {
                        flexDirection: "row",
                        alignItems: "center",
                        children:
                          currentServerState &&
                          _jsxs(_Fragment, {
                            children: [
                              _jsxs(Text, {
                                color: getStatusColor(
                                  currentServerState.status,
                                ),
                                children: [
                                  getStatusSymbol(currentServerState.status),
                                  " ",
                                  currentServerState.status,
                                ],
                              }),
                              _jsx(Text, { children: " " }),
                              (currentServerState?.status === "disconnected" ||
                                currentServerState?.status === "error") &&
                                _jsxs(Text, {
                                  color: "cyan",
                                  bold: true,
                                  children: [
                                    "[",
                                    _jsx(Text, {
                                      underline: true,
                                      children: "C",
                                    }),
                                    "onnect]",
                                  ],
                                }),
                              (currentServerState?.status === "connected" ||
                                currentServerState?.status === "connecting") &&
                                _jsxs(Text, {
                                  color: "red",
                                  bold: true,
                                  children: [
                                    "[",
                                    _jsx(Text, {
                                      underline: true,
                                      children: "D",
                                    }),
                                    "isconnect]",
                                  ],
                                }),
                            ],
                          }),
                      }),
                    ],
                  }),
                }),
              }),
              _jsx(Tabs, {
                activeTab: activeTab,
                onTabChange: setActiveTab,
                width: contentWidth,
                counts: tabCounts,
                focused: focus === "tabs",
                showLogging: selectedServerConfig
                  ? getServerType(selectedServerConfig) === "stdio"
                  : false,
              }),
              _jsxs(Box, {
                flexGrow: 1,
                width: contentWidth,
                borderTop: false,
                borderLeft: false,
                borderRight: false,
                borderBottom: false,
                children: [
                  activeTab === "info" &&
                    _jsx(InfoTab, {
                      serverName: selectedServer,
                      serverConfig: selectedServerConfig,
                      serverState: currentServerState,
                      width: contentWidth,
                      height: contentHeight,
                      focused:
                        focus === "tabContentList" ||
                        focus === "tabContentDetails",
                    }),
                  currentServerState?.status === "connected" && inspectorClient
                    ? _jsxs(_Fragment, {
                        children: [
                          activeTab === "resources" &&
                            _jsx(
                              ResourcesTab,
                              {
                                resources: currentServerState.resources,
                                client: inspectorClient,
                                width: contentWidth,
                                height: contentHeight,
                                onCountChange: (count) =>
                                  setTabCounts((prev) => ({
                                    ...prev,
                                    resources: count,
                                  })),
                                focusedPane:
                                  focus === "tabContentDetails"
                                    ? "details"
                                    : focus === "tabContentList"
                                      ? "list"
                                      : null,
                                onViewDetails: (resource) =>
                                  setDetailsModal({
                                    title: `Resource: ${resource.name || resource.uri || "Unknown"}`,
                                    content: renderResourceDetails(resource),
                                  }),
                                modalOpen: !!(toolTestModal || detailsModal),
                              },
                              `resources-${selectedServer}`,
                            ),
                          activeTab === "prompts" &&
                            _jsx(
                              PromptsTab,
                              {
                                prompts: currentServerState.prompts,
                                client: inspectorClient,
                                width: contentWidth,
                                height: contentHeight,
                                onCountChange: (count) =>
                                  setTabCounts((prev) => ({
                                    ...prev,
                                    prompts: count,
                                  })),
                                focusedPane:
                                  focus === "tabContentDetails"
                                    ? "details"
                                    : focus === "tabContentList"
                                      ? "list"
                                      : null,
                                onViewDetails: (prompt) =>
                                  setDetailsModal({
                                    title: `Prompt: ${prompt.name || "Unknown"}`,
                                    content: renderPromptDetails(prompt),
                                  }),
                                modalOpen: !!(toolTestModal || detailsModal),
                              },
                              `prompts-${selectedServer}`,
                            ),
                          activeTab === "tools" &&
                            _jsx(
                              ToolsTab,
                              {
                                tools: currentServerState.tools,
                                client: inspectorClient,
                                width: contentWidth,
                                height: contentHeight,
                                onCountChange: (count) =>
                                  setTabCounts((prev) => ({
                                    ...prev,
                                    tools: count,
                                  })),
                                focusedPane:
                                  focus === "tabContentDetails"
                                    ? "details"
                                    : focus === "tabContentList"
                                      ? "list"
                                      : null,
                                onTestTool: (tool) =>
                                  setToolTestModal({
                                    tool,
                                    client: inspectorClient,
                                  }),
                                onViewDetails: (tool) =>
                                  setDetailsModal({
                                    title: `Tool: ${tool.name || "Unknown"}`,
                                    content: renderToolDetails(tool),
                                  }),
                                modalOpen: !!(toolTestModal || detailsModal),
                              },
                              `tools-${selectedServer}`,
                            ),
                          activeTab === "messages" &&
                            _jsx(HistoryTab, {
                              serverName: selectedServer,
                              messages: inspectorMessages,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) =>
                                setTabCounts((prev) => ({
                                  ...prev,
                                  messages: count,
                                })),
                              focusedPane:
                                focus === "messagesDetail"
                                  ? "details"
                                  : focus === "messagesList"
                                    ? "messages"
                                    : null,
                              modalOpen: !!(toolTestModal || detailsModal),
                              onViewDetails: (message) => {
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
                              },
                            }),
                          activeTab === "logging" &&
                            _jsx(NotificationsTab, {
                              client: inspectorClient,
                              stderrLogs: inspectorStderrLogs,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) =>
                                setTabCounts((prev) => ({
                                  ...prev,
                                  logging: count,
                                })),
                              focused:
                                focus === "tabContentList" ||
                                focus === "tabContentDetails",
                            }),
                        ],
                      })
                    : activeTab !== "info" && selectedServer
                      ? _jsx(Box, {
                          paddingX: 1,
                          paddingY: 1,
                          children: _jsx(Text, {
                            dimColor: true,
                            children: "Server not connected",
                          }),
                        })
                      : null,
                ],
              }),
            ],
          }),
        ],
      }),
      toolTestModal &&
        _jsx(ToolTestModal, {
          tool: toolTestModal.tool,
          client: toolTestModal.client,
          width: dimensions.width,
          height: dimensions.height,
          onClose: () => setToolTestModal(null),
        }),
      detailsModal &&
        _jsx(DetailsModal, {
          title: detailsModal.title,
          content: detailsModal.content,
          width: dimensions.width,
          height: dimensions.height,
          onClose: () => setDetailsModal(null),
        }),
    ],
  });
}
export default App;
