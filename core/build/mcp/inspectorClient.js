import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getServerType as getServerTypeFromConfig } from "./config.js";
import { MessageTrackingTransport, } from "./messageTrackingTransport.js";
import { CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema, RootsListChangedNotificationSchema, ToolListChangedNotificationSchema, ResourceListChangedNotificationSchema, PromptListChangedNotificationSchema, ResourceUpdatedNotificationSchema, CallToolResultSchema, McpError, ErrorCode, } from "@modelcontextprotocol/sdk/types.js";
import { convertToolParameters, convertPromptArguments, } from "../json/jsonUtils.js";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { ContentCache } from "./contentCache.js";
import { InspectorClientEventTarget } from "./inspectorClientEventTarget.js";
import { SamplingCreateMessage } from "./samplingCreateMessage.js";
import { ElicitationCreateMessage } from "./elicitationCreateMessage.js";
import { BaseOAuthClientProvider } from "../auth/providers.js";
import { EMPTY_GUIDED_STATE } from "../auth/types.js";
import { OAuthStateMachine } from "../auth/state-machine.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { silentLogger } from "../auth/logger.js";
import { createFetchTracker } from "./fetchTracking.js";
import { parseOAuthState } from "../auth/utils.js";
/**
 * InspectorClient wraps an MCP Client and provides:
 * - Message tracking and storage
 * - Stderr log tracking and storage (for stdio transports)
 * - EventTarget interface for React hooks (cross-platform: works in browser and Node.js)
 * - Access to client functionality (prompts, resources, tools)
 */
// Maximum number of pages to fetch when paginating through lists
const MAX_PAGES = 100;
export class InspectorClient extends InspectorClientEventTarget {
    transportConfig;
    client = null;
    transport = null;
    baseTransport = null;
    messages = [];
    stderrLogs = [];
    fetchRequests = [];
    maxMessages;
    maxStderrLogEvents;
    maxFetchRequests;
    pipeStderr;
    autoSyncLists;
    initialLoggingLevel;
    sample;
    elicit;
    progress;
    resetTimeoutOnProgress;
    requestTimeout;
    status = "disconnected";
    // Server data
    tools = [];
    resources = [];
    resourceTemplates = [];
    prompts = [];
    capabilities;
    serverInfo;
    instructions;
    // Sampling requests
    pendingSamples = [];
    // Elicitation requests
    pendingElicitations = [];
    // Roots (undefined means roots capability not enabled, empty array means enabled but no roots)
    roots;
    // Content cache
    cacheInternal;
    cache;
    // ListChanged notification configuration
    listChangedNotifications;
    // Resource subscriptions
    subscribedResources = new Set();
    // Task tracking
    clientTasks = new Map();
    // OAuth support
    oauthConfig;
    oauthStateMachine = null;
    oauthState = null;
    logger;
    transportClientFactory;
    fetchFn;
    effectiveAuthFetch;
    // Session storage support
    sessionStorage;
    sessionId;
    constructor(transportConfig, options) {
        super();
        this.transportConfig = transportConfig;
        // Extract environment components
        this.transportClientFactory = options.environment.transport;
        this.fetchFn = options.environment.fetch;
        this.logger = options.environment.logger ?? silentLogger;
        // Initialize content cache
        this.cacheInternal = new ContentCache();
        this.cache = this.cacheInternal;
        this.maxMessages = options.maxMessages ?? 1000;
        this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1000;
        this.maxFetchRequests = options.maxFetchRequests ?? 1000;
        this.pipeStderr = options.pipeStderr ?? false;
        this.autoSyncLists = options.autoSyncLists ?? true;
        this.initialLoggingLevel = options.initialLoggingLevel;
        this.sample = options.sample ?? true;
        this.elicit = options.elicit ?? true;
        this.progress = options.progress ?? true;
        this.resetTimeoutOnProgress = options.resetTimeoutOnProgress ?? true;
        this.requestTimeout = options.timeout;
        // Only set roots if explicitly provided (even if empty array) - this enables roots capability
        this.roots = options.roots;
        // Initialize listChangedNotifications config (default: all enabled)
        this.listChangedNotifications = {
            tools: options.listChangedNotifications?.tools ?? true,
            resources: options.listChangedNotifications?.resources ?? true,
            prompts: options.listChangedNotifications?.prompts ?? true,
        };
        // Effective auth fetch: base fetch + tracking with category 'auth'
        this.effectiveAuthFetch = this.buildEffectiveAuthFetch();
        // Session storage support
        this.sessionStorage = options.sessionStorage;
        this.sessionId = options.sessionId;
        // Restore session if sessionId provided
        if (this.sessionId && this.sessionStorage) {
            this.restoreSession().catch((error) => {
                this.logger.warn({
                    sessionId: this.sessionId,
                    error: error instanceof Error ? error.message : String(error),
                }, "Failed to restore session");
            });
        }
        // Merge OAuth config with environment components
        if (options.oauth || options.environment.oauth) {
            this.oauthConfig = {
                // Environment components (storage, navigation, redirectUrlProvider)
                ...options.environment.oauth,
                // Config values (clientId, clientSecret, clientMetadataUrl, scope)
                ...options.oauth,
            };
        }
        // Transport is created in connect() (single place for create / wrap / attach).
        // Build client capabilities
        const clientOptions = {};
        const capabilities = {};
        if (this.sample) {
            capabilities.sampling = {};
        }
        // Handle elicitation capability with mode support
        if (this.elicit) {
            const elicitationCap = {};
            if (this.elicit === true) {
                // Backward compatibility: `elicit: true` means form support only
                elicitationCap.form = {};
            }
            else {
                // Explicit mode configuration
                if (this.elicit.form) {
                    elicitationCap.form = {};
                }
                if (this.elicit.url) {
                    elicitationCap.url = {};
                }
            }
            // Only add elicitation capability if at least one mode is enabled
            if (Object.keys(elicitationCap).length > 0) {
                capabilities.elicitation = elicitationCap;
            }
        }
        // Advertise roots capability if roots option was provided (even if empty array)
        if (this.roots !== undefined) {
            capabilities.roots = { listChanged: true };
        }
        if (Object.keys(capabilities).length > 0) {
            clientOptions.capabilities = capabilities;
        }
        this.client = new Client(options.clientIdentity ?? {
            name: "@modelcontextprotocol/inspector",
            version: "0.18.0",
        }, Object.keys(clientOptions).length > 0 ? clientOptions : undefined);
    }
    buildEffectiveAuthFetch() {
        const base = this.fetchFn ?? fetch;
        return createFetchTracker(base, {
            trackRequest: (entry) => this.addFetchRequest({ ...entry, category: "auth" }),
        });
    }
    createMessageTrackingCallbacks() {
        return {
            trackRequest: (message) => {
                const entry = {
                    id: `${Date.now()}-${Math.random()}`,
                    timestamp: new Date(),
                    direction: "request",
                    message,
                };
                this.addMessage(entry);
            },
            trackResponse: (message) => {
                const messageId = message.id;
                const requestEntry = this.messages.find((e) => e.direction === "request" &&
                    "id" in e.message &&
                    e.message.id === messageId);
                if (requestEntry) {
                    this.updateMessageResponse(requestEntry, message);
                }
                else {
                    const entry = {
                        id: `${Date.now()}-${Math.random()}`,
                        timestamp: new Date(),
                        direction: "response",
                        message,
                    };
                    this.addMessage(entry);
                }
            },
            trackNotification: (message) => {
                const entry = {
                    id: `${Date.now()}-${Math.random()}`,
                    timestamp: new Date(),
                    direction: "notification",
                    message,
                };
                this.addMessage(entry);
            },
        };
    }
    attachTransportListeners(baseTransport) {
        baseTransport.onclose = () => {
            if (this.status !== "disconnected") {
                this.status = "disconnected";
                this.dispatchTypedEvent("statusChange", this.status);
                this.dispatchTypedEvent("disconnect");
            }
        };
        baseTransport.onerror = (error) => {
            this.status = "error";
            this.dispatchTypedEvent("statusChange", this.status);
            this.dispatchTypedEvent("error", error);
        };
    }
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
    getRequestOptions(progressToken) {
        const opts = {
            resetTimeoutOnProgress: this.resetTimeoutOnProgress,
        };
        if (this.requestTimeout !== undefined) {
            opts.timeout = this.requestTimeout;
        }
        if (this.progress) {
            const token = progressToken;
            const onprogress = (progress) => {
                const payload = {
                    ...progress,
                    ...(token != null && { progressToken: token }),
                };
                this.dispatchTypedEvent("progressNotification", payload);
            };
            opts.onprogress = onprogress;
        }
        return opts;
    }
    isHttpOAuthConfig() {
        const serverType = getServerTypeFromConfig(this.transportConfig);
        return ((serverType === "sse" || serverType === "streamable-http") &&
            !!this.oauthConfig);
    }
    /**
     * Connect to the MCP server
     */
    async connect() {
        if (!this.client) {
            throw new Error("Client not initialized");
        }
        if (this.status === "connected") {
            return;
        }
        // Create transport (single place for create / wrap / attach).
        if (!this.baseTransport) {
            const transportOptions = {
                fetchFn: this.fetchFn,
                pipeStderr: this.pipeStderr,
                onStderr: (entry) => {
                    this.addStderrLog(entry);
                },
                onFetchRequest: (entry) => {
                    this.addFetchRequest({ ...entry, category: "transport" });
                },
            };
            if (this.isHttpOAuthConfig()) {
                const provider = await this.createOAuthProvider("normal");
                transportOptions.authProvider = provider;
            }
            const { transport: baseTransport } = this.transportClientFactory(this.transportConfig, transportOptions);
            this.baseTransport = baseTransport;
            const messageTracking = this.createMessageTrackingCallbacks();
            this.transport =
                this.maxMessages > 0
                    ? new MessageTrackingTransport(baseTransport, messageTracking)
                    : baseTransport;
            this.attachTransportListeners(this.baseTransport);
        }
        if (!this.transport) {
            throw new Error("Transport not initialized");
        }
        try {
            this.status = "connecting";
            this.dispatchTypedEvent("statusChange", this.status);
            // Clear message history on connect (start fresh for new session)
            // Don't clear stderrLogs - they persist across reconnects
            this.messages = [];
            this.dispatchTypedEvent("messagesChange");
            await this.client.connect(this.transport);
            this.status = "connected";
            this.dispatchTypedEvent("statusChange", this.status);
            this.dispatchTypedEvent("connect");
            // Always fetch server info (capabilities, serverInfo, instructions) - this is just cached data from initialize
            await this.fetchServerInfo();
            // Set initial logging level if configured and server supports it
            if (this.initialLoggingLevel && this.capabilities?.logging) {
                await this.client.setLoggingLevel(this.initialLoggingLevel, this.getRequestOptions());
            }
            // Auto-fetch server contents (tools, resources, prompts) if enabled
            if (this.autoSyncLists) {
                await this.loadAllLists();
            }
            // Set up sampling request handler if sampling capability is enabled
            if (this.sample && this.client) {
                this.client.setRequestHandler(CreateMessageRequestSchema, (request) => {
                    return new Promise((resolve, reject) => {
                        const samplingRequest = new SamplingCreateMessage(request, (result) => {
                            resolve(result);
                        }, (error) => {
                            reject(error);
                        }, (id) => this.removePendingSample(id));
                        this.addPendingSample(samplingRequest);
                    });
                });
            }
            // Set up elicitation request handler if elicitation capability is enabled
            if (this.elicit && this.client) {
                this.client.setRequestHandler(ElicitRequestSchema, (request) => {
                    return new Promise((resolve) => {
                        const elicitationRequest = new ElicitationCreateMessage(request, (result) => {
                            resolve(result);
                        }, (id) => this.removePendingElicitation(id));
                        this.addPendingElicitation(elicitationRequest);
                    });
                });
            }
            // Set up roots/list request handler if roots capability is enabled
            if (this.roots !== undefined && this.client) {
                this.client.setRequestHandler(ListRootsRequestSchema, async () => {
                    return { roots: this.roots ?? [] };
                });
            }
            // Set up notification handler for roots/list_changed from server
            if (this.client) {
                this.client.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
                    // Dispatch event to notify UI that server's roots may have changed
                    // Note: rootsChange is a CustomEvent with Root[] payload, not a signal event
                    // We'll reload roots when the UI requests them, so we don't need to pass data here
                    // For now, we'll just dispatch an empty array as a signal to reload
                    this.dispatchTypedEvent("rootsChange", this.roots || []);
                });
            }
            // Set up listChanged notification handlers based on config
            if (this.client) {
                // Tools listChanged handler
                // Only register if both client config and server capability are enabled
                if (this.listChangedNotifications.tools &&
                    this.capabilities?.tools?.listChanged) {
                    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
                        // Always fire notification event (for tracking)
                        this.dispatchTypedEvent("toolsListChanged");
                        // Only reload if autoSyncLists is enabled
                        if (this.autoSyncLists) {
                            await this.listAllTools();
                        }
                    });
                }
                // Note: If handler should not be registered, we don't set it
                // The SDK client will ignore notifications for which no handler is registered
                // Resources listChanged handler (reloads both resources and resource templates)
                if (this.listChangedNotifications.resources &&
                    this.capabilities?.resources?.listChanged) {
                    this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
                        // Always fire notification event (for tracking)
                        this.dispatchTypedEvent("resourcesListChanged");
                        // Only reload if autoSyncLists is enabled
                        if (this.autoSyncLists) {
                            // Resource templates are part of the resources capability
                            await this.listAllResources();
                            await this.listAllResourceTemplates();
                        }
                    });
                }
                // Prompts listChanged handler
                if (this.listChangedNotifications.prompts &&
                    this.capabilities?.prompts?.listChanged) {
                    this.client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
                        // Always fire notification event (for tracking)
                        this.dispatchTypedEvent("promptsListChanged");
                        // Only reload if autoSyncLists is enabled
                        if (this.autoSyncLists) {
                            await this.listAllPrompts();
                        }
                    });
                }
                // Resource updated notification handler (only if server supports subscriptions)
                if (this.capabilities?.resources?.subscribe === true) {
                    this.client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (notification) => {
                        const uri = notification.params.uri;
                        // Only process if we're subscribed to this resource
                        if (this.subscribedResources.has(uri)) {
                            // Clear cache for this resource (handles both regular resources and resource templates)
                            this.cacheInternal.clearResourceAndResourceTemplate(uri);
                            // Dispatch event to notify UI
                            this.dispatchTypedEvent("resourceUpdated", { uri });
                        }
                    });
                }
                // Progress: we use per-request onprogress (see getRequestOptions). We do not register
                // a progress notification handler so the Protocol's _onprogress stays; timeout reset
                // and routing work, and we inject the caller's progressToken into dispatched events.
            }
        }
        catch (error) {
            this.status = "error";
            this.dispatchTypedEvent("statusChange", this.status);
            this.dispatchTypedEvent("error", error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }
    /**
     * Disconnect from the MCP server
     */
    async disconnect() {
        if (this.client) {
            try {
                await this.client.close();
            }
            catch (error) {
                // Ignore errors on close
            }
        }
        // Null out transport so next connect() creates a fresh one.
        this.baseTransport = null;
        this.transport = null;
        // Update status - transport onclose handler will also fire and clear state
        // But we also do it here in case disconnect() is called directly
        if (this.status !== "disconnected") {
            this.status = "disconnected";
            this.dispatchTypedEvent("statusChange", this.status);
            this.dispatchTypedEvent("disconnect");
        }
        // Clear server state (tools, resources, resource templates, prompts) on disconnect
        // These are only valid when connected
        this.tools = [];
        this.resources = [];
        this.resourceTemplates = [];
        this.prompts = [];
        this.pendingSamples = [];
        this.pendingElicitations = [];
        // Clear all cached content on disconnect
        this.cacheInternal.clearAll();
        // Clear resource subscriptions on disconnect
        this.subscribedResources.clear();
        // Clear active tasks on disconnect
        this.clientTasks.clear();
        this.capabilities = undefined;
        this.serverInfo = undefined;
        this.instructions = undefined;
        this.dispatchTypedEvent("toolsChange", this.tools);
        this.dispatchTypedEvent("resourcesChange", this.resources);
        this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
        this.dispatchTypedEvent("promptsChange", this.prompts);
        this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
        this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
        this.dispatchTypedEvent("instructionsChange", this.instructions);
    }
    /**
     * Get the underlying MCP Client
     */
    getClient() {
        if (!this.client) {
            throw new Error("Client not initialized");
        }
        return this.client;
    }
    /**
     * Get all messages
     */
    getMessages() {
        return [...this.messages];
    }
    /**
     * Get all stderr logs
     */
    getStderrLogs() {
        return [...this.stderrLogs];
    }
    /**
     * Get the current connection status
     */
    getStatus() {
        return this.status;
    }
    /**
     * Get the MCP server configuration used to create this client
     */
    getTransportConfig() {
        return this.transportConfig;
    }
    /**
     * Get the server type (stdio, sse, or streamable-http)
     */
    getServerType() {
        return getServerTypeFromConfig(this.transportConfig);
    }
    /**
     * Get all tools
     */
    getTools() {
        return [...this.tools];
    }
    /**
     * Get all resources
     */
    getResources() {
        return [...this.resources];
    }
    /**
     * Get resource templates
     * @returns Array of resource templates
     */
    getResourceTemplates() {
        return [...this.resourceTemplates];
    }
    /**
     * Get all prompts
     */
    getPrompts() {
        return [...this.prompts];
    }
    /**
     * Clear all tools and dispatch change event
     */
    clearTools() {
        this.tools = [];
        this.dispatchTypedEvent("toolsChange", this.tools);
    }
    /**
     * Clear all resources and dispatch change event
     */
    clearResources() {
        this.resources = [];
        this.dispatchTypedEvent("resourcesChange", this.resources);
    }
    /**
     * Clear all resource templates and dispatch change event
     */
    clearResourceTemplates() {
        this.resourceTemplates = [];
        this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
    }
    /**
     * Clear all prompts and dispatch change event
     */
    clearPrompts() {
        this.prompts = [];
        this.dispatchTypedEvent("promptsChange", this.prompts);
    }
    /**
     * Get all active tasks
     */
    getClientTasks() {
        return Array.from(this.clientTasks.values());
    }
    /**
     * Get task capabilities from server
     * @returns Task capabilities or undefined if not supported
     */
    getTaskCapabilities() {
        if (!this.capabilities?.tasks) {
            return undefined;
        }
        return {
            list: !!this.capabilities.tasks.list,
            cancel: !!this.capabilities.tasks.cancel,
        };
    }
    /**
     * Update task cache (internal helper)
     */
    updateClientTask(task) {
        this.clientTasks.set(task.taskId, task);
    }
    /**
     * Get task status by taskId
     * @param taskId Task identifier
     * @returns Task status (GetTaskResult is the task itself)
     */
    async getTask(taskId) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        const result = await this.client.experimental.tasks.getTask(taskId, this.getRequestOptions());
        // GetTaskResult is the task itself (taskId, status, ttl, etc.)
        // Update task cache with result
        this.updateClientTask(result);
        // Dispatch event
        this.dispatchTypedEvent("taskStatusChange", {
            taskId: result.taskId,
            task: result,
        });
        return result;
    }
    /**
     * Get task result by taskId
     * @param taskId Task identifier
     * @returns Task result
     */
    async getTaskResult(taskId) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        // Use CallToolResultSchema for validation
        return await this.client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema, this.getRequestOptions());
    }
    /**
     * Cancel a running task
     * @param taskId Task identifier
     * @returns Cancel result
     */
    async cancelTask(taskId) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        await this.client.experimental.tasks.cancelTask(taskId, this.getRequestOptions());
        // Update task cache if we have it
        const task = this.clientTasks.get(taskId);
        if (task) {
            const cancelledTask = {
                ...task,
                status: "cancelled",
                lastUpdatedAt: new Date().toISOString(),
            };
            this.updateClientTask(cancelledTask);
        }
        // Dispatch event
        this.dispatchTypedEvent("taskCancelled", { taskId });
    }
    /**
     * List all tasks with optional pagination
     * @param cursor Optional pagination cursor
     * @returns List of tasks with optional next cursor
     */
    async listTasks(cursor) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        const result = await this.client.experimental.tasks.listTasks(cursor, this.getRequestOptions());
        // Update task cache with all returned tasks
        for (const task of result.tasks) {
            this.updateClientTask(task);
        }
        // Dispatch event with all tasks
        this.dispatchTypedEvent("tasksChange", result.tasks);
        return result;
    }
    /**
     * Get all pending sampling requests
     */
    getPendingSamples() {
        return [...this.pendingSamples];
    }
    /**
     * Add a pending sampling request
     */
    addPendingSample(sample) {
        this.pendingSamples.push(sample);
        this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
        this.dispatchTypedEvent("newPendingSample", sample);
    }
    /**
     * Remove a pending sampling request by ID
     */
    removePendingSample(id) {
        const index = this.pendingSamples.findIndex((s) => s.id === id);
        if (index !== -1) {
            this.pendingSamples.splice(index, 1);
            this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
        }
    }
    /**
     * Get all pending elicitation requests
     */
    getPendingElicitations() {
        return [...this.pendingElicitations];
    }
    /**
     * Add a pending elicitation request
     */
    addPendingElicitation(elicitation) {
        this.pendingElicitations.push(elicitation);
        this.dispatchTypedEvent("pendingElicitationsChange", this.pendingElicitations);
        this.dispatchTypedEvent("newPendingElicitation", elicitation);
    }
    /**
     * Remove a pending elicitation request by ID
     */
    removePendingElicitation(id) {
        const index = this.pendingElicitations.findIndex((e) => e.id === id);
        if (index !== -1) {
            this.pendingElicitations.splice(index, 1);
            this.dispatchTypedEvent("pendingElicitationsChange", this.pendingElicitations);
        }
    }
    /**
     * Get server capabilities
     */
    getCapabilities() {
        return this.capabilities;
    }
    /**
     * Get server info (name, version)
     */
    getServerInfo() {
        return this.serverInfo;
    }
    /**
     * Get server instructions
     */
    getInstructions() {
        return this.instructions;
    }
    /**
     * Set the logging level for the MCP server
     * @param level Logging level to set
     * @throws Error if client is not connected or server doesn't support logging
     */
    async setLoggingLevel(level) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        if (!this.capabilities?.logging) {
            throw new Error("Server does not support logging");
        }
        await this.client.setLoggingLevel(level, this.getRequestOptions());
    }
    /**
     * Fetch a specific tool by name without side effects (no state updates, no events)
     * First checks if the tool is already loaded, then fetches pages until found or exhausted
     * Used by callTool/callToolStream to check tool schema before calling
     * @param name Tool name to fetch
     * @param metadata Optional metadata to include in the request
     * @returns The tool if found, undefined otherwise
     */
    async fetchTool(name, metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        // First check if tool is already loaded
        const existingTool = this.tools.find((t) => t.name === name);
        if (existingTool) {
            return existingTool;
        }
        // Tool not found, fetch pages until we find it
        // Use client directly to avoid modifying this.tools
        let cursor;
        let pageCount = 0;
        try {
            do {
                const params = metadata && Object.keys(metadata).length > 0
                    ? { _meta: metadata }
                    : {};
                if (cursor) {
                    params.cursor = cursor;
                }
                const response = await this.client.listTools(params, this.getRequestOptions(metadata?.progressToken));
                const tools = response.tools || [];
                // Check if we found the tool
                const tool = tools.find((t) => t.name === name);
                if (tool) {
                    return tool; // Found it, return early
                }
                cursor = response.nextCursor;
                pageCount++;
                if (pageCount >= MAX_PAGES) {
                    throw new Error(`Maximum pagination limit (${MAX_PAGES} pages) reached while searching for tool "${name}"`);
                }
            } while (cursor);
            // Tool not found after searching all pages
            return undefined;
        }
        catch (error) {
            throw new Error(`Failed to fetch tool "${name}": ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * List available tools with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing tools and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch toolsChange event (default: false)
     * @returns Object containing tools array and optional nextCursor
     */
    async listTools(cursor, metadata, suppressEvents = false) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        const params = metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
        if (cursor) {
            params.cursor = cursor;
        }
        const response = await this.client.listTools(params, this.getRequestOptions(metadata?.progressToken));
        const tools = response.tools || [];
        // Update internal state: reset if no cursor, append if cursor provided
        if (cursor) {
            // Append to existing tools
            this.tools.push(...tools);
        }
        else {
            // Clear and start fresh
            this.tools = tools;
        }
        // Dispatch change event unless suppressed
        if (!suppressEvents) {
            this.dispatchTypedEvent("toolsChange", this.tools);
        }
        return {
            tools,
            nextCursor: response.nextCursor,
        };
    }
    /**
     * List all available tools (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all tools
     */
    async listAllTools(metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            // Store current tool names before fetching
            const currentNames = new Set(this.tools.map((t) => t.name));
            // Fetch all pages (suppress events during pagination)
            let cursor;
            let pageCount = 0;
            do {
                const result = await this.listTools(cursor, metadata, true);
                cursor = result.nextCursor;
                pageCount++;
                if (pageCount >= MAX_PAGES) {
                    throw new Error(`Maximum pagination limit (${MAX_PAGES} pages) reached while listing tools`);
                }
            } while (cursor);
            // Find removed tool names by comparing with current tools
            const newNames = new Set(this.tools.map((t) => t.name));
            // Clear cache for removed tools
            for (const name of currentNames) {
                if (!newNames.has(name)) {
                    this.cacheInternal.clearToolCallResult(name);
                }
            }
            // Dispatch final change event (listTools calls were suppressed)
            this.dispatchTypedEvent("toolsChange", this.tools);
            return this.tools;
        }
        catch (error) {
            throw new Error(`Failed to list all tools: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Call a tool by name
     * @param name Tool name
     * @param args Tool arguments
     * @param generalMetadata Optional general metadata
     * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
     * @returns Tool call response
     */
    async callTool(name, args, generalMetadata, toolSpecificMetadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        // Check if tool requires task support BEFORE try block
        // This ensures the error is thrown and not caught
        const tool = await this.fetchTool(name, generalMetadata);
        if (tool?.execution?.taskSupport === "required") {
            throw new Error(`Tool "${name}" requires task support. Use callToolStream() instead of callTool().`);
        }
        try {
            let convertedArgs = args;
            if (tool) {
                // Convert parameters based on the tool's schema, but only for string values
                // since we now accept pre-parsed values from the CLI
                const stringArgs = {};
                for (const [key, value] of Object.entries(args)) {
                    if (typeof value === "string") {
                        stringArgs[key] = value;
                    }
                }
                if (Object.keys(stringArgs).length > 0) {
                    const convertedStringArgs = convertToolParameters(tool, stringArgs);
                    convertedArgs = { ...args, ...convertedStringArgs };
                }
            }
            // Merge general metadata with tool-specific metadata
            // Tool-specific metadata takes precedence over general metadata
            let mergedMetadata;
            if (generalMetadata || toolSpecificMetadata) {
                mergedMetadata = {
                    ...(generalMetadata || {}),
                    ...(toolSpecificMetadata || {}),
                };
            }
            const timestamp = new Date();
            const metadata = mergedMetadata && Object.keys(mergedMetadata).length > 0
                ? mergedMetadata
                : undefined;
            const result = await this.client.callTool({
                name: name,
                arguments: convertedArgs,
                _meta: metadata,
            }, undefined, this.getRequestOptions(metadata?.progressToken));
            const invocation = {
                toolName: name,
                params: args,
                result: result,
                timestamp,
                success: true,
                metadata,
            };
            // Store in cache
            this.cacheInternal.setToolCallResult(name, invocation);
            // Dispatch event
            this.dispatchTypedEvent("toolCallResultChange", {
                toolName: name,
                params: args,
                result: invocation.result,
                timestamp,
                success: true,
                metadata,
            });
            return invocation;
        }
        catch (error) {
            // Merge general metadata with tool-specific metadata for error case
            let mergedMetadata;
            if (generalMetadata || toolSpecificMetadata) {
                mergedMetadata = {
                    ...(generalMetadata || {}),
                    ...(toolSpecificMetadata || {}),
                };
            }
            const timestamp = new Date();
            const metadata = mergedMetadata && Object.keys(mergedMetadata).length > 0
                ? mergedMetadata
                : undefined;
            const invocation = {
                toolName: name,
                params: args,
                result: null,
                timestamp,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata,
            };
            // Store in cache (even on error)
            this.cacheInternal.setToolCallResult(name, invocation);
            // Dispatch event
            this.dispatchTypedEvent("toolCallResultChange", {
                toolName: name,
                params: args,
                result: null,
                timestamp,
                success: false,
                error: invocation.error,
                metadata,
            });
            throw error;
        }
    }
    /**
     * Call a tool with task support (streaming)
     * This method supports tools with taskSupport: "required", "optional", or "forbidden"
     * @param name Tool name
     * @param args Tool arguments
     * @param generalMetadata Optional general metadata
     * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
     * @returns Tool call response
     */
    async callToolStream(name, args, generalMetadata, toolSpecificMetadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            const tool = await this.fetchTool(name, generalMetadata);
            let convertedArgs = args;
            if (tool) {
                // Convert parameters based on the tool's schema, but only for string values
                const stringArgs = {};
                for (const [key, value] of Object.entries(args)) {
                    if (typeof value === "string") {
                        stringArgs[key] = value;
                    }
                }
                if (Object.keys(stringArgs).length > 0) {
                    const convertedStringArgs = convertToolParameters(tool, stringArgs);
                    convertedArgs = { ...args, ...convertedStringArgs };
                }
            }
            // Merge general metadata with tool-specific metadata
            let mergedMetadata;
            if (generalMetadata || toolSpecificMetadata) {
                mergedMetadata = {
                    ...(generalMetadata || {}),
                    ...(toolSpecificMetadata || {}),
                };
            }
            const timestamp = new Date();
            const metadata = mergedMetadata && Object.keys(mergedMetadata).length > 0
                ? mergedMetadata
                : undefined;
            // Call the streaming API
            // Metadata should be in the params, not in options
            const streamParams = {
                name: name,
                arguments: convertedArgs,
            };
            if (metadata) {
                streamParams._meta = metadata;
            }
            const stream = this.client.experimental.tasks.callToolStream(streamParams, undefined, // Use default CallToolResultSchema
            this.getRequestOptions(metadata?.progressToken));
            let finalResult;
            let taskId;
            let error;
            // Iterate through the async generator
            for await (const message of stream) {
                switch (message.type) {
                    case "taskCreated":
                        // Task was created - update cache and dispatch event
                        this.updateClientTask(message.task);
                        taskId = message.task.taskId;
                        this.dispatchTypedEvent("taskCreated", {
                            taskId: message.task.taskId,
                            task: message.task,
                        });
                        break;
                    case "taskStatus":
                        // Task status updated - update cache and dispatch event
                        this.updateClientTask(message.task);
                        if (!taskId) {
                            taskId = message.task.taskId;
                        }
                        this.dispatchTypedEvent("taskStatusChange", {
                            taskId: message.task.taskId,
                            task: message.task,
                        });
                        break;
                    case "result":
                        // Task completed - update cache, dispatch event, and store result
                        // message.result is already CallToolResult from the stream
                        finalResult = message.result;
                        if (taskId) {
                            // Update task status to completed if we have the task
                            const task = this.clientTasks.get(taskId);
                            if (task) {
                                const completedTask = {
                                    ...task,
                                    status: "completed",
                                    lastUpdatedAt: new Date().toISOString(),
                                };
                                this.updateClientTask(completedTask);
                                this.dispatchTypedEvent("taskCompleted", {
                                    taskId,
                                    result: finalResult,
                                });
                            }
                        }
                        break;
                    case "error":
                        // Task failed - dispatch event and store error
                        error = new Error(message.error.message || "Task execution failed");
                        if (taskId) {
                            // Update task status to failed if we have the task
                            const task = this.clientTasks.get(taskId);
                            if (task) {
                                const failedTask = {
                                    ...task,
                                    status: "failed",
                                    lastUpdatedAt: new Date().toISOString(),
                                    statusMessage: message.error.message,
                                };
                                this.updateClientTask(failedTask);
                                this.dispatchTypedEvent("taskFailed", {
                                    taskId,
                                    error: message.error,
                                });
                            }
                        }
                        break;
                }
            }
            // If we got an error, throw it
            if (error) {
                throw error;
            }
            // If we didn't get a result, something went wrong
            // This can happen if the task completed but result wasn't in the stream
            // Try to get it from the task result endpoint
            if (!finalResult && taskId) {
                try {
                    finalResult = await this.client.experimental.tasks.getTaskResult(taskId, undefined, this.getRequestOptions());
                }
                catch (resultError) {
                    throw new Error(`Tool call did not return a result: ${resultError instanceof Error ? resultError.message : String(resultError)}`);
                }
            }
            if (!finalResult) {
                throw new Error("Tool call did not return a result");
            }
            const invocation = {
                toolName: name,
                params: args,
                result: finalResult,
                timestamp,
                success: true,
                metadata,
            };
            // Store in cache
            this.cacheInternal.setToolCallResult(name, invocation);
            // Dispatch event
            this.dispatchTypedEvent("toolCallResultChange", {
                toolName: name,
                params: args,
                result: invocation.result,
                timestamp,
                success: true,
                metadata,
            });
            return invocation;
        }
        catch (error) {
            // Merge general metadata with tool-specific metadata for error case
            let mergedMetadata;
            if (generalMetadata || toolSpecificMetadata) {
                mergedMetadata = {
                    ...(generalMetadata || {}),
                    ...(toolSpecificMetadata || {}),
                };
            }
            const timestamp = new Date();
            const metadata = mergedMetadata && Object.keys(mergedMetadata).length > 0
                ? mergedMetadata
                : undefined;
            const invocation = {
                toolName: name,
                params: args,
                result: null,
                timestamp,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata,
            };
            // Store in cache
            this.cacheInternal.setToolCallResult(name, invocation);
            // Dispatch event
            this.dispatchTypedEvent("toolCallResultChange", {
                toolName: name,
                params: args,
                result: null,
                timestamp,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata,
            });
            // Re-throw error
            throw error;
        }
    }
    /**
     * List available resources with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing resources and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch resourcesChange event (default: false)
     * @returns Object containing resources array and optional nextCursor
     */
    async listResources(cursor, metadata, suppressEvents = false) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        const params = metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
        if (cursor) {
            params.cursor = cursor;
        }
        const response = await this.client.listResources(params, this.getRequestOptions(metadata?.progressToken));
        const resources = response.resources || [];
        // Update internal state: reset if no cursor, append if cursor provided
        if (cursor) {
            // Append to existing resources
            this.resources.push(...resources);
        }
        else {
            // Clear and start fresh
            this.resources = resources;
        }
        // Dispatch change event unless suppressed
        if (!suppressEvents) {
            this.dispatchTypedEvent("resourcesChange", this.resources);
        }
        return {
            resources,
            nextCursor: response.nextCursor,
        };
    }
    /**
     * List all available resources (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all resources
     */
    async listAllResources(metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            // Store current URIs before fetching (capture before first page resets the list)
            const currentUris = new Set(this.resources.map((r) => r.uri));
            // Fetch all pages (suppress events during pagination)
            // First page resets the list, subsequent pages append
            let cursor;
            let pageCount = 0;
            do {
                const result = await this.listResources(cursor, metadata, true);
                cursor = result.nextCursor;
                pageCount++;
                if (pageCount >= MAX_PAGES) {
                    throw new Error(`Maximum pagination limit (${MAX_PAGES} pages) reached while listing resources`);
                }
            } while (cursor);
            // Find removed URIs by comparing previous state with new state
            const newUris = new Set(this.resources.map((r) => r.uri));
            // Clear cache for removed resources (only if we had resources before)
            if (currentUris.size > 0) {
                for (const uri of currentUris) {
                    if (!newUris.has(uri)) {
                        this.cacheInternal.clearResource(uri);
                    }
                }
            }
            // Dispatch final change event (listResources calls were suppressed)
            this.dispatchTypedEvent("resourcesChange", this.resources);
            // Note: Cached content for existing resources is automatically preserved
            return this.resources;
        }
        catch (error) {
            throw new Error(`Failed to list all resources: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Read a resource by URI
     * @param uri Resource URI
     * @param metadata Optional metadata to include in the request
     * @returns Resource content
     */
    async readResource(uri, metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        const params = { uri };
        if (metadata && Object.keys(metadata).length > 0) {
            params._meta = metadata;
        }
        const result = await this.client.readResource(params, this.getRequestOptions(metadata?.progressToken));
        const invocation = {
            result,
            timestamp: new Date(),
            uri,
            metadata,
        };
        // Store in cache
        this.cacheInternal.setResource(uri, invocation);
        // Dispatch event
        this.dispatchTypedEvent("resourceContentChange", {
            uri,
            content: invocation,
            timestamp: invocation.timestamp,
        });
        return invocation;
    }
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
    async readResourceFromTemplate(uriTemplate, params, metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        // Look up template in resourceTemplates by uriTemplate (the unique identifier)
        const template = this.resourceTemplates.find((t) => t.uriTemplate === uriTemplate);
        if (!template) {
            throw new Error(`Resource template with uriTemplate "${uriTemplate}" not found`);
        }
        if (!template.uriTemplate) {
            throw new Error(`Resource template does not have a uriTemplate property`);
        }
        // Get the uriTemplate string (the unique ID of the template)
        const uriTemplateString = template.uriTemplate;
        // Expand the template's uriTemplate using the provided params
        let expandedUri;
        try {
            const uriTemplate = new UriTemplate(uriTemplateString);
            expandedUri = uriTemplate.expand(params);
        }
        catch (error) {
            throw new Error(`Failed to expand URI template "${uriTemplate}": ${error instanceof Error ? error.message : String(error)}`);
        }
        // Always fetch fresh content: Call readResource with expanded URI
        const readInvocation = await this.readResource(expandedUri, metadata);
        // Create the template invocation object
        const invocation = {
            uriTemplate: uriTemplateString,
            expandedUri,
            result: readInvocation.result,
            timestamp: readInvocation.timestamp,
            params,
            metadata,
        };
        // Store in cache
        this.cacheInternal.setResourceTemplate(uriTemplateString, invocation);
        // Dispatch event
        this.dispatchTypedEvent("resourceTemplateContentChange", {
            uriTemplate: uriTemplateString,
            content: invocation,
            params,
            timestamp: invocation.timestamp,
        });
        return invocation;
    }
    /**
     * List resource templates with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing resource templates and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch resourceTemplatesChange event (default: false)
     * @returns Object containing resourceTemplates array and optional nextCursor
     */
    async listResourceTemplates(cursor, metadata, suppressEvents = false) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            const params = metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
            if (cursor) {
                params.cursor = cursor;
            }
            const response = await this.client.listResourceTemplates(params, this.getRequestOptions(metadata?.progressToken));
            const resourceTemplates = response.resourceTemplates || [];
            // Update internal state: reset if no cursor, append if cursor provided
            if (cursor) {
                // Append to existing resource templates
                this.resourceTemplates.push(...resourceTemplates);
            }
            else {
                // Clear and start fresh
                this.resourceTemplates = resourceTemplates;
            }
            // Dispatch change event unless suppressed
            if (!suppressEvents) {
                this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
            }
            return {
                resourceTemplates,
                nextCursor: response.nextCursor,
            };
        }
        catch (error) {
            throw new Error(`Failed to list resource templates: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * List all resource templates (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all resource templates
     */
    async listAllResourceTemplates(metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            // Store current uriTemplates before fetching
            const currentUriTemplates = new Set(this.resourceTemplates.map((t) => t.uriTemplate));
            // Fetch all pages (suppress events during pagination)
            let cursor;
            let pageCount = 0;
            do {
                const result = await this.listResourceTemplates(cursor, metadata, true);
                cursor = result.nextCursor;
                pageCount++;
                if (pageCount >= MAX_PAGES) {
                    throw new Error(`Maximum pagination limit (${MAX_PAGES} pages) reached while listing resource templates`);
                }
            } while (cursor);
            // Find removed uriTemplates by comparing with current templates
            const newUriTemplates = new Set(this.resourceTemplates.map((t) => t.uriTemplate));
            // Clear cache for removed templates
            for (const uriTemplate of currentUriTemplates) {
                if (!newUriTemplates.has(uriTemplate)) {
                    this.cacheInternal.clearResourceTemplate(uriTemplate);
                }
            }
            // Dispatch final change event (listResourceTemplates calls were suppressed)
            this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
            // Note: Cached content for existing templates is automatically preserved
            return this.resourceTemplates;
        }
        catch (error) {
            throw new Error(`Failed to list all resource templates: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * List available prompts with pagination support
     * @param cursor Optional cursor for pagination. If not provided, clears existing prompts and starts fresh.
     * @param metadata Optional metadata to include in the request
     * @param suppressEvents If true, does not dispatch promptsChange event (default: false)
     * @returns Object containing prompts array and optional nextCursor
     */
    async listPrompts(cursor, metadata, suppressEvents = false) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        const params = metadata && Object.keys(metadata).length > 0 ? { _meta: metadata } : {};
        if (cursor) {
            params.cursor = cursor;
        }
        const response = await this.client.listPrompts(params, this.getRequestOptions(metadata?.progressToken));
        const prompts = response.prompts || [];
        // Update internal state: reset if no cursor, append if cursor provided
        if (cursor) {
            // Append to existing prompts
            this.prompts.push(...prompts);
        }
        else {
            // Clear and start fresh
            this.prompts = prompts;
        }
        // Dispatch change event unless suppressed
        if (!suppressEvents) {
            this.dispatchTypedEvent("promptsChange", this.prompts);
        }
        return {
            prompts,
            nextCursor: response.nextCursor,
        };
    }
    /**
     * List all available prompts (fetches all pages)
     * @param metadata Optional metadata to include in the request
     * @returns Array of all prompts
     */
    async listAllPrompts(metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            // Store current prompt names before fetching
            const currentNames = new Set(this.prompts.map((p) => p.name));
            // Fetch all pages (suppress events during pagination)
            let cursor;
            let pageCount = 0;
            do {
                const result = await this.listPrompts(cursor, metadata, true);
                cursor = result.nextCursor;
                pageCount++;
                if (pageCount >= MAX_PAGES) {
                    throw new Error(`Maximum pagination limit (${MAX_PAGES} pages) reached while listing prompts`);
                }
            } while (cursor);
            // Find removed prompt names by comparing with current prompts
            const newNames = new Set(this.prompts.map((p) => p.name));
            // Clear cache for removed prompts
            for (const name of currentNames) {
                if (!newNames.has(name)) {
                    this.cacheInternal.clearPrompt(name);
                }
            }
            // Dispatch final change event (listPrompts calls were suppressed)
            this.dispatchTypedEvent("promptsChange", this.prompts);
            // Note: Cached content for existing prompts is automatically preserved
            return this.prompts;
        }
        catch (error) {
            throw new Error(`Failed to list all prompts: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Get a prompt by name
     * @param name Prompt name
     * @param args Optional prompt arguments
     * @param metadata Optional metadata to include in the request
     * @returns Prompt content
     */
    async getPrompt(name, args, metadata) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        // Convert all arguments to strings for prompt arguments
        const stringArgs = args ? convertPromptArguments(args) : {};
        const params = {
            name,
            arguments: stringArgs,
        };
        if (metadata && Object.keys(metadata).length > 0) {
            params._meta = metadata;
        }
        const result = await this.client.getPrompt(params, this.getRequestOptions(metadata?.progressToken));
        const invocation = {
            result,
            timestamp: new Date(),
            name,
            params: Object.keys(stringArgs).length > 0 ? stringArgs : undefined,
            metadata,
        };
        // Store in cache
        this.cacheInternal.setPrompt(name, invocation);
        // Dispatch event
        this.dispatchTypedEvent("promptContentChange", {
            name,
            content: invocation,
            timestamp: invocation.timestamp,
        });
        return invocation;
    }
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
    async getCompletions(ref, argumentName, argumentValue, context, metadata) {
        if (!this.client) {
            return { values: [] };
        }
        try {
            const params = {
                ref,
                argument: {
                    name: argumentName,
                    value: argumentValue,
                },
            };
            if (context) {
                params.context = {
                    arguments: context,
                };
            }
            if (metadata && Object.keys(metadata).length > 0) {
                params._meta = metadata;
            }
            const response = await this.client.complete(params, this.getRequestOptions(metadata?.progressToken));
            return {
                values: response.completion.values || [],
                total: response.completion.total,
                hasMore: response.completion.hasMore,
            };
        }
        catch (error) {
            // Handle MethodNotFound gracefully (server doesn't support completions)
            if ((error instanceof McpError &&
                error.code === ErrorCode.MethodNotFound) ||
                (error instanceof Error &&
                    (error.message.includes("Method not found") ||
                        error.message.includes("does not support completions")))) {
                return { values: [] };
            }
            // Re-throw other errors
            throw new Error(`Failed to get completions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Fetch server info (capabilities, serverInfo, instructions) from cached initialize response
     * This does not send any additional MCP requests - it just reads cached data
     * Always called on connect
     */
    async fetchServerInfo() {
        if (!this.client) {
            return;
        }
        try {
            // Get server capabilities (cached from initialize response)
            this.capabilities = this.client.getServerCapabilities();
            this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
            // Get server info (name, version) and instructions (cached from initialize response)
            this.serverInfo = this.client.getServerVersion();
            this.instructions = this.client.getInstructions();
            this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
            if (this.instructions !== undefined) {
                this.dispatchTypedEvent("instructionsChange", this.instructions);
            }
        }
        catch (error) {
            // Ignore errors in fetching server info
        }
    }
    /**
     * Load all lists (tools, resources, prompts) by sending MCP requests.
     * Only runs when autoSyncLists is enabled.
     * listChanged auto-refresh is implemented via notification handlers in connect().
     */
    async loadAllLists() {
        if (!this.client) {
            return;
        }
        try {
            // Query resources, prompts, and tools based on capabilities
            // The list*() methods now handle state updates and event dispatching internally
            if (this.capabilities?.resources) {
                try {
                    await this.listAllResources();
                }
                catch (err) {
                    // Ignore errors, just leave empty
                    this.resources = [];
                    this.dispatchTypedEvent("resourcesChange", this.resources);
                }
                // Also fetch resource templates
                try {
                    await this.listAllResourceTemplates();
                }
                catch (err) {
                    // Ignore errors, just leave empty
                    this.resourceTemplates = [];
                    this.dispatchTypedEvent("resourceTemplatesChange", this.resourceTemplates);
                }
            }
            if (this.capabilities?.prompts) {
                try {
                    await this.listAllPrompts();
                }
                catch (err) {
                    // Ignore errors, just leave empty
                    this.prompts = [];
                    this.dispatchTypedEvent("promptsChange", this.prompts);
                }
            }
            if (this.capabilities?.tools) {
                try {
                    await this.listAllTools();
                }
                catch (err) {
                    // Ignore errors, just leave empty
                    this.tools = [];
                    this.dispatchTypedEvent("toolsChange", this.tools);
                }
            }
        }
        catch (error) {
            // Ignore errors in fetching server contents
        }
    }
    addMessage(entry) {
        if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
            // Remove oldest message
            this.messages.shift();
        }
        this.messages.push(entry);
        this.dispatchTypedEvent("message", entry);
        this.dispatchTypedEvent("messagesChange");
    }
    updateMessageResponse(requestEntry, response) {
        const duration = Date.now() - requestEntry.timestamp.getTime();
        // Update the entry in place (mutate the object directly)
        requestEntry.response = response;
        requestEntry.duration = duration;
        this.dispatchTypedEvent("message", requestEntry);
        this.dispatchTypedEvent("messagesChange");
    }
    addStderrLog(entry) {
        if (this.maxStderrLogEvents > 0 &&
            this.stderrLogs.length >= this.maxStderrLogEvents) {
            // Remove oldest stderr log
            this.stderrLogs.shift();
        }
        this.stderrLogs.push(entry);
        this.dispatchTypedEvent("stderrLog", entry);
        this.dispatchTypedEvent("stderrLogsChange");
    }
    addFetchRequest(entry) {
        this.logger.info({
            component: "InspectorClient",
            category: entry.category,
            fetchRequest: {
                url: entry.url,
                method: entry.method,
                headers: entry.requestHeaders,
                body: entry.requestBody ?? "[no body]",
            },
            fetchResponse: entry.error
                ? { error: entry.error }
                : {
                    status: entry.responseStatus,
                    statusText: entry.responseStatusText,
                    headers: entry.responseHeaders,
                    body: entry.responseBody,
                },
        }, `${entry.category} fetch`);
        if (this.maxFetchRequests > 0 &&
            this.fetchRequests.length >= this.maxFetchRequests) {
            // Remove oldest fetch request
            this.fetchRequests.shift();
        }
        this.fetchRequests.push(entry);
        this.dispatchTypedEvent("fetchRequest", entry);
        this.dispatchTypedEvent("fetchRequestsChange");
    }
    /**
     * Get all fetch requests
     */
    getFetchRequests() {
        return [...this.fetchRequests];
    }
    /**
     * Get current session ID (from OAuth state authId)
     */
    getSessionId() {
        return this.sessionId;
    }
    /**
     * Set session ID (typically extracted from OAuth state)
     */
    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }
    /**
     * Save current session state to storage
     */
    async saveSession() {
        if (!this.sessionStorage || !this.sessionId) {
            return;
        }
        const state = {
            fetchRequests: [...this.fetchRequests], // Copy array, timestamps will be serialized by storage
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        try {
            await this.sessionStorage.saveSession(this.sessionId, state);
            this.logger.debug({
                sessionId: this.sessionId,
                fetchRequestCount: this.fetchRequests.length,
            }, "Session state saved");
        }
        catch (error) {
            this.logger.warn({
                sessionId: this.sessionId,
                error: error instanceof Error ? error.message : String(error),
            }, "Failed to save session state");
        }
    }
    /**
     * Restore session state from storage
     */
    async restoreSession() {
        if (!this.sessionStorage || !this.sessionId) {
            return;
        }
        try {
            const state = await this.sessionStorage.loadSession(this.sessionId);
            if (!state) {
                return;
            }
            // Restore fetch requests (convert timestamp strings back to Date objects)
            if (state.fetchRequests && state.fetchRequests.length > 0) {
                this.fetchRequests = state.fetchRequests.map((req) => ({
                    ...req,
                    timestamp: req.timestamp instanceof Date
                        ? req.timestamp
                        : typeof req.timestamp === "string"
                            ? new Date(req.timestamp)
                            : new Date(req.timestamp),
                }));
                this.dispatchTypedEvent("fetchRequestsChange");
                this.logger.debug({
                    sessionId: this.sessionId,
                    fetchRequestCount: this.fetchRequests.length,
                }, "Session state restored");
            }
        }
        catch (error) {
            this.logger.warn({
                sessionId: this.sessionId,
                error: error instanceof Error ? error.message : String(error),
            }, "Failed to restore session state");
        }
    }
    /**
     * Get current roots
     */
    getRoots() {
        return this.roots !== undefined ? [...this.roots] : [];
    }
    /**
     * Set roots and notify server if it supports roots/listChanged
     * Note: This will enable roots capability if it wasn't already enabled
     */
    async setRoots(roots) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        // Enable roots capability if not already enabled
        if (this.roots === undefined) {
            this.roots = [];
        }
        this.roots = [...roots];
        this.dispatchTypedEvent("rootsChange", this.roots);
        // Send notification to server - clients can send this notification to any server
        // The server doesn't need to advertise support for it
        try {
            await this.client.notification({
                method: "notifications/roots/list_changed",
            });
        }
        catch (error) {
            // Log but don't throw - roots were updated locally even if notification failed
            console.error("Failed to send roots/list_changed notification:", error);
        }
    }
    /**
     * Get list of currently subscribed resource URIs
     */
    getSubscribedResources() {
        return Array.from(this.subscribedResources);
    }
    /**
     * Check if a resource is currently subscribed
     */
    isSubscribedToResource(uri) {
        return this.subscribedResources.has(uri);
    }
    /**
     * Check if the server supports resource subscriptions
     */
    supportsResourceSubscriptions() {
        return this.capabilities?.resources?.subscribe === true;
    }
    /**
     * Subscribe to a resource to receive update notifications
     * @param uri - The URI of the resource to subscribe to
     * @throws Error if client is not connected or server doesn't support subscriptions
     */
    async subscribeToResource(uri) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        if (!this.supportsResourceSubscriptions()) {
            throw new Error("Server does not support resource subscriptions");
        }
        try {
            await this.client.subscribeResource({ uri }, this.getRequestOptions());
            this.subscribedResources.add(uri);
            this.dispatchTypedEvent("resourceSubscriptionsChange", Array.from(this.subscribedResources));
        }
        catch (error) {
            throw new Error(`Failed to subscribe to resource: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Unsubscribe from a resource
     * @param uri - The URI of the resource to unsubscribe from
     * @throws Error if client is not connected
     */
    async unsubscribeFromResource(uri) {
        if (!this.client) {
            throw new Error("Client is not connected");
        }
        try {
            await this.client.unsubscribeResource({ uri }, this.getRequestOptions());
            this.subscribedResources.delete(uri);
            this.dispatchTypedEvent("resourceSubscriptionsChange", Array.from(this.subscribedResources));
        }
        catch (error) {
            throw new Error(`Failed to unsubscribe from resource: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // ============================================================================
    // OAuth Support
    // ============================================================================
    /**
     * Get server URL from transport config (full URL including path, for OAuth discovery)
     */
    getServerUrl() {
        if (this.transportConfig.type === "sse" ||
            this.transportConfig.type === "streamable-http") {
            return this.transportConfig.url;
        }
        // Stdio transports don't have a URL - OAuth not applicable
        throw new Error("OAuth is only supported for HTTP-based transports (SSE, streamable-http)");
    }
    /**
     * Set OAuth configuration
     */
    setOAuthConfig(config) {
        if (!this.oauthConfig) {
            throw new Error("OAuth config must be set at creation. Pass oauth in constructor.");
        }
        this.oauthConfig = {
            ...this.oauthConfig,
            ...config,
        };
    }
    /**
     * Create and initialize an OAuth provider for the specified mode
     */
    async createOAuthProvider(mode) {
        if (!this.oauthConfig) {
            throw new Error("OAuth not configured. Call setOAuthConfig() first.");
        }
        if (!this.oauthConfig.storage ||
            !this.oauthConfig.redirectUrlProvider ||
            !this.oauthConfig.navigation) {
            throw new Error("OAuth environment components (storage, navigation, redirectUrlProvider) are required.");
        }
        const serverUrl = this.getServerUrl();
        const provider = new BaseOAuthClientProvider(serverUrl, {
            storage: this.oauthConfig.storage,
            redirectUrlProvider: this.oauthConfig.redirectUrlProvider,
            navigation: this.oauthConfig.navigation,
            clientMetadataUrl: this.oauthConfig.clientMetadataUrl,
        }, mode);
        // Set event target for event dispatch
        provider.setEventTarget(this);
        // Set scope if provided
        if (this.oauthConfig.scope) {
            await provider.saveScope(this.oauthConfig.scope);
        }
        // Save preregistered client info if provided (static client from config)
        if (this.oauthConfig.clientId) {
            const clientInfo = {
                client_id: this.oauthConfig.clientId,
                ...(this.oauthConfig.clientSecret && {
                    client_secret: this.oauthConfig.clientSecret,
                }),
            };
            await provider.savePreregisteredClientInformation(clientInfo);
        }
        return provider;
    }
    /**
     * Initiates OAuth flow using SDK's auth() function (normal mode)
     * Can be called directly by user or automatically triggered by 401 errors
     */
    async authenticate() {
        if (!this.oauthConfig) {
            throw new Error("OAuth not configured. Call setOAuthConfig() first.");
        }
        const provider = await this.createOAuthProvider("normal");
        const serverUrl = this.getServerUrl();
        // Clear any previously captured URL
        provider.clearCapturedAuthUrl();
        // Use SDK's auth() function - it handles client resolution, token refresh, etc.
        const result = await auth(provider, {
            serverUrl,
            scope: provider.scope,
            fetchFn: this.effectiveAuthFetch,
        });
        if (result === "AUTHORIZED") {
            // Tokens were refreshed, no authorization URL needed
            throw new Error("Unexpected: auth() returned AUTHORIZED without authorization code");
        }
        // Get the captured URL from the provider (set in redirectToAuthorization)
        const capturedUrl = provider.getCapturedAuthUrl();
        if (!capturedUrl) {
            throw new Error("Failed to capture authorization URL");
        }
        // Extract sessionId from OAuth state parameter in authorization URL
        const stateParam = capturedUrl.searchParams.get("state");
        if (stateParam) {
            const parsedState = parseOAuthState(stateParam);
            if (parsedState?.authId) {
                this.sessionId = parsedState.authId;
                // Save session before navigation
                await this.saveSession();
            }
        }
        // Backfill oauthState so getOAuthState() returns consistent shape (normal flow)
        const clientInfo = await provider.clientInformation();
        this.oauthState = {
            ...EMPTY_GUIDED_STATE,
            authType: "normal",
            oauthStep: "authorization_code",
            authorizationUrl: capturedUrl,
            oauthClientInfo: clientInfo ?? null,
        };
        return capturedUrl;
    }
    /**
     * Starts guided OAuth flow (step-by-step). Runs only the first step.
     * Use proceedOAuthStep() to advance. When oauthStep is "authorization_code",
     * set authorizationCode and call proceedOAuthStep() to complete.
     */
    async beginGuidedAuth() {
        if (!this.oauthConfig) {
            throw new Error("OAuth not configured. Call setOAuthConfig() first.");
        }
        const provider = await this.createOAuthProvider("guided");
        const serverUrl = this.getServerUrl();
        this.oauthState = { ...EMPTY_GUIDED_STATE };
        if (this.oauthConfig.clientId) {
            this.oauthState.oauthClientInfo = {
                client_id: this.oauthConfig.clientId,
                ...(this.oauthConfig.clientSecret && {
                    client_secret: this.oauthConfig.clientSecret,
                }),
            };
        }
        this.oauthStateMachine = new OAuthStateMachine(serverUrl, provider, (updates) => {
            const state = this.oauthState;
            if (!state)
                throw new Error("OAuth state not initialized");
            const previousStep = state.oauthStep;
            this.oauthState = { ...state, ...updates };
            if (updates.oauthStep === "complete") {
                this.oauthState.completedAt = Date.now();
            }
            const step = updates.oauthStep ?? previousStep;
            this.dispatchTypedEvent("oauthStepChange", {
                step,
                previousStep,
                state: updates,
            });
        }, this.effectiveAuthFetch);
        await this.oauthStateMachine.executeStep(this.oauthState);
    }
    /**
     * Runs guided OAuth flow to completion. If already started (via beginGuidedAuth),
     * continues from current step. Otherwise initializes and runs from the start.
     * Returns the authorization URL when user must authorize, or undefined if already complete.
     */
    async runGuidedAuth() {
        if (!this.oauthConfig) {
            throw new Error("OAuth not configured. Call setOAuthConfig() first.");
        }
        if (!this.oauthStateMachine || !this.oauthState) {
            await this.beginGuidedAuth();
        }
        const machine = this.oauthStateMachine;
        if (!machine) {
            throw new Error("Guided auth failed to initialize state");
        }
        while (true) {
            const state = this.oauthState;
            if (!state) {
                throw new Error("Guided auth failed to initialize state");
            }
            if (state.oauthStep === "authorization_code" ||
                state.oauthStep === "complete") {
                break;
            }
            await machine.executeStep(state);
        }
        const state = this.oauthState;
        if (state?.oauthStep === "complete") {
            return undefined;
        }
        if (!state?.authorizationUrl) {
            throw new Error("Failed to generate authorization URL");
        }
        // Extract sessionId from OAuth state parameter in authorization URL
        const stateParam = state.authorizationUrl.searchParams.get("state");
        if (stateParam) {
            const parsedState = parseOAuthState(stateParam);
            if (parsedState?.authId) {
                this.sessionId = parsedState.authId;
                // Save session before navigation
                await this.saveSession();
            }
        }
        this.dispatchTypedEvent("oauthAuthorizationRequired", {
            url: state.authorizationUrl,
        });
        return state.authorizationUrl;
    }
    /**
     * Set authorization code for guided OAuth flow.
     * Validates that the client is in guided OAuth mode (has active state machine).
     * @param authorizationCode The authorization code from the OAuth callback
     * @param completeFlow If true, automatically proceed through all remaining steps to completion.
     *                     If false, only set the code and wait for manual progression via proceedOAuthStep().
     *                     Defaults to false for manual step-by-step control.
     * @throws Error if not in guided OAuth flow or not at authorization_code step
     */
    async setGuidedAuthorizationCode(authorizationCode, completeFlow = false) {
        if (!this.oauthStateMachine || !this.oauthState) {
            throw new Error("Not in guided OAuth flow. Call beginGuidedAuth() first.");
        }
        const currentStep = this.oauthState.oauthStep;
        if (currentStep !== "authorization_code") {
            throw new Error(`Cannot set authorization code at step ${currentStep}. Expected step: authorization_code`);
        }
        this.oauthState.authorizationCode = authorizationCode;
        if (completeFlow) {
            // Execute current step (authorization_code -> token_request)
            await this.oauthStateMachine.executeStep(this.oauthState);
            // Continue through remaining steps until complete
            // TypeScript doesn't track that executeStep mutates oauthState.oauthStep,
            // so we use a type assertion to acknowledge the step changes dynamically
            let step = this.oauthState.oauthStep;
            while (step !== "complete") {
                await this.oauthStateMachine.executeStep(this.oauthState);
                step = this.oauthState.oauthStep;
            }
            if (!this.oauthState.oauthTokens) {
                throw new Error("Failed to exchange authorization code for tokens");
            }
            this.dispatchTypedEvent("oauthComplete", {
                tokens: this.oauthState.oauthTokens,
            });
        }
        else {
            // Manual mode: dispatch event to notify listeners that code was set
            // (step transitions will happen when user calls proceedOAuthStep())
            this.dispatchTypedEvent("oauthStepChange", {
                step: this.oauthState.oauthStep,
                previousStep: this.oauthState.oauthStep,
                state: { authorizationCode },
            });
        }
    }
    /**
     * Completes OAuth flow with authorization code.
     * For guided mode, this calls setGuidedAuthorizationCode(code, true) internally.
     * For normal mode, uses SDK auth() directly.
     */
    async completeOAuthFlow(authorizationCode) {
        if (!this.oauthConfig) {
            throw new Error("OAuth not configured. Call setOAuthConfig() first.");
        }
        try {
            if (this.oauthStateMachine && this.oauthState) {
                // Guided mode - use setGuidedAuthorizationCode with completeFlow=true
                await this.setGuidedAuthorizationCode(authorizationCode, true);
            }
            else {
                // Normal mode - use SDK auth() with authorization code
                const provider = await this.createOAuthProvider("normal");
                const serverUrl = this.getServerUrl();
                const result = await auth(provider, {
                    serverUrl,
                    authorizationCode,
                    fetchFn: this.effectiveAuthFetch,
                });
                if (result !== "AUTHORIZED") {
                    throw new Error(`Expected AUTHORIZED after providing authorization code, got: ${result}`);
                }
                const tokens = await provider.tokens();
                if (!tokens) {
                    throw new Error("Failed to retrieve tokens after authorization");
                }
                const clientInfo = await provider.clientInformation();
                const completedAt = Date.now();
                this.oauthState = this.oauthState
                    ? {
                        ...this.oauthState,
                        oauthStep: "complete",
                        oauthTokens: tokens,
                        oauthClientInfo: clientInfo ?? null,
                        completedAt,
                    }
                    : {
                        ...EMPTY_GUIDED_STATE,
                        authType: "normal",
                        oauthStep: "complete",
                        oauthTokens: tokens,
                        oauthClientInfo: clientInfo ?? null,
                        completedAt,
                    };
                this.dispatchTypedEvent("oauthComplete", {
                    tokens,
                });
            }
        }
        catch (error) {
            this.dispatchTypedEvent("oauthError", {
                error: error instanceof Error ? error : new Error(String(error)),
            });
            throw error;
        }
    }
    /**
     * Gets current OAuth tokens (if authorized)
     */
    async getOAuthTokens() {
        if (!this.oauthConfig) {
            return undefined;
        }
        // Return tokens from state machine if in guided mode
        if (this.oauthState?.oauthTokens) {
            return this.oauthState.oauthTokens;
        }
        // Otherwise get from provider storage
        const provider = await this.createOAuthProvider("normal");
        try {
            return await provider.tokens();
        }
        catch {
            return undefined;
        }
    }
    /**
     * Clears OAuth tokens and client information
     */
    clearOAuthTokens() {
        if (!this.oauthConfig?.storage) {
            return;
        }
        const serverUrl = this.getServerUrl();
        this.oauthConfig.storage.clear(serverUrl);
        this.oauthState = null;
        this.oauthStateMachine = null;
    }
    /**
     * Checks if client is currently OAuth authorized
     */
    async isOAuthAuthorized() {
        const tokens = await this.getOAuthTokens();
        return tokens !== undefined;
    }
    /**
     * Get current OAuth state machine state (for guided mode)
     */
    getOAuthState() {
        return this.oauthState ? { ...this.oauthState } : undefined;
    }
    /**
     * Get current OAuth step (for guided mode)
     */
    getOAuthStep() {
        return this.oauthState?.oauthStep;
    }
    /**
     * Manually progress to next step in guided OAuth flow
     */
    async proceedOAuthStep() {
        if (!this.oauthStateMachine || !this.oauthState) {
            throw new Error("Not in guided OAuth flow. Call authenticateGuided() first.");
        }
        await this.oauthStateMachine.executeStep(this.oauthState);
    }
}
//# sourceMappingURL=inspectorClient.js.map