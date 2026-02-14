import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { MCPServerConfig, StderrLogEntry, ConnectionStatus, MessageEntry, FetchRequestEntry, ResourceReadInvocation, ResourceTemplateReadInvocation, PromptGetInvocation, ToolCallInvocation } from "./types.js";
import type { CreateTransport, ServerType } from "./types.js";
import type { ServerCapabilities, Implementation, LoggingLevel, Tool, Resource, ResourceTemplate, Prompt, Root, CallToolResult, Task } from "@modelcontextprotocol/sdk/types.js";
import { type JsonValue } from "../json/jsonUtils.js";
import { type ReadOnlyContentCache } from "./contentCache.js";
import { InspectorClientEventTarget } from "./inspectorClientEventTarget.js";
import { SamplingCreateMessage } from "./samplingCreateMessage.js";
import { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
import type { OAuthNavigation, RedirectUrlProvider } from "../auth/providers.js";
import type { OAuthStorage } from "../auth/storage.js";
import type { AuthGuidedState, OAuthStep } from "../auth/types.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type pino from "pino";
import type { InspectorClientStorage } from "./sessionStorage.js";
/**
 * Consolidated environment interface that defines all environment-specific seams.
 * Each environment (Node, browser, tests) provides a complete implementation bundle.
 */
export interface InspectorClientEnvironment {
    /**
     * Factory that creates a client transport for the given server config.
     * Required. Environment provides the implementation:
     * - Node: createTransportNode
     * - Browser: createRemoteTransport
     */
    transport: CreateTransport;
    /**
     * Optional fetch function for HTTP requests (OAuth discovery/token exchange and
     * MCP transport). When provided, used for both auth and transport to bypass CORS.
     * - Node: undefined (uses global fetch)
     * - Browser: createRemoteFetch
     */
    fetch?: typeof fetch;
    /**
     * Optional logger for InspectorClient events (transport, OAuth, etc.).
     * - Node: pino file logger
     * - Browser: createRemoteLogger
     */
    logger?: pino.Logger;
    /**
     * OAuth environment components
     */
    oauth?: {
        /**
         * OAuth storage implementation
         * - Node: NodeOAuthStorage (file-based)
         * - Browser: BrowserOAuthStorage (sessionStorage) or RemoteOAuthStorage (shared state)
         */
        storage?: OAuthStorage;
        /**
         * Navigation handler for redirecting users to authorization URLs
         * - Node: ConsoleNavigation
         * - Browser: BrowserNavigation
         */
        navigation?: OAuthNavigation;
        /**
         * Redirect URL provider
         * - Node: from OAuth callback server
         * - Browser: from window.location or callback route
         */
        redirectUrlProvider?: RedirectUrlProvider;
    };
}
export interface InspectorClientOptions {
    /**
     * Environment-specific implementations (transport, fetch, logger, OAuth components)
     */
    environment: InspectorClientEnvironment;
    /**
     * Client identity (name and version)
     */
    clientIdentity?: {
        name: string;
        version: string;
    };
    /**
     * Maximum number of messages to store (0 = unlimited, but not recommended)
     */
    maxMessages?: number;
    /**
     * Maximum number of stderr log entries to store (0 = unlimited, but not recommended)
     */
    maxStderrLogEvents?: number;
    /**
     * Maximum number of fetch requests to store (0 = unlimited, but not recommended)
     * Only applies to HTTP-based transports (SSE, streamable-http)
     */
    maxFetchRequests?: number;
    /**
     * Whether to pipe stderr for stdio transports (default: true for TUI, false for CLI)
     */
    pipeStderr?: boolean;
    /**
     * Whether to automatically sync lists (tools, resources, prompts) on connect and when
     * list_changed notifications are received (default: true)
     * If false, lists must be loaded manually via listTools(), listResources(), etc.
     * Note: This only controls reloading; listChangedNotifications controls subscription.
     */
    autoSyncLists?: boolean;
    /**
     * Initial logging level to set after connection (if server supports logging)
     * If not provided, logging level will not be set automatically
     */
    initialLoggingLevel?: LoggingLevel;
    /**
     * Whether to advertise sampling capability (default: true)
     */
    sample?: boolean;
    /**
     * Elicitation capability configuration
     * - `true` - support form-based elicitation only (default, for backward compatibility)
     * - `{ form: true }` - support form-based elicitation only
     * - `{ url: true }` - support URL-based elicitation only
     * - `{ form: true, url: true }` - support both form and URL-based elicitation
     * - `false` or `undefined` - no elicitation support
     */
    elicit?: boolean | {
        form?: boolean;
        url?: boolean;
    };
    /**
     * Initial roots to configure. If provided (even if empty array), the client will
     * advertise roots capability and handle roots/list requests from the server.
     */
    roots?: Root[];
    /**
     * Whether to enable listChanged notification handlers (default: true)
     * If enabled, InspectorClient will subscribe to list_changed notifications and fire
     * corresponding events (toolsListChanged, resourcesListChanged, promptsListChanged).
     * If autoSyncLists is also true, lists will be automatically reloaded when notifications arrive.
     */
    listChangedNotifications?: {
        tools?: boolean;
        resources?: boolean;
        prompts?: boolean;
    };
    /**
     * Whether to enable progress notification handling (default: true)
     * If enabled, InspectorClient will register a handler for progress notifications and dispatch progressNotification events
     */
    progress?: boolean;
    /**
     * If true, receiving a progress notification resets the request timeout (default: true).
     * Only applies to requests that can receive progress. Set to false for strict timeout caps.
     */
    resetTimeoutOnProgress?: boolean;
    /**
     * Per-request timeout in milliseconds. If not set, the SDK default (60_000) is used.
     */
    timeout?: number;
    /**
     * OAuth configuration (client credentials, scope, etc.)
     * Note: OAuth environment components (storage, navigation, redirectUrlProvider)
     * are in environment.oauth, but clientId/clientSecret/scope are config.
     */
    oauth?: {
        /**
         * Preregistered client ID (optional, will use DCR if not provided)
         * If clientMetadataUrl is provided, this is ignored (CIMD mode)
         */
        clientId?: string;
        /**
         * Preregistered client secret (optional, only if client requires secret)
         * If clientMetadataUrl is provided, this is ignored (CIMD mode)
         */
        clientSecret?: string;
        /**
         * Client metadata URL for CIMD (Client ID Metadata Documents) mode
         * If provided, enables URL-based client IDs (SEP-991)
         * The URL becomes the client_id, and the authorization server fetches it to discover client metadata
         */
        clientMetadataUrl?: string;
        /**
         * OAuth scope (optional, will be discovered if not provided)
         */
        scope?: string;
    };
    /**
     * Optional storage for persisting session state across page navigations.
     * When provided, InspectorClient will save/restore fetch requests, etc.
     * during OAuth flows.
     */
    sessionStorage?: InspectorClientStorage;
    /**
     * Optional session ID. If not provided, will be extracted from OAuth state
     * when OAuth flow starts. Used as key for sessionStorage.
     */
    sessionId?: string;
}
export declare class InspectorClient extends InspectorClientEventTarget {
    private transportConfig;
    private client;
    private transport;
    private baseTransport;
    private messages;
    private stderrLogs;
    private fetchRequests;
    private maxMessages;
    private maxStderrLogEvents;
    private maxFetchRequests;
    private pipeStderr;
    private autoSyncLists;
    private initialLoggingLevel?;
    private sample;
    private elicit;
    private progress;
    private resetTimeoutOnProgress;
    private requestTimeout;
    private status;
    private tools;
    private resources;
    private resourceTemplates;
    private prompts;
    private capabilities?;
    private serverInfo?;
    private instructions?;
    private pendingSamples;
    private pendingElicitations;
    private roots;
    private cacheInternal;
    readonly cache: ReadOnlyContentCache;
    private listChangedNotifications;
    private subscribedResources;
    private clientTasks;
    private oauthConfig?;
    private oauthStateMachine;
    private oauthState;
    private logger;
    private transportClientFactory;
    private fetchFn?;
    private effectiveAuthFetch;
    private sessionStorage?;
    private sessionId?;
    constructor(transportConfig: MCPServerConfig, options: InspectorClientOptions);
    private buildEffectiveAuthFetch;
    private createMessageTrackingCallbacks;
    private attachTransportListeners;
    /**
     * Build RequestOptions for SDK client calls (timeout, resetTimeoutOnProgress, onprogress).
     * When timeout is unset, SDK uses DEFAULT_REQUEST_TIMEOUT_MSEC (60s).
     *
     * When progress is enabled, we pass a per-request onprogress so the SDK routes progress and
     * runs timeout reset. The SDK injects progressToken: messageId; we do not expose the caller's
     * token to the server. We collect it from metadata and inject it into dispatched progressNotification
     * events only, so listeners can correlate progress with the request that triggered it.
     *
     * @param progressToken Optional token from request metadata; injected into progressNotification
     * events when provided (not sent to server).
     */
    private getRequestOptions;
    private isHttpOAuthConfig;
    /**
     * Connect to the MCP server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the MCP server
     */
    disconnect(): Promise<void>;
    /**
     * Get the underlying MCP Client
     */
    getClient(): Client;
    /**
     * Get all messages
     */
    getMessages(): MessageEntry[];
    /**
     * Get all stderr logs
     */
    getStderrLogs(): StderrLogEntry[];
    /**
     * Get the current connection status
     */
    getStatus(): ConnectionStatus;
    /**
     * Get the MCP server configuration used to create this client
     */
    getTransportConfig(): MCPServerConfig;
    /**
     * Get the server type (stdio, sse, or streamable-http)
     */
    getServerType(): ServerType;
    /**
     * Get all tools
     */
    getTools(): Tool[];
    /**
     * Get all resources
     */
    getResources(): Resource[];
    /**
     * Get resource templates
     * @returns Array of resource templates
     */
    getResourceTemplates(): ResourceTemplate[];
    /**
     * Get all prompts
     */
    getPrompts(): Prompt[];
    /**
     * Clear all tools and dispatch change event
     */
    clearTools(): void;
    /**
     * Clear all resources and dispatch change event
     */
    clearResources(): void;
    /**
     * Clear all resource templates and dispatch change event
     */
    clearResourceTemplates(): void;
    /**
     * Clear all prompts and dispatch change event
     */
    clearPrompts(): void;
    /**
     * Get all active tasks
     */
    getClientTasks(): Task[];
    /**
     * Get task capabilities from server
     * @returns Task capabilities or undefined if not supported
     */
    getTaskCapabilities(): {
        list: boolean;
        cancel: boolean;
    } | undefined;
    /**
     * Update task cache (internal helper)
     */
    private updateClientTask;
    /**
     * Get task status by taskId
     * @param taskId Task identifier
     * @returns Task status (GetTaskResult is the task itself)
     */
    getTask(taskId: string): Promise<Task>;
    /**
     * Get task result by taskId
     * @param taskId Task identifier
     * @returns Task result
     */
    getTaskResult(taskId: string): Promise<CallToolResult>;
    /**
     * Cancel a running task
     * @param taskId Task identifier
     * @returns Cancel result
     */
    cancelTask(taskId: string): Promise<void>;
    /**
     * List all tasks with optional pagination
     * @param cursor Optional pagination cursor
     * @returns List of tasks with optional next cursor
     */
    listTasks(cursor?: string): Promise<{
        tasks: Task[];
        nextCursor?: string;
    }>;
    /**
     * Get all pending sampling requests
     */
    getPendingSamples(): SamplingCreateMessage[];
    /**
     * Add a pending sampling request
     */
    private addPendingSample;
    /**
     * Remove a pending sampling request by ID
     */
    removePendingSample(id: string): void;
    /**
     * Get all pending elicitation requests
     */
    getPendingElicitations(): ElicitationCreateMessage[];
    /**
     * Add a pending elicitation request
     */
    private addPendingElicitation;
    /**
     * Remove a pending elicitation request by ID
     */
    removePendingElicitation(id: string): void;
    /**
     * Get server capabilities
     */
    getCapabilities(): ServerCapabilities | undefined;
    /**
     * Get server info (name, version)
     */
    getServerInfo(): Implementation | undefined;
    /**
     * Get server instructions
     */
    getInstructions(): string | undefined;
    /**
     * Set the logging level for the MCP server
     * @param level Logging level to set
     * @throws Error if client is not connected or server doesn't support logging
     */
    setLoggingLevel(level: LoggingLevel): Promise<void>;
    /**
     * Fetch a specific tool by name without side effects (no state updates, no events)
     * First checks if the tool is already loaded, then fetches pages until found or exhausted
     * Used by callTool/callToolStream to check tool schema before calling
     * @param name Tool name to fetch
     * @param metadata Optional metadata to include in the request
     * @returns The tool if found, undefined otherwise
     */
    private fetchTool;
    /**
     * List available tools with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing tools and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch toolsChange event (default: false)
     * @returns Object containing tools array and optional nextCursor
     */
    listTools(cursor?: string, metadata?: Record<string, string>, suppressEvents?: boolean): Promise<{
        tools: Tool[];
        nextCursor?: string;
    }>;
    /**
     * List all available tools (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all tools
     */
    listAllTools(metadata?: Record<string, string>): Promise<Tool[]>;
    /**
     * Call a tool by name
     * @param name Tool name
     * @param args Tool arguments
     * @param generalMetadata Optional general metadata
     * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
     * @returns Tool call response
     */
    callTool(name: string, args: Record<string, JsonValue>, generalMetadata?: Record<string, string>, toolSpecificMetadata?: Record<string, string>): Promise<ToolCallInvocation>;
    /**
     * Call a tool with task support (streaming)
     * This method supports tools with taskSupport: "required", "optional", or "forbidden"
     * @param name Tool name
     * @param args Tool arguments
     * @param generalMetadata Optional general metadata
     * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
     * @returns Tool call response
     */
    callToolStream(name: string, args: Record<string, JsonValue>, generalMetadata?: Record<string, string>, toolSpecificMetadata?: Record<string, string>): Promise<ToolCallInvocation>;
    /**
     * List available resources with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing resources and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch resourcesChange event (default: false)
     * @returns Object containing resources array and optional nextCursor
     */
    listResources(cursor?: string, metadata?: Record<string, string>, suppressEvents?: boolean): Promise<{
        resources: Resource[];
        nextCursor?: string;
    }>;
    /**
     * List all available resources (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all resources
     */
    listAllResources(metadata?: Record<string, string>): Promise<Resource[]>;
    /**
     * Read a resource by URI
     * @param uri Resource URI
     * @param metadata Optional metadata to include in the request
     * @returns Resource content
     */
    readResource(uri: string, metadata?: Record<string, string>): Promise<ResourceReadInvocation>;
    /**
     * Read a resource from a template by expanding the template URI with parameters
     * This encapsulates the business logic of template expansion and associates the
     * loaded resource with its template in InspectorClient state
     * @param templateName The name/ID of the resource template
     * @param params Parameters to fill in the template variables
     * @param metadata Optional metadata to include in the request
     * @returns The resource content along with expanded URI and template name
     * @throws Error if template is not found or URI expansion fails
     */
    readResourceFromTemplate(uriTemplate: string, params: Record<string, string>, metadata?: Record<string, string>): Promise<ResourceTemplateReadInvocation>;
    /**
     * List resource templates with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing resource templates and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch resourceTemplatesChange event (default: false)
     * @returns Object containing resourceTemplates array and optional nextCursor
     */
    listResourceTemplates(cursor?: string, metadata?: Record<string, string>, suppressEvents?: boolean): Promise<{
        resourceTemplates: ResourceTemplate[];
        nextCursor?: string;
    }>;
    /**
     * List all resource templates (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all resource templates
     */
    listAllResourceTemplates(metadata?: Record<string, string>): Promise<ResourceTemplate[]>;
    /**
     * List available prompts with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing prompts and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch promptsChange event (default: false)
     * @returns Object containing prompts array and optional nextCursor
     */
    listPrompts(cursor?: string, metadata?: Record<string, string>, suppressEvents?: boolean): Promise<{
        prompts: Prompt[];
        nextCursor?: string;
    }>;
    /**
     * List all available prompts (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all prompts
     */
    listAllPrompts(metadata?: Record<string, string>): Promise<Prompt[]>;
    /**
     * Get a prompt by name
     * @param name Prompt name
     * @param args Optional prompt arguments
     * @param metadata Optional metadata to include in the request
     * @returns Prompt content
     */
    getPrompt(name: string, args?: Record<string, JsonValue>, metadata?: Record<string, string>): Promise<PromptGetInvocation>;
    /**
     * Request completions for a resource template variable or prompt argument
     * @param ref Resource template reference or prompt reference
     * @param argumentName Name of the argument/variable to complete
     * @param argumentValue Current (partial) value of the argument
     * @param context Optional context with other argument values
     * @param metadata Optional metadata to include in the request
     * @returns Completion result with values array
     * @throws Error if client is not connected or request fails (except MethodNotFound)
     */
    getCompletions(ref: {
        type: "ref/resource";
        uri: string;
    } | {
        type: "ref/prompt";
        name: string;
    }, argumentName: string, argumentValue: string, context?: Record<string, string>, metadata?: Record<string, string>): Promise<{
        values: string[];
        total?: number;
        hasMore?: boolean;
    }>;
    /**
     * Fetch server info (capabilities, serverInfo, instructions) from cached initialize response
     * This does not send any additional MCP requests - it just reads cached data
     * Always called on connect
     */
    private fetchServerInfo;
    /**
     * Load all lists (tools, resources, prompts) by sending MCP requests.
     * Only runs when autoSyncLists is enabled.
     * listChanged auto-refresh is implemented via notification handlers in connect().
     */
    private loadAllLists;
    private addMessage;
    private updateMessageResponse;
    private addStderrLog;
    private addFetchRequest;
    /**
     * Get all fetch requests
     */
    getFetchRequests(): FetchRequestEntry[];
    /**
     * Get current session ID (from OAuth state authId)
     */
    getSessionId(): string | undefined;
    /**
     * Set session ID (typically extracted from OAuth state)
     */
    setSessionId(sessionId: string): void;
    /**
     * Save current session state to storage
     */
    saveSession(): Promise<void>;
    /**
     * Restore session state from storage
     */
    private restoreSession;
    /**
     * Get current roots
     */
    getRoots(): Root[];
    /**
     * Set roots and notify server if it supports roots/listChanged
     * Note: This will enable roots capability if it wasn't already enabled
     */
    setRoots(roots: Root[]): Promise<void>;
    /**
     * Get list of currently subscribed resource URIs
     */
    getSubscribedResources(): string[];
    /**
     * Check if a resource is currently subscribed
     */
    isSubscribedToResource(uri: string): boolean;
    /**
     * Check if the server supports resource subscriptions
     */
    supportsResourceSubscriptions(): boolean;
    /**
     * Subscribe to a resource to receive update notifications
     * @param uri - The URI of the resource to subscribe to
     * @throws Error if client is not connected or server doesn't support subscriptions
     */
    subscribeToResource(uri: string): Promise<void>;
    /**
     * Unsubscribe from a resource
     * @param uri - The URI of the resource to unsubscribe from
     * @throws Error if client is not connected
     */
    unsubscribeFromResource(uri: string): Promise<void>;
    /**
     * Get server URL from transport config (full URL including path, for OAuth discovery)
     */
    private getServerUrl;
    /**
     * Set OAuth configuration
     */
    setOAuthConfig(config: {
        clientId?: string;
        clientSecret?: string;
        clientMetadataUrl?: string;
        scope?: string;
    }): void;
    /**
     * Create and initialize an OAuth provider for the specified mode
     */
    private createOAuthProvider;
    /**
     * Initiates OAuth flow using SDK's auth() function (normal mode)
     * Can be called directly by user or automatically triggered by 401 errors
     */
    authenticate(): Promise<URL>;
    /**
     * Starts guided OAuth flow (step-by-step). Runs only the first step.
     * Use proceedOAuthStep() to advance. When oauthStep is "authorization_code",
     * set authorizationCode and call proceedOAuthStep() to complete.
     */
    beginGuidedAuth(): Promise<void>;
    /**
     * Runs guided OAuth flow to completion. If already started (via beginGuidedAuth),
     * continues from current step. Otherwise initializes and runs from the start.
     * Returns the authorization URL when user must authorize, or undefined if already complete.
     */
    runGuidedAuth(): Promise<URL | undefined>;
    /**
     * Set authorization code for guided OAuth flow.
     * Validates that the client is in guided OAuth mode (has active state machine).
     * @param authorizationCode The authorization code from the OAuth callback
     * @param completeFlow If true, automatically proceed through all remaining steps to completion.
     *                     If false, only set the code and wait for manual progression via proceedOAuthStep().
     *                     Defaults to false for manual step-by-step control.
     * @throws Error if not in guided OAuth flow or not at authorization_code step
     */
    setGuidedAuthorizationCode(authorizationCode: string, completeFlow?: boolean): Promise<void>;
    /**
     * Completes OAuth flow with authorization code.
     * For guided mode, this calls setGuidedAuthorizationCode(code, true) internally.
     * For normal mode, uses SDK auth() directly.
     */
    completeOAuthFlow(authorizationCode: string): Promise<void>;
    /**
     * Gets current OAuth tokens (if authorized)
     */
    getOAuthTokens(): Promise<OAuthTokens | undefined>;
    /**
     * Clears OAuth tokens and client information
     */
    clearOAuthTokens(): void;
    /**
     * Checks if client is currently OAuth authorized
     */
    isOAuthAuthorized(): Promise<boolean>;
    /**
     * Get current OAuth state machine state (for guided mode)
     */
    getOAuthState(): AuthGuidedState | undefined;
    /**
     * Get current OAuth step (for guided mode)
     */
    getOAuthStep(): OAuthStep | undefined;
    /**
     * Manually progress to next step in guided OAuth flow
     */
    proceedOAuthStep(): Promise<void>;
}
//# sourceMappingURL=inspectorClient.d.ts.map