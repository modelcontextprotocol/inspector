import {
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import ListPane from "./ListPane";
import { ConnectionStatus } from "@/lib/constants";
import ToolRunCard from "./ToolRunCard";
import { McpJamRequest } from "@/lib/requestTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bookmark, Trash2, Calendar, Star, Edit2, Copy } from "lucide-react";
import { RequestStorage } from "@/utils/requestStorage";
import { sortRequests, createMcpJamRequest, getRequestsForClient } from "@/utils/requestUtils";

const ToolsTab = ({
  tools,
  listTools,
  clearTools,
  callTool,
  selectedTool,
  setSelectedTool,
  nextCursor,
  connectionStatus,
  selectedServerName,
}: {
  tools: Tool[];
  listTools: () => void;
  clearTools: () => void;
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool | null) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
  connectionStatus: ConnectionStatus;
  selectedServerName: string;
}) => {
  const [savedRequests, setSavedRequests] = useState<McpJamRequest[]>([]);
  const [renamingRequestId, setRenamingRequestId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [loadedRequest, setLoadedRequest] = useState<McpJamRequest | null>(null);

  // Load saved requests on component mount and filter by current client
  useEffect(() => {
    const loadSavedRequests = () => {
      const allRequests = RequestStorage.loadRequests();
      // Filter requests for the current client
      const clientRequests = selectedServerName 
        ? getRequestsForClient(allRequests, selectedServerName)
        : [];
      const sortedRequests = sortRequests(clientRequests, "updatedAt", "desc");
      setSavedRequests(sortedRequests);
    };

    loadSavedRequests();

    // Listen for storage changes (when requests are saved from other components)
    const handleStorageChange = () => {
      loadSavedRequests();
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("requestSaved", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("requestSaved", handleStorageChange);
    };
  }, [selectedServerName]);

  useEffect(() => {
    if (connectionStatus === "connected") {
      listTools();
    }
  }, [connectionStatus]);

  const handleDeleteRequest = (requestId: string) => {
    if (confirm("Are you sure you want to delete this saved request?")) {
      RequestStorage.removeRequest(requestId);
      setSavedRequests((prev) => prev.filter((req) => req.id !== requestId));
    }
  };

  const handleLoadRequest = (request: McpJamRequest) => {
    // Find and select the matching tool
    const matchingTool = tools.find((tool) => tool.name === request.toolName);
    if (matchingTool) {
      setSelectedTool(matchingTool);
    }
    // Set the loaded request for ToolRunCard
    setLoadedRequest(request);
    // Clear the loaded request after a short delay to allow the component to process it
    setTimeout(() => setLoadedRequest(null), 100);
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
      clientId: selectedServerName,
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

  return (
    <div className="grid grid-cols-3 gap-4 h-full">
      {/* Saved Requests Section */}
      <div className="flex flex-col bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-3 border-b border-border/50 bg-muted/30">
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

        <div className="flex-1 overflow-y-auto p-2">
          {savedRequests.length === 0 ? (
            <div className="text-center py-8">
              <Bookmark className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                No saved requests
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Save requests from the tool runner
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

      {/* Tools List */}
      <ListPane
        items={tools}
        listItems={listTools}
        clearItems={() => {
          clearTools();
          setSelectedTool(null);
        }}
        setSelectedItem={setSelectedTool}
        renderItem={(tool) => {
          const parameters = tool.inputSchema.properties
            ? Object.keys(tool.inputSchema.properties)
            : [];

          return (
            <div className="bg-white dark:bg-gray-900 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all duration-200 group">
              <div className="flex flex-col space-y-2.5">
                {/* Tool name with emoji and styling */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🛠️</span>
                    <span className="font-mono text-xs bg-gradient-to-r from-slate-100 to-gray-100 dark:from-slate-800 dark:to-gray-800 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 font-medium shadow-sm">
                      {tool.name}
                    </span>
                  </div>
                  {parameters.length > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-600 font-medium">
                      {parameters.length} param
                      {parameters.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {/* Tool description */}
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2">
                  {tool.description}
                </p>
              </div>
            </div>
          );
        }}
        title="Tools"
        isButtonDisabled={!nextCursor && tools.length > 0}
        searchKey="name"
        searchPlaceholder="Search tools by name..."
        buttonText="Load Tools"
      />

      {/* Tool Runner */}
      <ToolRunCard
        selectedTool={selectedTool}
        callTool={callTool}
        loadedRequest={loadedRequest}
        selectedServerName={selectedServerName}
      />
    </div>
  );
};

export default ToolsTab;
