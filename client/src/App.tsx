import {
  ClientRequest,
  EmptyResultSchema,
  ResourceReference,
  PromptReference,
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import React, { Suspense, useCallback, useEffect, useRef } from "react";
import { StdErrNotification } from "./lib/notificationTypes";
import { Activity } from "lucide-react";
import { z } from "zod";
import "./App.css";

// Components
import AuthDebugger from "./components/AuthDebugger";
import ConsoleTab from "./components/ConsoleTab";
import HistoryAndNotifications from "./components/History";
import PingTab from "./components/PingTab";
import PromptsTab from "./components/PromptsTab";
import ResourcesTab from "./components/ResourcesTab";
import RootsTab from "./components/RootsTab";
import SamplingTab from "./components/SamplingTab";
import ToolsTab from "./components/ToolsTab";
import ChatTab from "./components/ChatTab";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import SettingsTab from "./components/SettingsTab";
import ClientFormSection from "./components/ClientFormSection";

// Context
import { McpClientContext } from "@/context/McpClientContext";

// Hooks
import { useServerState } from "./hooks/useServerState";
import { useConnectionState } from "./hooks/useConnectionState";
import { useMCPOperations } from "./hooks/useMCPOperations";
import { useConfigState } from "./hooks/useConfigState";

// Services
import { loadOAuthTokens, handleOAuthDebugConnect } from "./services/oauth";

// Utils
import { getMCPProxyAddress } from "./utils/configUtils";
import { handleRootsChange, MCPHelperDependencies } from "./utils/mcpHelpers";

// Types
import {
  MCPJamServerConfig,
  StdioServerDefinition,
  HttpServerDefinition,
} from "./lib/serverTypes";

type ExtendedConnectionStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "error-connecting-to-proxy"
  | "partial";

const App = () => {
  // Custom hooks
  const serverState = useServerState();
  const connectionState = useConnectionState();
  const mcpOperations = useMCPOperations();
  const configState = useConfigState();

  // Refs
  const rootsRef = useRef(mcpOperations.roots);
  const nextRequestId = useRef(0);

  // Callbacks for connection

  const onStdErrNotification = useCallback(
    (notification: StdErrNotification) => {
      mcpOperations.setStdErrNotifications((prev) => [...prev, notification]);
    },
    [mcpOperations.setStdErrNotifications],
  );

  const onPendingRequest = useCallback(
    (
      request: CreateMessageRequest,
      resolve: (result: CreateMessageResult) => void,
      reject: (error: Error) => void,
    ) => {
      mcpOperations.setPendingSampleRequests((prev) => [
        ...prev,
        { id: nextRequestId.current++, request, resolve, reject },
      ]);
    },
    [mcpOperations.setPendingSampleRequests],
  );

  const getRootsCallback = useCallback(() => rootsRef.current, []);

  // Connection info
  const connectionStatus: ExtendedConnectionStatus =
    connectionState.getConnectionStatus();
  const serverCapabilities = connectionState.getServerCapabilities(
    serverState.selectedServerName,
  );
  const requestHistory = connectionState.getRequestHistory();
  const currentClient = connectionState.getCurrentClient(
    serverState.selectedServerName,
  );

  // Server management handlers
  const handleAddServer = useCallback(
    async (name: string, serverConfig: MCPJamServerConfig) => {
      console.log("🔧 Adding server without auto-connect:", {
        name,
        serverConfig,
      });

      // Check if there are no other servers BEFORE adding the new one
      const shouldSelectNewServer =
        Object.keys(serverState.serverConfigs).length === 0;

      // Just add the server config without connecting
      serverState.updateServerConfig(name, serverConfig);

      // Switch to the new server if there were no other servers
      if (shouldSelectNewServer) {
        serverState.setSelectedServerName(name);
      }

      // Create or update the agent with the new server config, but don't connect
      if (!connectionState.mcpAgent) {
        console.log(
          "🆕 Creating agent with server config (no auto-connect)...",
        );
        try {
          // Include ALL server configs (existing + new) when creating the agent
          const allServerConfigs = {
            ...serverState.serverConfigs,
            [name]: serverConfig,
          };

          await connectionState.createAgentWithoutConnecting(
            allServerConfigs,
            configState.config,
            configState.bearerToken,
            configState.headerName,
            configState.claudeApiKey,
            onStdErrNotification,
            onPendingRequest,
            getRootsCallback,
          );
        } catch (error) {
          console.error("❌ Failed to create agent:", error);
          throw error;
        }
      } else {
        // Add server to existing agent without connecting
        connectionState.mcpAgent.addServer(name, serverConfig);
        connectionState.forceUpdateSidebar();
      }

      return name;
    },
    [
      serverState,
      connectionState,
      configState.config,
      configState.bearerToken,
      configState.headerName,
      configState.claudeApiKey,
      onStdErrNotification,
      onPendingRequest,
      getRootsCallback,
    ],
  );

  const handleRemoveServer = useCallback(
    async (serverName: string) => {
      await connectionState.removeServer(serverName);
      serverState.removeServerConfig(serverName);

      // If we removed the selected server, select another one or empty string
      if (serverState.selectedServerName === serverName) {
        const remainingServers = Object.keys(serverState.serverConfigs).filter(
          (name) => name !== serverName,
        );
        serverState.setSelectedServerName(
          remainingServers.length > 0 ? remainingServers[0] : "",
        );
      }
    },
    [connectionState, serverState],
  );

  const handleUpdateServer = useCallback(
    async (serverName: string, config: MCPJamServerConfig) => {
      await connectionState.updateServerWithoutConnecting(serverName, config);
      serverState.updateServerConfig(serverName, config);
    },
    [connectionState, serverState],
  );

  const handleSaveClient = useCallback(async () => {
    if (!serverState.clientFormName.trim()) return;

    try {
      if (serverState.isCreatingClient) {
        await handleAddServer(
          serverState.clientFormName,
          serverState.clientFormConfig,
        );
      } else if (serverState.editingClientName) {
        // Check if the server name has changed
        const oldServerName = serverState.editingClientName;
        const newServerName = serverState.clientFormName.trim();

        if (oldServerName !== newServerName) {
          // Server name has changed - remove old and add new
          console.log(
            `🔄 Server name changed from "${oldServerName}" to "${newServerName}"`,
          );

          // Remove the old server
          await handleRemoveServer(oldServerName);

          // Add the server with the new name
          await handleAddServer(newServerName, serverState.clientFormConfig);

          // Update the selected server name if the changed server was selected
          if (serverState.selectedServerName === oldServerName) {
            serverState.setSelectedServerName(newServerName);
          }
        } else {
          // Server name hasn't changed - just update the configuration
          await handleUpdateServer(
            serverState.editingClientName,
            serverState.clientFormConfig,
          );
        }
      }
      serverState.handleCancelClientForm();
    } catch (error) {
      console.error("Failed to save client:", error);
    }
  }, [serverState, handleAddServer, handleUpdateServer, handleRemoveServer]);

  const handleEditClient = useCallback(
    (serverName: string) => {
      const serverConnections = connectionState.mcpAgent
        ? connectionState.mcpAgent.getAllConnectionInfo()
        : [];
      const connection = serverConnections.find(
        (conn) => conn.name === serverName,
      );
      if (!connection) return;

      serverState.handleEditClient(serverName, connection.config);
    },
    [connectionState.mcpAgent, serverState],
  );

  // Update API key in agent when it changes
  const updateApiKey = useCallback(
    (newApiKey: string) => {
      if (connectionState.mcpAgent) {
        connectionState.mcpAgent.updateCredentials(
          undefined,
          undefined,
          newApiKey,
        );
      }
    },
    [connectionState.mcpAgent],
  );

  const handleApiKeyChange = (newApiKey: string) => {
    configState.updateClaudeApiKey(newApiKey);
    updateApiKey(newApiKey);
  };

  // MCP operation wrappers
  const makeRequest = useCallback(
    async (request: ClientRequest) => {
      return await mcpOperations.makeRequest(
        connectionState.mcpAgent,
        serverState.selectedServerName,
        request,
      );
    },
    [mcpOperations, connectionState.mcpAgent, serverState.selectedServerName],
  );

  const handleCompletion = useCallback(
    async (
      ref: ResourceReference | PromptReference,
      argName: string,
      value: string,
      signal?: AbortSignal,
    ) => {
      return await mcpOperations.handleCompletion(
        connectionState.mcpAgent,
        serverState.selectedServerName,
        ref,
        argName,
        value,
        signal,
      );
    },
    [mcpOperations, connectionState.mcpAgent, serverState.selectedServerName],
  );

  const completionsSupported =
    connectionState.mcpAgent?.getClient(serverState.selectedServerName)
      ?.completionsSupported || false;

  const sendMCPRequest = async <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    tabKey?: keyof typeof mcpOperations.errors,
  ) => {
    try {
      const response = await makeRequest(request);
      return schema.parse(response);
    } catch (error) {
      if (tabKey) {
        mcpOperations.setErrors((prev) => ({
          ...prev,
          [tabKey]: (error as Error).message,
        }));
      }
      throw error;
    }
  };

  const handleRootsChangeWrapper = async () => {
    if (!connectionState.mcpAgent || serverState.selectedServerName === "all")
      return;

    const client = connectionState.mcpAgent.getClient(
      serverState.selectedServerName,
    );
    if (client) {
      return handleRootsChange({
        makeRequest: client.makeRequest.bind(client),
      } as MCPHelperDependencies);
    }
  };

  // Effect to sync roots ref
  useEffect(() => {
    rootsRef.current = mcpOperations.roots;
  }, [mcpOperations.roots]);

  // Effect to restore agent with saved server configs (without connecting)
  useEffect(() => {
    const restoreAgentWithoutConnecting = async () => {
      // Only restore if we have server configs but no active agent
      if (
        Object.keys(serverState.serverConfigs).length > 0 &&
        !connectionState.mcpAgent
      ) {
        console.log(
          "🔄 Restoring agent with saved server configs (no auto-connect)...",
        );

        try {
          await connectionState.createAgentWithoutConnecting(
            serverState.serverConfigs,
            configState.config,
            configState.bearerToken,
            configState.headerName,
            configState.claudeApiKey,
            onStdErrNotification,
            onPendingRequest,
            getRootsCallback,
          );
          console.log("✅ Successfully restored agent with server configs");
        } catch (error) {
          console.error("❌ Failed to restore agent:", error);
        }
      }
    };

    restoreAgentWithoutConnecting();
  }, [
    serverState.serverConfigs,
    connectionState.mcpAgent,
    connectionState.createAgentWithoutConnecting,
    configState.config,
    configState.bearerToken,
    configState.headerName,
    configState.claudeApiKey,
    onStdErrNotification,
    onPendingRequest,
    getRootsCallback,
  ]);

  // Effect to persist server configs
  useEffect(() => {
    const currentConfig =
      serverState.serverConfigs[serverState.selectedServerName];
    if (
      currentConfig?.transportType === "stdio" &&
      "command" in currentConfig
    ) {
      localStorage.setItem("lastCommand", currentConfig.command || "");
    }
  }, [serverState.serverConfigs, serverState.selectedServerName]);

  useEffect(() => {
    const currentConfig =
      serverState.serverConfigs[serverState.selectedServerName];
    if (currentConfig?.transportType === "stdio" && "args" in currentConfig) {
      localStorage.setItem("lastArgs", currentConfig.args?.join(" ") || "");
    }
  }, [serverState.serverConfigs, serverState.selectedServerName]);

  useEffect(() => {
    const currentConfig =
      serverState.serverConfigs[serverState.selectedServerName];
    if (currentConfig && "url" in currentConfig && currentConfig.url) {
      localStorage.setItem("lastSseUrl", currentConfig.url.toString());
    }
  }, [serverState.serverConfigs, serverState.selectedServerName]);

  useEffect(() => {
    localStorage.setItem(
      "lastTransportType",
      serverState.serverConfigs[serverState.selectedServerName]
        ?.transportType || "",
    );
  }, [serverState.serverConfigs, serverState.selectedServerName]);

  // OAuth handlers
  const onOAuthConnect = useCallback(
    async (serverUrl: string) => {
      // Determine the server name from the URL (e.g., "linear" from "https://mcp.linear.app/sse")
      const url = new URL(serverUrl);
      const hostname = url.hostname;
      let serverName = hostname.split(".")[1] || hostname.split(".")[0]; // Extract service name from hostname

      // Clean up the server name (remove common prefixes/suffixes)
      if (serverName.startsWith("mcp")) {
        serverName = hostname.split(".")[0].replace("mcp", ""); // Remove mcp prefix
      }

      // Fallback to a more descriptive name if needed
      if (!serverName || serverName.length < 2) {
        serverName = hostname.replace(/[^a-zA-Z0-9]/g, "");
      }

      // Make sure we have a valid server name
      if (!serverName) {
        serverName = "oauth-server";
      }

      // Check if a server with this URL already exists and use that name instead
      let existingServerName = null;
      for (const [name, config] of Object.entries(serverState.serverConfigs)) {
        if ("url" in config && config.url?.toString() === serverUrl) {
          existingServerName = name;
          break;
        }
      }

      // Use existing server name if found, otherwise use the determined name
      const finalServerName = existingServerName || serverName;

      console.log(
        `🔐 OAuth connecting to: ${serverUrl} as server "${finalServerName}"`,
      );

      // Update the server config for the correct server
      const serverConfig: HttpServerDefinition = {
        transportType: "sse",
        url: new URL(serverUrl),
      };

      // Add the server first
      try {
        await handleAddServer(finalServerName, serverConfig);

        // Switch to the newly connected server
        serverState.setSelectedServerName(finalServerName);

        // Then automatically connect to it since OAuth has completed
        console.log("🔌 Auto-connecting after OAuth success...");
        await connectionState.connectServer(finalServerName);
        console.log("✅ Auto-connected successfully after OAuth");
      } catch (error) {
        console.error("Failed to connect OAuth server:", error);
      }
    },
    [serverState, handleAddServer, connectionState.connectServer],
  );

  const onOAuthDebugConnect = useCallback(
    ({
      authorizationCode,
      errorMsg,
    }: {
      authorizationCode?: string;
      errorMsg?: string;
    }) => {
      handleOAuthDebugConnect(
        { authorizationCode, errorMsg },
        configState.updateAuthState,
      );
    },
    [configState.updateAuthState],
  );

  // Load OAuth tokens when sseUrl changes
  useEffect(() => {
    const loadTokens = async () => {
      const currentConfig =
        serverState.serverConfigs[serverState.selectedServerName];
      if (currentConfig && "url" in currentConfig && currentConfig.url) {
        await loadOAuthTokens(
          currentConfig.url.toString(),
          configState.updateAuthState,
        );
      }
    };

    loadTokens();
  }, [
    serverState.selectedServerName,
    serverState.serverConfigs,
    configState.updateAuthState,
  ]);

  // Fetch default environment
  useEffect(() => {
    fetch(`${getMCPProxyAddress(configState.config)}/config`)
      .then((response) => response.json())
      .then((data) => {
        const currentConfig =
          serverState.serverConfigs[serverState.selectedServerName];
        if (currentConfig?.transportType === "stdio") {
          serverState.setServerConfigs((prev) => ({
            ...prev,
            [serverState.selectedServerName]: {
              ...prev[serverState.selectedServerName],
              env: data.defaultEnvironment || {},
            } as StdioServerDefinition,
          }));
        }
      })
      .catch((error) =>
        console.error("Error fetching default environment:", error),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render OAuth callback components
  if (window.location.pathname === "/oauth/callback") {
    const OAuthCallback = React.lazy(
      () => import("./components/OAuthCallback"),
    );
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <Suspense
          fallback={
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-muted-foreground">Loading...</span>
            </div>
          }
        >
          <OAuthCallback onConnect={onOAuthConnect} />
        </Suspense>
      </div>
    );
  }

  if (window.location.pathname === "/oauth/callback/debug") {
    const OAuthDebugCallback = React.lazy(
      () => import("./components/OAuthDebugCallback"),
    );
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <Suspense
          fallback={
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-muted-foreground">Loading...</span>
            </div>
          }
        >
          <OAuthDebugCallback onConnect={onOAuthDebugConnect} />
        </Suspense>
      </div>
    );
  }

  const renderTabs = () => {
    // Show ClientFormSection when creating or editing a client
    if (serverState.isCreatingClient || serverState.editingClientName) {
      return (
        <ClientFormSection
          isCreating={serverState.isCreatingClient}
          editingClientName={serverState.editingClientName}
          clientFormName={serverState.clientFormName}
          setClientFormName={serverState.setClientFormName}
          clientFormConfig={serverState.clientFormConfig}
          setClientFormConfig={serverState.setClientFormConfig}
          config={configState.config}
          setConfig={configState.setConfig}
          bearerToken={configState.bearerToken}
          setBearerToken={configState.setBearerToken}
          headerName={configState.headerName}
          setHeaderName={configState.setHeaderName}
          onSave={handleSaveClient}
          onCancel={serverState.handleCancelClientForm}
        />
      );
    }

    const serverHasNoCapabilities =
      !serverCapabilities?.resources &&
      !serverCapabilities?.prompts &&
      !serverCapabilities?.tools;

    const renderServerNotConnected = () => {
      if (!connectionState.mcpAgent) {
        return (
          <div className="flex flex-col items-center justify-center p-12 rounded-xl bg-card border border-border/50 shadow-sm">
            <Activity className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">Connect to a server</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Please connect to a server to use the MCP Inspector.
            </p>
          </div>
        );
      }
    };

    const renderServerNoCapabilities = () => {
      if (serverHasNoCapabilities) {
        return (
          <div className="flex flex-col items-center justify-center p-12 rounded-xl bg-card border border-border/50 shadow-sm">
            <Activity className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              No Capabilities Available
            </h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              The connected server does not support any MCP capabilities. You
              can still use the Ping feature to test connectivity.
            </p>
            <div className="w-full max-w-sm">
              <PingTab
                onPingClick={() => {
                  void sendMCPRequest(
                    {
                      method: "ping" as const,
                    },
                    EmptyResultSchema,
                  );
                }}
              />
            </div>
          </div>
        );
      }
    };

    const renderCurrentPage = () => {
      switch (configState.currentPage) {
        case "resources":
          return (
            <ResourcesTab
              resources={mcpOperations.resources}
              resourceTemplates={mcpOperations.resourceTemplates}
              listResources={() => {
                mcpOperations.clearError("resources");
                mcpOperations.listResources(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                );
              }}
              clearResources={() => {
                mcpOperations.setResources([]);
                mcpOperations.setNextResourceCursor(undefined);
              }}
              listResourceTemplates={() => {
                mcpOperations.clearError("resources");
                mcpOperations.listResourceTemplates(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                );
              }}
              clearResourceTemplates={() => {
                mcpOperations.setResourceTemplates([]);
                mcpOperations.setNextResourceTemplateCursor(undefined);
              }}
              readResource={(uri) => {
                mcpOperations.clearError("resources");
                mcpOperations.readResource(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                  uri,
                );
              }}
              selectedResource={mcpOperations.selectedResource}
              setSelectedResource={(resource) => {
                mcpOperations.clearError("resources");
                mcpOperations.setSelectedResource(resource);
              }}
              resourceSubscriptionsSupported={
                serverCapabilities?.resources?.subscribe || false
              }
              resourceSubscriptions={mcpOperations.resourceSubscriptions}
              subscribeToResource={(uri) => {
                mcpOperations.clearError("resources");
                mcpOperations.subscribeToResource(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                  uri,
                );
              }}
              unsubscribeFromResource={(uri) => {
                mcpOperations.clearError("resources");
                mcpOperations.unsubscribeFromResource(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                  uri,
                );
              }}
              handleCompletion={handleCompletion}
              completionsSupported={completionsSupported}
              resourceContent={mcpOperations.resourceContent}
              nextCursor={mcpOperations.nextResourceCursor}
              nextTemplateCursor={mcpOperations.nextResourceTemplateCursor}
              error={mcpOperations.errors.resources}
              selectedServerName={serverState.selectedServerName}
            />
          );
        case "prompts":
          return (
            <PromptsTab
              prompts={mcpOperations.prompts}
              listPrompts={() => {
                mcpOperations.clearError("prompts");
                mcpOperations.listPrompts(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                );
              }}
              clearPrompts={() => {
                mcpOperations.setPrompts([]);
                mcpOperations.setNextPromptCursor(undefined);
              }}
              getPrompt={(name, args) => {
                mcpOperations.clearError("prompts");
                mcpOperations.getPrompt(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                  name,
                  args,
                );
              }}
              selectedPrompt={mcpOperations.selectedPrompt}
              setSelectedPrompt={(prompt) => {
                mcpOperations.clearError("prompts");
                mcpOperations.setSelectedPrompt(prompt);
                mcpOperations.setPromptContent("");
              }}
              handleCompletion={handleCompletion}
              completionsSupported={completionsSupported}
              promptContent={mcpOperations.promptContent}
              nextCursor={mcpOperations.nextPromptCursor}
              error={mcpOperations.errors.prompts}
              selectedServerName={serverState.selectedServerName}
            />
          );
        case "tools":
          return (
            <ToolsTab
              tools={mcpOperations.tools}
              listTools={() => {
                mcpOperations.clearError("tools");
                mcpOperations.listTools(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                );
              }}
              clearTools={() => {
                mcpOperations.setTools([]);
                mcpOperations.setNextToolCursor(undefined);
              }}
              callTool={async (name, params) => {
                mcpOperations.clearError("tools");
                mcpOperations.setToolResult(null);
                await mcpOperations.callTool(
                  connectionState.mcpAgent,
                  serverState.selectedServerName,
                  name,
                  params,
                );
              }}
              selectedTool={mcpOperations.selectedTool}
              setSelectedTool={(tool) => {
                mcpOperations.clearError("tools");
                mcpOperations.setSelectedTool(tool);
                mcpOperations.setToolResult(null);
              }}
              toolResult={mcpOperations.toolResult}
              nextCursor={mcpOperations.nextToolCursor}
              error={mcpOperations.errors.tools}
              connectionStatus={
                connectionStatus as
                  | "connected"
                  | "disconnected"
                  | "error"
                  | "error-connecting-to-proxy"
              }
              selectedServerName={serverState.selectedServerName}
            />
          );
        case "chat":
          return <ChatTab />;
        case "console":
          return <ConsoleTab />;
        case "ping":
          return (
            <PingTab
              onPingClick={() => {
                void sendMCPRequest(
                  {
                    method: "ping" as const,
                  },
                  EmptyResultSchema,
                );
              }}
            />
          );
        case "sampling":
          return (
            <SamplingTab
              pendingRequests={mcpOperations.pendingSampleRequests}
              onApprove={mcpOperations.handleApproveSampling}
              onReject={mcpOperations.handleRejectSampling}
            />
          );
        case "roots":
          return (
            <RootsTab
              roots={mcpOperations.roots}
              setRoots={mcpOperations.setRoots}
              onRootsChange={handleRootsChangeWrapper}
            />
          );
        case "auth":
          return (
            <AuthDebugger
              serverUrl={(() => {
                const currentConfig =
                  serverState.serverConfigs[serverState.selectedServerName];
                return currentConfig &&
                  "url" in currentConfig &&
                  currentConfig.url
                  ? currentConfig.url.toString()
                  : "";
              })()}
              onBack={() => configState.setCurrentPage("resources")}
              authState={configState.authState}
              updateAuthState={configState.updateAuthState}
            />
          );
        case "settings":
          return (
            <SettingsTab
              onApiKeyChange={handleApiKeyChange}
              disabled={
                connectionStatus !== "connected" &&
                connectionStatus !== "disconnected"
              }
            />
          );
        default:
          return null;
      }
    };

    return (
      <div className="flex-1 flex flex-col overflow-auto p-6">
        {!connectionState.mcpAgent
          ? renderServerNotConnected()
          : serverHasNoCapabilities
            ? renderServerNoCapabilities()
            : renderCurrentPage()}
      </div>
    );
  };

  return (
    <McpClientContext.Provider value={currentClient}>
      <div className="h-screen bg-gradient-to-br from-slate-50/50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-800/50 flex overflow-hidden app-container">
        {/* Sidebar - Full Height Left Side */}
        <Sidebar
          mcpAgent={connectionState.mcpAgent}
          selectedServerName={serverState.selectedServerName}
          onServerSelect={serverState.setSelectedServerName}
          onRemoveServer={handleRemoveServer}
          onConnectServer={connectionState.connectServer}
          onDisconnectServer={connectionState.disconnectServer}
          onCreateClient={serverState.handleCreateClient}
          onEditClient={handleEditClient}
          updateTrigger={connectionState.sidebarUpdateTrigger}
        />

        {/* Main Content Area - Right Side */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Horizontal Tabs */}
          <Tabs
            currentPage={configState.currentPage}
            onPageChange={configState.setCurrentPage}
            serverCapabilities={serverCapabilities}
            pendingSampleRequests={mcpOperations.pendingSampleRequests}
            shouldDisableAll={!connectionState.mcpAgent}
          />

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden overflow-y-auto">
            {renderTabs()}
          </div>

          {/* History Panel */}
          <HistoryAndNotifications
            requestHistory={requestHistory}
            toolResult={mcpOperations.toolResult}
          />
        </div>
      </div>
    </McpClientContext.Provider>
  );
};

export default App;
