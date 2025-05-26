import {
  ClientRequest,
  CompatibilityCallToolResult,
  CreateMessageResult,
  EmptyResultSchema,
  Resource,
  ResourceTemplate,
  Root,
  Tool,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./lib/constants";
import { AuthDebuggerState } from "./lib/auth-types";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConnection } from "./lib/hooks/useConnection";
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
  listResources,
  listResourceTemplates,
  readResource,
  subscribeToResource,
  unsubscribeFromResource,
  listPrompts,
  getPrompt,
  listTools,
  callTool,
  handleRootsChange,
  sendLogLevelRequest,
  clearStdErrNotifications,
  MCPHelperDependencies,
  MCPHelperState,
} from "./utils/mcpHelpers";
import { McpClientContext } from "@/context/McpClientContext";

const CONFIG_LOCAL_STORAGE_KEY = "inspectorConfig_v1";
const CLAUDE_API_KEY_STORAGE_KEY = "claude-api-key";

// Validate Claude API key format
const validateClaudeApiKey = (key: string): boolean => {
  // Claude API keys start with "sk-ant-api03-" and are followed by base64-like characters
  const claudeApiKeyPattern = /^sk-ant-api03-[A-Za-z0-9_-]+$/;
  return claudeApiKeyPattern.test(key) && key.length > 20;
};

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
  const [command, setCommand] = useState<string>(getInitialCommand);
  const [args, setArgs] = useState<string>(getInitialArgs);

  const [sseUrl, setSseUrl] = useState<string>(getInitialSseUrl);
  const [transportType, setTransportType] = useState<
    "stdio" | "sse" | "streamable-http"
  >(getInitialTransportType);
  const [logLevel, setLogLevel] = useState<LoggingLevel>("debug");
  const [stdErrNotifications, setStdErrNotifications] = useState<
    StdErrNotification[]
  >([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});

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
    return hash || "resources";
  });

  console.log(currentPage);

  const {
    connectionStatus,
    serverCapabilities,
    mcpClient,
    requestHistory,
    makeRequest,
    sendNotification,
    handleCompletion,
    completionsSupported,
    connect: connectMcpServer,
    disconnect: disconnectMcpServer,
    updateApiKey,
  } = useConnection({
    transportType,
    command,
    args,
    sseUrl,
    env,
    bearerToken,
    headerName,
    config,
    claudeApiKey,
    onNotification: () => {
      // Server notifications are no longer displayed in the UI
    },
    onStdErrNotification: (notification) => {
      setStdErrNotifications((prev) => [
        ...prev,
        notification as StdErrNotification,
      ]);
    },
    onPendingRequest: (request, resolve, reject) => {
      setPendingSampleRequests((prev) => [
        ...prev,
        { id: nextRequestId.current++, request, resolve, reject },
      ]);
    },
    getRoots: () => rootsRef.current,
  });

  // Handler to update both state and the MCP client's API key
  const handleApiKeyChange = (newApiKey: string) => {
    setClaudeApiKey(newApiKey);
    updateApiKey(newApiKey);
  };

  console.log("mcpClient", mcpClient);
  useEffect(() => {
    localStorage.setItem("lastCommand", command);
  }, [command]);

  useEffect(() => {
    localStorage.setItem("lastArgs", args);
  }, [args]);

  useEffect(() => {
    localStorage.setItem("lastSseUrl", sseUrl);
  }, [sseUrl]);

  useEffect(() => {
    localStorage.setItem("lastTransportType", transportType);
  }, [transportType]);

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
      setSseUrl(serverUrl);

      void connectMcpServer();
    },
    [connectMcpServer],
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
        if (sseUrl) {
          const key = getServerSpecificKey(SESSION_KEYS.TOKENS, sseUrl);
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
  }, [sseUrl]);

  useEffect(() => {
    fetch(`${getMCPProxyAddress(config)}/config`)
      .then((response) => response.json())
      .then((data) => {
        setEnv(data.defaultEnvironment);
        if (data.defaultCommand) {
          setCommand(data.defaultCommand);
        }
        if (data.defaultArgs) {
          setArgs(data.defaultArgs);
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
      window.location.hash = "resources";
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

  // Create helper dependencies and state objects
  const helperDependencies: MCPHelperDependencies = {
    makeRequest,
    sendNotification,
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

  const helperState: MCPHelperState = {
    resources,
    resourceTemplates,
    resourceSubscriptions,
    nextResourceCursor,
    nextResourceTemplateCursor,
    nextPromptCursor,
    nextToolCursor,
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
    return listResources(helperState, helperDependencies);
  };

  const listResourceTemplatesWrapper = async () => {
    return listResourceTemplates(helperState, helperDependencies);
  };

  const readResourceWrapper = async (uri: string) => {
    return readResource(uri, helperDependencies);
  };

  const subscribeToResourceWrapper = async (uri: string) => {
    return subscribeToResource(uri, helperState, helperDependencies);
  };

  const unsubscribeFromResourceWrapper = async (uri: string) => {
    return unsubscribeFromResource(uri, helperState, helperDependencies);
  };

  const listPromptsWrapper = async () => {
    return listPrompts(helperState, helperDependencies);
  };

  const getPromptWrapper = async (
    name: string,
    args: Record<string, string> = {},
  ) => {
    return getPrompt(name, args, helperDependencies);
  };

  const listToolsWrapper = async () => {
    return listTools(helperState, helperDependencies);
  };

  const callToolWrapper = async (
    name: string,
    params: Record<string, unknown>,
  ) => {
    return callTool(name, params, helperDependencies);
  };

  const handleRootsChangeWrapper = async () => {
    return handleRootsChange(helperDependencies);
  };

  const sendLogLevelRequestWrapper = async (level: LoggingLevel) => {
    return sendLogLevelRequest(level, helperDependencies);
  };

  const clearStdErrNotificationsWrapper = () => {
    clearStdErrNotifications(setStdErrNotifications);
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
      if (!mcpClient) {
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
              connectionStatus={connectionStatus}
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
              serverUrl={sseUrl}
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
        {!mcpClient
          ? renderServerNotConnected()
          : serverHasNoCapabilities
            ? renderServerNoCapabilities()
            : renderCurrentPage()}
      </div>
    );
  };

  return (
    <McpClientContext.Provider value={mcpClient}>
      <div className="h-screen bg-gradient-to-br from-slate-50/50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-800/50 flex overflow-hidden app-container">
        {/* Sidebar - Full Height Left Side */}
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          serverCapabilities={serverCapabilities}
          pendingSampleRequests={pendingSampleRequests}
        />

        {/* Main Content Area - Right Side */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Connection Section */}
          <div className="bg-background/80 backdrop-blur-md border-b border-border/50 shadow-sm">
            <ConnectionSection
              connectionStatus={connectionStatus}
              transportType={transportType}
              setTransportType={setTransportType}
              command={command}
              setCommand={setCommand}
              args={args}
              setArgs={setArgs}
              sseUrl={sseUrl}
              setSseUrl={setSseUrl}
              env={env}
              setEnv={setEnv}
              config={config}
              setConfig={setConfig}
              bearerToken={bearerToken}
              setBearerToken={setBearerToken}
              headerName={headerName}
              setHeaderName={setHeaderName}
              onConnect={connectMcpServer}
              onDisconnect={disconnectMcpServer}
              stdErrNotifications={stdErrNotifications}
              logLevel={logLevel}
              sendLogLevelRequest={sendLogLevelRequestWrapper}
              loggingSupported={!!serverCapabilities?.logging || false}
              clearStdErrNotifications={clearStdErrNotificationsWrapper}
            />
          </div>

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
