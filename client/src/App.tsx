import { Client } from "mcp-typescript/client/index.js";
import { SSEClientTransport } from "mcp-typescript/client/sse.js";
import {
  ListResourcesResultSchema,
  GetPromptResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  ListPromptsResultSchema,
  Tool,
  ClientRequest,
} from "mcp-typescript/types.js";
import { useState } from "react";
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

import ConsoleTab from "./components/ConsoleTab";
import Sidebar from "./components/Sidebar";
import RequestsTab from "./components/RequestsTabs";
import ResourcesTab, { Resource } from "./components/ResourcesTab";
import NotificationsTab from "./components/NotificationsTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import ToolsTab from "./components/ToolsTab";
import History from "./components/History";
import { AnyZodObject } from "node_modules/zod/lib";

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
    "/Users/ashwin/code/example-servers/build/everything/index.js",
  );
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response: string }[]
  >([]);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);

  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

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
      },
      ListResourcesResultSchema,
    );
    if (response.resources) {
      setResources(response.resources);
    }
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
      },
      ListPromptsResultSchema,
    );
    setPrompts(response.prompts);
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
      },
      ListToolsResultSchema,
    );
    setTools(response.tools);
  };

  const callTool = async (name: string, params: Record<string, unknown>) => {
    const response = await makeRequest(
      {
        method: "tools/call" as const,
        params: { name, arguments: params },
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

      const clientTransport = new SSEClientTransport();
      const url = new URL("http://localhost:3000/sse");
      url.searchParams.append("command", encodeURIComponent(command));
      url.searchParams.append("args", encodeURIComponent(args));
      await clientTransport.connect(url);

      await client.connect(clientTransport);

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
                  <TabsTrigger value="notifications" disabled>
                    <Bell className="w-4 h-4 mr-2" />
                    Notifications
                  </TabsTrigger>
                  <TabsTrigger value="tools">
                    <Hammer className="w-4 h-4 mr-2" />
                    Tools
                  </TabsTrigger>
                  <TabsTrigger value="console" disabled>
                    <Terminal className="w-4 h-4 mr-2" />
                    Console
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
                    error={error}
                  />
                  <NotificationsTab />
                  <PromptsTab
                    prompts={prompts}
                    listPrompts={listPrompts}
                    getPrompt={getPrompt}
                    selectedPrompt={selectedPrompt}
                    setSelectedPrompt={setSelectedPrompt}
                    promptContent={promptContent}
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
                    error={error}
                  />
                  <ConsoleTab />
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
      <History requestHistory={requestHistory} />
    </div>
  );
};

export default App;
