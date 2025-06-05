import { useState, useCallback, useEffect } from "react";
import { MCPJamServerConfig, StdioServerDefinition } from "../lib/serverTypes";

const SERVER_CONFIGS_STORAGE_KEY = "mcpServerConfigs_v1";
const SELECTED_SERVER_STORAGE_KEY = "selectedServerName_v1";

// Helper functions for serialization/deserialization
const serializeServerConfigs = (configs: Record<string, MCPJamServerConfig>): string => {
  const serializable = Object.entries(configs).reduce((acc, [name, config]) => {
    if ('url' in config && config.url) {
      // Convert URL object to string for serialization
      acc[name] = {
        ...config,
        url: config.url.toString(),
      };
    } else {
      acc[name] = config;
    }
    return acc;
  }, {} as Record<string, MCPJamServerConfig | (Omit<MCPJamServerConfig, 'url'> & { url: string })>);
  
  return JSON.stringify(serializable);
};

const deserializeServerConfigs = (serialized: string): Record<string, MCPJamServerConfig> => {
  try {
    const parsed = JSON.parse(serialized) as Record<string, MCPJamServerConfig | (Omit<MCPJamServerConfig, 'url'> & { url: string })>;
    return Object.entries(parsed).reduce((acc, [name, config]) => {
      if ('url' in config && config.url && typeof config.url === 'string') {
        // Convert URL string back to URL object
        acc[name] = {
          ...config,
          url: new URL(config.url),
        } as MCPJamServerConfig;
      } else {
        acc[name] = config as MCPJamServerConfig;
      }
      return acc;
    }, {} as Record<string, MCPJamServerConfig>);
  } catch (error) {
    console.warn("Failed to deserialize server configs:", error);
    return {};
  }
};

const loadServerConfigsFromStorage = (): Record<string, MCPJamServerConfig> => {
  try {
    const stored = localStorage.getItem(SERVER_CONFIGS_STORAGE_KEY);
    if (stored) {
      return deserializeServerConfigs(stored);
    }
  } catch (error) {
    console.warn("Failed to load server configs from localStorage:", error);
  }
  return {};
};

const loadSelectedServerFromStorage = (serverConfigs: Record<string, MCPJamServerConfig>): string => {
  try {
    const stored = localStorage.getItem(SELECTED_SERVER_STORAGE_KEY);
    if (stored && serverConfigs[stored]) {
      return stored;
    }
  } catch (error) {
    console.warn("Failed to load selected server from localStorage:", error);
  }
  
  // If there are no servers, default to empty string to show create prompt
  const serverNames = Object.keys(serverConfigs);
  return serverNames.length > 0 ? serverNames[0] : "";
};

export const useServerState = () => {
  const [state] = useState(() => {
    const configs = loadServerConfigsFromStorage();
    const selectedServer = loadSelectedServerFromStorage(configs);
    return { configs, selectedServer };
  });

  const [serverConfigs, setServerConfigs] = useState<
    Record<string, MCPJamServerConfig>
  >(state.configs);

  const [selectedServerName, setSelectedServerName] = useState<string>(
    state.selectedServer
  );
  
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

  // Persist server configs to localStorage whenever they change
  useEffect(() => {
    try {
      if (Object.keys(serverConfigs).length > 0) {
        const serialized = serializeServerConfigs(serverConfigs);
        localStorage.setItem(SERVER_CONFIGS_STORAGE_KEY, serialized);
      } else {
        // Remove from storage if no configs exist
        localStorage.removeItem(SERVER_CONFIGS_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save server configs to localStorage:", error);
    }
  }, [serverConfigs]);

  // Persist selected server name whenever it changes
  useEffect(() => {
    try {
      if (selectedServerName) {
        localStorage.setItem(SELECTED_SERVER_STORAGE_KEY, selectedServerName);
      } else {
        localStorage.removeItem(SELECTED_SERVER_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save selected server to localStorage:", error);
    }
  }, [selectedServerName]);

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
