import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Trash2,
  Server,
  Wifi,
  WifiOff,
  AlertCircle,
  Edit2,
} from "lucide-react";
import useTheme from "../lib/hooks/useTheme";
import { version } from "../../../package.json";
import { MCPJamAgent } from "../mcpjamAgent";

interface SidebarProps {
  mcpAgent: MCPJamAgent | null;
  selectedServerName: string;
  onServerSelect: (serverName: string) => void;
  onRemoveServer: (serverName: string) => Promise<void>;
  onConnectServer: (serverName: string) => Promise<void>;
  onDisconnectServer: (serverName: string) => Promise<void>;
  onCreateClient: () => void;
  onEditClient: (serverName: string) => void;
  updateTrigger: number;
}

const Sidebar: React.FC<SidebarProps> = ({
  mcpAgent,
  selectedServerName,
  onServerSelect,
  onRemoveServer,
  onConnectServer,
  onDisconnectServer,
  onCreateClient,
  onEditClient,
  updateTrigger,
}) => {
  const [theme, setTheme] = useTheme();

  // Get server connections directly from the agent
  // The updateTrigger dependency will cause this to re-evaluate when agent state changes
  const serverConnections = React.useMemo(() => {
    return mcpAgent ? mcpAgent.getAllConnectionInfo() : [];
  }, [mcpAgent, updateTrigger]);

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
        return "text-green-600 dark:text-green-400";
      case "disconnected":
        return "text-gray-500 dark:text-gray-400";
      case "error":
      case "error-connecting-to-proxy":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-gray-500 dark:text-gray-400";
    }
  };

  // Show create client prompt if no clients exist
  const shouldShowCreatePrompt = serverConnections.length === 0;

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full">
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

          {/* Title */}
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
            onClick={onCreateClient}
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 hover:bg-primary/20 hover:text-primary"
            title="Create new client"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
            {/* Show create client prompt if no clients */}
            {shouldShowCreatePrompt && (
              <div className="p-4 text-center">
                <div className="py-8">
                  <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-sm font-medium mb-2">No clients connected</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Create your first MCP client to get started
                  </p>
                  <Button
                    onClick={onCreateClient}
                    size="sm"
                    className="w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Client
                  </Button>
                </div>
              </div>
            )}

            {/* Client List */}
            {serverConnections.length > 0 && (
              <div className="p-3 space-y-2">
                {/* All Servers Option */}
                <div
                  className={`p-3 rounded-lg border cursor-pointer transition-all hover:bg-muted/50 ${
                    selectedServerName === "all"
                      ? "border-primary bg-primary/10"
                      : "border-border"
                  }`}
                  onClick={() => onServerSelect("all")}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex -space-x-1">
                        {serverConnections.slice(0, 3).map((_, index) => (
                          <div
                            key={index}
                            className="w-6 h-6 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center"
                          >
                            <Server className="w-3 h-3 text-primary" />
                          </div>
                        ))}
                        {serverConnections.length > 3 && (
                          <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                            <span className="text-xs font-medium">+{serverConnections.length - 3}</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm">All Servers</div>
                        <div className="text-xs text-muted-foreground">
                          Aggregate view of all connections
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Individual Server Connections */}
                {serverConnections.map((connection) => (
                  <div
                    key={connection.name}
                    className={`p-3 rounded-lg border cursor-pointer transition-all hover:bg-muted/50 ${
                      selectedServerName === connection.name
                        ? "border-primary bg-primary/10"
                        : "border-border"
                    }`}
                    onClick={() => onServerSelect(connection.name)}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          {getConnectionStatusIcon(connection.connectionStatus)}
                          <div>
                            <div className="font-medium text-sm">{connection.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {connection.config.transportType === "stdio" && "command" in connection.config
                                ? `${connection.config.command} ${connection.config.args?.join(" ") || ""}`
                                : "url" in connection.config && connection.config.url
                                ? connection.config.url.toString()
                                : "Unknown configuration"}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex space-x-1">
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditClient(connection.name);
                            }}
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveServer(connection.name);
                            }}
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className={`text-xs capitalize ${getConnectionStatusColor(connection.connectionStatus)}`}>
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Theme Selector */}
      <div className="p-4 border-t">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Theme</span>
          <Select
            value={theme}
            onValueChange={(value: string) =>
              setTheme(value as "system" | "light" | "dark")
            }
          >
            <SelectTrigger className="w-[100px]" id="theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
