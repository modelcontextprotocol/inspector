import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Plus, 
  Trash2, 
  Server, 
  Wifi, 
  WifiOff, 
  AlertCircle,
  Edit2,
  Check,
  X
} from "lucide-react";
import { MCPJamServerConfig, StdioServerDefinition, HttpServerDefinition } from "@/lib/serverTypes";
import { ServerConnectionInfo } from "@/mcpjamAgent";
import { version } from "../../../package.json";
import useTheme from "../lib/hooks/useTheme";

interface ConnectionsSidebarProps {
  serverConnections: ServerConnectionInfo[];
  selectedServerName: string;
  onServerSelect: (serverName: string) => void;
  onAddServer: (name: string, config: MCPJamServerConfig) => void;
  onRemoveServer: (serverName: string) => void;
  onConnectServer: (serverName: string) => void;
  onDisconnectServer: (serverName: string) => void;
  onUpdateServer: (serverName: string, config: MCPJamServerConfig) => void;
}

const ConnectionsSidebar: React.FC<ConnectionsSidebarProps> = ({
  serverConnections,
  selectedServerName,
  onServerSelect,
  onAddServer,
  onRemoveServer,
  onConnectServer,
  onDisconnectServer,
  onUpdateServer,
}) => {
  const [theme] = useTheme();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [newServerName, setNewServerName] = useState("");
  const [newServerTransportType, setNewServerTransportType] = useState<"stdio" | "sse" | "streamable-http">("stdio");
  const [newServerCommand, setNewServerCommand] = useState("");
  const [newServerArgs, setNewServerArgs] = useState("");
  const [newServerUrl, setNewServerUrl] = useState("");

  const resetForm = () => {
    setNewServerName("");
    setNewServerTransportType("stdio");
    setNewServerCommand("");
    setNewServerArgs("");
    setNewServerUrl("");
    setShowAddForm(false);
    setEditingServer(null);
  };

  const handleAddServer = () => {
    if (!newServerName.trim()) return;

    let config: MCPJamServerConfig;
    
    if (newServerTransportType === "stdio") {
      config = {
        transportType: "stdio",
        command: newServerCommand,
        args: newServerArgs.split(" ").filter(arg => arg.trim() !== ""),
        env: {},
      } as StdioServerDefinition;
    } else {
      config = {
        transportType: newServerTransportType,
        url: new URL(newServerUrl),
      } as HttpServerDefinition;
    }

    onAddServer(newServerName, config);
    resetForm();
  };

  const handleEditServer = (serverName: string) => {
    const connection = serverConnections.find(conn => conn.name === serverName);
    if (!connection) return;

    setEditingServer(serverName);
    setNewServerName(serverName);
    setNewServerTransportType(connection.config.transportType);
    
    if (connection.config.transportType === "stdio" && "command" in connection.config) {
      setNewServerCommand(connection.config.command || "");
      setNewServerArgs(connection.config.args?.join(" ") || "");
    } else if ("url" in connection.config && connection.config.url) {
      setNewServerUrl(connection.config.url.toString());
    }
  };

  const handleUpdateServer = () => {
    if (!editingServer || !newServerName.trim()) return;

    let config: MCPJamServerConfig;
    
    if (newServerTransportType === "stdio") {
      config = {
        transportType: "stdio",
        command: newServerCommand,
        args: newServerArgs.split(" ").filter(arg => arg.trim() !== ""),
        env: {},
      } as StdioServerDefinition;
    } else {
      config = {
        transportType: newServerTransportType,
        url: new URL(newServerUrl),
      } as HttpServerDefinition;
    }

    onUpdateServer(editingServer, config);
    resetForm();
  };

  const getConnectionStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <Wifi className="w-4 h-4 text-green-500" />;
      case "disconnected":
        return <WifiOff className="w-4 h-4 text-gray-400" />;
      case "error":
      case "error-connecting-to-proxy":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <WifiOff className="w-4 h-4 text-gray-400" />;
    }
  };

  const getConnectionStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "border-green-500/30 bg-green-50/50 dark:bg-green-900/20";
      case "disconnected":
        return "border-gray-300/30 bg-gray-50/50 dark:bg-gray-800/20";
      case "error":
      case "error-connecting-to-proxy":
        return "border-red-500/30 bg-red-50/50 dark:bg-red-900/20";
      default:
        return "border-gray-300/30 bg-gray-50/50 dark:bg-gray-800/20";
    }
  };

  // Determine which logo to show based on theme
  const getLogoSrc = () => {
    if (theme === "dark") {
      return "/mcp_jam_dark.png";
    } else if (theme === "light") {
      return "/mcp_jam_light.png";
    } else {
      // For system theme, check if dark mode is active
      const isDarkMode = document.documentElement.classList.contains("dark");
      return isDarkMode ? "/mcp_jam_dark.png" : "/mcp_jam_light.png";
    }
  };

  return (
    <div className="w-64 bg-card border-r border-border flex flex-col h-full">
      {/* Logo and Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-col items-center space-y-2">
          {/* MCP Jam Logo */}
          <div className="w-full flex justify-center">
            <img
              src={getLogoSrc()}
              alt="MCP Jam"
              className="h-6 w-auto object-contain transition-opacity duration-200"
              onError={(e) => {
                console.warn("Failed to load MCP Jam logo");
                e.currentTarget.style.display = "none";
              }}
            />
          </div>

          {/* Version */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground opacity-70">
              v{version}
            </p>
          </div>
        </div>
      </div>

      {/* Connections Header */}
      <div className="p-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Connections</h3>
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {serverConnections.length}
            </span>
          </div>
          <Button
            onClick={() => setShowAddForm(true)}
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:bg-primary/20 hover:text-primary"
            title="Add new connection"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Add/Edit Server Form */}
      {(showAddForm || editingServer) && (
        <div className="p-3 border-b border-border bg-muted/30">
          <div className="space-y-3">
            <Input
              placeholder="Server name"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              className="text-xs"
            />
            
            <Select
              value={newServerTransportType}
              onValueChange={(value: "stdio" | "sse" | "streamable-http") => 
                setNewServerTransportType(value)
              }
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">Stdio</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
                <SelectItem value="streamable-http">HTTP</SelectItem>
              </SelectContent>
            </Select>

            {newServerTransportType === "stdio" ? (
              <>
                <Input
                  placeholder="Command"
                  value={newServerCommand}
                  onChange={(e) => setNewServerCommand(e.target.value)}
                  className="text-xs"
                />
                <Input
                  placeholder="Arguments"
                  value={newServerArgs}
                  onChange={(e) => setNewServerArgs(e.target.value)}
                  className="text-xs"
                />
              </>
            ) : (
              <Input
                placeholder="Server URL"
                value={newServerUrl}
                onChange={(e) => setNewServerUrl(e.target.value)}
                className="text-xs"
              />
            )}

            <div className="flex space-x-2">
              <Button
                onClick={editingServer ? handleUpdateServer : handleAddServer}
                size="sm"
                className="flex-1 text-xs"
                disabled={!newServerName.trim()}
              >
                <Check className="w-3 h-3 mr-1" />
                {editingServer ? "Update" : "Add"}
              </Button>
              <Button
                onClick={resetForm}
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Connections List */}
      <div className="flex-1 overflow-y-auto p-2">
        {serverConnections.length === 0 ? (
          <div className="text-center py-8">
            <Server className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No connections</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Add a server to get started
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {serverConnections.map((connection) => (
              <div
                key={connection.name}
                className={`group border rounded-lg p-3 transition-all duration-200 cursor-pointer ${
                  selectedServerName === connection.name
                    ? "ring-2 ring-primary/50 bg-primary/5"
                    : "hover:bg-muted/50"
                } ${getConnectionStatusColor(connection.connectionStatus)}`}
                onClick={() => onServerSelect(connection.name)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      {getConnectionStatusIcon(connection.connectionStatus)}
                      <h4 className="text-xs font-medium text-foreground truncate">
                        {connection.name}
                      </h4>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-1">
                      {connection.config.transportType}
                      {connection.config.transportType === "stdio" && "command" in connection.config
                        ? `: ${connection.config.command}`
                        : "url" in connection.config && connection.config.url
                        ? `: ${connection.config.url.hostname}`
                        : ""
                      }
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditServer(connection.name);
                      }}
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 hover:bg-primary/20 hover:text-primary"
                      title="Edit connection"
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Are you sure you want to remove ${connection.name}?`)) {
                          onRemoveServer(connection.name);
                        }
                      }}
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive"
                      title="Remove connection"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground capitalize">
                    {connection.connectionStatus}
                  </span>
                  
                  <div className="flex space-x-1">
                    {connection.connectionStatus === "connected" ? (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDisconnectServer(connection.name);
                        }}
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onConnectServer(connection.name);
                        }}
                        size="sm"
                        className="h-6 text-xs px-2"
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                </div>

                {connection.capabilities && (
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <div className="flex flex-wrap gap-1">
                      {connection.capabilities.tools && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                          Tools
                        </span>
                      )}
                      {connection.capabilities.resources && (
                        <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
                          Resources
                        </span>
                      )}
                      {connection.capabilities.prompts && (
                        <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">
                          Prompts
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionsSidebar; 