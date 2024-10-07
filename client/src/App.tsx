import { useState, useEffect } from "react";
import { Send, Bell, Terminal, Files } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import ConsoleTab from "./components/ConsoleTab";
import Sidebar from "./components/Sidebar";
import RequestsTab from "./components/RequestsTabs";
import ResourcesTab, { Resource } from "./components/ResourcesTab";
import NotificationsTab from "./components/NotificationsTab";

const App = () => {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [resourceContent, setResourceContent] = useState<string>("");
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connected" | "error"
  >("disconnected");
  const [error, setError] = useState<string | null>(null);

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
      } else if (message.type === "error") {
        setError(message.message);
      }
    };

    ws.onerror = () => {
      setConnectionStatus("error");
    };

    ws.onclose = () => {
      setConnectionStatus("disconnected");
    };

    return () => ws.close();
  }, []);

  const listResources = () => {
    if (socket) {
      socket.send(JSON.stringify({ type: "listResources" }));
    }
  };

  const readResource = (uri: string) => {
    if (socket) {
      socket.send(JSON.stringify({ type: "readResource", uri }));
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar connectionStatus={connectionStatus} />
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-6">
          <Tabs defaultValue="requests">
            <TabsList className="mb-4">
              <TabsTrigger value="requests">
                <Send className="w-4 h-4 mr-2" />
                Requests
              </TabsTrigger>
              <TabsTrigger value="notifications">
                <Bell className="w-4 h-4 mr-2" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="resources">
                <Files className="w-4 h-4 mr-2" />
                Resources
              </TabsTrigger>
              <TabsTrigger value="console">
                <Terminal className="w-4 h-4 mr-2" />
                Console
              </TabsTrigger>
            </TabsList>

            <RequestsTab />
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
            <ConsoleTab />
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default App;
