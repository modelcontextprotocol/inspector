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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import useTheme from "../lib/hooks/useTheme";
import { version } from "../../../package.json";
import { MCPJamAgent, ServerConnectionInfo } from "../mcpjamAgent";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  isExpanded: boolean;
  onToggleExpanded: () => void;
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
  isExpanded,
  onToggleExpanded,
}) => {
  const [theme, setTheme] = useTheme();

  // Get server connections directly from the agent
  const serverConnections = React.useMemo(() => {
    return mcpAgent ? mcpAgent.getAllConnectionInfo() : [];
  }, [mcpAgent, updateTrigger]);

  // Helper function to get logo source based on theme
  const getLogoSrc = () => {
    if (theme === "dark") {
      return "/mcp_jam_dark.png";
    } else if (theme === "light") {
      return "/mcp_jam_light.png";
    } else {
      const isDarkMode = document.documentElement.classList.contains("dark");
      return isDarkMode ? "/mcp_jam_dark.png" : "/mcp_jam_light.png";
    }
  };

  // Helper function to get connection status icon
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

  // Helper function to get connection status color
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

  // Helper function to check if connection should be disabled
  const shouldDisableConnection = (connection: ServerConnectionInfo) => {
    if (!mcpAgent || connection.connectionStatus === "connected") {
      return false;
    }

    if (connection.config.transportType !== "stdio") {
      const hasConnectedRemote = mcpAgent.hasConnectedRemoteServer();
      const connectedRemoteName = mcpAgent.getConnectedRemoteServerName();
      return hasConnectedRemote && connectedRemoteName !== connection.name;
    }

    return false;
  };

  // Helper function to get connect tooltip message
  const getConnectTooltipMessage = (connection: ServerConnectionInfo) => {
    if (shouldDisableConnection(connection)) {
      const connectedRemoteName = mcpAgent?.getConnectedRemoteServerName();
      return `Cannot connect: "${connectedRemoteName}" is already connected (only one remote server allowed at a time)`;
    }
    return "Connect to this server";
  };

  // Helper function to get connection display text
  const getConnectionDisplayText = (connection: ServerConnectionInfo) => {
    if (
      connection.config.transportType === "stdio" &&
      "command" in connection.config
    ) {
      return `${connection.config.command} ${connection.config.args?.join(" ") || ""}`;
    }
    if ("url" in connection.config && connection.config.url) {
      return connection.config.url.toString();
    }
    return "Unknown configuration";
  };

  // Component: Header with logo and version
  const renderHeader = () => (
    <div className="p-4 border-b border-gray-200 dark:border-gray-800">
      <div className="flex flex-col items-center space-y-2">
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
        <div className="text-center">
          <p className="text-xs text-muted-foreground opacity-70">v{version}</p>
        </div>
      </div>
    </div>
  );

  // Component: Connections header with count and add button
  const renderConnectionsHeader = () => (
    <div className="p-3 border-b border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Connections</h3>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {serverConnections.length}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={onCreateClient}
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 hover:bg-primary/20 hover:text-primary"
              title="Create new client"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {mcpAgent?.hasConnectedRemoteServer()
              ? "Note: Creating a remote client will disconnect the current remote connection"
              : "Create new client"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );

  // Component: Empty state when no clients exist
  const renderEmptyState = () => (
    <div className="p-4 text-center">
      <div className="py-8">
        <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-sm font-medium mb-2">No clients connected</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Create your first MCP client to get started
        </p>
        <Button onClick={onCreateClient} size="sm" className="w-full">
          <Plus className="w-4 h-4 mr-2" />
          Create Client
        </Button>
      </div>
    </div>
  );

  // Component: Action buttons for each connection
  const renderConnectionActions = (connection: ServerConnectionInfo) => (
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
  );

  // Component: Connection button (Connect/Disconnect)
  const renderConnectionButton = (connection: ServerConnectionInfo) => {
    if (connection.connectionStatus === "connected") {
      return (
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
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onConnectServer(connection.name);
                onServerSelect(connection.name);
              }}
              size="sm"
              className="h-6 text-xs px-2"
              disabled={shouldDisableConnection(connection)}
            >
              Connect
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{getConnectTooltipMessage(connection)}</TooltipContent>
      </Tooltip>
    );
  };

  // Component: Individual connection item
  const renderConnectionItem = (connection: ServerConnectionInfo) => (
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
                {getConnectionDisplayText(connection)}
              </div>
            </div>
          </div>
          {renderConnectionActions(connection)}
        </div>

        <div className="flex items-center justify-between">
          <span
            className={`text-xs capitalize ${getConnectionStatusColor(connection.connectionStatus)}`}
          >
            {connection.connectionStatus}
          </span>
          <div className="flex space-x-1">
            {renderConnectionButton(connection)}
          </div>
        </div>
      </div>
    </div>
  );

  // Component: Theme selector
  const renderThemeSelector = () => (
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
  );

  const renderToggleExpandedButton = () => {
    return (
      <Button
        onClick={onToggleExpanded}
        size="sm"
        variant="outline"
        className="absolute top-1/2 -translate-y-1/2 -right-4 h-8 w-8 p-0 bg-background border border-border rounded-full shadow-md hover:shadow-lg z-10 transition-all duration-200"
      >
        {isExpanded ? (
          <ChevronLeft className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </Button>
    );
  };

  const renderExpandedContent = () => {
    return (
      <>
        {renderHeader()}
        {renderConnectionsHeader()}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">
              {shouldShowCreatePrompt && renderEmptyState()}

              {serverConnections.length > 0 && (
                <div className="p-3 space-y-2">
                  {serverConnections.map(renderConnectionItem)}
                </div>
              )}
            </div>
          </div>
        </div>
        {renderThemeSelector()}
      </>
    );
  };

  const renderCollapsedContent = () => {
    return (
      <div className="flex-1 flex flex-col items-center pt-4 space-y-4">
        <div className="flex flex-col space-y-2">
          {serverConnections.slice(0, 5).map((connection) => (
            <Tooltip key={connection.name}>
              <TooltipTrigger asChild>
                <div
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors ${
                    selectedServerName === connection.name
                      ? "border-primary bg-primary/10"
                      : "border-border bg-muted/50"
                  }`}
                  onClick={() => onServerSelect(connection.name)}
                >
                  {getConnectionStatusIcon(connection.connectionStatus)}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="text-xs">
                  <div className="font-medium">{connection.name}</div>
                  <div className="text-muted-foreground capitalize">
                    {connection.connectionStatus}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Add Server Button in Collapsed State */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onCreateClient}
                size="sm"
                variant="ghost"
                className="w-8 h-8 p-0 rounded-full"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Create new client</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  };

  const shouldShowCreatePrompt = serverConnections.length === 0;

  return (
    <div
      className={`${isExpanded ? "w-80" : "w-16"} bg-card border-r border-border flex flex-col h-full transition-all duration-300 ease-in-out relative`}
    >
      {renderToggleExpandedButton()}
      {isExpanded ? renderExpandedContent() : renderCollapsedContent()}
    </div>
  );
};

export default Sidebar;
