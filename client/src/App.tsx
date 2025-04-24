import {
  ClientRequest,
  CompatibilityCallToolResult,
  CompatibilityCallToolResultSchema,
  CreateMessageResult,
  EmptyResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  Resource,
  ResourceTemplate,
  Root,
  ServerNotification,
  Tool,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useConnection } from "./lib/hooks/useConnection";
import { useDraggablePane } from "./lib/hooks/useDraggablePane";
import { StdErrNotification } from "./lib/notificationTypes";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  Files,
  FolderTree,
  Hammer,
  Hash,
  MessageSquare,
} from "lucide-react";

import { z } from "zod";
import "./App.css";
import ConsoleTab from "./components/ConsoleTab";
import HistoryAndNotifications from "./components/History";
import PingTab from "./components/PingTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import ResourcesTab from "./components/ResourcesTab";
import RootsTab from "./components/RootsTab";
import SamplingTab, { PendingRequest } from "./components/SamplingTab";
import Sidebar from "./components/Sidebar";
import ToolsTab from "./components/ToolsTab";
import { DEFAULT_INSPECTOR_CONFIG } from "./lib/constants";
import { InspectorConfig } from "./lib/configurationTypes";
import { getMCPProxyAddress } from "./utils/configUtils";

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
  const [command, setCommand] = useState<string>(() => {
    return localStorage.getItem("lastCommand") || "mcp-server-everything";
  });
  const [args, setArgs] = useState<string>(() => {
    return localStorage.getItem("lastArgs") || "";
  });

  const [sseUrl, setSseUrl] = useState<string>(() => {
    return localStorage.getItem("lastSseUrl") || "http://localhost:3001/sse";
  });
  const [transportType, setTransportType] = useState<
    "stdio" | "sse" | "streamable-http"
  >(() => {
    return (
      (localStorage.getItem("lastTransportType") as
        | "stdio"
        | "sse"
        | "streamable-http") || "stdio"
    );
  });
  const [logLevel, setLogLevel] = useState<LoggingLevel>("debug");
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [stdErrNotifications, setStdErrNotifications] = useState<
    StdErrNotification[]
  >([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});

  const [config, setConfig] = useState<InspectorConfig>(() => {
    const savedConfig = localStorage.getItem(CONFIG_LOCAL_STORAGE_KEY);
    if (savedConfig) {
      // merge default config with saved config
      const mergedConfig = {
        ...DEFAULT_INSPECTOR_CONFIG,
        ...JSON.parse(savedConfig),
      } as InspectorConfig;

      // update description of keys to match the new description (in case of any updates to the default config description)
      Object.entries(mergedConfig).forEach(([key, value]) => {
        mergedConfig[key as keyof InspectorConfig] = {
          ...value,
          label: DEFAULT_INSPECTOR_CONFIG[key as keyof InspectorConfig].label,
        };
      });

      return mergedConfig;
    }
    return DEFAULT_INSPECTOR_CONFIG;
  });
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

  const { height: historyPaneHeight, handleDragStart } = useDraggablePane(300);

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
  } = useConnection({
    transportType,
    command,
    args,
    sseUrl,
    env,
    bearerToken,
    headerName,
    config,
    onNotification: (notification) => {
      setNotifications((prev) => [...prev, notification as ServerNotification]);
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
      setTransportType("sse");
      void connectMcpServer();
    },
    [connectMcpServer],
  );

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

  const handleApproveSampling = (id: number, result: CreateMessageResult) => {
    setPendingSampleRequests((prev) => {
      const request = prev.find((r) => r.id === id);
      request?.resolve(result);
      return prev.filter((r) => r.id !== id);
    });
  };

  const handleRejectSampling = (id: number) => {
    setPendingSampleRequests((prev) => {
      const request = prev.find((r) => r.id === id);
      request?.reject(new Error("Sampling request rejected"));
      return prev.filter((r) => r.id !== id);
    });
  };

  const clearError = (tabKey: keyof typeof errors) => {
    setErrors((prev) => ({ ...prev, [tabKey]: null }));
  };

  const sendMCPRequest = async <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    tabKey?: keyof typeof errors,
  ) => {
    try {
      const response = await makeRequest(request, schema);
      if (tabKey !== undefined) {
        clearError(tabKey);
      }
      return response;
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      if (tabKey !== undefined) {
        setErrors((prev) => ({
          ...prev,
          [tabKey]: errorString,
        }));
      }
      throw e;
    }
  };

  const listResources = async () => {
    const response = await sendMCPRequest(
      {
        method: "resources/list" as const,
        params: nextResourceCursor ? { cursor: nextResourceCursor } : {},
      },
      ListResourcesResultSchema,
      "resources",
    );
    setResources(resources.concat(response.resources ?? []));
    setNextResourceCursor(response.nextCursor);
  };

  const listResourceTemplates = async () => {
    const response = await sendMCPRequest(
      {
        method: "resources/templates/list" as const,
        params: nextResourceTemplateCursor
          ? { cursor: nextResourceTemplateCursor }
          : {},
      },
      ListResourceTemplatesResultSchema,
      "resources",
    );
    setResourceTemplates(
      resourceTemplates.concat(response.resourceTemplates ?? []),
    );
    setNextResourceTemplateCursor(response.nextCursor);
  };

  const readResource = async (uri: string) => {
    const response = await sendMCPRequest(
      {
        method: "resources/read" as const,
        params: { uri },
      },
      ReadResourceResultSchema,
      "resources",
    );
    setResourceContent(JSON.stringify(response, null, 2));
  };

  const subscribeToResource = async (uri: string) => {
    if (!resourceSubscriptions.has(uri)) {
      await sendMCPRequest(
        {
          method: "resources/subscribe" as const,
          params: { uri },
        },
        z.object({}),
        "resources",
      );
      const clone = new Set(resourceSubscriptions);
      clone.add(uri);
      setResourceSubscriptions(clone);
    }
  };

  const unsubscribeFromResource = async (uri: string) => {
    if (resourceSubscriptions.has(uri)) {
      await sendMCPRequest(
        {
          method: "resources/unsubscribe" as const,
          params: { uri },
        },
        z.object({}),
        "resources",
      );
      const clone = new Set(resourceSubscriptions);
      clone.delete(uri);
      setResourceSubscriptions(clone);
    }
  };

  const listPrompts = async () => {
    const response = await sendMCPRequest(
      {
        method: "prompts/list" as const,
        params: nextPromptCursor ? { cursor: nextPromptCursor } : {},
      },
      ListPromptsResultSchema,
      "prompts",
    );
    setPrompts(response.prompts);
    setNextPromptCursor(response.nextCursor);
  };

  const getPrompt = async (name: string, args: Record<string, string> = {}) => {
    const response = await sendMCPRequest(
      {
        method: "prompts/get" as const,
        params: { name, arguments: args },
      },
      GetPromptResultSchema,
      "prompts",
    );
    setPromptContent(JSON.stringify(response, null, 2));
  };

  const listTools = async () => {
    const response = await sendMCPRequest(
      {
        method: "tools/list" as const,
        params: nextToolCursor ? { cursor: nextToolCursor } : {},
      },
      ListToolsResultSchema,
      "tools",
    );
    setTools(response.tools);
    setNextToolCursor(response.nextCursor);
  };

  const callTool = async (name: string, params: Record<string, unknown>) => {
    try {
      const response = await sendMCPRequest(
        {
          method: "tools/call" as const,
          params: {
            name,
            arguments: params,
            _meta: {
              progressToken: progressTokenRef.current++,
            },
          },
        },
        CompatibilityCallToolResultSchema,
        "tools",
      );
      setToolResult(response);
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

  const handleRootsChange = async () => {
    await sendNotification({ method: "notifications/roots/list_changed" });
  };

  const sendLogLevelRequest = async (level: LoggingLevel) => {
    await sendMCPRequest(
      {
        method: "logging/setLevel" as const,
        params: { level },
      },
      z.object({}),
    );
    setLogLevel(level);
  };

  const clearStdErrNotifications = () => {
    setStdErrNotifications([]);
  };

  if (window.location.pathname === "/oauth/callback") {
    const OAuthCallback = React.lazy(
      () => import("./components/OAuthCallback"),
    );
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <OAuthCallback onConnect={onOAuthConnect} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
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
        sendLogLevelRequest={sendLogLevelRequest}
        loggingSupported={!!serverCapabilities?.logging || false}
        clearStdErrNotifications={clearStdErrNotifications}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          {mcpClient ? (
            <Tabs
              defaultValue={
                Object.keys(serverCapabilities ?? {}).includes(
                  window.location.hash.slice(1),
                )
                  ? window.location.hash.slice(1)
                  : serverCapabilities?.resources
                    ? "resources"
                    : serverCapabilities?.prompts
                      ? "prompts"
                      : serverCapabilities?.tools
                        ? "tools"
                        : "ping"
              }
              className="w-full p-4"
              onValueChange={(value) => (window.location.hash = value)}
            >
              <TabsList className="mb-4 p-0">
                <TabsTrigger
                  value="resources"
                  disabled={!serverCapabilities?.resources}
                >
                  <Files className="w-4 h-4 mr-2" />
                  Resources
                </TabsTrigger>
                <TabsTrigger
                  value="prompts"
                  disabled={!serverCapabilities?.prompts}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Prompts
                </TabsTrigger>
                <TabsTrigger
                  value="tools"
                  disabled={!serverCapabilities?.tools}
                >
                  <Hammer className="w-4 h-4 mr-2" />
                  Tools
                </TabsTrigger>
                <TabsTrigger value="ping">
                  <Bell className="w-4 h-4 mr-2" />
                  Ping
                </TabsTrigger>
                <TabsTrigger value="sampling" className="relative">
                  <Hash className="w-4 h-4 mr-2" />
                  Sampling
                  {pendingSampleRequests.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {pendingSampleRequests.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="roots">
                  <FolderTree className="w-4 h-4 mr-2" />
                  Roots
                </TabsTrigger>
              </TabsList>

              <div className="w-full">
                {!serverCapabilities?.resources &&
                !serverCapabilities?.prompts &&
                !serverCapabilities?.tools ? (
                  <div className="flex items-center justify-center p-4">
                    <p className="text-lg text-gray-500">
                      The connected server does not support any MCP capabilities
                    </p>
                  </div>
                ) : (
                  <>
                    <ResourcesTab
                      resources={resources}
                      resourceTemplates={resourceTemplates}
                      listResources={() => {
                        clearError("resources");
                        listResources();
                      }}
                      clearResources={() => {
                        setResources([]);
                        setNextResourceCursor(undefined);
                      }}
                      listResourceTemplates={() => {
                        clearError("resources");
                        listResourceTemplates();
                      }}
                      clearResourceTemplates={() => {
                        setResourceTemplates([]);
                        setNextResourceTemplateCursor(undefined);
                      }}
                      readResource={(uri) => {
                        clearError("resources");
                        readResource(uri);
                      }}
                      selectedResource={selectedResource}
                      setSelectedResource={(resource) => {
                        clearError("resources");
                        setSelectedResource(resource);
                      }}
                      resourceSubscriptionsSupported={
                        serverCapabilities?.resources?.subscribe || false
                      }
                      resourceSubscriptions={resourceSubscriptions}
                      subscribeToResource={(uri) => {
                        clearError("resources");
                        subscribeToResource(uri);
                      }}
                      unsubscribeFromResource={(uri) => {
                        clearError("resources");
                        unsubscribeFromResource(uri);
                      }}
                      handleCompletion={handleCompletion}
                      completionsSupported={completionsSupported}
                      resourceContent={resourceContent}
                      nextCursor={nextResourceCursor}
                      nextTemplateCursor={nextResourceTemplateCursor}
                      error={errors.resources}
                    />
                    <PromptsTab
                      prompts={prompts}
                      listPrompts={() => {
                        clearError("prompts");
                        listPrompts();
                      }}
                      clearPrompts={() => {
                        setPrompts([]);
                        setNextPromptCursor(undefined);
                      }}
                      getPrompt={(name, args) => {
                        clearError("prompts");
                        getPrompt(name, args);
                      }}
                      selectedPrompt={selectedPrompt}
                      setSelectedPrompt={(prompt) => {
                        clearError("prompts");
                        setSelectedPrompt(prompt);
                        setPromptContent("");
                      }}
                      handleCompletion={handleCompletion}
                      completionsSupported={completionsSupported}
                      promptContent={promptContent}
                      nextCursor={nextPromptCursor}
                      error={errors.prompts}
                    />
                    <ToolsTab
                      tools={tools}
                      listTools={() => {
                        clearError("tools");
                        listTools();
                      }}
                      clearTools={() => {
                        setTools([]);
                        setNextToolCursor(undefined);
                      }}
                      callTool={async (name, params) => {
                        clearError("tools");
                        setToolResult(null);
                        await callTool(name, params);
                      }}
                      selectedTool={selectedTool}
                      setSelectedTool={(tool) => {
                        clearError("tools");
                        setSelectedTool(tool);
                        setToolResult(null);
                      }}
                      toolResult={toolResult}
                      nextCursor={nextToolCursor}
                      error={errors.tools}
                    />
                    <ConsoleTab />
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
                    <SamplingTab
                      pendingRequests={pendingSampleRequests}
                      onApprove={handleApproveSampling}
                      onReject={handleRejectSampling}
                    />
                    <RootsTab
                      roots={roots}
                      setRoots={setRoots}
                      onRootsChange={handleRootsChange}
                    />
                  </>
                )}
              </div>
            </Tabs>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-lg text-gray-500">
                Connect to an MCP server to start inspecting
              </p>
            </div>
          )}
        </div>
        <div
          className="relative border-t border-border"
          style={{
            height: `${historyPaneHeight}px`,
          }}
        >
          <div
            className="absolute w-full h-4 -top-2 cursor-row-resize flex items-center justify-center hover:bg-accent/50"
            onMouseDown={handleDragStart}
          >
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
          <div className="h-full overflow-auto">
            <HistoryAndNotifications
              requestHistory={requestHistory}
              serverNotifications={notifications}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
