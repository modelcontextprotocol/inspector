import React, { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { useServerConnection } from "../../lib/hooks/useServerConnection";
import { useDraggablePane } from "../../lib/hooks/useDraggablePane";
import {
  ServerConfig,
  ServerStatus,
  ServerConnection,
} from "./types/multiserver";
import {
  Files,
  Hammer,
  MessageSquare,
  Server,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Bell,
  Hash,
  FolderTree,
  Key,
} from "lucide-react";
import {
  Resource,
  ResourceTemplate,
  Tool,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListPromptsResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  GetPromptResultSchema,
  CompatibilityCallToolResultSchema,
  CompatibilityCallToolResult,
  ResourceReference,
  PromptReference,
  Root,
  CreateMessageResult,
  EmptyResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import ResourcesTab from "../ResourcesTab";
import PromptsTab, { Prompt } from "../PromptsTab";
import ToolsTab from "../ToolsTab";
import PingTab from "../PingTab";
import SamplingTab, { PendingRequest } from "../SamplingTab";
import ElicitationTab, {
  PendingElicitationRequest,
  ElicitationResponse,
} from "../ElicitationTab";
import RootsTab from "../RootsTab";
import AuthDebugger from "../AuthDebugger";
import MultiServerHistoryAndNotifications from "./MultiServerHistoryAndNotifications";
import { useMultiServerErrors } from "./hooks/useMultiServerErrors";
import { useMultiServerMCP } from "./hooks/useMultiServerMCP";
import { cacheToolOutputSchemas } from "../../utils/schemaUtils";
import { AuthDebuggerState, EMPTY_DEBUGGER_STATE } from "../../lib/auth-types";

interface ServerSpecificTabsProps {
  server: ServerConfig;
  serverStatus?: ServerStatus;
  serverConnection?: ServerConnection;
  onConnect?: () => Promise<void>;
  onDisconnect?: () => Promise<void>;
  className?: string;
}

export const ServerSpecificTabs: React.FC<ServerSpecificTabsProps> = ({
  server,
  serverStatus,
  serverConnection,
  onConnect,
  onDisconnect,
  className = "",
}) => {
  const hookResult = useServerConnection({
    serverId: server.id,
    server,
  });

  // Prioritize multi-server props over hook results for better streamable HTTP support
  const status = serverStatus || hookResult.status;
  const isConnected = serverStatus
    ? serverStatus.status === "connected"
    : hookResult.isConnected;
  const isConnecting = serverStatus
    ? serverStatus.status === "connecting"
    : hookResult.isConnecting;
  const hasError = serverStatus
    ? serverStatus.status === "error"
    : hookResult.hasError;
  const getError = () => serverStatus?.lastError || hookResult.getError();

  // Use capabilities from serverConnection if available, otherwise from hook
  const getCapabilities = useCallback(() => {
    return serverConnection?.capabilities || hookResult.getCapabilities();
  }, [serverConnection, hookResult.getCapabilities]);

  // Multi-server HTTP API hook
  const multiServerMCP = useMultiServerMCP(server.id);

  // Use the hook's makeRequest as it properly handles the MCP client communication
  // But only if we have a valid connection
  const makeRequest = useCallback(
    async (request: any, schema: any) => {
      // Check if we're in multi-server mode (have serverConnection but no direct client)
      // or if we have serverStatus (indicating we're being used in multi-server context)
      const isMultiServerMode =
        serverStatus !== undefined ||
        (serverConnection && !serverConnection.client);

      if (isMultiServerMode) {
        // Use multi-server HTTP API
        try {
          console.log(
            `[ServerSpecificTabs] Using multi-server HTTP API for ${request.method}`,
          );
          const response = await multiServerMCP.makeRequest(request, schema);
          return response;
        } catch (error) {
          console.error("Multi-server HTTP API request failed:", error);
          throw error;
        }
      } else if (serverConnection?.client) {
        // Use the multi-server connection's client directly
        try {
          const response = await serverConnection.client.request(
            request,
            schema,
          );
          return response;
        } catch (error) {
          console.error("Multi-server direct client request failed:", error);
          throw error;
        }
      } else {
        // Fall back to hook's makeRequest (single-server mode)
        return hookResult.makeRequest(request, schema);
      }
    },
    [serverConnection, hookResult.makeRequest, serverStatus, multiServerMCP],
  );

  // Use passed connection handlers if available, otherwise fall back to hook handlers
  const connect = onConnect || hookResult.connect;
  const disconnect = onDisconnect || hookResult.disconnect;

  // Error management for this specific server
  const { getServerErrors } = useMultiServerErrors();
  getServerErrors(server.id); // Call to ensure subscription is active

  // Subscribe to real-time error updates for this server
  useEffect(() => {
    // The useMultiServerErrors hook already subscribes to the history store
    // This effect ensures the component re-renders when errors change
    // The subscription is handled internally by the hook
  }, [server.id]);

  const [activeTab, setActiveTab] = useState<string>("overview");

  // Resources state
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >([]);
  const [resourceContent, setResourceContent] = useState<string>("");
  const [resourceContentMap, setResourceContentMap] = useState<
    Record<string, string>
  >({});
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [resourceSubscriptions, setResourceSubscriptions] = useState<
    Set<string>
  >(new Set());
  const [nextResourceCursor, setNextResourceCursor] = useState<
    string | undefined
  >();
  const [nextResourceTemplateCursor, setNextResourceTemplateCursor] = useState<
    string | undefined
  >();

  // Prompts state
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptContent, setPromptContent] = useState<string>("");
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [nextPromptCursor, setNextPromptCursor] = useState<
    string | undefined
  >();

  // Tools state
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolResult, setToolResult] =
    useState<CompatibilityCallToolResult | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [nextToolCursor, setNextToolCursor] = useState<string | undefined>();

  // Additional tabs state
  const [pendingSampleRequests, setPendingSampleRequests] = useState<
    Array<
      PendingRequest & {
        resolve: (result: CreateMessageResult) => void;
        reject: (error: Error) => void;
      }
    >
  >([]);
  const [pendingElicitationRequests, setPendingElicitationRequests] = useState<
    Array<
      PendingElicitationRequest & {
        resolve: (response: ElicitationResponse) => void;
        decline: (error: Error) => void;
      }
    >
  >([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [authState, setAuthState] =
    useState<AuthDebuggerState>(EMPTY_DEBUGGER_STATE);

  // Error state
  const [errors, setErrors] = useState<Record<string, string | null>>({
    resources: null,
    prompts: null,
    tools: null,
  });

  // History pane
  const {
    height: historyPaneHeight,
    handleDragStart,
    isDragging,
  } = useDraggablePane(300);

  const serverCapabilities = getCapabilities();

  // Completion support for resources and prompts
  const handleCompletion = useCallback(
    async (
      _ref: ResourceReference | PromptReference,
      _argName: string,
      _value: string,
      _context?: Record<string, string>,
    ): Promise<string[]> => {
      // For multi-server mode, we don't have completion support yet
      // This is a placeholder that returns empty array
      return [];
    },
    [],
  );

  const completionsSupported = false; // Multi-server mode doesn't support completions yet

  // Error handling helper
  const clearError = useCallback((tabKey: keyof typeof errors) => {
    setErrors((prev) => ({ ...prev, [tabKey]: null }));
  }, []);

  // Generic request helper
  const sendMCPRequest = useCallback(
    async <T extends z.ZodType>(
      request: any,
      schema: T,
      tabKey?: keyof typeof errors,
    ) => {
      try {
        const response = await makeRequest(request, schema);
        if (tabKey !== undefined) {
          clearError(tabKey);
        }
        return response;
      } catch (e) {
        const errorString = (e as Error).message ?? String(e);
        if (tabKey !== undefined) {
          setErrors((prev) => ({
            ...prev,
            [tabKey]: errorString,
          }));
        }
        throw e;
      }
    },
    [makeRequest, clearError],
  );

  // Resources functions
  const listResources = useCallback(async () => {
    const response = await sendMCPRequest(
      {
        method: "resources/list" as const,
        params: nextResourceCursor ? { cursor: nextResourceCursor } : {},
      },
      ListResourcesResultSchema,
      "resources",
    );
    setResources(resources.concat(response.resources ?? []));
    setNextResourceCursor(response.nextCursor);
  }, [sendMCPRequest, nextResourceCursor, resources]);

  const listResourceTemplates = useCallback(async () => {
    const response = await sendMCPRequest(
      {
        method: "resources/templates/list" as const,
        params: nextResourceTemplateCursor
          ? { cursor: nextResourceTemplateCursor }
          : {},
      },
      ListResourceTemplatesResultSchema,
      "resources",
    );
    setResourceTemplates(
      resourceTemplates.concat(response.resourceTemplates ?? []),
    );
    setNextResourceTemplateCursor(response.nextCursor);
  }, [sendMCPRequest, nextResourceTemplateCursor, resourceTemplates]);

  const readResource = useCallback(
    async (uri: string) => {
      const response = await sendMCPRequest(
        {
          method: "resources/read" as const,
          params: { uri },
        },
        ReadResourceResultSchema,
        "resources",
      );
      const content = JSON.stringify(response, null, 2);
      setResourceContent(content);
      setResourceContentMap((prev) => ({
        ...prev,
        [uri]: content,
      }));
    },
    [sendMCPRequest],
  );

  const subscribeToResource = useCallback(
    async (uri: string) => {
      if (!resourceSubscriptions.has(uri)) {
        await sendMCPRequest(
          {
            method: "resources/subscribe" as const,
            params: { uri },
          },
          z.object({}),
          "resources",
        );
        const clone = new Set(resourceSubscriptions);
        clone.add(uri);
        setResourceSubscriptions(clone);
      }
    },
    [sendMCPRequest, resourceSubscriptions],
  );

  const unsubscribeFromResource = useCallback(
    async (uri: string) => {
      if (resourceSubscriptions.has(uri)) {
        await sendMCPRequest(
          {
            method: "resources/unsubscribe" as const,
            params: { uri },
          },
          z.object({}),
          "resources",
        );
        const clone = new Set(resourceSubscriptions);
        clone.delete(uri);
        setResourceSubscriptions(clone);
      }
    },
    [sendMCPRequest, resourceSubscriptions],
  );

  // Prompts functions
  const listPrompts = useCallback(async () => {
    const response = await sendMCPRequest(
      {
        method: "prompts/list" as const,
        params: nextPromptCursor ? { cursor: nextPromptCursor } : {},
      },
      ListPromptsResultSchema,
      "prompts",
    );
    setPrompts(response.prompts);
    setNextPromptCursor(response.nextCursor);
  }, [sendMCPRequest, nextPromptCursor]);

  const getPrompt = useCallback(
    async (name: string, args: Record<string, string> = {}) => {
      const response = await sendMCPRequest(
        {
          method: "prompts/get" as const,
          params: { name, arguments: args },
        },
        GetPromptResultSchema,
        "prompts",
      );
      setPromptContent(JSON.stringify(response, null, 2));
    },
    [sendMCPRequest],
  );

  // Tools functions
  const listTools = useCallback(async () => {
    const response = await sendMCPRequest(
      {
        method: "tools/list" as const,
        params: nextToolCursor ? { cursor: nextToolCursor } : {},
      },
      ListToolsResultSchema,
      "tools",
    );
    setTools(response.tools);
    setNextToolCursor(response.nextCursor);
    cacheToolOutputSchemas(response.tools);
  }, [sendMCPRequest, nextToolCursor]);

  const callTool = useCallback(
    async (name: string, params: Record<string, unknown>) => {
      try {
        const response = await sendMCPRequest(
          {
            method: "tools/call" as const,
            params: {
              name,
              arguments: params,
              _meta: {
                progressToken: Date.now(), // Simple progress token
              },
            },
          },
          CompatibilityCallToolResultSchema,
          "tools",
        );

        setToolResult(response);
      } catch (e) {
        const toolResult: CompatibilityCallToolResult = {
          content: [
            {
              type: "text",
              text: (e as Error).message ?? String(e),
            },
          ],
          isError: true,
        };
        setToolResult(toolResult);
      }
    },
    [sendMCPRequest],
  );

  // Ping function
  const sendPing = useCallback(async () => {
    await sendMCPRequest(
      {
        method: "ping" as const,
      },
      EmptyResultSchema,
    );
  }, [sendMCPRequest]);

  // Sampling functions
  const handleApproveSampling = useCallback(
    (id: number, result: CreateMessageResult) => {
      setPendingSampleRequests((prev) => {
        const request = prev.find((r) => r.id === id);
        request?.resolve(result);
        return prev.filter((r) => r.id !== id);
      });
    },
    [],
  );

  const handleRejectSampling = useCallback((id: number) => {
    setPendingSampleRequests((prev) => {
      const request = prev.find((r) => r.id === id);
      request?.reject(new Error("Sampling request rejected"));
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  // Elicitation functions
  const handleResolveElicitation = useCallback(
    (id: number, response: ElicitationResponse) => {
      setPendingElicitationRequests((prev) => {
        const request = prev.find((r) => r.id === id);
        if (request) {
          request.resolve(response);
        }
        return prev.filter((r) => r.id !== id);
      });
    },
    [],
  );

  // Roots functions
  const handleRootsChange = useCallback(async () => {
    // Send notification about roots change
    if (serverConnection?.client) {
      try {
        await serverConnection.client.notification({
          method: "notifications/roots/list_changed",
        });
      } catch (error) {
        console.warn("Failed to send roots change notification:", error);
      }
    }
  }, [serverConnection]);

  // Auth functions
  const updateAuthState = useCallback((updates: Partial<AuthDebuggerState>) => {
    setAuthState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Load connection data when component mounts
  useEffect(() => {
    // Don't auto-connect - connection should be managed by the main dashboard
    // Just ensure we have the latest connection state
    if (status.status === "connected" && !serverCapabilities) {
      // If we're supposed to be connected but don't have capabilities, refresh
      const refreshConnection = async () => {
        try {
          // The useServerConnection hook will automatically load the connection
          // when the component mounts via its own useEffect
        } catch (error) {
          console.warn("Failed to refresh connection:", error);
        }
      };
      refreshConnection();
    }
  }, [status.status, serverCapabilities]);

  // Update active tab based on capabilities
  useEffect(() => {
    if (serverCapabilities) {
      const validTabs = [
        ...(serverCapabilities?.resources ? ["resources"] : []),
        ...(serverCapabilities?.prompts ? ["prompts"] : []),
        ...(serverCapabilities?.tools ? ["tools"] : []),
        "ping",
        "sampling",
        "elicitations",
        "roots",
        "auth",
        "overview",
      ];

      if (!validTabs.includes(activeTab)) {
        const defaultTab = serverCapabilities?.resources
          ? "resources"
          : serverCapabilities?.prompts
            ? "prompts"
            : serverCapabilities?.tools
              ? "tools"
              : "ping";
        setActiveTab(defaultTab);
      }
    }
  }, [serverCapabilities, activeTab]);

  // Listen for server notifications from the hook
  useEffect(() => {
    // Add any new notifications from the hook to the history
    if (hookResult.serverNotifications.length > 0) {
      // The notification is already added to the history store by the useServerConnection hook
      // This effect is just to ensure we're aware of new notifications
    }
  }, [hookResult.serverNotifications]);

  const getStatusIcon = () => {
    switch (status.status) {
      case "connected":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "connecting":
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Server className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    switch (status.status) {
      case "connected":
        return "success";
      case "connecting":
        return "warning";
      case "error":
        return "error";
      default:
        return "secondary";
    }
  };

  if (status.status === "connecting" || isConnecting) {
    return (
      <div className={`space-y-4 p-4 ${className}`}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-600 animate-pulse" />
              Connecting to {server.name}
            </CardTitle>
            <CardDescription>
              Establishing connection to the MCP server...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status.status === "error" || hasError) {
    return (
      <div className={`space-y-4 p-4 ${className}`}>
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Connection Error
            </CardTitle>
            <CardDescription>
              Failed to connect to {server.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>
                {getError() ||
                  "Unable to establish connection to the MCP server. Please check the server configuration and try again."}
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button onClick={connect} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className={`space-y-4 p-4 ${className}`}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-gray-400" />
              {server.name}
            </CardTitle>
            <CardDescription>Server is not connected</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={connect}>Connect to Server</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If connected but no capabilities, show the interface with a warning instead of blocking
  const hasCapabilities = serverCapabilities !== null;

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex-1 overflow-auto space-y-4 p-4">
        {/* Server Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {getStatusIcon()}
                <div>
                  <CardTitle>{server.name}</CardTitle>
                  <CardDescription>
                    {server.description || `${server.transportType} server`}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={getStatusColor()}>{status.status}</Badge>
                <Button variant="outline" size="sm" onClick={disconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Server Capabilities Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="resources">
              <Files className="w-4 h-4 mr-2" />
              Resources
            </TabsTrigger>
            <TabsTrigger value="prompts">
              <MessageSquare className="w-4 h-4 mr-2" />
              Prompts
            </TabsTrigger>
            <TabsTrigger value="tools">
              <Hammer className="w-4 h-4 mr-2" />
              Tools
            </TabsTrigger>
            <TabsTrigger value="ping">
              <Bell className="w-4 h-4 mr-2" />
              Ping
            </TabsTrigger>
            <TabsTrigger value="sampling" className="relative">
              <Hash className="w-4 h-4 mr-2" />
              Sampling
              {pendingSampleRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                  {pendingSampleRequests.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="elicitations" className="relative">
              <MessageSquare className="w-4 h-4 mr-2" />
              Elicitations
              {pendingElicitationRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                  {pendingElicitationRequests.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="roots">
              <FolderTree className="w-4 h-4 mr-2" />
              Roots
            </TabsTrigger>
            <TabsTrigger value="auth">
              <Key className="w-4 h-4 mr-2" />
              Auth
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <CardHeader>
                <CardTitle>Server Overview</CardTitle>
                <CardDescription>
                  Server capabilities and information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!hasCapabilities && (
                  <Alert className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Server capabilities could not be determined due to
                      initialization issues. You can still try using the server
                      features through the individual tabs.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="flex items-center gap-2">
                    <Files className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      Resources:{" "}
                      {serverCapabilities?.resources
                        ? "Supported"
                        : hasCapabilities
                          ? "Not supported"
                          : "Unknown (try Resources tab)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      Prompts:{" "}
                      {serverCapabilities?.prompts
                        ? "Supported"
                        : hasCapabilities
                          ? "Not supported"
                          : "Unknown (try Prompts tab)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Hammer className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      Tools:{" "}
                      {serverCapabilities?.tools
                        ? "Supported"
                        : hasCapabilities
                          ? "Not supported"
                          : "Unknown (try Tools tab)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Ping: Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Sampling: Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Elicitations: Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FolderTree className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Roots: Available</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Auth: Available</span>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2">Server Configuration</h4>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div>Transport: {server.transportType}</div>
                    {server.transportType === "stdio" && server.config && (
                      <>
                        <div>Command: {server.config.command}</div>
                        {server.config.args &&
                          server.config.args.length > 0 && (
                            <div>Arguments: {server.config.args.join(" ")}</div>
                          )}
                      </>
                    )}
                    {server.transportType === "streamable-http" &&
                      server.config && <div>URL: {server.config.url}</div>}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="resources">
            <ResourcesTab
              resources={resources}
              resourceTemplates={resourceTemplates}
              listResources={() => {
                clearError("resources");
                listResources();
              }}
              clearResources={() => {
                setResources([]);
                setNextResourceCursor(undefined);
              }}
              listResourceTemplates={() => {
                clearError("resources");
                listResourceTemplates();
              }}
              clearResourceTemplates={() => {
                setResourceTemplates([]);
                setNextResourceTemplateCursor(undefined);
              }}
              readResource={(uri) => {
                clearError("resources");
                readResource(uri);
              }}
              selectedResource={selectedResource}
              setSelectedResource={(resource) => {
                clearError("resources");
                setSelectedResource(resource);
              }}
              resourceSubscriptionsSupported={
                serverCapabilities?.resources?.subscribe || false
              }
              resourceSubscriptions={resourceSubscriptions}
              subscribeToResource={(uri) => {
                clearError("resources");
                subscribeToResource(uri);
              }}
              unsubscribeFromResource={(uri) => {
                clearError("resources");
                unsubscribeFromResource(uri);
              }}
              handleCompletion={handleCompletion}
              completionsSupported={completionsSupported}
              resourceContent={resourceContent}
              nextCursor={nextResourceCursor}
              nextTemplateCursor={nextResourceTemplateCursor}
              error={errors.resources}
            />
          </TabsContent>

          <TabsContent value="prompts">
            <PromptsTab
              prompts={prompts}
              listPrompts={() => {
                clearError("prompts");
                listPrompts();
              }}
              clearPrompts={() => {
                setPrompts([]);
                setNextPromptCursor(undefined);
              }}
              getPrompt={(name, args) => {
                clearError("prompts");
                getPrompt(name, args);
              }}
              selectedPrompt={selectedPrompt}
              setSelectedPrompt={(prompt) => {
                clearError("prompts");
                setSelectedPrompt(prompt);
                setPromptContent("");
              }}
              handleCompletion={handleCompletion}
              completionsSupported={completionsSupported}
              promptContent={promptContent}
              nextCursor={nextPromptCursor}
              error={errors.prompts}
            />
          </TabsContent>

          <TabsContent value="tools">
            <ToolsTab
              tools={tools}
              listTools={() => {
                clearError("tools");
                listTools();
              }}
              clearTools={() => {
                setTools([]);
                setNextToolCursor(undefined);
                cacheToolOutputSchemas([]);
              }}
              callTool={async (name, params) => {
                clearError("tools");
                setToolResult(null);
                await callTool(name, params);
              }}
              selectedTool={selectedTool}
              setSelectedTool={(tool) => {
                clearError("tools");
                setSelectedTool(tool);
                setToolResult(null);
              }}
              toolResult={toolResult}
              nextCursor={nextToolCursor}
              error={errors.tools}
              resourceContent={resourceContentMap}
              onReadResource={(uri: string) => {
                clearError("resources");
                readResource(uri);
              }}
            />
          </TabsContent>

          <TabsContent value="ping">
            <PingTab onPingClick={sendPing} />
          </TabsContent>

          <TabsContent value="sampling">
            <SamplingTab
              pendingRequests={pendingSampleRequests}
              onApprove={handleApproveSampling}
              onReject={handleRejectSampling}
            />
          </TabsContent>

          <TabsContent value="elicitations">
            <ElicitationTab
              pendingRequests={pendingElicitationRequests}
              onResolve={handleResolveElicitation}
            />
          </TabsContent>

          <TabsContent value="roots">
            <RootsTab
              roots={roots}
              setRoots={setRoots}
              onRootsChange={handleRootsChange}
            />
          </TabsContent>

          <TabsContent value="auth">
            <AuthDebugger
              serverUrl={
                server.transportType === "streamable-http" && server.config?.url
                  ? server.config.url
                  : ""
              }
              onBack={() => setActiveTab("overview")}
              authState={authState}
              updateAuthState={updateAuthState}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* History Pane (improved draggable logic) */}
      <div
        className="relative border-t border-border"
        style={{ height: `${historyPaneHeight}px` }}
      >
        <div
          className="absolute w-full h-4 -top-2 cursor-row-resize flex items-center justify-center hover:bg-accent/50 dark:hover:bg-input/40"
          onMouseDown={handleDragStart}
          aria-label="Resize history pane"
          data-testid="history-drag-handle"
          style={{
            zIndex: 10,
            background: isDragging ? "rgba(0,0,0,0.08)" : "transparent",
          }}
        >
          <div className="w-8 h-1 rounded-full bg-border" />
        </div>
        <div className="h-full overflow-auto">
          <MultiServerHistoryAndNotifications filteredServerId={server.id} />
        </div>
      </div>
    </div>
  );
};
