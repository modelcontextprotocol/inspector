import React from "react";
import { ServerConfig, ServerStatus } from "./types/multiserver";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  MoreVertical,
  Play,
  Square,
  Settings,
  Trash2,
  Wifi,
  WifiOff,
  AlertCircle,
  Eye,
} from "lucide-react";

interface ServerCardProps {
  server: ServerConfig;
  status: ServerStatus;
  onConnect: (serverId: string) => void;
  onDisconnect: (serverId: string) => void;
  onEdit: (server: ServerConfig) => void;
  onDelete: (serverId: string) => void;
  onSelect: (serverId: string) => void;
  onView: (server: ServerConfig) => void;
  isSelected?: boolean;
  className?: string;
}

const getStatusColor = (status: ServerStatus["status"]) => {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "warning";
    case "error":
      return "error";
    case "disconnected":
    default:
      return "secondary";
  }
};

const getStatusIcon = (status: ServerStatus["status"]) => {
  switch (status) {
    case "connected":
      return <Wifi className="h-4 w-4" />;
    case "connecting":
      return <Wifi className="h-4 w-4 animate-pulse" />;
    case "error":
      return <AlertCircle className="h-4 w-4" />;
    case "disconnected":
    default:
      return <WifiOff className="h-4 w-4" />;
  }
};

const getStatusText = (status: ServerStatus["status"]) => {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "error":
      return "Error";
    case "disconnected":
    default:
      return "Disconnected";
  }
};

export const ServerCard: React.FC<ServerCardProps> = ({
  server,
  status,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  onSelect,
  onView,
  isSelected = false,
  className = "",
}) => {
  const handleConnect = () => {
    if (status.status === "connected") {
      onDisconnect(server.id);
    } else {
      onConnect(server.id);
    }
  };

  const handleCardClick = () => {
    onSelect(server.id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(server);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(server.id);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    onView(server);
  };

  const isConnected = status.status === "connected";
  const isConnecting = status.status === "connecting";

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? "ring-2 ring-primary" : ""
      } ${className}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-label={`Server ${server.name}, status: ${getStatusText(status.status)}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg font-semibold truncate">
              {server.name}
            </CardTitle>
            {server.description && (
              <CardDescription className="mt-1 text-sm text-muted-foreground">
                {server.description}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2">
            <Badge
              variant={getStatusColor(status.status)}
              className="flex items-center gap-1"
            >
              {getStatusIcon(status.status)}
              {getStatusText(status.status)}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleView}>
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleEdit}>
                  <Settings className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Transport:</span>
            <Badge variant="outline">{server.transportType}</Badge>
          </div>

          {status.lastConnected && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Last connected:</span>
              <span className="text-xs">
                {new Date(status.lastConnected).toLocaleString()}
              </span>
            </div>
          )}

          {status.lastError && (
            <div className="text-sm">
              <span className="text-muted-foreground">Error:</span>
              <p className="text-xs text-destructive mt-1 break-words">
                {status.lastError}
              </p>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="pt-0">
        <div className="flex gap-2 w-full">
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleConnect();
            }}
            disabled={isConnecting}
            variant={isConnected ? "outline" : "default"}
            size="sm"
            className="flex-1"
          >
            {isConnecting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                Connecting...
              </>
            ) : isConnected ? (
              <>
                <Square className="mr-2 h-4 w-4" />
                Disconnect
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Connect
              </>
            )}
          </Button>
          <Button
            onClick={handleView}
            variant="outline"
            size="sm"
            className="px-3"
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};
