import { useState, useEffect } from "react";
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
import ToolsTab, { Tool as ToolType } from "./components/ToolsTab";

const App = () => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connected" | "error"
  >("disconnected");
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceContent, setResourceContent] = useState<string>("");
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptContent, setPromptContent] = useState<string>("");
  const [tools, setTools] = useState<ToolType[]>([]);
  const [toolResult, setToolResult] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string>(
    "/Users/ashwin/.nvm/versions/node/v18.20.4/bin/node",
  );
  const [args, setArgs] = useState<string>(
    "/Users/ashwin/code/example-servers/build/everything/index.js",
  );
  const [mcpConnected, setMcpConnected] = useState<boolean>(false);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:3000");

    ws.onopen = () => {
      console.log("Connected to WebSocket server");
      setConnectionStatus("connected");
      setSocket(ws);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received message:", message);
      if (message.type === "resources") {
        setResources(message.data.resources);
        setError(null);
      } else if (message.type === "resource") {
        setResourceContent(JSON.stringify(message.data, null, 2));
        setError(null);
      } else if (message.type === "prompts") {
        setPrompts(message.data.prompts);
        setError(null);
      } else if (message.type === "prompt") {
        setPromptContent(JSON.stringify(message.data, null, 2));
        setError(null);
      } else if (message.type === "tools") {
        setTools(message.data.tools);
        setError(null);
      } else if (message.type === "toolResult") {
        setToolResult(JSON.stringify(message.data, null, 2));
        setError(null);
      } else if (message.type === "error") {
        setError(message.message);
      } else if (message.type === "connected") {
        setMcpConnected(true);
      }
    };

    ws.onerror = () => {
      setConnectionStatus("error");
    };

    ws.onclose = () => {
      setConnectionStatus("disconnected");
      setMcpConnected(false);
    };

    return () => ws.close();
  }, []);

  const sendWebSocketMessage = (message: object) => {
    if (socket) {
      console.log("Sending WebSocket message:", message);
      socket.send(JSON.stringify(message));
    }
  };

  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null);

  const listResources = () => {
    sendWebSocketMessage({ type: "listResources" });
  };

  const readResource = (uri: string) => {
    sendWebSocketMessage({ type: "readResource", uri });
  };

  const listPrompts = () => {
    sendWebSocketMessage({ type: "listPrompts" });
  };

  const getPrompt = (name: string) => {
    sendWebSocketMessage({ type: "getPrompt", name });
  };

  const listTools = () => {
    sendWebSocketMessage({ type: "listTools" });
  };

  const callTool = (name: string, params: Record<string, unknown>) => {
    sendWebSocketMessage({ type: "callTool", name, params });
  };

  const connectMcpServer = () => {
    const argsArray = args.split(" ").filter((arg) => arg.trim() !== "");
    sendWebSocketMessage({ type: "connect", command, args: argsArray });
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar connectionStatus={connectionStatus} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <h1 className="text-2xl font-bold p-4">MCP Inspector</h1>
        <div className="flex-1 overflow-auto">
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
          {mcpConnected ? (
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
                <TabsTrigger value="tools" disabled>
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
                  setSelectedTool={setSelectedTool}
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
  );
};

export default App;
