import { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { MCPJamClient } from "./mcpjamClient";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import { InspectorOAuthClientProvider } from "./lib/auth";
import { InspectorConfig } from "./lib/configurationTypes";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

type BaseServerOptions = {
    timeout?: number;
    capabilities?: ClientCapabilities;
    enableServerLogs?: boolean;
  };
  
type StdioServerDefinition = BaseServerOptions & {
command: string; // 'command' is required for Stdio
args?: string[];
env?: Record<string, string>;

url?: never; // Exclude 'url' for Stdio
requestInit?: never; // Exclude HTTP options for Stdio
eventSourceInit?: never; // Exclude HTTP options for Stdio
reconnectionOptions?: never; // Exclude Streamable HTTP specific options
sessionId?: never; // Exclude Streamable HTTP specific options
};

// HTTP Server Definition (Streamable HTTP or SSE fallback)
type HttpServerDefinition = BaseServerOptions & {
url: URL; // 'url' is required for HTTP

command?: never; // Exclude 'command' for HTTP
args?: never; // Exclude Stdio options for HTTP
env?: never; // Exclude Stdio options for HTTP

// Include relevant options from SDK HTTP transport types
requestInit?: StreamableHTTPClientTransportOptions['requestInit'];
eventSourceInit?: SSEClientTransportOptions['eventSourceInit'];
reconnectionOptions?: StreamableHTTPClientTransportOptions['reconnectionOptions'];
sessionId?: StreamableHTTPClientTransportOptions['sessionId'];
};

type MCPJamServerConfig = StdioServerDefinition | HttpServerDefinition;

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

        // Create headers object
        const headers: HeadersInit = {};
        
        // Create server auth provider - for stdio we'll use empty string as URL
        let sseUrl = '';
        if ('url' in config) {
            sseUrl = (config as HttpServerDefinition).url.toString();
        }
        const serverAuthProvider = new InspectorOAuthClientProvider(sseUrl);

        const newClient = new MCPJamClient(
            this.config,
            'command' in config ? (config as StdioServerDefinition).command : '',
            'args' in config ? (config.args || []).join(' ') : '',
            'env' in config ? config.env || {} : {},
            headers,
            sseUrl,
            serverAuthProvider,
            'stdio', // transportType
            undefined, // bearerToken
            undefined, // headerName
            undefined, // onStdErrNotification
            undefined, // claudeApiKey
            undefined, // onPendingRequest
            undefined  // getRoots
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