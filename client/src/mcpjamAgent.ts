import { MCPJamClient } from "./mcpjamClient";
import { InspectorConfig } from "./lib/configurationTypes";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { MCPJamServerConfig } from "./lib/serverTypes";

export interface MCPClientOptions {
    id?: string;
    servers: Record<string, MCPJamServerConfig>;
    timeout?: number; // Optional global timeout
    config?: InspectorConfig; // Add optional config
  }

export class MCPJamAgent {
    private mcpClientsById = new Map<string, MCPJamClient>();
    private serverConfigs: Record<string, MCPJamServerConfig>;
    private config: InspectorConfig;

    constructor(options: MCPClientOptions) {
        this.serverConfigs = options.servers;
        // Use provided config or create default config
        this.config = options.config || this.createDefaultConfig();
    }

    private createDefaultConfig(): InspectorConfig {
        return {
            MCP_SERVER_REQUEST_TIMEOUT: {
                label: "MCP Server Request Timeout",
                description: "Maximum time in milliseconds to wait for a response from the MCP server",
                value: 30000
            },
            MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS: {
                label: "Reset Timeout on Progress",
                description: "Whether to reset the timeout on progress notifications",
                value: true
            },
            MCP_REQUEST_MAX_TOTAL_TIMEOUT: {
                label: "Max Total Timeout",
                description: "Maximum total time in milliseconds to wait for a response",
                value: 300000
            },
            MCP_PROXY_FULL_ADDRESS: {
                label: "MCP Proxy Address",
                description: "The full address of the MCP Proxy Server",
                value: "http://localhost:6277"
            }
        };
    }

    private async getOrCreateClient(name: string, config: MCPJamServerConfig): Promise<MCPJamClient> {
        const client = this.mcpClientsById.get(name);
        if (client) {
            return client;
        }

        // Create new client with updated constructor signature
        const newClient = new MCPJamClient(
            config,           // serverConfig (first parameter)
            this.config,      // config (second parameter)
            undefined,        // bearerToken
            undefined,        // headerName
            undefined,        // onStdErrNotification
            undefined,        // claudeApiKey
            undefined,        // onPendingRequest
            undefined         // getRoots
        );
        
        await newClient.connectToServer();
        this.mcpClientsById.set(name, newClient);
        return newClient;
    }

    private async getConnectedClientForServer(serverName: string){
        const serverConfig = this.serverConfigs[serverName];
        if (!serverConfig) {
            throw new Error(`Server ${serverName} not found`);
        }
        const client = await this.getOrCreateClient(serverName, serverConfig);
        return client;
    }

    private async getAllTools(): Promise<Tool[]>{
        const allTools: Tool[] = [];
        for (const [serverName, serverConfig] of Object.entries(this.serverConfigs)) {
            const client = await this.getOrCreateClient(serverName, serverConfig);
            const toolsResponse = await client.tools();
            allTools.push(...toolsResponse.tools);
        }
        return allTools;
    }
    
}