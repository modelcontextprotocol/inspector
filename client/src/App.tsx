import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  CompatibilityCallToolResultSchema,
  ClientRequest,
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
  Resource,
  ResourceTemplate,
  Root,
  ServerNotification,
  Tool,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  Files,
  Hammer,
  Hash,
  MessageSquare,
  Play,
  Send,
  Terminal,
  FolderTree,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { ZodType } from "zod";
import "./App.css";
import ConsoleTab from "./components/ConsoleTab";
import HistoryAndNotifications from "./components/History";
import PingTab from "./components/PingTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import RequestsTab from "./components/RequestsTabs";
import ResourcesTab from "./components/ResourcesTab";
import RootsTab from "./components/RootsTab";
import SamplingTab, { PendingRequest } from "./components/SamplingTab";
import Sidebar from "./components/Sidebar";
import ToolsTab from "./components/ToolsTab";

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
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string>(() => {
    return (
      localStorage.getItem("lastCommand") ||
      "/Users/ashwin/.nvm/versions/node/v18.20.4/bin/node"
    );
  });
  const [args, setArgs] = useState<string>(() => {
    return (
      localStorage.getItem("lastArgs") ||
      "/Users/ashwin/code/mcp/example-servers/build/everything/stdio.js"
    );
  });
  const [url, setUrl] = useState<string>("http://localhost:3001/sse");
  const [transportType, setTransportType] = useState<"stdio" | "sse">("stdio");
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response: string }[]
  >([]);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [showEnvVars, setShowEnvVars] = useState(false);

  const [pendingSampleRequests, setPendingSampleRequests] = useState<
    Array<
      PendingRequest & {
        resolve: (result: CreateMessageResult) => void;
        reject: (error: Error) => void;
      }
    >
  >([]);
  const nextRequestId = useRef(0);

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

  useEffect(() => {
    localStorage.setItem("lastCommand", command);
  }, [command]);

  useEffect(() => {
    localStorage.setItem("lastArgs", args);
  }, [args]);

  useEffect(() => {
    fetch("http://localhost:3000/default-environment")
      .then((response) => response.json())
      .then((data) => setEnv(data))
      .catch((error) =>
        console.error("Error fetching default environment:", error),
      );
  }, []);

  const pushHistory = (request: object, response: object) => {
    setRequestHistory((prev) => [
      ...prev,
      { request: JSON.stringify(request), response: JSON.stringify(response) },
    ]);
  };

  const makeRequest = async <T extends ZodType<object>>(
    request: ClientRequest,
    schema: T,
  ) => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }

    try {
      const response = await mcpClient.request(request, schema);
      pushHistory(request, response);
      return response;
    } catch (e: unknown) {
      setError((e as Error).message);
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
    );
    setToolResult(response);
  };

  const handleRootsChange = async () => {
    if (mcpClient) {
      try {
        await mcpClient.sendRootsListChanged();
      } catch (e) {
        console.error("Failed to send roots list changed notification:", e);
      }
    }
  };

  const connectMcpServer = async () => {
    try {
      const client = new Client({
        name: "mcp-inspector",
        version: "0.0.1",
      });

      const backendUrl = new URL("http://localhost:3000/sse");

      backendUrl.searchParams.append("transportType", transportType);
      if (transportType === "stdio") {
        backendUrl.searchParams.append("command", command);
        backendUrl.searchParams.append("args", args);
        backendUrl.searchParams.append("env", JSON.stringify(env));
      } else {
        backendUrl.searchParams.append("url", url);
      }

      const clientTransport = new SSEClientTransport(backendUrl);
      await client.connect(clientTransport);

      client.setNotificationHandler(
        ProgressNotificationSchema,
        (notification) => {
          setNotifications((prevNotifications) => [
            ...prevNotifications,
            notification,
          ]);
        },
      );

      client.setRequestHandler(CreateMessageRequestSchema, (request) => {
        return new Promise<CreateMessageResult>((resolve, reject) => {
          setPendingSampleRequests((prev) => [
            ...prev,
            { id: nextRequestId.current++, request, resolve, reject },
          ]);
        });
      });

      client.setRequestHandler(ListRootsRequestSchema, async () => {
        return { roots };
      });

      setMcpClient(client);
      setConnectionStatus("connected");
    } catch (e) {
      console.error(e);
      setConnectionStatus("error");
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar connectionStatus={connectionStatus} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <h1 className="text-2xl font-bold p-4">MCP Inspector</h1>
        <div className="flex-1 overflow-auto flex">
          <div className="flex-1">
            <div className="p-4 bg-white shadow-md m-4 rounded-md">
              <h2 className="text-lg font-semibold mb-2">Connect MCP Server</h2>
              <div className="flex space-x-2 mb-2">
                <Select
                  value={transportType}
                  onValueChange={(value: "stdio" | "sse") =>
                    setTransportType(value)
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select transport type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio">STDIO</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                  </SelectContent>
                </Select>
                {transportType === "stdio" ? (
                  <>
                    <Input
                      placeholder="Command"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                    />
                    <Input
                      placeholder="Arguments (space-separated)"
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                    />
                  </>
                ) : (
                  <Input
                    placeholder="URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                )}
                <Button onClick={connectMcpServer}>
                  <Play className="w-4 h-4 mr-2" />
                  Connect
                </Button>
              </div>
              {transportType === "stdio" && (
                <div className="mt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShowEnvVars(!showEnvVars)}
                    className="flex items-center"
                  >
                    {showEnvVars ? (
                      <ChevronDown className="w-4 h-4 mr-2" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2" />
                    )}
                    Environment Variables
                  </Button>
                  {showEnvVars && (
                    <div className="mt-2">
                      {Object.entries(env).map(([key, value]) => (
                        <div key={key} className="flex space-x-2 mb-2">
                          <Input
                            placeholder="Key"
                            value={key}
                            onChange={(e) =>
                              setEnv((prev) => ({
                                ...prev,
                                [e.target.value]: value,
                              }))
                            }
                          />
                          <Input
                            placeholder="Value"
                            value={value}
                            onChange={(e) =>
                              setEnv((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }))
                            }
                          />
                          <Button
                            onClick={() =>
                              setEnv((prev) => {
                                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                                const { [key]: _, ...rest } = prev;
                                return rest;
                              })
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button
                        onClick={() => setEnv((prev) => ({ ...prev, "": "" }))}
                      >
                        Add Environment Variable
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
                  <TabsTrigger value="requests" disabled>
                    <Send className="w-4 h-4 mr-2" />
                    Requests
                  </TabsTrigger>
                  <TabsTrigger value="tools">
                    <Hammer className="w-4 h-4 mr-2" />
                    Tools
                  </TabsTrigger>
                  <TabsTrigger value="console" disabled>
                    <Terminal className="w-4 h-4 mr-2" />
                    Console
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
                    listResources={listResources}
                    listResourceTemplates={listResourceTemplates}
                    readResource={readResource}
                    selectedResource={selectedResource}
                    setSelectedResource={setSelectedResource}
                    resourceContent={resourceContent}
                    nextCursor={nextResourceCursor}
                    nextTemplateCursor={nextResourceTemplateCursor}
                    error={error}
                  />
                  <PromptsTab
                    prompts={prompts}
                    listPrompts={listPrompts}
                    getPrompt={getPrompt}
                    selectedPrompt={selectedPrompt}
                    setSelectedPrompt={setSelectedPrompt}
                    promptContent={promptContent}
                    nextCursor={nextPromptCursor}
                    error={error}
                  />
                  <RequestsTab />
                  <ToolsTab
                    tools={tools}
                    listTools={listTools}
                    callTool={callTool}
                    selectedTool={selectedTool}
                    setSelectedTool={(tool) => {
                      setSelectedTool(tool);
                      setToolResult(null);
                    }}
                    toolResult={toolResult}
                    nextCursor={nextToolCursor}
                    error={error}
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
        </div>
      </div>
      <HistoryAndNotifications
        requestHistory={requestHistory}
        serverNotifications={notifications}
      />
    </div>
  );
};

export default App;
