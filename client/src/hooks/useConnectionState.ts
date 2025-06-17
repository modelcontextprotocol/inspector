import { useState, useCallback } from "react";
import { MCPJamAgent, MCPClientOptions } from "../mcpjamAgent";
import { MCPJamServerConfig } from "../lib/serverTypes";
import { InspectorConfig } from "../lib/configurationTypes";
import {
  CreateMessageRequest,
  CreateMessageResult,
  Root,
} from "@modelcontextprotocol/sdk/types.js";
import { StdErrNotification } from "../lib/notificationTypes";
import { ConnectionStatus } from "@/lib/constants";

export const useConnectionState = (
  addRequestHistory: (request: object, response?: object) => void,
) => {
  const [mcpAgent, setMcpAgent] = useState<MCPJamAgent | null>(null);
  const [sidebarUpdateTrigger, setSidebarUpdateTrigger] = useState(0);
  const forceUpdateSidebar = useCallback(() => {
    setSidebarUpdateTrigger((prev) => prev + 1);
  }, []);

  const createAgent = useCallback(
    async (
      serverConfigs: Record<string, MCPJamServerConfig>,
      config: InspectorConfig,
      bearerToken: string,
      headerName: string,
      claudeApiKey: string,
      onStdErrNotification: (notification: StdErrNotification) => void,
      onPendingRequest: (
        request: CreateMessageRequest,
        resolve: (result: CreateMessageResult) => void,
        reject: (error: Error) => void,
      ) => void,
      getRoots: () => Root[],
    ) => {
      if (Object.keys(serverConfigs).length === 0) {
        console.log("No servers configured, skipping connection");
        return;
      }

      const options: MCPClientOptions = {
        servers: serverConfigs,
        config: config,
        bearerToken,
        headerName,
        claudeApiKey,
        onStdErrNotification,
        onPendingRequest,
        getRoots,
        addRequestHistory: addRequestHistory,
      };

      const agent = new MCPJamAgent(options);

      try {
        await agent.connectToAllServers();
        setMcpAgent(agent);
        return agent;
      } catch (error) {
        console.error("Failed to connect to servers:", error);
        setMcpAgent(null);
        throw error;
      }
    },
    [addRequestHistory],
  );

  const createAgentWithoutConnecting = useCallback(
    async (
      serverConfigs: Record<string, MCPJamServerConfig>,
      config: InspectorConfig,
      bearerToken: string,
      headerName: string,
      claudeApiKey: string,
      onStdErrNotification: (notification: StdErrNotification) => void,
      onPendingRequest: (
        request: CreateMessageRequest,
        resolve: (result: CreateMessageResult) => void,
        reject: (error: Error) => void,
      ) => void,
      getRoots: () => Root[],
    ) => {
      const options: MCPClientOptions = {
        servers: serverConfigs,
        config: config,
        bearerToken,
        headerName,
        claudeApiKey,
        onStdErrNotification,
        onPendingRequest,
        getRoots,
        addRequestHistory: addRequestHistory,
      };

      const agent = new MCPJamAgent(options);
      setMcpAgent(agent);
      return agent;
    },
    [addRequestHistory],
  );

  const addServer = useCallback(
    async (
      name: string,
      serverConfig: MCPJamServerConfig,
      config: InspectorConfig,
      bearerToken: string,
      headerName: string,
      claudeApiKey: string,
      onStdErrNotification: (notification: StdErrNotification) => void,
      onPendingRequest: (
        request: CreateMessageRequest,
        resolve: (result: CreateMessageResult) => void,
        reject: (error: Error) => void,
      ) => void,
      getRoots: () => Root[],
    ) => {
      console.log("🔧 addServer called with:", { name, serverConfig });

      if (!mcpAgent) {
        console.log("🆕 No agent exists, creating new one...");
        const options: MCPClientOptions = {
          servers: { [name]: serverConfig },
          config: config,
          bearerToken,
          headerName,
          claudeApiKey,
          onStdErrNotification,
          onPendingRequest,
          getRoots,
          addRequestHistory: addRequestHistory,
        };

        const agent = new MCPJamAgent(options);

        try {
          console.log("🔌 Attempting to connect to server...");
          await agent.connectToServer(name);
          console.log("✅ Successfully connected to server");
          setMcpAgent(agent);
          forceUpdateSidebar();
          return name;
        } catch (error) {
          console.error(
            "❌ Failed to create agent and connect to server:",
            error,
          );
          setMcpAgent(null);
          throw error;
        }
      } else {
        console.log("🔄 Agent exists, adding server to it...");
        mcpAgent.addServer(name, serverConfig);

        try {
          console.log("🔌 Attempting to connect to existing agent...");
          await mcpAgent.connectToServer(name);
          console.log("✅ Successfully connected to existing agent");
          forceUpdateSidebar();
          return name;
        } catch (error) {
          console.error(`❌ Failed to connect to server ${name}:`, error);
          forceUpdateSidebar();
          throw error;
        }
      }
    },
    [mcpAgent, forceUpdateSidebar, addRequestHistory],
  );

  const removeServer = useCallback(
    async (serverName: string) => {
      if (!mcpAgent) return;

      await mcpAgent.removeServer(serverName);
      forceUpdateSidebar();
    },
    [mcpAgent, forceUpdateSidebar],
  );

  const connectServer = useCallback(
    async (serverName: string) => {
      if (!mcpAgent) {
        console.log(
          "🆕 No agent exists, cannot connect to server. Please add the server first.",
        );
        return;
      }

      try {
        await mcpAgent.connectToServer(serverName);
        forceUpdateSidebar();
      } catch (error) {
        console.error(`Failed to connect to server ${serverName}:`, error);
        forceUpdateSidebar();
      }
    },
    [mcpAgent, forceUpdateSidebar],
  );

  const disconnectServer = useCallback(
    async (serverName: string) => {
      if (!mcpAgent) return;

      await mcpAgent.disconnectFromServer(serverName);
      forceUpdateSidebar();
    },
    [mcpAgent, forceUpdateSidebar],
  );

  const updateServer = useCallback(
    async (serverName: string, config: MCPJamServerConfig) => {
      if (!mcpAgent) return;

      await mcpAgent.disconnectFromServer(serverName);
      mcpAgent.addServer(serverName, config);

      try {
        await mcpAgent.connectToServer(serverName);
      } catch (error) {
        console.error(`Failed to reconnect to server ${serverName}:`, error);
      }

      forceUpdateSidebar();
    },
    [mcpAgent, forceUpdateSidebar],
  );

  const updateServerWithoutConnecting = useCallback(
    async (serverName: string, config: MCPJamServerConfig) => {
      if (!mcpAgent) return;

      // Disconnect if currently connected, but don't reconnect
      await mcpAgent.disconnectFromServer(serverName);

      // Update the server configuration
      mcpAgent.addServer(serverName, config);

      forceUpdateSidebar();
    },
    [mcpAgent, forceUpdateSidebar],
  );

  const getConnectionStatus = useCallback((): ConnectionStatus => {
    return mcpAgent?.getOverallConnectionStatus() || "disconnected";
  }, [mcpAgent]);

  const getServerCapabilities = useCallback(
    (selectedServerName: string) => {
      if (selectedServerName === "all") {
        return null;
      }
      return (
        mcpAgent
          ?.getAllConnectionInfo()
          .find((s) => s.name === selectedServerName)?.capabilities || null
      );
    },
    [mcpAgent],
  );

  const getCurrentClient = useCallback(
    (selectedServerName: string) => {
      return mcpAgent?.getClient(selectedServerName) || null;
    },
    [mcpAgent],
  );

  return {
    mcpAgent,
    sidebarUpdateTrigger,
    forceUpdateSidebar,
    createAgent,
    createAgentWithoutConnecting,
    addServer,
    removeServer,
    connectServer,
    disconnectServer,
    updateServer,
    updateServerWithoutConnecting,
    getConnectionStatus,
    getServerCapabilities,
    getCurrentClient,
  };
};
