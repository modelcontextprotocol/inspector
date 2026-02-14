/**
 * Shared test fixtures for composable MCP test servers
 *
 * This module provides helper functions for creating test tools, prompts, and resources.
 * For the core composable server types and createMcpServer function, see composable-test-server.ts
 */
import * as z from "zod/v4";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition, TaskToolDefinition, ResourceDefinition, PromptDefinition, ResourceTemplateDefinition, ServerConfig } from "./composable-test-server.js";
export type { ToolDefinition, TaskToolDefinition, ResourceDefinition, PromptDefinition, ResourceTemplateDefinition, ServerConfig, } from "./composable-test-server.js";
export { createMcpServer } from "./composable-test-server.js";
/**
 * Create multiple numbered tools for pagination testing
 * @param count Number of tools to create
 * @returns Array of tool definitions
 */
export declare function createNumberedTools(count: number): ToolDefinition[];
/**
 * Create multiple numbered resources for pagination testing
 * @param count Number of resources to create
 * @returns Array of resource definitions
 */
export declare function createNumberedResources(count: number): ResourceDefinition[];
/**
 * Create multiple numbered resource templates for pagination testing
 * @param count Number of resource templates to create
 * @returns Array of resource template definitions
 */
export declare function createNumberedResourceTemplates(count: number): ResourceTemplateDefinition[];
/**
 * Create multiple numbered prompts for pagination testing
 * @param count Number of prompts to create
 * @returns Array of prompt definitions
 */
export declare function createNumberedPrompts(count: number): PromptDefinition[];
/**
 * Create an "echo" tool that echoes back the input message
 */
export declare function createEchoTool(): ToolDefinition;
/**
 * Create a tool that writes a message to stderr. Used to test stderr capture/piping.
 */
export declare function createWriteToStderrTool(): ToolDefinition;
/**
 * Create an "add" tool that adds two numbers together
 */
export declare function createAddTool(): ToolDefinition;
/**
 * Create a "get-sum" tool that returns the sum of two numbers (alias for add)
 */
export declare function createGetSumTool(): ToolDefinition;
/**
 * Create a "collectSample" tool that sends a sampling request and returns the response
 */
export declare function createCollectSampleTool(): ToolDefinition;
/**
 * Create a "listRoots" tool that calls roots/list and returns the roots
 */
export declare function createListRootsTool(): ToolDefinition;
/**
 * Create a "collectElicitation" tool that sends an elicitation request and returns the response
 */
export declare function createCollectFormElicitationTool(): ToolDefinition;
/**
 * Create a "collectUrlElicitation" tool that sends a URL-based elicitation request
 * to the client and returns the response
 */
export declare function createCollectUrlElicitationTool(): ToolDefinition;
/**
 * Create a "sendNotification" tool that sends a notification message from the server
 */
export declare function createSendNotificationTool(): ToolDefinition;
/**
 * Create a "get-annotated-message" tool that returns a message with optional image
 */
export declare function createGetAnnotatedMessageTool(): ToolDefinition;
/**
 * Create a "simple-prompt" prompt definition
 */
export declare function createSimplePrompt(): PromptDefinition;
/**
 * Create an "args-prompt" prompt that accepts arguments
 */
export declare function createArgsPrompt(completions?: Record<string, (argumentValue: string, context?: Record<string, string>) => Promise<string[]> | string[]>): PromptDefinition;
/**
 * Create an "architecture" resource definition
 */
export declare function createArchitectureResource(): ResourceDefinition;
/**
 * Create a "test-cwd" resource that exposes the current working directory (generally useful when testing with the stdio test server)
 */
export declare function createTestCwdResource(): ResourceDefinition;
/**
 * Create a "test-env" resource that exposes environment variables (generally useful when testing with the stdio test server)
 */
export declare function createTestEnvResource(): ResourceDefinition;
/**
 * Create a "test-argv" resource that exposes command-line arguments (generally useful when testing with the stdio test server)
 */
export declare function createTestArgvResource(): ResourceDefinition;
/**
 * Create minimal server info for test servers
 */
export declare function createTestServerInfo(name?: string, version?: string): Implementation;
/**
 * Create a "file" resource template that reads files by path
 */
export declare function createFileResourceTemplate(completionCallback?: (argumentName: string, value: string, context?: Record<string, string>) => Promise<string[]> | string[], listCallback?: () => Promise<string[]> | string[]): ResourceTemplateDefinition;
/**
 * Create a "user" resource template that returns user data by ID
 */
export declare function createUserResourceTemplate(completionCallback?: (argumentName: string, value: string, context?: Record<string, string>) => Promise<string[]> | string[], listCallback?: () => Promise<string[]> | string[]): ResourceTemplateDefinition;
/**
 * Create a tool that adds a resource to the server and sends list_changed notification
 */
export declare function createAddResourceTool(): ToolDefinition;
/**
 * Create a tool that removes a resource from the server by URI and sends list_changed notification
 */
export declare function createRemoveResourceTool(): ToolDefinition;
/**
 * Create a tool that adds a tool to the server and sends list_changed notification
 */
export declare function createAddToolTool(): ToolDefinition;
/**
 * Create a tool that removes a tool from the server by name and sends list_changed notification
 */
export declare function createRemoveToolTool(): ToolDefinition;
/**
 * Create a tool that adds a prompt to the server and sends list_changed notification
 */
export declare function createAddPromptTool(): ToolDefinition;
/**
 * Create a tool that updates an existing resource's content and sends resource updated notification
 */
export declare function createUpdateResourceTool(): ToolDefinition;
/**
 * Create a tool that sends progress notifications during execution
 * @param name Tool name (default: "sendProgress")
 * @returns Tool definition
 */
export declare function createSendProgressTool(name?: string): ToolDefinition;
export declare function createRemovePromptTool(): ToolDefinition;
/**
 * Options for creating a flexible task tool fixture
 */
export interface FlexibleTaskToolOptions {
    name?: string;
    taskSupport?: "required" | "optional" | "forbidden";
    immediateReturn?: boolean;
    delayMs?: number;
    progressUnits?: number;
    elicitationSchema?: z.ZodTypeAny;
    samplingText?: string;
    failAfterDelay?: number;
    cancelAfterDelay?: number;
}
/**
 * Create a flexible task tool that can be configured for various task scenarios
 * Returns ToolDefinition if taskSupport is "forbidden" or immediateReturn is true
 * Returns TaskToolDefinition otherwise
 */
export declare function createFlexibleTaskTool(options?: FlexibleTaskToolOptions): ToolDefinition | TaskToolDefinition;
/**
 * Create a simple task tool that completes after a delay
 */
export declare function createSimpleTaskTool(name?: string, delayMs?: number): TaskToolDefinition;
/**
 * Create a task tool that sends progress notifications
 */
export declare function createProgressTaskTool(name?: string, delayMs?: number, progressUnits?: number): TaskToolDefinition;
/**
 * Create a task tool that requires elicitation input
 */
export declare function createElicitationTaskTool(name?: string, elicitationSchema?: z.ZodTypeAny): TaskToolDefinition;
/**
 * Create a task tool that requires sampling input
 */
export declare function createSamplingTaskTool(name?: string, samplingText?: string): TaskToolDefinition;
/**
 * Create a task tool with optional task support
 */
export declare function createOptionalTaskTool(name?: string, delayMs?: number): TaskToolDefinition;
/**
 * Create a task tool that is forbidden from using tasks (returns immediately)
 */
export declare function createForbiddenTaskTool(name?: string, delayMs?: number): ToolDefinition;
/**
 * Create a task tool that returns immediately even if taskSupport is required
 * (for testing callTool() with task-supporting tools)
 */
export declare function createImmediateReturnTaskTool(name?: string, delayMs?: number): ToolDefinition;
/**
 * Get a server config with task support and task tools for testing
 */
export declare function getTaskServerConfig(): ServerConfig;
/**
 * Get default server config with common test tools, prompts, and resources
 */
export declare function getDefaultServerConfig(): ServerConfig;
/**
 * OAuth Test Fixtures
 */
/**
 * Creates a test server configuration with OAuth enabled
 */
export declare function createOAuthTestServerConfig(options: {
    requireAuth?: boolean;
    scopesSupported?: string[];
    staticClients?: Array<{
        clientId: string;
        clientSecret?: string;
        redirectUris?: string[];
    }>;
    supportDCR?: boolean;
    supportCIMD?: boolean;
    tokenExpirationSeconds?: number;
    supportRefreshTokens?: boolean;
}): Partial<ServerConfig>;
import type { OAuthNavigation, RedirectUrlProvider } from "../auth/providers.js";
import type { OAuthStorage } from "../auth/storage.js";
/**
 * Creates OAuth configuration for InspectorClient tests
 */
export declare function createOAuthClientConfig(options: {
    mode: "static" | "dcr" | "cimd";
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    redirectUrl: string;
    scope?: string;
}): {
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    redirectUrlProvider: RedirectUrlProvider;
    scope?: string;
    storage: OAuthStorage;
    navigation: OAuthNavigation;
};
/**
 * Client metadata document for CIMD testing
 */
export interface ClientMetadataDocument {
    redirect_uris: string[];
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
    client_name?: string;
    client_uri?: string;
    scope?: string;
}
/**
 * Creates an Express server that serves a client metadata document for CIMD testing
 * The server runs on a different port and serves the metadata at the root path
 *
 * @param metadata - The client metadata document to serve
 * @returns Object with server URL and cleanup function
 */
export declare function createClientMetadataServer(metadata: ClientMetadataDocument): Promise<{
    url: string;
    stop: () => Promise<void>;
}>;
/**
 * Helper function to programmatically complete OAuth authorization
 * Makes HTTP GET request to authorization URL and extracts authorization code
 * The test server's authorization endpoint auto-approves and redirects with code
 *
 * @param authorizationUrl - The authorization URL from oauthAuthorizationRequired event
 * @returns Authorization code extracted from redirect URL
 */
export declare function completeOAuthAuthorization(authorizationUrl: URL): Promise<string>;
//# sourceMappingURL=test-server-fixtures.d.ts.map