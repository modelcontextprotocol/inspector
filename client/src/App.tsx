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

import {
  Bell,
  Files,
  FolderTree,
  Hammer,
  Hash,
  Key,
  MessageSquare,
  Activity,
  Bot,
} from "lucide-react";

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
import ApiKeyManager from "./components/ApiKeyManager";

const CONFIG_LOCAL_STORAGE_KEY = "inspectorConfig_v1";

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
  const [isAuthDebuggerVisible, setIsAuthDebuggerVisible] = useState(false);

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

  const [claudeApiKey, setClaudeApiKey] = useState<string>("");

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
      setIsAuthDebuggerVisible(false);
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
      setIsAuthDebuggerVisible(true);
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

    const handlePageChange = (page: string) => {
      setCurrentPage(page);
      window.location.hash = page;
    };

    const renderTabsList = () => {
      return (
        <div className="grid w-full grid-cols-7 bg-muted/30 backdrop-blur-sm border border-border/50 rounded-xl p-1 h-auto">
          <button
            onClick={() => handlePageChange("resources")}
            disabled={!serverCapabilities?.resources}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "resources"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Files className="w-4 h-4" />
            <span className="hidden sm:inline">Resources</span>
          </button>
          <button
            onClick={() => handlePageChange("prompts")}
            disabled={!serverCapabilities?.prompts}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "prompts"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Prompts</span>
          </button>
          <button
            onClick={() => handlePageChange("tools")}
            disabled={!serverCapabilities?.tools}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "tools"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Hammer className="w-4 h-4" />
            <span className="hidden sm:inline">Tools</span>
          </button>
          <button
            onClick={() => handlePageChange("chat")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "chat"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            }`}
          >
            <Bot className="w-4 h-4" />
            <span className="hidden sm:inline">Chat</span>
          </button>
          <button
            onClick={() => handlePageChange("ping")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "ping"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            }`}
          >
            <Bell className="w-4 h-4" />
            <span className="hidden sm:inline">Ping</span>
          </button>
          <button
            onClick={() => handlePageChange("sampling")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "sampling"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            } relative`}
          >
            <Hash className="w-4 h-4" />
            <span className="hidden sm:inline">Sampling</span>
            {pendingSampleRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                {pendingSampleRequests.length}
              </span>
            )}
          </button>
          <button
            onClick={() => handlePageChange("roots")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "roots"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            }`}
          >
            <FolderTree className="w-4 h-4" />
            <span className="hidden sm:inline">Roots</span>
          </button>
          <button
            onClick={() => handlePageChange("auth")}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-all duration-200 ${
              currentPage === "auth"
                ? "bg-background shadow-sm border border-border/50"
                : "hover:bg-background/50"
            }`}
          >
            <Key className="w-4 h-4" />
            <span className="hidden sm:inline">Auth</span>
          </button>
        </div>
      );
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
        default:
          return null;
      }
    };

    return (
      <div className="flex-1 flex flex-col">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/50 px-6 pt-4 pb-2">
          {renderTabsList()}
        </div>
        <div className="flex-1 p-6 overflow-auto">
          {serverHasNoCapabilities
            ? renderServerNoCapabilities()
            : renderCurrentPage()}
        </div>
      </div>
    );
  };

  return (
    <McpClientContext.Provider value={mcpClient}>
      <div className="h-screen bg-gradient-to-br from-slate-50/50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-800/50 flex overflow-hidden app-container">
        {/* Sidebar - Full Height Left Side */}
        <Sidebar />

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

          {/* API Key Manager Section */}
          <div className="bg-background/80 backdrop-blur-md border-b border-border/50 shadow-sm px-6 py-4">
            <ApiKeyManager
              onApiKeyChange={handleApiKeyChange}
              disabled={
                connectionStatus !== "connected" &&
                connectionStatus !== "disconnected"
              }
            />
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden overflow-y-auto">
            {mcpClient ? (
              renderTabs()
            ) : isAuthDebuggerVisible ? (
              <div className="flex-1 p-6">
                <AuthDebugger
                  serverUrl={sseUrl}
                  onBack={() => setIsAuthDebuggerVisible(false)}
                  authState={authState}
                  updateAuthState={updateAuthState}
                />
              </div>
            ) : null}
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
