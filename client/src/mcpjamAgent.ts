import { MCPJamClient } from "./mcpjamClient";
import { InspectorConfig } from "./lib/configurationTypes";
import {
  Tool,
  Resource,
  Prompt,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { MCPJamServerConfig } from "./lib/serverTypes";
import { createDefaultConfig } from "./utils/configUtils";
import { StdErrNotification } from "./lib/notificationTypes";
import {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

export interface MCPClientOptions {
  id?: string;
  servers: Record<string, MCPJamServerConfig>;
  timeout?: number; // Optional global timeout
  config?: InspectorConfig; // Add optional config
  bearerToken?: string;
  headerName?: string;
  claudeApiKey?: string;
  onStdErrNotification?: (notification: StdErrNotification) => void;
  onPendingRequest?: (
    request: CreateMessageRequest,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
  ) => void;
  getRoots?: () => unknown[];
  onRequestHistory?: (request: object, response?: object) => void;
}

export interface ServerConnectionInfo {
  name: string;
  config: MCPJamServerConfig;
  client: MCPJamClient | null;
  connectionStatus: string;
  capabilities: ServerCapabilities | null;
}

export class MCPJamAgent {
  private mcpClientsById = new Map<string, MCPJamClient>();
  private serverConfigs: Record<string, MCPJamServerConfig>;
  private config: InspectorConfig;
  private bearerToken?: string;
  private headerName?: string;
  private claudeApiKey?: string;
  private onStdErrNotification?: (notification: StdErrNotification) => void;
  private onPendingRequest?: (
    request: CreateMessageRequest,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
  ) => void;
  private getRoots?: () => unknown[];
  private onRequestHistory?: (request: object, response?: object) => void;

  constructor(options: MCPClientOptions) {
    this.serverConfigs = options.servers;
    // Use provided config or create default config
    this.config = options.config || createDefaultConfig();
    this.bearerToken = options.bearerToken;
    this.headerName = options.headerName;
    this.claudeApiKey = options.claudeApiKey;
    this.onStdErrNotification = options.onStdErrNotification;
    this.onPendingRequest = options.onPendingRequest;
    this.getRoots = options.getRoots;
    this.onRequestHistory = options.onRequestHistory;
  }

  // Add or update a server configuration
  addServer(name: string, config: MCPJamServerConfig) {
    this.serverConfigs[name] = config;
  }

  // Remove a server and disconnect its client
  async removeServer(name: string) {
    const client = this.mcpClientsById.get(name);
    if (client) {
      await client.disconnect();
      this.mcpClientsById.delete(name);
    }
    delete this.serverConfigs[name];
  }

  // Get list of all configured servers
  getServerNames(): string[] {
    return Object.keys(this.serverConfigs);
  }

  // Get connection info for all servers
  getAllConnectionInfo(): ServerConnectionInfo[] {
    return Object.entries(this.serverConfigs).map(([name, config]) => {
      const client = this.mcpClientsById.get(name);
      return {
        name,
        config,
        client: client || null, // Allow null for servers that haven't been connected yet
        connectionStatus: client?.connectionStatus || "disconnected",
        capabilities: client?.serverCapabilities || null,
      };
    });
  }

  // Connect to a specific server
  async connectToServer(serverName: string): Promise<MCPJamClient> {
    const serverConfig = this.serverConfigs[serverName];
    if (!serverConfig) {
      throw new Error(`Server ${serverName} not found`);
    }
    return await this.getOrCreateClient(serverName, serverConfig);
  }

  // Connect to all servers
  async connectToAllServers(): Promise<void> {
    const connectionPromises = Object.keys(this.serverConfigs).map(
      (serverName) =>
        this.connectToServer(serverName).catch((error) => {
          console.error(`Failed to connect to server ${serverName}:`, error);
          return null;
        }),
    );
    await Promise.all(connectionPromises);
  }

  // Disconnect from a specific server
  async disconnectFromServer(serverName: string): Promise<void> {
    const client = this.mcpClientsById.get(serverName);
    if (client) {
      await client.disconnect();
      // Don't remove the client from the map - keep it so it shows as disconnected
      // this.mcpClientsById.delete(serverName);
    }
  }

  // Disconnect from all servers
  async disconnectFromAllServers(): Promise<void> {
    const disconnectionPromises = Array.from(this.mcpClientsById.entries()).map(
      async ([name, client]) => {
        try {
          await client.disconnect();
        } catch (error) {
          console.error(`Failed to disconnect from server ${name}:`, error);
        }
      },
    );
    await Promise.all(disconnectionPromises);
    this.mcpClientsById.clear();
  }

  // Get client for a specific server
  getClient(serverName: string): MCPJamClient | undefined {
    return this.mcpClientsById.get(serverName);
  }

  // Get all connected clients
  getAllClients(): Map<string, MCPJamClient> {
    return new Map(this.mcpClientsById);
  }

  private async getOrCreateClient(
    name: string,
    config: MCPJamServerConfig,
  ): Promise<MCPJamClient> {
    const existingClient = this.mcpClientsById.get(name);

    // If client exists and is connected, return it
    if (existingClient && existingClient.connectionStatus === "connected") {
      return existingClient;
    }

    // Check if this is a remote server and if there's already a connected remote server
    if (this.isRemoteServer(config)) {
      const connectedRemoteServerName = this.getConnectedRemoteServerName();
      if (connectedRemoteServerName && connectedRemoteServerName !== name) {
        // Automatically disconnect the existing remote server
        console.log(
          `Automatically disconnecting existing remote server: ${connectedRemoteServerName}`,
        );
        await this.disconnectFromServer(connectedRemoteServerName);

        // Clear OAuth tokens for the old server
        const connectedConfig = this.serverConfigs[connectedRemoteServerName];
        if (
          connectedConfig &&
          "url" in connectedConfig &&
          connectedConfig.url
        ) {
          const { InspectorOAuthClientProvider } = await import("./lib/auth");
          const oldAuthProvider = new InspectorOAuthClientProvider(
            connectedConfig.url.toString(),
          );
          oldAuthProvider.clear();
        }
      }
    }

    // If client exists but is disconnected, reconnect it
    if (existingClient && existingClient.connectionStatus === "disconnected") {
      try {
        await existingClient.connectToServer();
        return existingClient;
      } catch (error) {
        console.error(`Failed to reconnect existing client ${name}:`, error);
        // If reconnection fails, we'll create a new client below
      }
    }

    // Create new client (either no client exists or reconnection failed)
    const newClient = new MCPJamClient(
      config, // serverConfig (first parameter)
      this.config, // config (second parameter)
      this.bearerToken, // bearerToken
      this.headerName, // headerName
      this.onStdErrNotification, // onStdErrNotification
      this.claudeApiKey, // claudeApiKey
      this.onPendingRequest, // onPendingRequest
      this.getRoots, // getRoots
      this.onRequestHistory, // onRequestHistory
    );

    await newClient.connectToServer();
    this.mcpClientsById.set(name, newClient);
    return newClient;
  }

  private async getConnectedClientForServer(
    serverName: string,
  ): Promise<MCPJamClient> {
    const serverConfig = this.serverConfigs[serverName];
    if (!serverConfig) {
      throw new Error(`Server ${serverName} not found`);
    }
    const client = await this.getOrCreateClient(serverName, serverConfig);
    return client;
  }

  // Aggregate operations across all servers
  async getAllTools(): Promise<{ serverName: string; tools: Tool[] }[]> {
    const allServerTools: { serverName: string; tools: Tool[] }[] = [];
    for (const [serverName, serverConfig] of Object.entries(
      this.serverConfigs,
    )) {
      try {
        const client = await this.getOrCreateClient(serverName, serverConfig);
        const toolsResponse = await client.tools();
        allServerTools.push({
          serverName,
          tools: toolsResponse.tools,
        });
      } catch (error) {
        console.error(`Failed to get tools from server ${serverName}:`, error);
        allServerTools.push({
          serverName,
          tools: [],
        });
      }
    }
    return allServerTools;
  }

  async getAllResources(): Promise<
    { serverName: string; resources: Resource[] }[]
  > {
    const allServerResources: { serverName: string; resources: Resource[] }[] =
      [];
    for (const [serverName, serverConfig] of Object.entries(
      this.serverConfigs,
    )) {
      try {
        const client = await this.getOrCreateClient(serverName, serverConfig);
        const resourcesResponse = await client.listResources();
        allServerResources.push({
          serverName,
          resources: resourcesResponse.resources,
        });
      } catch (error) {
        console.error(
          `Failed to get resources from server ${serverName}:`,
          error,
        );
        allServerResources.push({
          serverName,
          resources: [],
        });
      }
    }
    return allServerResources;
  }

  async getAllPrompts(): Promise<{ serverName: string; prompts: Prompt[] }[]> {
    const allServerPrompts: { serverName: string; prompts: Prompt[] }[] = [];
    for (const [serverName, serverConfig] of Object.entries(
      this.serverConfigs,
    )) {
      try {
        const client = await this.getOrCreateClient(serverName, serverConfig);
        const promptsResponse = await client.listPrompts();
        allServerPrompts.push({
          serverName,
          prompts: promptsResponse.prompts,
        });
      } catch (error) {
        console.error(
          `Failed to get prompts from server ${serverName}:`,
          error,
        );
        allServerPrompts.push({
          serverName,
          prompts: [],
        });
      }
    }
    return allServerPrompts;
  }

  // Server-specific operations
  async callToolOnServer(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>,
  ) {
    const client = await this.getConnectedClientForServer(serverName);
    return await client.callTool({ name: toolName, arguments: params });
  }

  async readResourceFromServer(serverName: string, uri: string) {
    const client = await this.getConnectedClientForServer(serverName);
    return await client.readResource({ uri });
  }

  async getPromptFromServer(
    serverName: string,
    name: string,
    args: Record<string, string> = {},
  ) {
    const client = await this.getConnectedClientForServer(serverName);
    return await client.getPrompt({ name, arguments: args });
  }

  // Update configuration methods
  updateConfig(newConfig: Partial<InspectorConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  updateCredentials(
    bearerToken?: string,
    headerName?: string,
    claudeApiKey?: string,
  ) {
    this.bearerToken = bearerToken;
    this.headerName = headerName;
    this.claudeApiKey = claudeApiKey;

    // Update existing clients
    this.mcpClientsById.forEach((client) => {
      if (claudeApiKey && client.updateApiKey) {
        client.updateApiKey(claudeApiKey);
      }
    });
  }

  // Get aggregated connection status
  getOverallConnectionStatus():
    | "connected"
    | "partial"
    | "disconnected"
    | "error" {
    const connections = this.getAllConnectionInfo();
    if (connections.length === 0) return "disconnected";

    const connectedCount = connections.filter(
      (c) => c.connectionStatus === "connected",
    ).length;
    const errorCount = connections.filter(
      (c) => c.connectionStatus === "error",
    ).length;

    if (errorCount > 0) return "error";
    if (connectedCount === connections.length) return "connected";
    if (connectedCount > 0) return "partial";
    return "disconnected";
  }

  // Check if there are any connected remote servers (HTTP/SSE)
  hasConnectedRemoteServer(): boolean {
    for (const [name, client] of this.mcpClientsById.entries()) {
      const config = this.serverConfigs[name];
      if (
        config &&
        config.transportType !== "stdio" &&
        client.connectionStatus === "connected"
      ) {
        return true;
      }
    }
    return false;
  }

  // Get the name of the connected remote server (if any)
  getConnectedRemoteServerName(): string | null {
    for (const [name, client] of this.mcpClientsById.entries()) {
      const config = this.serverConfigs[name];
      if (
        config &&
        config.transportType !== "stdio" &&
        client.connectionStatus === "connected"
      ) {
        return name;
      }
    }
    return null;
  }

  // Check if a server config is for a remote connection
  private isRemoteServer(config: MCPJamServerConfig): boolean {
    return config.transportType !== "stdio";
  }
}
