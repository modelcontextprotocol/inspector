import { useState, useCallback } from "react";
import {
  MCPJamServerConfig,
  StdioServerDefinition,
  HttpServerDefinition,
} from "../lib/serverTypes";
import {
  getInitialTransportType,
  getInitialCommand,
  getInitialArgs,
  getInitialSseUrl,
} from "../utils/configUtils";

export const useServerState = () => {
  const [serverConfigs, setServerConfigs] = useState<
    Record<string, MCPJamServerConfig>
  >(() => {
    const transportType = getInitialTransportType();
    const defaultServerName = "default";

    // Only create a default server if we have valid initial configuration
    const initialCommand = getInitialCommand();
    const initialSseUrl = getInitialSseUrl();

    if (transportType === "stdio" && initialCommand) {
      return {
        [defaultServerName]: {
          transportType: transportType,
          command: initialCommand,
          args: getInitialArgs()
            .split(" ")
            .filter((arg) => arg.trim() !== ""),
          env: {},
        } as StdioServerDefinition,
      };
    } else if (transportType !== "stdio" && initialSseUrl) {
      return {
        [defaultServerName]: {
          transportType: transportType,
          url: new URL(initialSseUrl),
        } as HttpServerDefinition,
      };
    }

    // Return empty object if no valid initial configuration
    return {} as Record<string, MCPJamServerConfig>;
  });

  const [selectedServerName, setSelectedServerName] = useState<string>(() => {
    // If there are no servers, default to empty string to show create prompt
    const serverNames = Object.keys(serverConfigs);
    return serverNames.length > 0 ? serverNames[0] : "";
  });

  // Client form state for creating/editing
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [editingClientName, setEditingClientName] = useState<string | null>(
    null,
  );
  const [clientFormConfig, setClientFormConfig] = useState<MCPJamServerConfig>({
    transportType: "stdio",
    command: "npx",
    args: ["@modelcontextprotocol/server-brave-search"],
    env: {},
  } as StdioServerDefinition);
  const [clientFormName, setClientFormName] = useState("");

  const updateServerConfig = useCallback(
    (serverName: string, config: MCPJamServerConfig) => {
      setServerConfigs((prev) => ({ ...prev, [serverName]: config }));
    },
    [],
  );

  const removeServerConfig = useCallback((serverName: string) => {
    setServerConfigs((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [serverName]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const handleCreateClient = useCallback(() => {
    setIsCreatingClient(true);
    setEditingClientName(null);
    setClientFormName("");
    setClientFormConfig({
      transportType: "stdio",
      command: "npx",
      args: ["@modelcontextprotocol/server-brave-search"],
      env: {},
    } as StdioServerDefinition);
  }, []);

  const handleEditClient = useCallback(
    (serverName: string, config: MCPJamServerConfig) => {
      setIsCreatingClient(false);
      setEditingClientName(serverName);
      setClientFormName(serverName);
      setClientFormConfig(config);
    },
    [],
  );

  const handleCancelClientForm = useCallback(() => {
    setIsCreatingClient(false);
    setEditingClientName(null);
    setClientFormName("");
  }, []);

  return {
    serverConfigs,
    setServerConfigs,
    selectedServerName,
    setSelectedServerName,
    isCreatingClient,
    editingClientName,
    clientFormConfig,
    setClientFormConfig,
    clientFormName,
    setClientFormName,
    updateServerConfig,
    removeServerConfig,
    handleCreateClient,
    handleEditClient,
    handleCancelClientForm,
  };
};
