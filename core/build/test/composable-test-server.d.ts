/**
 * Composable Test Server
 *
 * Provides types and functions for creating MCP test servers from configuration.
 * This allows composing MCP test servers with different capabilities, tools, resources, and prompts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { TaskStore, TaskMessageQueue, ToolTaskHandler } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { RegisteredTool, RegisteredResource, RegisteredPrompt, RegisteredResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { type ListResourcesResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
type ToolInputSchema = ZodRawShapeCompat;
type PromptArgsSchema = ZodRawShapeCompat;
interface ServerState {
    registeredTools: Map<string, RegisteredTool>;
    registeredResources: Map<string, RegisteredResource>;
    registeredPrompts: Map<string, RegisteredPrompt>;
    registeredResourceTemplates: Map<string, RegisteredResourceTemplate>;
    listChangedConfig: {
        tools?: boolean;
        resources?: boolean;
        prompts?: boolean;
    };
    resourceSubscriptions: Set<string>;
}
/**
 * Context object passed to tool handlers containing both server and state
 */
export interface TestServerContext {
    server: McpServer;
    state: ServerState;
    serverControl?: {
        isClosing(): boolean;
    };
}
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema?: ToolInputSchema;
    handler: (params: Record<string, any>, context?: TestServerContext, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) => Promise<any>;
}
export interface TaskToolDefinition {
    name: string;
    description: string;
    inputSchema?: ToolInputSchema;
    execution?: {
        taskSupport: "required" | "optional";
    };
    handler: ToolTaskHandler<ToolInputSchema | undefined>;
}
export interface ResourceDefinition {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    text?: string;
}
export interface PromptDefinition {
    name: string;
    description?: string;
    promptString: string;
    argsSchema?: PromptArgsSchema;
    completions?: Record<string, (argumentValue: string, context?: Record<string, string>) => Promise<string[]> | string[]>;
}
export interface ResourceTemplateDefinition {
    name: string;
    uriTemplate: string;
    description?: string;
    inputSchema?: ZodRawShapeCompat;
    handler: (uri: URL, params: Record<string, any>, context?: TestServerContext, extra?: RequestHandlerExtra<ServerRequest, ServerNotification>) => Promise<{
        contents: Array<{
            uri: string;
            mimeType?: string;
            text: string;
        }>;
    }>;
    list?: (() => Promise<string[]> | string[]) | (() => Promise<ListResourcesResult> | ListResourcesResult);
    complete?: Record<string, (value: string, context?: Record<string, string>) => Promise<string[]> | string[]> | ((argumentName: string, argumentValue: string, context?: Record<string, string>) => Promise<string[]> | string[]);
}
/**
 * Configuration for composing an MCP server
 */
export interface ServerConfig {
    serverInfo: Implementation;
    tools?: (ToolDefinition | TaskToolDefinition)[];
    resources?: ResourceDefinition[];
    resourceTemplates?: ResourceTemplateDefinition[];
    prompts?: PromptDefinition[];
    logging?: boolean;
    onLogLevelSet?: (level: string) => void;
    onRegisterResource?: (resource: ResourceDefinition) => (() => Promise<{
        contents: Array<{
            uri: string;
            mimeType?: string;
            text: string;
        }>;
    }>) | undefined;
    serverType?: "sse" | "streamable-http";
    port?: number;
    /**
     * Whether to advertise listChanged capability for each list type
     * If enabled, modification tools will send list_changed notifications
     */
    listChanged?: {
        tools?: boolean;
        resources?: boolean;
        prompts?: boolean;
    };
    /**
     * Whether to advertise resource subscriptions capability
     * If enabled, server will advertise resources.subscribe capability
     */
    subscriptions?: boolean;
    /**
     * Maximum page size for pagination (optional, undefined means no pagination)
     * When set, custom list handlers will paginate results using this page size
     */
    maxPageSize?: {
        tools?: number;
        resources?: number;
        resourceTemplates?: number;
        prompts?: number;
    };
    /**
     * Whether to advertise tasks capability
     * If enabled, server will advertise tasks capability with list and cancel support
     */
    tasks?: {
        list?: boolean;
        cancel?: boolean;
    };
    /**
     * Task store implementation (optional, defaults to InMemoryTaskStore)
     * Only used if tasks capability is enabled
     */
    taskStore?: TaskStore;
    /**
     * Task message queue implementation (optional, defaults to InMemoryTaskMessageQueue)
     * Only used if tasks capability is enabled
     */
    taskMessageQueue?: TaskMessageQueue;
    /**
     * OAuth 2.1 configuration for test server
     * If enabled, server will act as an OAuth authorization server
     */
    oauth?: {
        /**
         * Whether OAuth is enabled for this test server
         */
        enabled: boolean;
        /**
         * OAuth authorization server issuer URL
         * Used for metadata endpoints and token issuance
         * If not provided, defaults to the test server's base URL
         */
        issuerUrl?: URL;
        /**
         * List of scopes supported by this authorization server
         * Defaults to ["mcp"] if not provided
         */
        scopesSupported?: string[];
        /**
         * If true, MCP endpoints require valid Bearer token
         * Returns 401 Unauthorized if token is missing or invalid
         */
        requireAuth?: boolean;
        /**
         * Static/preregistered clients for testing
         * These clients are pre-configured and don't require DCR
         */
        staticClients?: Array<{
            clientId: string;
            clientSecret?: string;
            redirectUris?: string[];
        }>;
        /**
         * Whether to support Dynamic Client Registration (DCR)
         * If true, exposes /register endpoint for client registration
         */
        supportDCR?: boolean;
        /**
         * Whether to support CIMD (Client ID Metadata Documents)
         * If true, server will fetch client metadata from clientMetadataUrl
         */
        supportCIMD?: boolean;
        /**
         * Token expiration time in seconds (default: 3600)
         */
        tokenExpirationSeconds?: number;
        /**
         * Whether to support refresh tokens (default: true)
         */
        supportRefreshTokens?: boolean;
    };
    /**
     * Optional server control for orderly shutdown (test HTTP server).
     * When present, progress-sending tools check isClosing() before sending and skip/break if closing.
     */
    serverControl?: {
        isClosing(): boolean;
    };
}
/**
 * Create and configure an McpServer instance from ServerConfig
 * This centralizes the setup logic shared between HTTP and stdio test servers
 */
export declare function createMcpServer(config: ServerConfig): McpServer;
export {};
//# sourceMappingURL=composable-test-server.d.ts.map