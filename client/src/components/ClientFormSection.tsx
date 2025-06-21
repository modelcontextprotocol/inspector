import React, { useState, useEffect } from "react";
import {
  MCPJamServerConfig,
  StdioServerDefinition,
  HttpServerDefinition,
} from "../lib/serverTypes";
import { InspectorConfig } from "../lib/configurationTypes";
import ConnectionSection from "./ConnectionSection";
import { ParsedServerConfig } from "@/utils/configImportUtils";
import { useToast } from "@/lib/hooks/useToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import {
  X,
  Plus,
  Save,
  AlertCircle,
  Upload,
  Settings,
  Users,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import ConfigImportDialog from "./ConfigImportDialog";

interface ClientConfig {
  id: string;
  name: string;
  config: MCPJamServerConfig;
  argsString: string;
  sseUrlString: string;
}

interface ClientFormSectionProps {
  isCreating: boolean;
  editingClientName: string | null;
  clientFormName: string;
  setClientFormName: (name: string) => void;
  clientFormConfig: MCPJamServerConfig;
  setClientFormConfig: (config: MCPJamServerConfig) => void;
  config: InspectorConfig;
  setConfig: (config: InspectorConfig) => void;
  bearerToken: string;
  setBearerToken: (token: string) => void;
  headerName: string;
  setHeaderName: (name: string) => void;
  onSave: (config: MCPJamServerConfig) => void;
  onCancel: () => void;
  onImportMultipleServers?: (servers: ParsedServerConfig[]) => void;
  onSaveMultiple?: (
    clients: Array<{ name: string; config: MCPJamServerConfig }>,
  ) => Promise<{
    success: string[];
    failed: Array<{ name: string; error: string }>;
  }>;
}

const ClientFormSection: React.FC<ClientFormSectionProps> = ({
  isCreating,
  editingClientName,
  clientFormName,
  setClientFormName,
  clientFormConfig,
  setClientFormConfig,
  config,
  setConfig,
  bearerToken,
  setBearerToken,
  headerName,
  setHeaderName,
  onSave,
  onCancel,
  onImportMultipleServers,
  onSaveMultiple,
}) => {
  // Local state to track raw args string while typing
  const [argsString, setArgsString] = useState<string>("");
  const [sseUrlString, setSseUrlString] = useState<string>("");
  const [multipleClients, setMultipleClients] = useState<ClientConfig[]>([]);
  const [isMultipleMode, setIsMultipleMode] = useState(false);
  const [isManualConfigExpanded, setIsManualConfigExpanded] = useState(false);
  const { toast } = useToast();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [nameError, setNameError] = useState<string>("");

  // Initialize argsString when clientFormConfig changes
  useEffect(() => {
    if (
      clientFormConfig.transportType === "stdio" &&
      "args" in clientFormConfig
    ) {
      setArgsString(clientFormConfig.args?.join(" ") || "");
      setSseUrlString("");
    } else if (
      clientFormConfig.transportType !== "stdio" &&
      "url" in clientFormConfig
    ) {
      setArgsString("");
      setSseUrlString(clientFormConfig.url?.toString() || "");
    }
  }, [clientFormConfig]);

  useEffect(() => {
    if (clientFormName.trim()) {
      setNameError("");
    } else {
      setNameError("Client name is required");
    }
  }, [clientFormName]);

  // Handler for args changes that preserves input while typing
  const handleArgsChange = (newArgsString: string) => {
    setArgsString(newArgsString);

    // Update the config with parsed args
    if (clientFormConfig.transportType === "stdio") {
      setClientFormConfig({
        ...clientFormConfig,
        args: newArgsString.trim() ? newArgsString.split(/\s+/) : [],
      } as StdioServerDefinition);
    }
  };

  const handleSseUrlChange = (newSseUrlString: string) => {
    setSseUrlString(newSseUrlString);
  };

  // Handler for importing multiple servers
  const handleImportServers = (servers: ParsedServerConfig[]) => {
    if (servers.length > 1) {
      // Multiple servers - switch to multiple mode
      const clients: ClientConfig[] = servers.map((server, index) => ({
        id: `client-${Date.now()}-${index}`,
        name: server.name,
        config: server.config,
        argsString:
          server.config.transportType === "stdio" && "args" in server.config
            ? server.config.args?.join(" ") || ""
            : "",
        sseUrlString:
          server.config.transportType !== "stdio" && "url" in server.config
            ? server.config.url?.toString() || ""
            : "",
      }));

      setMultipleClients(clients);
      setIsMultipleMode(true);

      toast({
        title: "Multiple servers imported",
        description: `Imported ${servers.length} server configurations. Configure each client below.`,
      });
    } else if (servers.length === 1) {
      // Single server - use existing flow
      const firstServer = servers[0];
      setClientFormConfig(firstServer.config);
      if (!clientFormName.trim()) {
        setClientFormName(firstServer.name);
      }

      // Update args string if it's a stdio server
      if (
        firstServer.config.transportType === "stdio" &&
        "args" in firstServer.config
      ) {
        setArgsString(firstServer.config.args?.join(" ") || "");
        setSseUrlString("");
      } else if (
        firstServer.config.transportType !== "stdio" &&
        "url" in firstServer.config
      ) {
        setArgsString("");
        setSseUrlString(firstServer.config.url?.toString() || "");
      }

      toast({
        title: "Configuration imported",
        description: `Imported configuration for "${firstServer.name}".`,
      });
    }

    if (onImportMultipleServers) {
      onImportMultipleServers(servers);
    }
  };

  // Handler for updating individual client in multiple mode
  const handleUpdateClient = (
    clientId: string,
    updates: Partial<ClientConfig>,
  ) => {
    setMultipleClients((prev) =>
      prev.map((client) =>
        client.id === clientId ? { ...client, ...updates } : client,
      ),
    );
  };

  // Handler for removing a client in multiple mode
  const handleRemoveClient = (clientId: string) => {
    setMultipleClients((prev) =>
      prev.filter((client) => client.id !== clientId),
    );
  };

  // Handler for adding a new client in multiple mode
  const handleAddClient = () => {
    const newClient: ClientConfig = {
      id: `client-${Date.now()}`,
      name: "",
      config: {
        transportType: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-everything"],
        env: {},
      } as StdioServerDefinition,
      argsString: "@modelcontextprotocol/server-everything",
      sseUrlString: "",
    };
    setMultipleClients((prev) => [...prev, newClient]);
  };

  const handleSingleSave = () => {
    let configToSave = { ...clientFormConfig };

    if (configToSave.transportType !== "stdio") {
      try {
        const url = new URL(sseUrlString);
        configToSave = {
          ...configToSave,
          url,
        } as HttpServerDefinition;
      } catch {
        toast({
          title: "Invalid URL",
          description: "Please enter a valid URL for the client.",
          variant: "destructive",
        });
        return;
      }
    }
    onSave(configToSave);
  };

  const handleSaveAll = async () => {
    if (!onSaveMultiple) return;

    const validClients = multipleClients.filter((c) => c.name.trim());
    if (validClients.length === 0) {
      toast({
        title: "No valid clients",
        description: "Please provide names for at least one client.",
        variant: "destructive",
      });
      return;
    }

    const clientsToSave = validClients.map((client) => {
      let configToSave = { ...client.config };

      if (configToSave.transportType !== "stdio") {
        try {
          const url = new URL(client.sseUrlString);
          configToSave = {
            ...configToSave,
            url,
          } as HttpServerDefinition;
        } catch {
          throw new Error(`Invalid URL for client "${client.name}"`);
        }
      }

      return {
        name: client.name,
        config: configToSave,
      };
    });

    try {
      const result = await onSaveMultiple(clientsToSave);

      if (result.success.length > 0) {
        toast({
          title: "Clients created successfully",
          description: `Successfully created ${result.success.length} client(s).`,
        });
      }

      if (result.failed.length > 0) {
        toast({
          title: "Some clients failed to create",
          description: `${result.failed.length} client(s) failed to create. Check the console for details.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error creating clients",
        description:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  const handleBackToSingle = () => {
    setIsMultipleMode(false);
    setMultipleClients([]);
  };

  if (isMultipleMode) {
    return (
      <div className="flex-1 flex flex-col overflow-auto bg-gradient-to-br from-background to-muted/20">
        <div className="max-w-7xl mx-auto w-full p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToSingle}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Create Multiple Clients
              </h1>
              <p className="text-muted-foreground mt-1">
                Configure each imported server as a separate client
              </p>
            </div>
            <Badge variant="secondary" className="ml-auto">
              <Users className="h-3 w-3 mr-1" />
              {multipleClients.length} clients
            </Badge>
          </div>

          <Separator />

          {/* Client Cards */}
          <div className="grid gap-6">
            {multipleClients.map((client, index) => (
              <Card
                key={client.id}
                className="border-2 border-border/50 hover:border-border transition-colors"
              >
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <CardTitle className="text-lg">
                          Client {index + 1}
                        </CardTitle>
                        <CardDescription>
                          {client.name || "Unnamed client"}
                        </CardDescription>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveClient(client.id)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Client Name */}
                  <div className="space-y-2">
                    <Label
                      htmlFor={`client-name-${client.id}`}
                      className="text-sm font-medium"
                    >
                      Client Name
                    </Label>
                    <Input
                      id={`client-name-${client.id}`}
                      value={client.name}
                      onChange={(e) =>
                        handleUpdateClient(client.id, { name: e.target.value })
                      }
                      placeholder="Enter a descriptive name for this client"
                      className="max-w-md"
                    />
                  </div>

                  {/* Connection Configuration */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-sm font-medium">
                        Connection Settings
                      </Label>
                    </div>
                    <div className="border border-border/50 rounded-lg p-4 bg-muted/30">
                      <ConnectionSection
                        connectionStatus="disconnected"
                        transportType={client.config.transportType}
                        setTransportType={(type) => {
                          let newConfig: MCPJamServerConfig;
                          let newArgsString = "";

                          if (type === "stdio") {
                            newConfig = {
                              transportType: type,
                              command: "npx",
                              args: ["@modelcontextprotocol/server-everything"],
                              env: {},
                            } as StdioServerDefinition;
                            newArgsString =
                              "@modelcontextprotocol/server-everything";
                          } else {
                            newConfig = {
                              transportType: type,
                              url: new URL("https://example.com"),
                            } as HttpServerDefinition;
                          }

                          handleUpdateClient(client.id, {
                            config: newConfig,
                            argsString: newArgsString,
                            sseUrlString:
                              newConfig.transportType !== "stdio" &&
                              "url" in newConfig &&
                              newConfig.url
                                ? newConfig.url.toString()
                                : "",
                          });
                        }}
                        command={
                          client.config.transportType === "stdio" &&
                          "command" in client.config
                            ? client.config.command || ""
                            : ""
                        }
                        setCommand={(command) => {
                          if (client.config.transportType === "stdio") {
                            handleUpdateClient(client.id, {
                              config: {
                                ...client.config,
                                command,
                              } as StdioServerDefinition,
                            });
                          }
                        }}
                        args={client.argsString}
                        setArgs={(newArgsString) => {
                          if (client.config.transportType === "stdio") {
                            handleUpdateClient(client.id, {
                              argsString: newArgsString,
                              config: {
                                ...client.config,
                                args: newArgsString.trim()
                                  ? newArgsString.split(/\s+/)
                                  : [],
                              } as StdioServerDefinition,
                            });
                          }
                        }}
                        sseUrl={client.sseUrlString}
                        setSseUrl={(url) => {
                          handleUpdateClient(client.id, { sseUrlString: url });
                        }}
                        env={
                          client.config.transportType === "stdio" &&
                          "env" in client.config
                            ? client.config.env || {}
                            : {}
                        }
                        setEnv={(env) => {
                          if (client.config.transportType === "stdio") {
                            handleUpdateClient(client.id, {
                              config: {
                                ...client.config,
                                env,
                              } as StdioServerDefinition,
                            });
                          }
                        }}
                        config={config}
                        setConfig={setConfig}
                        bearerToken={bearerToken}
                        setBearerToken={setBearerToken}
                        headerName={headerName}
                        setHeaderName={setHeaderName}
                        onConnect={() => {}} // No-op for form
                        onDisconnect={() => {}} // No-op for form
                        stdErrNotifications={[]}
                        clearStdErrNotifications={() => {}}
                        logLevel="debug"
                        sendLogLevelRequest={async () => {}}
                        loggingSupported={false}
                        hideActionButtons={true}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Add Client Button */}
            <Card className="border-2 border-dashed border-border/50 hover:border-border transition-colors">
              <CardContent className="p-6">
                <Button
                  variant="ghost"
                  onClick={handleAddClient}
                  className="w-full h-16 text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Add Another Client
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Action Bar */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {multipleClients.some((c) => !c.name.trim()) && (
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertCircle className="h-4 w-4" />
                    <span>Some clients need names</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveAll}
                  disabled={
                    multipleClients.filter((c) => c.name.trim()).length === 0
                  }
                  className="min-w-[200px]"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Create {
                    multipleClients.filter((c) => c.name.trim()).length
                  }{" "}
                  Client(s)
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single client mode
  return (
    <div className="flex-1 flex flex-col overflow-auto bg-gradient-to-br from-background to-muted/20">
      <div className="max-w-5xl mx-auto w-full p-6 space-y-8">
        {/* Import Configuration Card - Only show when creating */}
        {isCreating && (
          <Card className="border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Upload className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Quick Import</CardTitle>
                </div>
                <Badge variant="secondary" className="ml-auto">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Recommended
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Supports the same format used by Claude Desktop and Cursor.
              </p>
              <Button
                onClick={() => setShowImportDialog(true)}
                className="w-full sm:w-auto"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import from Configuration File
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Or separator - Only show when creating */}
        {isCreating && (
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-4">
              <Separator className="w-16" />
              <span className="text-sm font-medium text-muted-foreground">
                or
              </span>
              <Separator className="w-16" />
            </div>
          </div>
        )}

        {/* Manual Configuration Card */}
        <Card className="border-2 border-border/50">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setIsManualConfigExpanded(!isManualConfigExpanded)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <Settings className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle className="text-lg">
                    {isCreating ? "Manual Setup" : `Edit: ${editingClientName}`}
                  </CardTitle>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsManualConfigExpanded(!isManualConfigExpanded);
                }}
              >
                {isManualConfigExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          {isManualConfigExpanded && (
            <CardContent className="space-y-6">
              {/* Client Name */}
              <div className="space-y-2">
                <Label htmlFor="client-name" className="text-sm font-medium">
                  Name
                </Label>
                <Input
                  id="client-name"
                  value={clientFormName}
                  onChange={(e) => setClientFormName(e.target.value)}
                  placeholder="Enter client name"
                  className={`max-w-md ${nameError ? "border-red-500 focus:border-red-500 focus:ring-red-500" : ""}`}
                />
                {nameError && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {nameError}
                  </p>
                )}
              </div>

              {/* Connection Configuration */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Connection</Label>
                <div className="border border-border/50 rounded-lg p-4 bg-muted/30">
                  <ConnectionSection
                    connectionStatus="disconnected"
                    transportType={clientFormConfig.transportType}
                    setTransportType={(type) => {
                      if (type === "stdio") {
                        const newConfig = {
                          transportType: type,
                          command: "npx",
                          args: ["@modelcontextprotocol/server-everything"],
                          env: {},
                        } as StdioServerDefinition;
                        setClientFormConfig(newConfig);
                        setArgsString(
                          "@modelcontextprotocol/server-everything",
                        );
                      } else {
                        setClientFormConfig({
                          transportType: type,
                          url: new URL("https://example.com"),
                        } as HttpServerDefinition);
                        setArgsString("");
                      }
                    }}
                    command={
                      clientFormConfig.transportType === "stdio" &&
                      "command" in clientFormConfig
                        ? clientFormConfig.command || ""
                        : ""
                    }
                    setCommand={(command) => {
                      if (clientFormConfig.transportType === "stdio") {
                        setClientFormConfig({
                          ...clientFormConfig,
                          command,
                        } as StdioServerDefinition);
                      }
                    }}
                    args={argsString}
                    setArgs={handleArgsChange}
                    sseUrl={sseUrlString}
                    setSseUrl={handleSseUrlChange}
                    env={
                      clientFormConfig.transportType === "stdio" &&
                      "env" in clientFormConfig
                        ? clientFormConfig.env || {}
                        : {}
                    }
                    setEnv={(env) => {
                      if (clientFormConfig.transportType === "stdio") {
                        setClientFormConfig({
                          ...clientFormConfig,
                          env,
                        } as StdioServerDefinition);
                      }
                    }}
                    config={config}
                    setConfig={setConfig}
                    bearerToken={bearerToken}
                    setBearerToken={setBearerToken}
                    headerName={headerName}
                    setHeaderName={setHeaderName}
                    onConnect={() => {}} // No-op for form
                    onDisconnect={() => {}} // No-op for form
                    stdErrNotifications={[]}
                    clearStdErrNotifications={() => {}}
                    logLevel="debug"
                    sendLogLevelRequest={async () => {}}
                    loggingSupported={false}
                    hideActionButtons={true}
                  />
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Action Bar */}
        <div className="flex flex-col items-center gap-3 pt-4">
          <Button
            onClick={handleSingleSave}
            disabled={!clientFormName.trim()}
            className="min-w-[180px] h-12 text-base font-semibold bg-primary hover:bg-primary/90 shadow-lg hover:shadow-xl transition-all duration-200 border-2 border-primary/20"
          >
            <CheckCircle2 className="h-5 w-5 mr-2" />
            {isCreating ? "Create Client" : "Update Client"}
          </Button>
          <button
            onClick={onCancel}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
          >
            Cancel
          </button>
        </div>

        {/* Import Dialog */}
        <ConfigImportDialog
          open={showImportDialog}
          onOpenChange={setShowImportDialog}
          onImportServers={handleImportServers}
        />
      </div>
    </div>
  );
};

export default ClientFormSection;
