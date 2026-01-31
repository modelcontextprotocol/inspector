import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { Box, Text, useInput, useApp, type Key } from "ink";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type {
  MessageEntry,
  FetchRequestEntry,
  MCPServerConfig,
  InspectorClientOptions,
} from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { loadMcpServersConfig } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { useInspectorClient } from "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js";
import {
  createOAuthCallbackServer,
  CallbackNavigation,
  MutableRedirectUrlProvider,
  NodeOAuthStorage,
} from "@modelcontextprotocol/inspector-shared/auth";
import { openUrl } from "./utils/openUrl.js";
import { Tabs, type TabType, tabs as tabList } from "./components/Tabs.js";
import { InfoTab } from "./components/InfoTab.js";
import { ResourcesTab } from "./components/ResourcesTab.js";
import { PromptsTab } from "./components/PromptsTab.js";
import { ToolsTab } from "./components/ToolsTab.js";
import { NotificationsTab } from "./components/NotificationsTab.js";
import { HistoryTab } from "./components/HistoryTab.js";
import { RequestsTab } from "./components/RequestsTab.js";
import { ToolTestModal } from "./components/ToolTestModal.js";
import { ResourceTestModal } from "./components/ResourceTestModal.js";
import { PromptTestModal } from "./components/PromptTestModal.js";
import { DetailsModal } from "./components/DetailsModal.js";

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
  | "messagesDetail"
  // Used only when activeTab === 'requests'
  | "requestsList"
  | "requestsDetail";

interface AppProps {
  configFile: string;
}

/** HTTP transports (SSE, streamable-http) can use OAuth. No config gate. */
function isOAuthCapableServer(config: MCPServerConfig | null): boolean {
  if (!config) return false;
  const c = config as MCPServerConfig & { oauth?: unknown };
  return c.type === "sse" || c.type === "streamable-http";
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
    requests?: number;
    logging?: number;
  }>({});
  const [oauthStatus, setOauthStatus] = useState<
    "idle" | "authenticating" | "success" | "error"
  >("idle");
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const oauthInProgressRef = useRef(false);

  // Tool test modal state
  const [toolTestModal, setToolTestModal] = useState<{
    tool: any;
    inspectorClient: InspectorClient | null;
  } | null>(null);

  // Resource test modal state
  const [resourceTestModal, setResourceTestModal] = useState<{
    template: {
      name: string;
      uriTemplate: string;
      description?: string;
    };
    inspectorClient: InspectorClient | null;
  } | null>(null);

  // Prompt test modal state
  const [promptTestModal, setPromptTestModal] = useState<{
    prompt: {
      name: string;
      description?: string;
      arguments?: any[];
    };
    inspectorClient: InspectorClient | null;
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

  // Mutable redirect URL providers, keyed by server name (populated before authenticate)
  const redirectUrlProvidersRef = useRef<
    Record<string, MutableRedirectUrlProvider>
  >({});

  // Create InspectorClient instances for each server on mount
  useEffect(() => {
    const newClients: Record<string, InspectorClient> = {};
    for (const serverName of serverNames) {
      if (!(serverName in inspectorClients)) {
        const serverConfig = mcpConfig.mcpServers[
          serverName
        ] as MCPServerConfig & {
          oauth?: Record<string, unknown>;
        };
        const opts: InspectorClientOptions = {
          maxMessages: 1000,
          maxStderrLogEvents: 1000,
          maxFetchRequests: 1000,
          pipeStderr: true,
        };
        if (isOAuthCapableServer(serverConfig)) {
          const oauthFromConfig = serverConfig.oauth as
            | { storagePath?: string }
            | undefined;
          const redirectUrlProvider =
            redirectUrlProvidersRef.current[serverName] ??
            (redirectUrlProvidersRef.current[serverName] =
              new MutableRedirectUrlProvider());
          opts.oauth = {
            ...(serverConfig.oauth || {}),
            storage: new NodeOAuthStorage(oauthFromConfig?.storagePath),
            navigation: new CallbackNavigation(
              async (url) => await openUrl(url),
            ),
            redirectUrlProvider,
          };
        }
        newClients[serverName] = new InspectorClient(serverConfig, opts);
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

  // Clear OAuth status when switching servers
  useEffect(() => {
    setOauthStatus("idle");
    setOauthMessage(null);
  }, [selectedServer]);

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
    fetchRequests: inspectorFetchRequests,
    tools: inspectorTools,
    resources: inspectorResources,
    resourceTemplates: inspectorResourceTemplates,
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
      // InspectorClient automatically fetches server data (capabilities, tools, resources, resource templates, prompts, etc.)
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

  // OAuth Authenticate handler (normal mode; callback server + open URL)
  const handleAuthenticate = useCallback(async () => {
    if (
      !selectedServer ||
      !selectedInspectorClient ||
      !selectedServerConfig ||
      !isOAuthCapableServer(selectedServerConfig)
    ) {
      return;
    }
    if (oauthInProgressRef.current) return;
    oauthInProgressRef.current = true;
    setOauthStatus("authenticating");
    setOauthMessage(null);
    const callbackServer = createOAuthCallbackServer();
    let flowResolve: () => void;
    let flowReject: (err: Error) => void;
    const flowDone = new Promise<void>((resolve, reject) => {
      flowResolve = resolve;
      flowReject = reject;
    });
    try {
      const { redirectUrl, redirectUrlGuided } = await callbackServer.start({
        port: 0,
        onCallback: async (params) => {
          try {
            await selectedInspectorClient!.completeOAuthFlow(params.code);
            flowResolve!();
          } catch (err) {
            flowReject!(err instanceof Error ? err : new Error(String(err)));
          }
        },
        onError: (params) => {
          flowReject!(
            new Error(
              params.error_description ?? params.error ?? "OAuth error",
            ),
          );
          void callbackServer.stop();
        },
      });
      const redirectUrlProvider =
        redirectUrlProvidersRef.current[selectedServer];
      if (redirectUrlProvider) {
        redirectUrlProvider.redirectUrl = redirectUrl;
        redirectUrlProvider.redirectUrlGuided = redirectUrlGuided;
      }
      await selectedInspectorClient.authenticate();
      await flowDone;
      setOauthStatus("success");
      setOauthMessage("OAuth complete. Press C to connect.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOauthStatus("error");
      setOauthMessage(msg);
    } finally {
      oauthInProgressRef.current = false;
    }
  }, [selectedServer, selectedInspectorClient, selectedServerConfig]);

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
      resourceTemplates: inspectorResourceTemplates,
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
    inspectorResourceTemplates,
    inspectorPrompts,
    inspectorTools,
    inspectorStderrLogs,
  ]);

  // 401 on connect → prompt to authenticate (HTTP servers). Hide during/after auth.
  const show401AuthHint = useMemo(() => {
    if (inspectorStatus !== "error") return false;
    if (oauthStatus === "authenticating" || oauthStatus === "success")
      return false;
    if (!selectedServerConfig || !isOAuthCapableServer(selectedServerConfig))
      return false;
    return inspectorFetchRequests.some((r) => r.responseStatus === 401);
  }, [
    inspectorStatus,
    oauthStatus,
    selectedServerConfig,
    inspectorFetchRequests,
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

  const renderRequestDetails = (request: FetchRequestEntry) => (
    <>
      <Box flexShrink={0}>
        <Text bold>
          {request.method} {request.url}
        </Text>
      </Box>
      {request.responseStatus !== undefined ? (
        <Box marginTop={1} flexShrink={0}>
          <Text bold>
            Status: {request.responseStatus} {request.responseStatusText || ""}
          </Text>
        </Box>
      ) : request.error ? (
        <Box marginTop={1} flexShrink={0}>
          <Text bold color="red">
            Error: {request.error}
          </Text>
        </Box>
      ) : null}
      {request.duration !== undefined && (
        <Box marginTop={1} flexShrink={0}>
          <Text dimColor>Duration: {request.duration}ms</Text>
        </Box>
      )}
      <Box marginTop={1} flexShrink={0}>
        <Text bold>Request Headers:</Text>
        {Object.entries(request.requestHeaders).map(([key, value]) => (
          <Box key={key} marginTop={0} paddingLeft={2} flexShrink={0}>
            <Text dimColor>
              {key}: {value}
            </Text>
          </Box>
        ))}
      </Box>
      {request.requestBody && (
        <>
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Request Body:</Text>
          </Box>
          {(() => {
            try {
              const parsed = JSON.parse(request.requestBody);
              return JSON.stringify(parsed, null, 2)
                .split("\n")
                .map((line: string, idx: number) => (
                  <Box
                    key={`req-body-${idx}`}
                    marginTop={idx === 0 ? 1 : 0}
                    paddingLeft={2}
                    flexShrink={0}
                  >
                    <Text dimColor>{line}</Text>
                  </Box>
                ));
            } catch {
              return (
                <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                  <Text dimColor>{request.requestBody}</Text>
                </Box>
              );
            }
          })()}
        </>
      )}
      {request.responseHeaders &&
        Object.keys(request.responseHeaders).length > 0 && (
          <>
            <Box marginTop={1} flexShrink={0}>
              <Text bold>Response Headers:</Text>
            </Box>
            {Object.entries(request.responseHeaders).map(([key, value]) => (
              <Box key={key} marginTop={0} paddingLeft={2} flexShrink={0}>
                <Text dimColor>
                  {key}: {value}
                </Text>
              </Box>
            ))}
          </>
        )}
      {request.responseBody && (
        <>
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Response Body:</Text>
          </Box>
          {(() => {
            try {
              const parsed = JSON.parse(request.responseBody);
              return JSON.stringify(parsed, null, 2)
                .split("\n")
                .map((line: string, idx: number) => (
                  <Box
                    key={`resp-body-${idx}`}
                    marginTop={idx === 0 ? 1 : 0}
                    paddingLeft={2}
                    flexShrink={0}
                  >
                    <Text dimColor>{line}</Text>
                  </Box>
                ));
            } catch {
              return (
                <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                  <Text dimColor>{request.responseBody}</Text>
                </Box>
              );
            }
          })()}
        </>
      )}
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
      requests: inspectorFetchRequests.length || 0,
      logging: inspectorStderrLogs.length || 0,
    });
  }, [
    selectedServer,
    inspectorResources,
    inspectorPrompts,
    inspectorTools,
    inspectorMessages,
    inspectorFetchRequests,
    inspectorStderrLogs,
  ]);

  // Keep focus state consistent when switching tabs
  useEffect(() => {
    if (activeTab === "messages") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("messagesList");
      }
    } else if (activeTab === "requests") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("requestsList");
      }
    } else {
      if (
        focus === "messagesList" ||
        focus === "messagesDetail" ||
        focus === "requestsList" ||
        focus === "requestsDetail"
      ) {
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
    if (toolTestModal || resourceTestModal || promptTestModal || detailsModal) {
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
          : activeTab === "requests"
            ? ["serverList", "tabs", "requestsList", "requestsDetail"]
            : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const nextIndex = (currentIndex + 1) % focusOrder.length;
      setFocus(focusOrder[nextIndex]);
    } else if (key.tab && key.shift) {
      // Reverse order: servers <- tabs <- list <- details <- wrap to servers
      const focusOrder: FocusArea[] =
        activeTab === "messages"
          ? ["serverList", "tabs", "messagesList", "messagesDetail"]
          : activeTab === "requests"
            ? ["serverList", "tabs", "requestsList", "requestsDetail"]
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
        "requests",
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

    // Accelerator keys for connect/disconnect/authenticate (work from anywhere)
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
      } else if (
        input.toLowerCase() === "a" &&
        (inspectorStatus === "disconnected" || inspectorStatus === "error") &&
        selectedServerConfig &&
        isOAuthCapableServer(selectedServerConfig)
      ) {
        handleAuthenticate();
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
                <Box flexDirection="row" alignItems="center" gap={1}>
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
                      {(currentServerState?.status === "disconnected" ||
                        currentServerState?.status === "error") &&
                        selectedServerConfig &&
                        isOAuthCapableServer(selectedServerConfig) && (
                          <Text color="green" bold>
                            [<Text underline>A</Text>uth]
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
              {show401AuthHint && (
                <Box marginTop={1}>
                  <Text color="yellow">
                    401 Unauthorized. Press <Text bold>A</Text> to authenticate.
                  </Text>
                </Box>
              )}
              {oauthStatus !== "idle" && (
                <Box marginTop={1}>
                  {oauthStatus === "authenticating" && (
                    <Text dimColor>OAuth: authenticating…</Text>
                  )}
                  {oauthStatus === "success" && oauthMessage && (
                    <Text color="green">{oauthMessage}</Text>
                  )}
                  {oauthStatus === "error" && oauthMessage && (
                    <Text color="red">OAuth: {oauthMessage}</Text>
                  )}
                </Box>
              )}
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
            showRequests={
              selectedServer && inspectorClients[selectedServer]
                ? (() => {
                    const serverType =
                      inspectorClients[selectedServer].getServerType();
                    return (
                      serverType === "sse" || serverType === "streamable-http"
                    );
                  })()
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
            selectedInspectorClient ? (
              <ResourcesTab
                key={`resources-${selectedServer}`}
                resources={currentServerState.resources}
                resourceTemplates={currentServerState.resourceTemplates}
                inspectorClient={selectedInspectorClient}
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
                onFetchResource={(resource) => {
                  // Resource fetching is handled internally by ResourcesTab
                  // This callback is just for triggering the fetch
                }}
                onFetchTemplate={(template) => {
                  setResourceTestModal({
                    template,
                    inspectorClient: selectedInspectorClient,
                  });
                }}
                modalOpen={
                  !!(toolTestModal || resourceTestModal || detailsModal)
                }
              />
            ) : activeTab === "prompts" &&
              currentServerState?.status === "connected" &&
              selectedInspectorClient ? (
              <PromptsTab
                key={`prompts-${selectedServer}`}
                prompts={currentServerState.prompts}
                client={inspectorClient}
                inspectorClient={selectedInspectorClient}
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
                onFetchPrompt={(prompt) => {
                  setPromptTestModal({
                    prompt,
                    inspectorClient: selectedInspectorClient,
                  });
                }}
                modalOpen={
                  !!(
                    toolTestModal ||
                    resourceTestModal ||
                    promptTestModal ||
                    detailsModal
                  )
                }
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
                  setToolTestModal({
                    tool,
                    inspectorClient: selectedInspectorClient,
                  })
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
            ) : activeTab === "requests" &&
              selectedInspectorClient &&
              (inspectorStatus === "connected" ||
                inspectorFetchRequests.length > 0) ? (
              <RequestsTab
                serverName={selectedServer}
                requests={inspectorFetchRequests}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, requests: count }))
                }
                focusedPane={
                  focus === "requestsDetail"
                    ? "details"
                    : focus === "requestsList"
                      ? "requests"
                      : null
                }
                modalOpen={!!(toolTestModal || detailsModal)}
                onViewDetails={(request) => {
                  setDetailsModal({
                    title: `Request: ${request.method} ${request.url}`,
                    content: renderRequestDetails(request),
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
          inspectorClient={toolTestModal.inspectorClient}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setToolTestModal(null)}
        />
      )}

      {/* Resource Test Modal - rendered at App level for full screen overlay */}
      {resourceTestModal && (
        <ResourceTestModal
          template={resourceTestModal.template}
          inspectorClient={resourceTestModal.inspectorClient}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setResourceTestModal(null)}
        />
      )}

      {promptTestModal && (
        <PromptTestModal
          prompt={promptTestModal.prompt}
          inspectorClient={promptTestModal.inspectorClient}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setPromptTestModal(null)}
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
