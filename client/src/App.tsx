import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  ClientNotification,
  ClientRequest,
  CompatibilityCallToolResult,
  CompatibilityCallToolResultSchema,
  CreateMessageRequestSchema,
  CreateMessageResult,
  EmptyResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListRootsRequestSchema,
  ListToolsResultSchema,
  ProgressNotificationSchema,
  ReadResourceResultSchema,
  Request,
  Resource,
  ResourceTemplate,
  Result,
  Root,
  ServerNotification,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Notification,
  StdErrNotification,
  StdErrNotificationSchema,
} from "./lib/notificationTypes";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  Files,
  FolderTree,
  Hammer,
  Hash,
  MessageSquare,
} from "lucide-react";

import { toast } from "react-toastify";
import { ZodType } from "zod";
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

const DEFAULT_REQUEST_TIMEOUT_MSEC = 10000;

const params = new URLSearchParams(window.location.search);
const PROXY_PORT = params.get("proxyPort") ?? "3000";
const REQUEST_TIMEOUT =
  parseInt(params.get("timeout") ?? "") || DEFAULT_REQUEST_TIMEOUT_MSEC;
const PROXY_SERVER_URL = `http://localhost:${PROXY_PORT}`;

const App = () => {
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connected" | "error"
  >("disconnected");
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

  const [sseUrl, setSseUrl] = useState<string>("http://localhost:3001/sse");
  const [transportType, setTransportType] = useState<"stdio" | "sse">("stdio");
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [stdErrNotifications, setStdErrNotifications] = useState<
    StdErrNotification[]
  >([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});

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

  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
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
  const [historyPaneHeight, setHistoryPaneHeight] = useState<number>(300);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartHeight.current = historyPaneHeight;
      document.body.style.userSelect = "none";
    },
    [historyPaneHeight],
  );

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.max(
        100,
        Math.min(800, dragStartHeight.current + deltaY),
      );
      setHistoryPaneHeight(newHeight);
    },
    [isDragging],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleDragMove);
      window.addEventListener("mouseup", handleDragEnd);
      return () => {
        window.removeEventListener("mousemove", handleDragMove);
        window.removeEventListener("mouseup", handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  useEffect(() => {
    localStorage.setItem("lastCommand", command);
  }, [command]);

  useEffect(() => {
    localStorage.setItem("lastArgs", args);
  }, [args]);

  useEffect(() => {
    fetch(`${PROXY_SERVER_URL}/config`)
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
  }, []);

  useEffect(() => {
    rootsRef.current = roots;
  }, [roots]);

  const pushHistory = (request: object, response?: object) => {
    setRequestHistory((prev) => [
      ...prev,
      {
        request: JSON.stringify(request),
        response: response !== undefined ? JSON.stringify(response) : undefined,
      },
    ]);
  };

  const clearError = (tabKey: keyof typeof errors) => {
    setErrors((prev) => ({ ...prev, [tabKey]: null }));
  };

  const makeRequest = async <T extends ZodType<object>>(
    request: ClientRequest,
    schema: T,
    tabKey?: keyof typeof errors,
  ) => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort("Request timed out");
      }, REQUEST_TIMEOUT);

      let response;
      try {
        response = await mcpClient.request(request, schema, {
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      pushHistory(request, response);

      if (tabKey !== undefined) {
        clearError(tabKey);
      }

      return response;
    } catch (e: unknown) {
      const errorString = (e as Error).message ?? String(e);
      if (tabKey === undefined) {
        toast.error(errorString);
      } else {
        setErrors((prev) => ({
          ...prev,
          [tabKey]: errorString,
        }));
      }

      throw e;
    }
  };

  const sendNotification = async (notification: ClientNotification) => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }

    try {
      await mcpClient.notification(notification);
      pushHistory(notification);
    } catch (e: unknown) {
      toast.error((e as Error).message ?? String(e));
      throw e;
    }
  };

  const listResources = async () => {
    const response = await makeRequest(
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
    const response = await makeRequest(
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
    const response = await makeRequest(
      {
        method: "resources/read" as const,
        params: { uri },
      },
      ReadResourceResultSchema,
      "resources",
    );
    setResourceContent(JSON.stringify(response, null, 2));
  };

  const listPrompts = async () => {
    const response = await makeRequest(
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
    const response = await makeRequest(
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
    const response = await makeRequest(
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
    const response = await makeRequest(
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
  };

  const handleRootsChange = async () => {
    await sendNotification({ method: "notifications/roots/list_changed" });
  };

  const connectMcpServer = async () => {
    try {
      const client = new Client<Request, Notification, Result>(
        {
          name: "mcp-inspector",
          version: "0.0.1",
        },
        {
          capabilities: {
            // Support all client capabilities since we're an inspector tool
            sampling: {},
            roots: {
              listChanged: true,
            },
          },
        },
      );

      const backendUrl = new URL(`${PROXY_SERVER_URL}/sse`);

      backendUrl.searchParams.append("transportType", transportType);
      if (transportType === "stdio") {
        backendUrl.searchParams.append("command", command);
        backendUrl.searchParams.append("args", args);
        backendUrl.searchParams.append("env", JSON.stringify(env));
      } else {
        backendUrl.searchParams.append("url", sseUrl);
      }

      const clientTransport = new SSEClientTransport(backendUrl);
      client.setNotificationHandler(
        ProgressNotificationSchema,
        (notification) => {
          setNotifications((prevNotifications) => [
            ...prevNotifications,
            notification,
          ]);
        },
      );

      client.setNotificationHandler(
        StdErrNotificationSchema,
        (notification) => {
          setStdErrNotifications((prevErrorNotifications) => [
            ...prevErrorNotifications,
            notification,
          ]);
        },
      );

      await client.connect(clientTransport);

      client.setRequestHandler(CreateMessageRequestSchema, (request) => {
        return new Promise<CreateMessageResult>((resolve, reject) => {
          setPendingSampleRequests((prev) => [
            ...prev,
            { id: nextRequestId.current++, request, resolve, reject },
          ]);
        });
      });

      client.setRequestHandler(ListRootsRequestSchema, async () => {
        return { roots: rootsRef.current };
      });

      setMcpClient(client);
      setConnectionStatus("connected");
    } catch (e) {
      console.error(e);
      setConnectionStatus("error");
    }
  };

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
        onConnect={connectMcpServer}
        stdErrNotifications={stdErrNotifications}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          {mcpClient ? (
            <Tabs defaultValue="resources" className="w-full p-4">
              <TabsList className="mb-4 p-0">
                <TabsTrigger value="resources">
                  <Files className="w-4 h-4 mr-2" />
                  Resources
                </TabsTrigger>
                <TabsTrigger value="prompts">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Prompts
                </TabsTrigger>
                <TabsTrigger value="tools">
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
                  }}
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
                  callTool={(name, params) => {
                    clearError("tools");
                    callTool(name, params);
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
                    void makeRequest(
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
