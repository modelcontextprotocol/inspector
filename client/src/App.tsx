import {
  ClientRequest,
  CompatibilityCallToolResult,
  CreateMessageResult,
  CreateMessageRequest,
  EmptyResultSchema,
  Resource,
  ResourceTemplate,
  Root,
  Tool,
  LoggingLevel,
  ResourceReference,
  PromptReference,
} from "@modelcontextprotocol/sdk/types.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./lib/constants";
import { AuthDebuggerState } from "./lib/auth-types";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import { StdErrNotification } from "./lib/notificationTypes";

import { Activity } from "lucide-react";

import { z } from "zod";
import "./App.css";
import AuthDebugger from "./components/AuthDebugger";
import ConsoleTab from "./components/ConsoleTab";
import HistoryAndNotifications from "./components/History";
import PingTab from "./components/PingTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import ResourcesTab from "./components/ResourcesTab";
import RootsTab from "./components/RootsTab";
import SamplingTab, { PendingRequest } from "./components/SamplingTab";
import ToolsTab from "./components/ToolsTab";
import ChatTab from "./components/ChatTab";
import Sidebar from "./components/Sidebar";
import Tabs from "./components/Tabs";
import SettingsTab from "./components/SettingsTab";
import { InspectorConfig } from "./lib/configurationTypes";
import ConnectionSection from "./components/ConnectionSection";
import {
  getMCPProxyAddress,
  getInitialSseUrl,
  getInitialTransportType,
  getInitialCommand,
  getInitialArgs,
  initializeInspectorConfig,
} from "./utils/configUtils";
import {
  handleApproveSampling,
  handleRejectSampling,
  clearError,
  sendMCPRequest,
  handleRootsChange,
  sendLogLevelRequest,
  MCPHelperDependencies,
} from "./utils/mcpHelpers";
import { McpClientContext } from "@/context/McpClientContext";
import { MCPJamServerConfig, StdioServerDefinition } from "./lib/serverTypes";
import { MCPJamAgent, MCPClientOptions, ServerConnectionInfo } from "./mcpjamAgent";

const CONFIG_LOCAL_STORAGE_KEY = "inspectorConfig_v1";
const CLAUDE_API_KEY_STORAGE_KEY = "claude-api-key";

// Validate Claude API key format
const validateClaudeApiKey = (key: string): boolean => {
  // Claude API keys start with "sk-ant-api03-" and are followed by base64-like characters
  const claudeApiKeyPattern = /^sk-ant-api03-[A-Za-z0-9_-]+$/;
  return claudeApiKeyPattern.test(key) && key.length > 20;
};

// Update ConnectionStatus type to include "partial"
type ExtendedConnectionStatus = "disconnected" | "connected" | "error" | "error-connecting-to-proxy" | "partial";

const App = () => {
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >([]);
  const [resourceContent, setResourceContent] = useState<string>("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptContent, setPromptContent] = useState<string>("");
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolResult, setToolResult] =
    useState<CompatibilityCallToolResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({
    resources: null,
    prompts: null,
    tools: null,
  });

  // Replace single serverConfig with multiple servers
  const [serverConfigs, setServerConfigs] = useState<Record<string, MCPJamServerConfig>>(() => {
    const transportType = getInitialTransportType();
    const defaultServerName = "default";
    if (transportType === "stdio") {
      return {
        [defaultServerName]: {
          transportType: transportType,
          command: getInitialCommand(),
          args: getInitialArgs().split(" ").filter(arg => arg.trim() !== ""),
          env: {},
        }
      };
    } else {
      return {
        [defaultServerName]: {
          transportType: transportType,
          url: new URL(getInitialSseUrl()),
        }
      };
    }
  });

  // Add state for managing multiple servers
  const [selectedServerName] = useState<string>("default");
  const [serverConnections, setServerConnections] = useState<ServerConnectionInfo[]>([]);

  const [logLevel, setLogLevel] = useState<LoggingLevel>("debug");
  const [stdErrNotifications, setStdErrNotifications] = useState<
    StdErrNotification[]
  >([]);
  const [roots, setRoots] = useState<Root[]>([]);


  const [config, setConfig] = useState<InspectorConfig>(() =>
    initializeInspectorConfig(CONFIG_LOCAL_STORAGE_KEY),
  );
  const [bearerToken, setBearerToken] = useState<string>(() => {
    return localStorage.getItem("lastBearerToken") || "";
  });

  const [headerName, setHeaderName] = useState<string>(() => {
    return localStorage.getItem("lastHeaderName") || "";
  });

  const [pendingSampleRequests, setPendingSampleRequests] = useState<
    Array<
      PendingRequest & {
        resolve: (result: CreateMessageResult) => void;
        reject: (error: Error) => void;
      }
    >
  >([]);

  // Auth debugger state
  const [authState, setAuthState] = useState<AuthDebuggerState>({
    isInitiatingAuth: false,
    oauthTokens: null,
    loading: true,
    oauthStep: "metadata_discovery",
    oauthMetadata: null,
    oauthClientInfo: null,
    authorizationUrl: null,
    authorizationCode: "",
    latestError: null,
    statusMessage: null,
    validationError: null,
  });

  // Helper function to update specific auth state properties
  const updateAuthState = (updates: Partial<AuthDebuggerState>) => {
    setAuthState((prev) => ({ ...prev, ...updates }));
  };
  const nextRequestId = useRef(0);
  const rootsRef = useRef<Root[]>([]);

  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [resourceSubscriptions, setResourceSubscriptions] = useState<
    Set<string>
  >(new Set<string>());

  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [nextResourceCursor, setNextResourceCursor] = useState<
    string | undefined
  >();
  const [nextResourceTemplateCursor, setNextResourceTemplateCursor] = useState<
    string | undefined
  >();
  const [nextPromptCursor, setNextPromptCursor] = useState<
    string | undefined
  >();
  const [nextToolCursor, setNextToolCursor] = useState<string | undefined>();
  const progressTokenRef = useRef(0);

  const [claudeApiKey, setClaudeApiKey] = useState<string>(() => {
    // Load Claude API key from localStorage on app initialization
    try {
      const storedApiKey =
        localStorage.getItem(CLAUDE_API_KEY_STORAGE_KEY) || "";
      if (storedApiKey && validateClaudeApiKey(storedApiKey)) {
        return storedApiKey;
      }
    } catch (error) {
      console.warn("Failed to load Claude API key from localStorage:", error);
    }
    return "";
  });

  const [currentPage, setCurrentPage] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    return hash || "tools";
  });

  // Replace single mcpClient with MCPJamAgent
  const [mcpAgent, setMcpAgent] = useState<MCPJamAgent | null>(null);

  // Use callbacks to prevent MCPJamClient recreation
  const onStdErrNotification = useCallback((notification: StdErrNotification) => {
    setStdErrNotifications((prev) => [
      ...prev,
      notification,
    ]);
  }, []);

  const onPendingRequest = useCallback((request: CreateMessageRequest, resolve: (result: CreateMessageResult) => void, reject: (error: Error) => void) => {
    setPendingSampleRequests((prev) => [
      ...prev,
      { id: nextRequestId.current++, request, resolve, reject },
    ]);
  }, []);

  const getRootsCallback = useCallback(() => rootsRef.current, []);

  // Update the connect function to use MCPJamAgent
  const connect = useCallback(async () => {
    const options: MCPClientOptions = {
      servers: serverConfigs,
      config,
      bearerToken,
      headerName,
      claudeApiKey,
      onStdErrNotification,
      onPendingRequest,
      getRoots: getRootsCallback,
    };

    const agent = new MCPJamAgent(options);
    
    try {
      await agent.connectToAllServers();
      setMcpAgent(agent);
      setServerConnections(agent.getAllConnectionInfo());
    } catch (error) {
      console.error("Failed to connect to servers:", error);
      setMcpAgent(null);
    }
  }, [
    serverConfigs,
    config,
    bearerToken,
    headerName,
    claudeApiKey,
    onStdErrNotification,
    onPendingRequest,
    getRootsCallback,
  ]);

  const disconnect = useCallback(async () => {
    if (mcpAgent) {
      await mcpAgent.disconnectFromAllServers();
      setMcpAgent(null);
      setServerConnections([]);
    }
  }, [mcpAgent]);

  // Handler to update transport type and serverConfig accordingly
  const handleTransportTypeChange = useCallback((newTransportType: "stdio" | "sse" | "streamable-http") => {
    if (newTransportType === "stdio") {
      // Switch to stdio config for the selected server
      setServerConfigs(prev => ({
        ...prev,
        [selectedServerName]: {
          transportType: newTransportType,
          command: getInitialCommand(),
          args: getInitialArgs().split(" ").filter(arg => arg.trim() !== ""),
          env: {},
        }
      }));
    } else {
      // Switch to HTTP config (SSE or streamable-http) for the selected server
      setServerConfigs(prev => ({
        ...prev,
        [selectedServerName]: {
          transportType: newTransportType,
          url: new URL(getInitialSseUrl()),
        }
      }));
    }
  }, [selectedServerName]);

  // Update connection status and capabilities to work with multiple servers
  const connectionStatus: ExtendedConnectionStatus = mcpAgent?.getOverallConnectionStatus() || "disconnected";
  const serverCapabilities = selectedServerName === "all"
    ? null // You'll need to merge capabilities or handle this differently
    : serverConnections.find(s => s.name === selectedServerName)?.capabilities || null;
  
  // Get request history from agent or current client
  const requestHistory = mcpAgent?.getAllRequestHistory().flatMap(({ history }) => history) || [];
  
  // Create makeRequest function that works with the agent
  const makeRequest = useCallback(async (request: ClientRequest) => {
    if (!mcpAgent) {
      throw new Error("Agent not connected");
    }
    
    if (selectedServerName === "all") {
      throw new Error("Cannot make requests when 'all' servers are selected. Please select a specific server.");
    }
    
    const client = mcpAgent.getClient(selectedServerName);
    if (!client) {
      throw new Error(`Client for server ${selectedServerName} not found`);
    }
    
    return await client.makeRequest(request, z.any());
  }, [mcpAgent, selectedServerName]);

  // Create handleCompletion function with proper typing
  const handleCompletion = useCallback(async (ref: ResourceReference | PromptReference, argName: string, value: string, signal?: AbortSignal) => {
    if (!mcpAgent || selectedServerName === "all") {
      return [];
    }
    
    const client = mcpAgent.getClient(selectedServerName);
    if (!client) {
      return [];
    }
    
    return await client.handleCompletion(ref, argName, value, signal);
  }, [mcpAgent, selectedServerName]);

  const completionsSupported = selectedServerName === "all" 
    ? false 
    : mcpAgent?.getClient(selectedServerName)?.completionsSupported || false;

  // Create updateApiKey function
  const updateApiKey = useCallback((newApiKey: string) => {
    if (mcpAgent) {
      mcpAgent.updateCredentials(undefined, undefined, newApiKey);
    }
  }, [mcpAgent]);

  // Handler to update both state and the MCP client's API key
  const handleApiKeyChange = (newApiKey: string) => {
    setClaudeApiKey(newApiKey);
    updateApiKey(newApiKey);
  };

  useEffect(() => {
    if (serverConfigs[selectedServerName]?.transportType === "stdio" && "command" in serverConfigs[selectedServerName]) {
      localStorage.setItem("lastCommand", serverConfigs[selectedServerName].command || "");
    }
  }, [serverConfigs, selectedServerName]);

  useEffect(() => {
    if (serverConfigs[selectedServerName]?.transportType === "stdio" && "args" in serverConfigs[selectedServerName]) {
      localStorage.setItem("lastArgs", serverConfigs[selectedServerName].args?.join(" ") || "");
    }
  }, [serverConfigs, selectedServerName]);

  useEffect(() => {
    if ("url" in serverConfigs[selectedServerName] && serverConfigs[selectedServerName].url) {
      localStorage.setItem("lastSseUrl", serverConfigs[selectedServerName].url.toString());
    }
  }, [serverConfigs, selectedServerName]);

  useEffect(() => {
    localStorage.setItem("lastTransportType", serverConfigs[selectedServerName]?.transportType || "");
  }, [serverConfigs, selectedServerName]);

  useEffect(() => {
    localStorage.setItem("lastBearerToken", bearerToken);
  }, [bearerToken]);

  useEffect(() => {
    localStorage.setItem("lastHeaderName", headerName);
  }, [headerName]);

  useEffect(() => {
    localStorage.setItem(CONFIG_LOCAL_STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  // Auto-connect to previously saved serverURL after OAuth callback
  const onOAuthConnect = useCallback(
    (serverUrl: string) => {
      setServerConfigs(prev => ({
        ...prev,
        [selectedServerName]: {
          transportType: serverConfigs[selectedServerName]?.transportType || "stdio",
          url: new URL(serverUrl),
        }
      }));

      void connect();
    },
    [connect, selectedServerName, serverConfigs],
  );

  // Update OAuth debug state during debug callback
  const onOAuthDebugConnect = useCallback(
    ({
      authorizationCode,
      errorMsg,
    }: {
      authorizationCode?: string;
      errorMsg?: string;
    }) => {
      if (authorizationCode) {
        updateAuthState({
          authorizationCode,
          oauthStep: "token_request",
        });
      }
      if (errorMsg) {
        updateAuthState({
          latestError: new Error(errorMsg),
        });
      }
    },
    [],
  );

  // Load OAuth tokens when sseUrl changes
  useEffect(() => {
    const loadOAuthTokens = async () => {
      try {
        if ("url" in serverConfigs[selectedServerName] && serverConfigs[selectedServerName].url) {
          const key = getServerSpecificKey(SESSION_KEYS.TOKENS, serverConfigs[selectedServerName].url.toString());
          const tokens = sessionStorage.getItem(key);
          if (tokens) {
            const parsedTokens = await OAuthTokensSchema.parseAsync(
              JSON.parse(tokens),
            );
            updateAuthState({
              oauthTokens: parsedTokens,
              oauthStep: "complete",
            });
          }
        }
      } catch (error) {
        console.error("Error loading OAuth tokens:", error);
      } finally {
        updateAuthState({ loading: false });
      }
    };

    loadOAuthTokens();
  }, [selectedServerName, serverConfigs]);

  useEffect(() => {
    fetch(`${getMCPProxyAddress(config)}/config`)
      .then((response) => response.json())
      .then((data) => {
        if (serverConfigs[selectedServerName]?.transportType === "stdio") {
          setServerConfigs(prev => ({
            ...prev,
            [selectedServerName]: {
              ...prev[selectedServerName],
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

  useEffect(() => {
    rootsRef.current = roots;
  }, [roots]);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "tools";
    }
  }, []);

  // Add effect to handle hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        setCurrentPage(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Create helper dependencies and state objects - only keeping what's needed
  const helperDependencies: MCPHelperDependencies = {
    makeRequest,
    sendNotification: async () => {},
    setErrors,
    setResources,
    setResourceTemplates,
    setResourceContent,
    setResourceSubscriptions,
    setPrompts,
    setPromptContent,
    setTools,
    setToolResult,
    setNextResourceCursor,
    setNextResourceTemplateCursor,
    setNextPromptCursor,
    setNextToolCursor,
    setLogLevel,
    setStdErrNotifications,
    setPendingSampleRequests,
    progressTokenRef,
  };

  // Replace the old helper functions with calls to imported ones
  const handleApproveSamplingWrapper = (
    id: number,
    result: CreateMessageResult,
  ) => {
    handleApproveSampling(id, result, setPendingSampleRequests);
  };

  const handleRejectSamplingWrapper = (id: number) => {
    handleRejectSampling(id, setPendingSampleRequests);
  };

  const clearErrorWrapper = (tabKey: keyof typeof errors) => {
    clearError(tabKey, setErrors);
  };

  const sendMCPRequestWrapper = async <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    tabKey?: keyof typeof errors,
  ) => {
    return sendMCPRequest(request, schema, helperDependencies, tabKey);
  };

  const listResourcesWrapper = async () => {
    if (!mcpAgent) return;
    
    if (selectedServerName === "all") {
      // Get resources from all servers
      const allServerResources = await mcpAgent.getAllResources();
      const flatResources = allServerResources.flatMap(({ resources }) => resources);
      setResources(flatResources);
    } else {
      // Get resources from specific server
      const client = mcpAgent.getClient(selectedServerName);
      if (client) {
        const resourcesResponse = await client.listResources();
        setResources(resourcesResponse.resources);
      }
    }
  };

  const listResourceTemplatesWrapper = async () => {
    if (!mcpAgent) return;
    
    if (selectedServerName === "all") {
      // For now, just get from first server - you might want to aggregate differently
      const allServerResources = await mcpAgent.getAllResources();
      if (allServerResources.length > 0) {
        const client = mcpAgent.getClient(allServerResources[0].serverName);
        if (client) {
          const templatesResponse = await client.listResourceTemplates();
          setResourceTemplates(templatesResponse.resourceTemplates);
        }
      }
    } else {
      const client = mcpAgent.getClient(selectedServerName);
      if (client) {
        const templatesResponse = await client.listResourceTemplates();
        setResourceTemplates(templatesResponse.resourceTemplates);
      }
    }
  };

  const readResourceWrapper = async (uri: string) => {
    if (!mcpAgent) return;
    
    if (selectedServerName !== "all") {
      return await mcpAgent.readResourceFromServer(selectedServerName, uri);
    } else {
      // Try to find which server has this resource
      const allResources = await mcpAgent.getAllResources();
      for (const { serverName, resources } of allResources) {
        if (resources.some(resource => resource.uri === uri)) {
          return await mcpAgent.readResourceFromServer(serverName, uri);
        }
      }
      throw new Error(`Resource ${uri} not found on any server`);
    }
  };

  const subscribeToResourceWrapper = async (uri: string) => {
    if (!mcpAgent || selectedServerName === "all") return;
    
    const client = mcpAgent.getClient(selectedServerName);
    if (client) {
      return await client.subscribeResource({ uri });
    }
  };

  const unsubscribeFromResourceWrapper = async (uri: string) => {
    if (!mcpAgent || selectedServerName === "all") return;
    
    const client = mcpAgent.getClient(selectedServerName);
    if (client) {
      return await client.unsubscribeResource({ uri });
    }
  };

  const listPromptsWrapper = async () => {
    if (!mcpAgent) return;
    
    if (selectedServerName === "all") {
      // Get prompts from all servers
      const allServerPrompts = await mcpAgent.getAllPrompts();
      const flatPrompts = allServerPrompts.flatMap(({ prompts }) => prompts);
      setPrompts(flatPrompts);
    } else {
      // Get prompts from specific server
      const client = mcpAgent.getClient(selectedServerName);
      if (client) {
        const promptsResponse = await client.listPrompts();
        setPrompts(promptsResponse.prompts);
      }
    }
  };

  const getPromptWrapper = async (name: string, args: Record<string, string> = {}) => {
    if (!mcpAgent) return;
    
    if (selectedServerName !== "all") {
      return await mcpAgent.getPromptFromServer(selectedServerName, name, args);
    } else {
      // Try to find which server has this prompt
      const allPrompts = await mcpAgent.getAllPrompts();
      for (const { serverName, prompts } of allPrompts) {
        if (prompts.some(prompt => prompt.name === name)) {
          return await mcpAgent.getPromptFromServer(serverName, name, args);
        }
      }
      throw new Error(`Prompt ${name} not found on any server`);
    }
  };

  const listToolsWrapper = async () => {
    if (!mcpAgent) return;
    
    if (selectedServerName === "all") {
      // Get tools from all servers
      const allServerTools = await mcpAgent.getAllTools();
      const flatTools = allServerTools.flatMap(({ tools }) => tools);
      setTools(flatTools);
    } else {
      // Get tools from specific server
      const client = mcpAgent.getClient(selectedServerName);
      if (client) {
        const toolsResponse = await client.tools();
        setTools(toolsResponse.tools);
      }
    }
  };

  const callToolWrapper = async (name: string, params: Record<string, unknown>) => {
    if (!mcpAgent) return;
    
    try {
      // For tool calls, we need to know which server has the tool
      if (selectedServerName !== "all") {
        const result = await mcpAgent.callToolOnServer(selectedServerName, name, params);
        setToolResult(result);
      } else {
        // If "all" is selected, try to find which server has this tool
        const allTools = await mcpAgent.getAllTools();
        for (const { serverName, tools } of allTools) {
          if (tools.some(tool => tool.name === name)) {
            const result = await mcpAgent.callToolOnServer(serverName, name, params);
            setToolResult(result);
            return;
          }
        }
        throw new Error(`Tool ${name} not found on any server`);
      }
    } catch (e) {
      const toolResult: CompatibilityCallToolResult = {
        content: [
          {
            type: "text",
            text: (e as Error).message ?? String(e),
          },
        ],
        isError: true,
      };
      setToolResult(toolResult);
    }
  };

  const handleRootsChangeWrapper = async () => {
    if (!mcpAgent || selectedServerName === "all") return;
    
    const client = mcpAgent.getClient(selectedServerName);
    if (client) {
      return handleRootsChange({ makeRequest: client.makeRequest.bind(client) } as MCPHelperDependencies);
    }
  };

  const sendLogLevelRequestWrapper = async (level: LoggingLevel) => {
    if (!mcpAgent || selectedServerName === "all") return;
    
    const client = mcpAgent.getClient(selectedServerName);
    if (client) {
      return sendLogLevelRequest(level, { makeRequest: client.makeRequest.bind(client) } as MCPHelperDependencies);
    }
  };

  const clearStdErrNotificationsWrapper = () => {
    setStdErrNotifications([]);
  };

  // Helper function to render OAuth callback components
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
    const serverHasNoCapabilities =
      !serverCapabilities?.resources &&
      !serverCapabilities?.prompts &&
      !serverCapabilities?.tools;

    const renderServerNotConnected = () => {
      if (!mcpAgent) {
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
                  void sendMCPRequestWrapper(
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
      switch (currentPage) {
        case "resources":
          return (
            <ResourcesTab
              resources={resources}
              resourceTemplates={resourceTemplates}
              listResources={() => {
                clearErrorWrapper("resources");
                listResourcesWrapper();
              }}
              clearResources={() => {
                setResources([]);
                setNextResourceCursor(undefined);
              }}
              listResourceTemplates={() => {
                clearErrorWrapper("resources");
                listResourceTemplatesWrapper();
              }}
              clearResourceTemplates={() => {
                setResourceTemplates([]);
                setNextResourceTemplateCursor(undefined);
              }}
              readResource={(uri) => {
                clearErrorWrapper("resources");
                readResourceWrapper(uri);
              }}
              selectedResource={selectedResource}
              setSelectedResource={(resource) => {
                clearErrorWrapper("resources");
                setSelectedResource(resource);
              }}
              resourceSubscriptionsSupported={
                serverCapabilities?.resources?.subscribe || false
              }
              resourceSubscriptions={resourceSubscriptions}
              subscribeToResource={(uri) => {
                clearErrorWrapper("resources");
                subscribeToResourceWrapper(uri);
              }}
              unsubscribeFromResource={(uri) => {
                clearErrorWrapper("resources");
                unsubscribeFromResourceWrapper(uri);
              }}
              handleCompletion={handleCompletion}
              completionsSupported={completionsSupported}
              resourceContent={resourceContent}
              nextCursor={nextResourceCursor}
              nextTemplateCursor={nextResourceTemplateCursor}
              error={errors.resources}
            />
          );
        case "prompts":
          return (
            <PromptsTab
              prompts={prompts}
              listPrompts={() => {
                clearErrorWrapper("prompts");
                listPromptsWrapper();
              }}
              clearPrompts={() => {
                setPrompts([]);
                setNextPromptCursor(undefined);
              }}
              getPrompt={(name, args) => {
                clearErrorWrapper("prompts");
                getPromptWrapper(name, args);
              }}
              selectedPrompt={selectedPrompt}
              setSelectedPrompt={(prompt) => {
                clearErrorWrapper("prompts");
                setSelectedPrompt(prompt);
                setPromptContent("");
              }}
              handleCompletion={handleCompletion}
              completionsSupported={completionsSupported}
              promptContent={promptContent}
              nextCursor={nextPromptCursor}
              error={errors.prompts}
            />
          );
        case "tools":
          return (
            <ToolsTab
              tools={tools}
              listTools={() => {
                clearErrorWrapper("tools");
                listToolsWrapper();
              }}
              clearTools={() => {
                setTools([]);
                setNextToolCursor(undefined);
              }}
              callTool={async (name, params) => {
                clearErrorWrapper("tools");
                setToolResult(null);
                await callToolWrapper(name, params);
              }}
              selectedTool={selectedTool}
              setSelectedTool={(tool) => {
                clearErrorWrapper("tools");
                setSelectedTool(tool);
                setToolResult(null);
              }}
              toolResult={toolResult}
              nextCursor={nextToolCursor}
              error={errors.tools}
              connectionStatus={connectionStatus as "connected" | "disconnected" | "error" | "error-connecting-to-proxy"}
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
                void sendMCPRequestWrapper(
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
              pendingRequests={pendingSampleRequests}
              onApprove={handleApproveSamplingWrapper}
              onReject={handleRejectSamplingWrapper}
            />
          );
        case "roots":
          return (
            <RootsTab
              roots={roots}
              setRoots={setRoots}
              onRootsChange={handleRootsChangeWrapper}
            />
          );
        case "auth":
          return (
            <AuthDebugger
              serverUrl={"url" in serverConfigs[selectedServerName] && serverConfigs[selectedServerName].url ? serverConfigs[selectedServerName].url.toString() : ""}
              onBack={() => setCurrentPage("resources")}
              authState={authState}
              updateAuthState={updateAuthState}
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
        {!mcpAgent
          ? renderServerNotConnected()
          : serverHasNoCapabilities
            ? renderServerNoCapabilities()
            : renderCurrentPage()}
      </div>
    );
  };

  // Update the context provider to use the current client instead of the agent
  const currentClient = mcpAgent?.getClient(selectedServerName) || null;

  return (
    <McpClientContext.Provider value={currentClient}>
      <div className="h-screen bg-gradient-to-br from-slate-50/50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-800/50 flex overflow-hidden app-container">
        {/* Sidebar - Full Height Left Side */}
        <Sidebar />

        {/* Main Content Area - Right Side */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Connection Section */}
          <div className="bg-background/80 backdrop-blur-md border-b border-border/50 shadow-sm">
            <ConnectionSection
              connectionStatus={connectionStatus as "connected" | "disconnected" | "error" | "error-connecting-to-proxy"}
              transportType={serverConfigs[selectedServerName]?.transportType || "stdio"}
              setTransportType={handleTransportTypeChange}
              command={serverConfigs[selectedServerName]?.transportType === "stdio" && "command" in serverConfigs[selectedServerName] ? (serverConfigs[selectedServerName] as StdioServerDefinition).command || "" : ""}
              setCommand={(newCommand) => {
                if (serverConfigs[selectedServerName]?.transportType === "stdio") {
                  setServerConfigs(prev => ({
                    ...prev,
                    [selectedServerName]: {
                      ...prev[selectedServerName],
                      command: newCommand,
                    } as StdioServerDefinition,
                  }));
                }
              }}
              args={serverConfigs[selectedServerName]?.transportType === "stdio" && "args" in serverConfigs[selectedServerName] ? (serverConfigs[selectedServerName] as StdioServerDefinition).args?.join(" ") || "" : ""}
              setArgs={(newArgs) => {
                if (serverConfigs[selectedServerName]?.transportType === "stdio") {
                  setServerConfigs(prev => ({
                    ...prev,
                    [selectedServerName]: {
                      ...prev[selectedServerName],
                      args: newArgs.split(" ").filter(arg => arg.trim() !== ""),
                    } as StdioServerDefinition,
                  }));
                }
              }}
              sseUrl={"url" in serverConfigs[selectedServerName] && serverConfigs[selectedServerName].transportType !== "stdio" ? (serverConfigs[selectedServerName] as { url: URL }).url.toString() : ""}
              setSseUrl={(newSseUrl) => {
                if (serverConfigs[selectedServerName]?.transportType !== "stdio") {
                  setServerConfigs(prev => ({
                    ...prev,
                    [selectedServerName]: {
                      ...prev[selectedServerName],
                      url: new URL(newSseUrl),
                    }
                  }));
                }
              }}
              env={serverConfigs[selectedServerName]?.transportType === "stdio" && "env" in serverConfigs[selectedServerName] ? (serverConfigs[selectedServerName] as StdioServerDefinition).env || {} : {}}
              setEnv={(newEnv) => {
                if (serverConfigs[selectedServerName]?.transportType === "stdio") {
                  setServerConfigs(prev => ({
                    ...prev,
                    [selectedServerName]: {
                      ...prev[selectedServerName],
                      env: newEnv,
                    } as StdioServerDefinition,
                  }));
                }
              }}
              config={config}
              setConfig={setConfig}
              bearerToken={bearerToken}
              setBearerToken={setBearerToken}
              headerName={headerName}
              setHeaderName={setHeaderName}
              onConnect={connect}
              onDisconnect={disconnect}
              stdErrNotifications={stdErrNotifications}
              logLevel={logLevel}
              sendLogLevelRequest={sendLogLevelRequestWrapper}
              loggingSupported={!!serverCapabilities?.logging || false}
              clearStdErrNotifications={clearStdErrNotificationsWrapper}
            />
          </div>

          {/* Horizontal Tabs */}
          <Tabs
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            serverCapabilities={serverCapabilities}
            pendingSampleRequests={pendingSampleRequests}
            shouldDisableAll={!mcpAgent}
          />

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden overflow-y-auto">
            {renderTabs()}
          </div>

          {/* History Panel */}
          <HistoryAndNotifications
            requestHistory={requestHistory}
            toolResult={toolResult}
          />
        </div>
      </div>
    </McpClientContext.Provider>
  );
};

export default App;
