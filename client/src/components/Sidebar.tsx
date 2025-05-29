import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Bookmark, Trash2, Calendar, Star, Edit2, Copy } from "lucide-react";
import { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import useTheme from "../lib/hooks/useTheme";
import { version } from "../../../package.json";
import { PendingRequest } from "./SamplingTab";
import { useEffect, useState } from "react";
import { McpJamRequest } from "@/lib/requestTypes";
import { RequestStorage } from "@/utils/requestStorage";
import { sortRequests } from "@/utils/requestUtils";
import { createMcpJamRequest } from "@/utils/requestUtils";
import { Input } from "@/components/ui/input";

interface SidebarProps {
  currentPage: string;
  onPageChange: (page: string) => void;
  serverCapabilities?: ServerCapabilities | null;
  pendingSampleRequests: PendingRequest[];
  shouldDisableAll: boolean;
  onLoadRequest?: (request: McpJamRequest) => void;
}

const Sidebar = ({ onPageChange, onLoadRequest }: SidebarProps) => {
  const [theme, setTheme] = useTheme();
  const [savedRequests, setSavedRequests] = useState<McpJamRequest[]>([]);
  const [renamingRequestId, setRenamingRequestId] = useState<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

  // Load saved requests on component mount
  useEffect(() => {
    const loadSavedRequests = () => {
      const requests = RequestStorage.loadRequests();
      const sortedRequests = sortRequests(requests, "updatedAt", "desc");
      setSavedRequests(sortedRequests);
    };

    loadSavedRequests();

    // Listen for storage changes (when requests are saved from other components)
    const handleStorageChange = () => {
      loadSavedRequests();
    };

    window.addEventListener("storage", handleStorageChange);

    // Custom event for when requests are saved within the same tab
    window.addEventListener("requestSaved", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("requestSaved", handleStorageChange);
    };
  }, []);

  const handlePageChange = (page: string) => {
    onPageChange(page);
    window.location.hash = page;
  };

  const handleDeleteRequest = (requestId: string) => {
    if (confirm("Are you sure you want to delete this saved request?")) {
      RequestStorage.removeRequest(requestId);
      setSavedRequests((prev) => prev.filter((req) => req.id !== requestId));
    }
  };

  const handleLoadRequest = (request: McpJamRequest) => {
    if (onLoadRequest) {
      onLoadRequest(request);
      // Switch to tools tab to show the loaded request
      handlePageChange("tools");
    }
  };

  const handleRenameRequest = (requestId: string, currentName: string) => {
    setRenamingRequestId(requestId);
    setRenameValue(currentName);
  };

  const handleSaveRename = (requestId: string) => {
    if (renameValue.trim()) {
      RequestStorage.updateRequest(requestId, { name: renameValue.trim() });
      setSavedRequests((prev) =>
        prev.map((req) =>
          req.id === requestId ? { ...req, name: renameValue.trim() } : req,
        ),
      );
    }
    setRenamingRequestId(null);
    setRenameValue("");
  };

  const handleCancelRename = () => {
    setRenamingRequestId(null);
    setRenameValue("");
  };

  const handleDuplicateRequest = (request: McpJamRequest) => {
    const duplicatedRequest = createMcpJamRequest({
      name: `${request.name} (Copy)`,
      description: request.description,
      toolName: request.toolName,
      tool: request.tool,
      parameters: request.parameters,
      tags: request.tags || [],
      isFavorite: false,
    });

    RequestStorage.addRequest(duplicatedRequest);
    setSavedRequests((prev) => [duplicatedRequest, ...prev]);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
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

      {/* Navigation Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Saved Requests Section */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b border-border/50">
            <div className="flex items-center space-x-2">
              <Bookmark className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">
                Saved Requests
              </h3>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {savedRequests.length}
              </span>
            </div>
          </div>

          {/* Scrollable Requests List */}
          <div className="flex-1 overflow-y-auto p-2">
            {savedRequests.length === 0 ? (
              <div className="text-center py-8">
                <Bookmark className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  No saved requests
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Save requests from the Tools tab
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {savedRequests.map((request) => (
                  <div
                    key={request.id}
                    className="group bg-muted/30 hover:bg-muted/50 border border-border/30 rounded-lg p-2.5 transition-all duration-200 cursor-pointer"
                    onClick={() =>
                      renamingRequestId !== request.id &&
                      handleLoadRequest(request)
                    }
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="flex-1 min-w-0">
                        {renamingRequestId === request.id ? (
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleSaveRename(request.id);
                              } else if (e.key === "Escape") {
                                handleCancelRename();
                              }
                            }}
                            onBlur={() => handleSaveRename(request.id)}
                            className="text-xs h-6 font-medium"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <h4 className="text-xs font-medium text-foreground truncate">
                            {request.name}
                          </h4>
                        )}
                        <p className="text-xs text-muted-foreground font-mono">
                          {request.toolName}
                        </p>
                      </div>
                      <div className="flex items-center space-x-1">
                        {request.isFavorite && (
                          <Star className="w-3 h-3 text-yellow-500 fill-current" />
                        )}
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRenameRequest(request.id, request.name);
                          }}
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 hover:bg-primary/20 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Rename request"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateRequest(request);
                          }}
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 hover:bg-blue-500/20 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Duplicate request"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRequest(request.id);
                          }}
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete request"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    {request.description && (
                      <p className="text-xs text-muted-foreground/80 mb-1.5 line-clamp-2">
                        {request.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                      <div className="flex items-center space-x-1">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(request.updatedAt)}</span>
                      </div>
                      {request.isFavorite && (
                        <span className="text-yellow-500">★</span>
                      )}
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
