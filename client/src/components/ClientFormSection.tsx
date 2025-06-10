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
import { X, Plus, Save, AlertCircle } from "lucide-react";

interface ClientConfig {
  id: string;
  name: string;
  config: MCPJamServerConfig;
  argsString: string;
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
  onSave: () => void;
  onCancel: () => void;
  onImportMultipleServers?: (servers: ParsedServerConfig[]) => void;
  onSaveMultiple?: (clients: Array<{ name: string; config: MCPJamServerConfig }>) => void;
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
  const [multipleClients, setMultipleClients] = useState<ClientConfig[]>([]);
  const [isMultipleMode, setIsMultipleMode] = useState(false);
  const { toast } = useToast();

  // Initialize argsString when clientFormConfig changes
  useEffect(() => {
    if (clientFormConfig.transportType === "stdio" && "args" in clientFormConfig) {
      setArgsString(clientFormConfig.args?.join(" ") || "");
    }
  }, [clientFormConfig]);

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

  // Handler for importing multiple servers
  const handleImportServers = (servers: ParsedServerConfig[]) => {
    if (servers.length > 1) {
      // Multiple servers - switch to multiple mode
      const clients: ClientConfig[] = servers.map((server, index) => ({
        id: `client-${Date.now()}-${index}`,
        name: server.name,
        config: server.config,
        argsString: server.config.transportType === "stdio" && "args" in server.config 
          ? server.config.args?.join(" ") || ""
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
      if (firstServer.config.transportType === "stdio" && "args" in firstServer.config) {
        setArgsString(firstServer.config.args?.join(" ") || "");
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
  const handleUpdateClient = (clientId: string, updates: Partial<ClientConfig>) => {
    setMultipleClients(prev => 
      prev.map(client => 
        client.id === clientId 
          ? { ...client, ...updates }
          : client
      )
    );
  };

  // Handler for removing a client in multiple mode
  const handleRemoveClient = (clientId: string) => {
    setMultipleClients(prev => prev.filter(client => client.id !== clientId));
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
    };
    setMultipleClients(prev => [...prev, newClient]);
  };

  // Handler for saving all clients in multiple mode
  const handleSaveAll = () => {
    const validClients = multipleClients.filter(client => client.name.trim());
    
    if (validClients.length === 0) {
      toast({
        title: "No valid clients",
        description: "Please provide names for at least one client.",
        variant: "destructive",
      });
      return;
    }

    if (onSaveMultiple) {
      onSaveMultiple(validClients.map(client => ({
        name: client.name,
        config: client.config,
      })));
    }

    toast({
      title: "Clients created",
      description: `Successfully created ${validClients.length} client(s).`,
    });
  };

  // Handler for going back to single mode
  const handleBackToSingle = () => {
    setIsMultipleMode(false);
    setMultipleClients([]);
  };

  if (isMultipleMode) {
    return (
      <div className="flex-1 flex flex-col overflow-auto p-6">
        <div className="max-w-6xl mx-auto w-full">
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-2">
              Create Multiple Clients
            </h2>
            <p className="text-muted-foreground">
              Configure each imported server as a separate client. You can modify settings individually.
            </p>
          </div>

          <div className="space-y-6">
            {multipleClients.map((client, index) => (
              <div key={client.id} className="border border-border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Client {index + 1}</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemoveClient(client.id)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Client Name
                  </label>
                  <Input
                    value={client.name}
                    onChange={(e) => handleUpdateClient(client.id, { name: e.target.value })}
                    placeholder="Enter client name"
                    className="w-full"
                  />
                </div>

                <div className="border border-border rounded-lg">
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
                        newArgsString = "@modelcontextprotocol/server-everything";
                      } else {
                        newConfig = {
                          transportType: type,
                          url: new URL("https://example.com"),
                        } as HttpServerDefinition;
                      }
                      
                      handleUpdateClient(client.id, { 
                        config: newConfig,
                        argsString: newArgsString
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
                          } as StdioServerDefinition
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
                            args: newArgsString.trim() ? newArgsString.split(/\s+/) : [],
                          } as StdioServerDefinition
                        });
                      }
                    }}
                    sseUrl={
                      "url" in client.config && client.config.url
                        ? client.config.url.toString()
                        : ""
                    }
                    setSseUrl={(url) => {
                      if (client.config.transportType !== "stdio") {
                        handleUpdateClient(client.id, {
                          config: {
                            ...client.config,
                            url: new URL(url),
                          } as HttpServerDefinition
                        });
                      }
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
                          } as StdioServerDefinition
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
            ))}

            <Button
              variant="outline"
              onClick={handleAddClient}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Another Client
            </Button>

            <div className="flex space-x-3 pt-4 border-t">
              <Button
                onClick={handleSaveAll}
                disabled={multipleClients.filter(c => c.name.trim()).length === 0}
                className="flex-1"
              >
                <Save className="h-4 w-4 mr-2" />
                Create {multipleClients.filter(c => c.name.trim()).length} Client(s)
              </Button>
              <Button
                variant="outline"
                onClick={handleBackToSingle}
                className="flex-1"
              >
                Back to Single Mode
              </Button>
              <Button
                variant="outline"
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>

            {multipleClients.some(c => !c.name.trim()) && (
              <div className="flex items-center gap-2 text-amber-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                Some clients don't have names and won't be created.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Single client mode (existing functionality)
  return (
    <div className="flex-1 flex flex-col overflow-auto p-6">
      <div className="max-w-4xl mx-auto w-full">
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-2">
            {isCreating
              ? "Create New Client"
              : `Edit Client: ${editingClientName}`}
          </h2>
          <p className="text-muted-foreground">
            Configure your MCP client connection settings below.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Client Name
            </label>
            <input
              type="text"
              value={clientFormName}
              onChange={(e) => setClientFormName(e.target.value)}
              placeholder="Enter client name"
              className="w-full px-3 py-2 border border-border rounded-md bg-background"
            />
          </div>

          <div className="border border-border rounded-lg">
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
                  setArgsString("@modelcontextprotocol/server-everything");
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
              sseUrl={
                "url" in clientFormConfig && clientFormConfig.url
                  ? clientFormConfig.url.toString()
                  : ""
              }
              setSseUrl={(url) => {
                if (clientFormConfig.transportType !== "stdio") {
                  setClientFormConfig({
                    ...clientFormConfig,
                    url: new URL(url),
                  } as HttpServerDefinition);
                }
              }}
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
              onImportServers={handleImportServers}
            />
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              onClick={onSave}
              disabled={!clientFormName.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? "Create Client" : "Update Client"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 border border-border rounded-md hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientFormSection;
