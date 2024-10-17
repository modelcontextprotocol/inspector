import { Client } from "mcp-typescript/client/index.js";
import { SSEClientTransport } from "mcp-typescript/client/sse.js";
import {
  ListResourcesResultSchema,
  GetPromptResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  ListPromptsResultSchema,
  Resource,
  Tool,
  ClientRequest,
  ProgressNotificationSchema,
  ServerNotification,
  EmptyResultSchema,
} from "mcp-typescript/types.js";
import { useState, useRef } from "react";
import {
  Send,
  Bell,
  Terminal,
  Files,
  MessageSquare,
  Hammer,
  Play,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import ConsoleTab from "./components/ConsoleTab";
import Sidebar from "./components/Sidebar";
import RequestsTab from "./components/RequestsTabs";
import ResourcesTab from "./components/ResourcesTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import ToolsTab from "./components/ToolsTab";
import { AnyZodObject } from "zod";
import HistoryAndNotifications from "./components/History";
import "./App.css";
import PingTab from "./components/PingTab";

const App = () => {
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connected" | "error"
  >("disconnected");
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceContent, setResourceContent] = useState<string>("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptContent, setPromptContent] = useState<string>("");
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolResult, setToolResult] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string>(
    "/Users/ashwin/.nvm/versions/node/v18.20.4/bin/node",
  );
  const [args, setArgs] = useState<string>(
    "/Users/ashwin/code/mcp/example-servers/build/everything/stdio.js",
  );
  const [url, setUrl] = useState<string>("http://localhost:3001/sse");
  const [transportType, setTransportType] = useState<"stdio" | "sse">("stdio");
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response: string }[]
  >([]);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);

  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [nextResourceCursor, setNextResourceCursor] = useState<
    string | undefined
  >();
  const [nextPromptCursor, setNextPromptCursor] = useState<
    string | undefined
  >();
  const [nextToolCursor, setNextToolCursor] = useState<string | undefined>();
  const progressTokenRef = useRef(0);

  const pushHistory = (request: object, response: object) => {
    setRequestHistory((prev) => [
      ...prev,
      { request: JSON.stringify(request), response: JSON.stringify(response) },
    ]);
  };

  const makeRequest = async <T extends AnyZodObject>(
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

  const readResource = async (uri: URL) => {
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
      CallToolResultSchema,
    );
    setToolResult(JSON.stringify(response.toolResult, null, 2));
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
                </TabsList>

                <div className="w-full">
                  <ResourcesTab
                    resources={resources}
                    listResources={listResources}
                    readResource={readResource}
                    selectedResource={selectedResource}
                    setSelectedResource={setSelectedResource}
                    resourceContent={resourceContent}
                    nextCursor={nextResourceCursor}
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
                      setToolResult("");
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
