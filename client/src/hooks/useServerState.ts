import { useState, useCallback } from "react";
import { MCPJamServerConfig, StdioServerDefinition } from "../lib/serverTypes";

export const useServerState = () => {
  const [serverConfigs, setServerConfigs] = useState<
    Record<string, MCPJamServerConfig>
  >({});

  const [selectedServerName, setSelectedServerName] = useState<string>(() => {
    // If there are no servers, default to empty string to show create prompt
    const serverNames = Object.keys(serverConfigs);
    return serverNames.length > 0 ? serverNames[0] : "";
  });
  console.log("selectedServerName", selectedServerName);
  // Client form state for creating/editing
  const [isCreatingClient, setIsCreatingClient] = useState(false);
  const [editingClientName, setEditingClientName] = useState<string | null>(
    null,
  );
  const [clientFormConfig, setClientFormConfig] = useState<MCPJamServerConfig>({
    transportType: "stdio",
    command: "npx",
    args: ["@modelcontextprotocol/server-everything"],
    env: {},
  } as StdioServerDefinition);
  const [clientFormName, setClientFormName] = useState("");

  console.log("clientFormConfig", clientFormConfig);

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
      args: ["@modelcontextprotocol/server-everything"],
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
