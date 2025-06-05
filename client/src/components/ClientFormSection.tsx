import React, { useState, useEffect } from "react";
import {
  MCPJamServerConfig,
  StdioServerDefinition,
  HttpServerDefinition,
} from "../lib/serverTypes";
import { InspectorConfig } from "../lib/configurationTypes";
import ConnectionSection from "./ConnectionSection";

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
}) => {
  // Local state to track raw args string while typing
  const [argsString, setArgsString] = useState<string>("");

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
