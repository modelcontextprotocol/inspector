#!/usr/bin/env node

// src/index.ts
import { resolve as resolve3 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/cli.ts
import { dirname as dirname2, join as join2 } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Command } from "commander";

// src/error-handler.ts
function formatError(error) {
  let message;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = "Unknown error";
  }
  return message;
}
function handleError(error) {
  const errorMessage = formatError(error);
  console.error(errorMessage);
  process.exit(1);
}

// src/utils/awaitable-log.ts
function awaitableLog(logValue) {
  return new Promise((resolve4) => {
    process.stdout.write(logValue, () => {
      resolve4();
    });
  });
}

// ../../core/mcp/types.ts
var DEFAULT_TASK_TTL_MS = 6e4;

// ../../core/mcp/inspectorClient.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// ../../core/mcp/config.ts
function getServerType(config) {
  if (!("type" in config) || config.type === void 0) {
    return "stdio";
  }
  const type = config.type;
  if (type === "stdio") {
    return "stdio";
  }
  if (type === "sse") {
    return "sse";
  }
  if (type === "streamable-http") {
    return "streamable-http";
  }
  throw new Error(
    `Invalid server type: ${type}. Valid types are: stdio, sse, streamable-http`
  );
}

// ../../core/mcp/messageTrackingTransport.ts
var MessageTrackingTransport = class {
  baseTransport;
  callbacks;
  negotiatedProtocolVersion;
  constructor(baseTransport, callbacks) {
    this.baseTransport = baseTransport;
    this.callbacks = callbacks;
  }
  async start() {
    return this.baseTransport.start();
  }
  async send(message, options) {
    if ("id" in message && message.id !== null && message.id !== void 0) {
      if ("result" in message || "error" in message) {
        this.callbacks.trackResponse?.(
          message,
          "client"
        );
      } else if ("method" in message) {
        this.callbacks.trackRequest?.(message, "client");
      }
    } else if ("method" in message) {
      this.callbacks.trackNotification?.(
        message,
        "client"
      );
    }
    return this.baseTransport.send(message, options);
  }
  async close() {
    return this.baseTransport.close();
  }
  get onclose() {
    return this.baseTransport.onclose;
  }
  set onclose(handler) {
    this.baseTransport.onclose = handler;
  }
  get onerror() {
    return this.baseTransport.onerror;
  }
  set onerror(handler) {
    this.baseTransport.onerror = handler;
  }
  get onmessage() {
    return this.baseTransport.onmessage;
  }
  set onmessage(handler) {
    if (handler) {
      this.baseTransport.onmessage = (message, extra) => {
        if ("id" in message && message.id !== null && message.id !== void 0) {
          if ("result" in message || "error" in message) {
            this.callbacks.trackResponse?.(
              message,
              "server"
            );
          } else if ("method" in message) {
            this.callbacks.trackRequest?.(message, "server");
          }
        } else if ("method" in message) {
          this.callbacks.trackNotification?.(
            message,
            "server"
          );
        }
        handler(message, extra);
      };
    } else {
      this.baseTransport.onmessage = void 0;
    }
  }
  get sessionId() {
    return this.baseTransport.sessionId;
  }
  // Implemented as a concrete method (rather than delegating the base
  // transport's optional `setProtocolVersion`) so the SDK Client always
  // invokes it after the initialize handshake — including for stdio, whose
  // base transport has no `setProtocolVersion`. We capture the negotiated
  // version for the UI here, then forward to the base transport when it
  // cares (HTTP transports stamp it into subsequent request headers).
  setProtocolVersion(version) {
    this.negotiatedProtocolVersion = version;
    this.baseTransport.setProtocolVersion?.(version);
  }
  /** MCP protocol version negotiated during initialize, once connected. */
  get protocolVersion() {
    return this.negotiatedProtocolVersion;
  }
};

// ../../core/mcp/inspectorClient.ts
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  EmptyResultSchema,
  ListRootsRequestSchema,
  ElicitationCompleteNotificationSchema,
  RootsListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  CallToolResultSchema,
  McpError as McpError2,
  ErrorCode as ErrorCode2,
  ListTasksRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  CancelTaskRequestSchema,
  TaskStatusNotificationSchema
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

// ../../core/mcp/toolOutputValidation.ts
function validateToolOutput(provider, tool, result) {
  if (!tool.outputSchema) return void 0;
  const structured = result.structuredContent;
  if (structured == null) {
    return result.isError ? void 0 : `Tool "${tool.name}" declares an output schema but returned no structured content`;
  }
  try {
    const validate = provider.getValidator(
      tool.outputSchema
    );
    const validation = validate(structured);
    return validation.valid ? void 0 : validation.errorMessage;
  } catch {
    return void 0;
  }
}

// ../../core/mcp/taskNotificationSchemas.ts
import { NotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
var TasksListChangedNotificationSchema = NotificationSchema.extend({
  method: z.literal("notifications/tasks/list_changed"),
  params: z.record(z.string(), z.unknown()).optional()
});

// ../../core/json/jsonUtils.ts
function convertParameterValue(value, schema) {
  if (!value) {
    return value;
  }
  if (schema.type === "number" || schema.type === "integer") {
    return Number(value);
  }
  if (schema.type === "boolean") {
    return value.toLowerCase() === "true";
  }
  if (schema.type === "object" || schema.type === "array") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
function convertToolParameters(tool, params) {
  const result = {};
  const properties = tool.inputSchema?.properties || {};
  for (const [key, value] of Object.entries(params)) {
    const paramSchema = properties[key];
    if (paramSchema) {
      result[key] = convertParameterValue(value, paramSchema);
    } else {
      result[key] = value;
    }
  }
  return result;
}
function convertPromptArguments(args) {
  const stringArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      stringArgs[key] = value;
    } else if (value === null || value === void 0) {
      stringArgs[key] = String(value);
    } else {
      stringArgs[key] = JSON.stringify(value);
    }
  }
  return stringArgs;
}

// ../../core/mcp/inspectorClient.ts
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";

// ../../core/mcp/typedEventTarget.ts
var TypedEventGeneric = class extends CustomEvent {
  constructor(type, detail) {
    super(type, { detail });
  }
};
var TypedEventTarget = class extends EventTarget {
  dispatchTypedEvent(type, ...args) {
    const detail = args[0] ?? void 0;
    this.dispatchEvent(new TypedEventGeneric(type, detail));
  }
  addEventListener(type, listener, options) {
    super.addEventListener(
      type,
      listener,
      options
    );
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(
      type,
      listener,
      options
    );
  }
};

// ../../core/mcp/inspectorClientEventTarget.ts
var InspectorClientEventTarget = class extends TypedEventTarget {
};

// ../../core/mcp/samplingCreateMessage.ts
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";
var SamplingCreateMessage = class {
  id;
  timestamp;
  request;
  taskId;
  resolvePromise;
  rejectPromise;
  onRemove;
  constructor(request, resolve4, reject, onRemove) {
    this.onRemove = onRemove;
    this.id = `sampling-${crypto.randomUUID()}`;
    this.timestamp = /* @__PURE__ */ new Date();
    this.request = request;
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY];
    this.taskId = relatedTask?.taskId;
    this.resolvePromise = resolve4;
    this.rejectPromise = reject;
  }
  /**
   * Respond to the sampling request with a result
   */
  async respond(result) {
    if (!this.resolvePromise) {
      throw new Error("Request already resolved or rejected");
    }
    this.resolvePromise(result);
    this.resolvePromise = void 0;
    this.rejectPromise = void 0;
    this.remove();
  }
  /**
   * Reject the sampling request with an error
   */
  async reject(error) {
    if (!this.rejectPromise) {
      throw new Error("Request already resolved or rejected");
    }
    this.rejectPromise(error);
    this.resolvePromise = void 0;
    this.rejectPromise = void 0;
    this.remove();
  }
  /**
   * Remove this pending sample from the list
   */
  remove() {
    this.onRemove(this.id);
  }
};

// ../../core/mcp/elicitationCreateMessage.ts
import { RELATED_TASK_META_KEY as RELATED_TASK_META_KEY2 } from "@modelcontextprotocol/sdk/types.js";
var ElicitationCreateMessage = class {
  id;
  timestamp;
  request;
  taskId;
  resolvePromise;
  /** Set only for task-augmented elicit; used when user declines so server's tasks/result receives an error */
  rejectCallback;
  onRemove;
  constructor(request, resolve4, onRemove, reject) {
    this.onRemove = onRemove;
    this.id = `elicitation-${crypto.randomUUID()}`;
    this.timestamp = /* @__PURE__ */ new Date();
    this.request = request;
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY2];
    this.taskId = relatedTask?.taskId;
    this.resolvePromise = resolve4;
    this.rejectCallback = reject;
  }
  /**
   * Reject the elicitation (e.g. when user declines). Only has effect when this
   * request was task-augmented; then the server's tasks/result will receive the error.
   */
  reject(error) {
    if (this.rejectCallback) {
      this.rejectCallback(error);
      this.rejectCallback = void 0;
    }
  }
  /**
   * Respond to the elicitation request with a result
   */
  async respond(result) {
    if (!this.resolvePromise) {
      throw new Error("Request already resolved");
    }
    this.resolvePromise(result);
    this.resolvePromise = void 0;
    this.remove();
  }
  /**
   * Resolve this elicitation as accepted, but only if it is still pending.
   *
   * Used by the URL-mode `notifications/elicitation/complete` handler to
   * auto-advance an open URL elicitation when the server signals the
   * out-of-band flow finished. It is a no-op once the user has already
   * responded — that guard (plus the modal's own once-guard) keeps `respond()`
   * from throwing its "already resolved" error on a race between the manual
   * "I've completed it" click and the server's completion notification.
   */
  completeIfPending() {
    if (this.resolvePromise) {
      void this.respond({ action: "accept" });
    }
  }
  /**
   * Settle a still-pending elicitation as cancelled, without removing it from
   * the queue. Used by `disconnect()` teardown so an awaiting caller — notably
   * the error-path `awaitUrlElicitation` that blocks `callTool` — doesn't hang
   * forever when the pending queue is dropped wholesale. No-op once already
   * resolved; deliberately does not call `onRemove` (the caller clears the
   * queue itself, so we must not splice it mid-iteration).
   */
  cancel() {
    if (this.resolvePromise) {
      this.resolvePromise({ action: "cancel" });
      this.resolvePromise = void 0;
    }
    this.rejectCallback = void 0;
  }
  /**
   * Remove this pending elicitation from the list
   */
  remove() {
    this.onRemove(this.id);
  }
};

// ../../core/mcp/urlElicitation.ts
import {
  ErrorCode,
  McpError,
  UrlElicitationRequiredError
} from "@modelcontextprotocol/sdk/types.js";
var UrlElicitationLoopError = class extends Error {
  /** The URL the server repeated. */
  url;
  constructor(url) {
    super(
      `The server asked for the same URL elicitation again (${url}); cancelling the call to avoid a loop.`
    );
    this.name = "UrlElicitationLoopError";
    this.url = url;
  }
};
function getUrlElicitationsFromError(error) {
  if (error instanceof UrlElicitationRequiredError) {
    return error.elicitations ?? [];
  }
  if (error instanceof McpError && error.code === ErrorCode.UrlElicitationRequired) {
    const data = error.data;
    return data?.elicitations ?? [];
  }
  return null;
}

// ../../core/logging/logger.ts
var noop = () => {
};
function createSilentLogger() {
  const logger = {
    level: "silent",
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    child: () => logger
  };
  return logger;
}
var silentLogger = createSilentLogger();

// ../../core/mcp/fetchTracking.ts
function isLongLivedStreamResponse(method, contentType) {
  if (method !== "GET") return false;
  if (!contentType) return false;
  return contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson");
}
function createFetchTracker(baseFetch, callbacks) {
  return async (input, init) => {
    const startTime = Date.now();
    const timestamp = /* @__PURE__ */ new Date();
    const id = `${timestamp.getTime()}-${Math.random().toString(36).slice(2, 11)}`;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || "GET";
    const requestHeaders = {};
    if (input instanceof Request) {
      input.headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }
    if (init?.headers) {
      const headers = new Headers(init.headers);
      headers.forEach((value, key) => {
        requestHeaders[key] = value;
      });
    }
    let requestBody;
    if (init?.body) {
      if (typeof init.body === "string") {
        requestBody = init.body;
      } else {
        try {
          requestBody = String(init.body);
        } catch {
          requestBody = void 0;
        }
      }
    } else if (input instanceof Request && input.body) {
      try {
        const cloned = input.clone();
        requestBody = await cloned.text();
      } catch {
        requestBody = void 0;
      }
    }
    let response;
    let error;
    try {
      response = await baseFetch(input, init);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const entry2 = {
        id,
        timestamp,
        method,
        url,
        requestHeaders,
        requestBody,
        error,
        duration: Date.now() - startTime
      };
      callbacks.trackRequest?.(entry2);
      throw err;
    }
    const responseStatus = response.status;
    const responseStatusText = response.statusText;
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const isLongLivedStream = isLongLivedStreamResponse(
      method,
      response.headers.get("content-type")
    );
    const duration = Date.now() - startTime;
    const entry = {
      id,
      timestamp,
      method,
      url,
      requestHeaders,
      requestBody,
      responseStatus,
      responseStatusText,
      responseHeaders,
      responseBody: void 0,
      duration
    };
    callbacks.trackRequest?.(entry);
    if (!isLongLivedStream && response.body && !response.bodyUsed) {
      try {
        const cloned = response.clone();
        cloned.text().then((body) => {
          callbacks.updateResponseBody?.(id, body);
        }).catch(() => {
        });
      } catch {
      }
    }
    return response;
  };
}

// ../../core/auth/utils.ts
var generateOAuthState = () => {
  const array = new Uint8Array(32);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};
var generateOAuthStateWithMode = (mode) => {
  const authId = generateOAuthState();
  return `${mode}:${authId}`;
};
var parseOAuthState = (state) => {
  if (!state || typeof state !== "string") return null;
  if (state.startsWith("normal:")) {
    return { mode: "normal", authId: state.slice(7) };
  }
  if (state.startsWith("guided:")) {
    return { mode: "guided", authId: state.slice(7) };
  }
  if (/^[a-f0-9]{64}$/i.test(state)) {
    return { mode: "normal", authId: state };
  }
  return null;
};

// ../../core/auth/providers.ts
var BaseOAuthClientProvider = class {
  capturedAuthUrl = null;
  eventTarget = null;
  serverUrl;
  storage;
  redirectUrlProvider;
  navigation;
  clientMetadataUrl;
  mode;
  constructor(serverUrl, oauthConfig, mode = "normal") {
    this.serverUrl = serverUrl;
    this.storage = oauthConfig.storage;
    this.redirectUrlProvider = oauthConfig.redirectUrlProvider;
    this.navigation = oauthConfig.navigation;
    this.clientMetadataUrl = oauthConfig.clientMetadataUrl;
    this.mode = mode;
  }
  /**
   * Set the event target for dispatching oauthAuthorizationRequired events
   */
  setEventTarget(eventTarget) {
    this.eventTarget = eventTarget;
  }
  /**
   * Get the captured authorization URL (for return value)
   */
  getCapturedAuthUrl() {
    return this.capturedAuthUrl;
  }
  /**
   * Clear the captured authorization URL
   */
  clearCapturedAuthUrl() {
    this.capturedAuthUrl = null;
  }
  get scope() {
    return this.storage.getScope(this.serverUrl);
  }
  /** Redirect URL for the current flow (normal or guided). */
  get redirectUrl() {
    return this.redirectUrlProvider.getRedirectUrl(this.mode);
  }
  get redirect_uris() {
    return [this.redirectUrlProvider.getRedirectUrl("normal")];
  }
  get clientMetadata() {
    const metadata = {
      redirect_uris: this.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "MCP Inspector",
      client_uri: "https://github.com/modelcontextprotocol/inspector",
      scope: this.scope ?? ""
    };
    return metadata;
  }
  state() {
    return generateOAuthStateWithMode(this.mode);
  }
  async clientInformation() {
    const preregistered = await this.storage.getClientInformation(
      this.serverUrl,
      true
    );
    if (preregistered) {
      return preregistered;
    }
    return await this.storage.getClientInformation(this.serverUrl, false);
  }
  async saveClientInformation(clientInformation) {
    await this.storage.saveClientInformation(this.serverUrl, clientInformation);
  }
  async saveScope(scope) {
    await this.storage.saveScope(this.serverUrl, scope);
  }
  async savePreregisteredClientInformation(clientInformation) {
    await this.storage.savePreregisteredClientInformation(
      this.serverUrl,
      clientInformation
    );
  }
  async tokens() {
    return await this.storage.getTokens(this.serverUrl);
  }
  async saveTokens(tokens) {
    await this.storage.saveTokens(this.serverUrl, tokens);
  }
  redirectToAuthorization(authorizationUrl) {
    this.capturedAuthUrl = authorizationUrl;
    if (this.eventTarget) {
      this.eventTarget.dispatchEvent(
        new CustomEvent("oauthAuthorizationRequired", {
          detail: { url: authorizationUrl }
        })
      );
    }
    this.navigation.navigateToAuthorization(authorizationUrl);
  }
  async saveCodeVerifier(codeVerifier) {
    await this.storage.saveCodeVerifier(this.serverUrl, codeVerifier);
  }
  codeVerifier() {
    const verifier = this.storage.getCodeVerifier(this.serverUrl);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }
    return verifier;
  }
  clear() {
    this.storage.clear(this.serverUrl);
  }
  getServerMetadata() {
    return this.storage.getServerMetadata(this.serverUrl);
  }
  async saveServerMetadata(metadata) {
    await this.storage.saveServerMetadata(this.serverUrl, metadata);
  }
};

// ../../core/auth/types.ts
var EMPTY_GUIDED_STATE = {
  authType: "guided",
  completedAt: null,
  isInitiatingAuth: false,
  oauthTokens: null,
  oauthStep: "metadata_discovery",
  oauthMetadata: null,
  resourceMetadata: null,
  resourceMetadataError: null,
  resource: null,
  authServerUrl: null,
  oauthClientInfo: null,
  authorizationUrl: null,
  authorizationCode: "",
  latestError: null,
  statusMessage: null,
  validationError: null
};

// ../../core/auth/discovery.ts
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";
function getAuthorizationServerUrl(serverUrl, resourceMetadata) {
  const first = resourceMetadata?.authorization_servers?.[0];
  return first ? new URL(first) : new URL("/", serverUrl);
}
var discoverScopes = async (serverUrl, resourceMetadata, fetchFn) => {
  try {
    const authServerUrl = getAuthorizationServerUrl(
      serverUrl,
      resourceMetadata
    );
    const metadata = await discoverAuthorizationServerMetadata(authServerUrl, {
      fetchFn
    });
    const resourceScopes = resourceMetadata?.scopes_supported;
    const oauthScopes = metadata?.scopes_supported;
    const scopesSupported = resourceScopes && resourceScopes.length > 0 ? resourceScopes : oauthScopes;
    return scopesSupported && scopesSupported.length > 0 ? scopesSupported.join(" ") : void 0;
  } catch {
    return void 0;
  }
};

// ../../core/auth/state-machine.ts
import {
  discoverAuthorizationServerMetadata as discoverAuthorizationServerMetadata2,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  discoverOAuthProtectedResourceMetadata,
  selectResourceURL
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthMetadataSchema
} from "@modelcontextprotocol/sdk/shared/auth.js";
var oauthTransitions = {
  metadata_discovery: {
    canTransition: async () => true,
    execute: async (context) => {
      let resourceMetadata = null;
      let resourceMetadataError = null;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          context.serverUrl
        );
      } catch (e) {
        if (e instanceof Error) {
          resourceMetadataError = e;
        } else {
          resourceMetadataError = new Error(String(e));
        }
      }
      const authServerUrl = getAuthorizationServerUrl(
        context.serverUrl,
        resourceMetadata
      );
      const resource = resourceMetadata ? await selectResourceURL(
        context.serverUrl,
        context.provider,
        resourceMetadata
      ) : void 0;
      const metadata = await discoverAuthorizationServerMetadata2(
        authServerUrl,
        {
          ...context.fetchFn && { fetchFn: context.fetchFn }
        }
      );
      if (!metadata) {
        throw new Error("Failed to discover OAuth metadata");
      }
      const parsedMetadata = await OAuthMetadataSchema.parseAsync(metadata);
      await context.provider.saveServerMetadata(parsedMetadata);
      context.updateState({
        resourceMetadata,
        resource,
        resourceMetadataError,
        authServerUrl,
        oauthMetadata: parsedMetadata,
        oauthStep: "client_registration"
      });
    }
  },
  client_registration: {
    canTransition: async (context) => !!context.state.oauthMetadata,
    execute: async (context) => {
      const metadata = context.state.oauthMetadata;
      const clientMetadata = context.provider.clientMetadata;
      if (!context.provider.scope || context.provider.scope.trim() === "") {
        const scopesSupported = context.state.resourceMetadata?.scopes_supported || metadata.scopes_supported;
        if (scopesSupported) {
          clientMetadata.scope = scopesSupported.join(" ");
        }
      }
      let fullInformation = context.state.oauthClientInfo ?? await context.provider.clientInformation();
      if (!fullInformation) {
        const clientMetadataUrl = "clientMetadataUrl" in context.provider && context.provider.clientMetadataUrl ? context.provider.clientMetadataUrl : void 0;
        const supportsUrlBasedClientId = metadata?.client_id_metadata_document_supported === true;
        const shouldUseUrlBasedClientId = supportsUrlBasedClientId && clientMetadataUrl;
        if (shouldUseUrlBasedClientId) {
          fullInformation = {
            client_id: clientMetadataUrl
          };
        } else {
          fullInformation = await registerClient(context.serverUrl, {
            metadata,
            clientMetadata,
            ...context.fetchFn && { fetchFn: context.fetchFn }
          });
        }
        await context.provider.saveClientInformation(fullInformation);
      }
      context.updateState({
        oauthClientInfo: fullInformation,
        oauthStep: "authorization_redirect"
      });
    }
  },
  authorization_redirect: {
    canTransition: async (context) => !!context.state.oauthMetadata && !!context.state.oauthClientInfo,
    execute: async (context) => {
      const metadata = context.state.oauthMetadata;
      const clientInformation = context.state.oauthClientInfo;
      let scope = context.provider.scope;
      if (!scope || scope.trim() === "") {
        scope = await discoverScopes(
          context.serverUrl,
          context.state.resourceMetadata ?? void 0,
          context.fetchFn
        );
      }
      const providerState = context.provider.state();
      const state = await Promise.resolve(providerState);
      const { authorizationUrl, codeVerifier } = await startAuthorization(
        context.serverUrl,
        {
          metadata,
          clientInformation,
          redirectUrl: context.provider.redirectUrl,
          scope,
          state,
          resource: context.state.resource ?? void 0
        }
      );
      await context.provider.saveCodeVerifier(codeVerifier);
      context.updateState({
        authorizationUrl,
        oauthStep: "authorization_code"
      });
    }
  },
  authorization_code: {
    canTransition: async () => true,
    execute: async (context) => {
      if (!context.state.authorizationCode || context.state.authorizationCode.trim() === "") {
        context.updateState({
          validationError: "You need to provide an authorization code"
        });
        throw new Error("Authorization code required");
      }
      context.updateState({
        validationError: null,
        oauthStep: "token_request"
      });
    }
  },
  token_request: {
    canTransition: async (context) => {
      const hasMetadata = !!context.provider.getServerMetadata();
      const clientInfo = context.state.oauthClientInfo ?? await context.provider.clientInformation();
      return !!context.state.authorizationCode && hasMetadata && !!clientInfo;
    },
    execute: async (context) => {
      const codeVerifier = context.provider.codeVerifier();
      const metadata = context.provider.getServerMetadata();
      if (!metadata) {
        throw new Error("OAuth metadata not available");
      }
      const clientInformation = context.state.oauthClientInfo ?? await context.provider.clientInformation();
      if (!clientInformation) {
        throw new Error("Client information not available for token exchange");
      }
      const tokens = await exchangeAuthorization(context.serverUrl, {
        metadata,
        clientInformation,
        authorizationCode: context.state.authorizationCode,
        codeVerifier,
        redirectUri: context.provider.redirectUrl,
        resource: context.state.resource ? context.state.resource instanceof URL ? context.state.resource : new URL(context.state.resource) : void 0,
        ...context.fetchFn && { fetchFn: context.fetchFn }
      });
      await context.provider.saveTokens(tokens);
      context.updateState({
        oauthTokens: tokens,
        oauthStep: "complete"
      });
    }
  },
  complete: {
    canTransition: async () => false,
    execute: async () => {
    }
  }
};
var OAuthStateMachine = class {
  serverUrl;
  provider;
  updateState;
  fetchFn;
  constructor(serverUrl, provider, updateState, fetchFn) {
    this.serverUrl = serverUrl;
    this.provider = provider;
    this.updateState = updateState;
    this.fetchFn = fetchFn;
  }
  async executeStep(state) {
    const context = {
      state,
      serverUrl: this.serverUrl,
      provider: this.provider,
      updateState: this.updateState,
      ...this.fetchFn && { fetchFn: this.fetchFn }
    };
    const transition = oauthTransitions[state.oauthStep];
    if (!await transition.canTransition(context)) {
      throw new Error(`Cannot transition from ${state.oauthStep}`);
    }
    await transition.execute(context);
  }
};

// ../../core/mcp/oauthManager.ts
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
var OAuthManager = class {
  params;
  oauthConfig;
  oauthStateMachine = null;
  oauthState = null;
  constructor(params) {
    this.params = params;
    this.oauthConfig = { ...params.initialConfig };
  }
  setOAuthConfig(config) {
    this.oauthConfig = {
      ...this.oauthConfig,
      ...config
    };
  }
  getServerUrl() {
    return this.params.getServerUrl();
  }
  async createOAuthProvider(mode) {
    if (!this.oauthConfig.storage || !this.oauthConfig.redirectUrlProvider || !this.oauthConfig.navigation) {
      throw new Error(
        "OAuth environment components (storage, navigation, redirectUrlProvider) are required."
      );
    }
    const serverUrl = this.getServerUrl();
    const provider = new BaseOAuthClientProvider(
      serverUrl,
      {
        storage: this.oauthConfig.storage,
        redirectUrlProvider: this.oauthConfig.redirectUrlProvider,
        navigation: this.oauthConfig.navigation,
        clientMetadataUrl: this.oauthConfig.clientMetadataUrl
      },
      mode
    );
    provider.setEventTarget(this.params.getEventTarget());
    if (this.oauthConfig.scope) {
      await provider.saveScope(this.oauthConfig.scope);
    }
    if (this.oauthConfig.clientId) {
      const clientInfo = {
        client_id: this.oauthConfig.clientId,
        ...this.oauthConfig.clientSecret && {
          client_secret: this.oauthConfig.clientSecret
        }
      };
      await provider.savePreregisteredClientInformation(clientInfo);
    }
    return provider;
  }
  async authenticate() {
    const provider = await this.createOAuthProvider("normal");
    const serverUrl = this.getServerUrl();
    provider.clearCapturedAuthUrl();
    const result = await auth(provider, {
      serverUrl,
      scope: provider.scope,
      fetchFn: this.params.effectiveAuthFetch
    });
    if (result === "AUTHORIZED") {
      throw new Error(
        "Unexpected: auth() returned AUTHORIZED without authorization code"
      );
    }
    const capturedUrl = provider.getCapturedAuthUrl();
    if (!capturedUrl) {
      throw new Error("Failed to capture authorization URL");
    }
    const stateParam = capturedUrl.searchParams.get("state");
    if (stateParam && this.params.onBeforeOAuthRedirect) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        await this.params.onBeforeOAuthRedirect(parsedState.authId);
      }
    }
    const clientInfo = await provider.clientInformation();
    this.oauthState = {
      ...EMPTY_GUIDED_STATE,
      authType: "normal",
      oauthStep: "authorization_code",
      authorizationUrl: capturedUrl,
      oauthClientInfo: clientInfo ?? null
    };
    return capturedUrl;
  }
  async beginGuidedAuth() {
    const provider = await this.createOAuthProvider("guided");
    const serverUrl = this.getServerUrl();
    this.oauthState = { ...EMPTY_GUIDED_STATE };
    if (this.oauthConfig.clientId) {
      this.oauthState.oauthClientInfo = {
        client_id: this.oauthConfig.clientId,
        ...this.oauthConfig.clientSecret && {
          client_secret: this.oauthConfig.clientSecret
        }
      };
    }
    this.oauthStateMachine = new OAuthStateMachine(
      serverUrl,
      provider,
      (updates) => {
        const state = this.oauthState;
        if (!state) throw new Error("OAuth state not initialized");
        const previousStep = state.oauthStep;
        this.oauthState = { ...state, ...updates };
        if (updates.oauthStep === "complete") {
          this.oauthState.completedAt = Date.now();
        }
        const step = updates.oauthStep ?? previousStep;
        this.params.dispatchOAuthStepChange({
          step,
          previousStep,
          state: updates
        });
      },
      this.params.effectiveAuthFetch
    );
    await this.oauthStateMachine.executeStep(this.oauthState);
  }
  async runGuidedAuth() {
    if (!this.oauthStateMachine || !this.oauthState) {
      await this.beginGuidedAuth();
    }
    const machine = this.oauthStateMachine;
    if (!machine) {
      throw new Error("Guided auth failed to initialize state");
    }
    while (true) {
      const state2 = this.oauthState;
      if (!state2) {
        throw new Error("Guided auth failed to initialize state");
      }
      if (state2.oauthStep === "authorization_code" || state2.oauthStep === "complete") {
        break;
      }
      await machine.executeStep(state2);
    }
    const state = this.oauthState;
    if (state?.oauthStep === "complete") {
      return void 0;
    }
    if (!state?.authorizationUrl) {
      throw new Error("Failed to generate authorization URL");
    }
    const stateParam = state.authorizationUrl.searchParams.get("state");
    if (stateParam && this.params.onBeforeOAuthRedirect) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        await this.params.onBeforeOAuthRedirect(parsedState.authId);
      }
    }
    this.params.dispatchOAuthAuthorizationRequired({
      url: state.authorizationUrl
    });
    return state.authorizationUrl;
  }
  async setGuidedAuthorizationCode(authorizationCode, completeFlow = false) {
    if (!this.oauthStateMachine || !this.oauthState) {
      throw new Error(
        "Not in guided OAuth flow. Call beginGuidedAuth() first."
      );
    }
    const currentStep = this.oauthState.oauthStep;
    if (currentStep !== "authorization_code") {
      throw new Error(
        `Cannot set authorization code at step ${currentStep}. Expected step: authorization_code`
      );
    }
    this.oauthState.authorizationCode = authorizationCode;
    if (completeFlow) {
      await this.oauthStateMachine.executeStep(this.oauthState);
      let step = this.oauthState.oauthStep;
      while (step !== "complete") {
        await this.oauthStateMachine.executeStep(this.oauthState);
        step = this.oauthState.oauthStep;
      }
      if (!this.oauthState.oauthTokens) {
        throw new Error("Failed to exchange authorization code for tokens");
      }
      this.params.dispatchOAuthComplete({
        tokens: this.oauthState.oauthTokens
      });
    } else {
      this.params.dispatchOAuthStepChange({
        step: this.oauthState.oauthStep,
        previousStep: this.oauthState.oauthStep,
        state: { authorizationCode }
      });
    }
  }
  async completeOAuthFlow(authorizationCode) {
    try {
      if (this.oauthStateMachine && this.oauthState) {
        await this.setGuidedAuthorizationCode(authorizationCode, true);
      } else {
        const provider = await this.createOAuthProvider("normal");
        const serverUrl = this.getServerUrl();
        const result = await auth(provider, {
          serverUrl,
          authorizationCode,
          fetchFn: this.params.effectiveAuthFetch
        });
        if (result !== "AUTHORIZED") {
          throw new Error(
            `Expected AUTHORIZED after providing authorization code, got: ${result}`
          );
        }
        const tokens = await provider.tokens();
        if (!tokens) {
          throw new Error("Failed to retrieve tokens after authorization");
        }
        const clientInfo = await provider.clientInformation();
        const completedAt = Date.now();
        this.oauthState = this.oauthState ? {
          ...this.oauthState,
          oauthStep: "complete",
          oauthTokens: tokens,
          oauthClientInfo: clientInfo ?? null,
          completedAt
        } : {
          ...EMPTY_GUIDED_STATE,
          authType: "normal",
          oauthStep: "complete",
          oauthTokens: tokens,
          oauthClientInfo: clientInfo ?? null,
          completedAt
        };
        this.params.dispatchOAuthComplete({ tokens });
      }
    } catch (error) {
      this.params.dispatchOAuthError({
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }
  async getOAuthTokens() {
    if (this.oauthState?.oauthTokens) {
      return this.oauthState.oauthTokens;
    }
    const provider = await this.createOAuthProvider("normal");
    try {
      return await provider.tokens();
    } catch {
      return void 0;
    }
  }
  clearOAuthTokens() {
    if (!this.oauthConfig?.storage) {
      return;
    }
    const serverUrl = this.getServerUrl();
    this.oauthConfig.storage.clear(serverUrl);
    this.oauthState = null;
    this.oauthStateMachine = null;
  }
  async isOAuthAuthorized() {
    const tokens = await this.getOAuthTokens();
    return tokens !== void 0;
  }
  getOAuthState() {
    return this.oauthState ? { ...this.oauthState } : void 0;
  }
  getOAuthStep() {
    return this.oauthState?.oauthStep;
  }
  async proceedOAuthStep() {
    if (!this.oauthStateMachine || !this.oauthState) {
      throw new Error(
        "Not in guided OAuth flow. Call authenticateGuided() first."
      );
    }
    await this.oauthStateMachine.executeStep(this.oauthState);
  }
  /**
   * Create an OAuth provider for transport auth (connect()).
   * Used only when isHttpOAuthConfig() is true.
   */
  async createOAuthProviderForTransport() {
    return this.createOAuthProvider("normal");
  }
};

// ../../core/mcp/inspectorClient.ts
var corePackageJson = {
  name: "@modelcontextprotocol/inspector-core",
  version: "0.20.0"
};
var MAX_URL_ELICITATION_RETRIES = 5;
var InspectorClient = class _InspectorClient extends InspectorClientEventTarget {
  client = null;
  appRendererClientProxy = null;
  // Lazily-built validator used only on the skipOutputValidation path to detect
  // (non-fatally) when a delivered result violates the tool's outputSchema.
  outputValidator = null;
  transport = null;
  baseTransport = null;
  pipeStderr;
  initialLoggingLevel;
  sample;
  elicit;
  progress;
  resetTimeoutOnProgress;
  requestTimeout;
  defaultMetadata;
  serverSettings;
  status = "disconnected";
  // Server data (resources, resourceTemplates, prompts are in state managers)
  capabilities;
  serverInfo;
  instructions;
  protocolVersion;
  // The capabilities this Inspector client advertises to the server during the
  // initialize handshake. Built once in setupClient() and snapshotted here so
  // UI surfaces (Server Info modal) can display them without poking at the
  // SDK Client's private state.
  clientCapabilities = {};
  // Sampling requests
  pendingSamples = [];
  // Elicitation requests
  pendingElicitations = [];
  // Roots (undefined means roots capability not enabled, empty array means enabled but no roots)
  roots;
  // Content cache
  // ListChanged notification configuration
  listChangedNotifications;
  // Resource subscriptions
  subscribedResources = /* @__PURE__ */ new Set();
  // Receiver tasks (server-initiated: server sends createMessage/elicit with params.task, server polls us)
  receiverTasks;
  receiverTaskTtlMs;
  receiverTaskRecords = /* @__PURE__ */ new Map();
  // OAuth support (config owned by oauthManager; client delegates and uses !!oauthManager for "is OAuth configured")
  oauthManager = null;
  logger;
  transportClientFactory;
  fetchFn;
  effectiveAuthFetch;
  // Session ID (for OAuth state and saveSession event; persistence is in FetchRequestLogState)
  sessionId;
  transportConfig;
  constructor(transportConfig, options) {
    super();
    this.transportConfig = transportConfig;
    this.transportClientFactory = options.environment.transport;
    this.fetchFn = options.environment.fetch;
    this.logger = options.environment.logger ?? silentLogger;
    this.pipeStderr = options.pipeStderr ?? false;
    this.initialLoggingLevel = options.initialLoggingLevel;
    this.sample = options.sample ?? true;
    this.elicit = options.elicit ?? true;
    this.receiverTasks = options.receiverTasks ?? false;
    this.receiverTaskTtlMs = options.receiverTaskTtlMs ?? 6e4;
    this.progress = options.progress ?? true;
    this.resetTimeoutOnProgress = options.resetTimeoutOnProgress ?? true;
    this.requestTimeout = options.timeout;
    this.defaultMetadata = options.defaultMetadata && Object.keys(options.defaultMetadata).length > 0 ? options.defaultMetadata : void 0;
    this.serverSettings = options.serverSettings;
    this.roots = options.roots;
    this.listChangedNotifications = {
      tools: options.listChangedNotifications?.tools ?? true,
      resources: options.listChangedNotifications?.resources ?? true,
      prompts: options.listChangedNotifications?.prompts ?? true
    };
    this.effectiveAuthFetch = this.buildEffectiveAuthFetch();
    this.sessionId = options.sessionId;
    if (options.oauth || options.environment.oauth) {
      const oauthConfig = {
        // Environment components (storage, navigation, redirectUrlProvider)
        ...options.environment.oauth,
        // Config values (clientId, clientSecret, clientMetadataUrl, scope)
        ...options.oauth
      };
      this.oauthManager = new OAuthManager({
        getServerUrl: () => this.getServerUrl(),
        effectiveAuthFetch: this.effectiveAuthFetch,
        getEventTarget: () => this,
        onBeforeOAuthRedirect: (sessionId) => {
          this.sessionId = sessionId;
          this.saveSession();
          return Promise.resolve();
        },
        initialConfig: oauthConfig,
        dispatchOAuthStepChange: (detail) => this.dispatchTypedEvent("oauthStepChange", detail),
        dispatchOAuthComplete: (detail) => this.dispatchTypedEvent("oauthComplete", detail),
        dispatchOAuthAuthorizationRequired: (detail) => this.dispatchTypedEvent("oauthAuthorizationRequired", detail),
        dispatchOAuthError: (detail) => this.dispatchTypedEvent("oauthError", detail)
      });
    }
    const clientOptions = {};
    const capabilities = {};
    if (this.sample) {
      capabilities.sampling = {};
    }
    if (this.elicit) {
      const elicitationCap = {};
      if (this.elicit === true) {
        elicitationCap.form = {};
      } else {
        if (this.elicit.form) {
          elicitationCap.form = {};
        }
        if (this.elicit.url) {
          elicitationCap.url = {};
        }
      }
      if (Object.keys(elicitationCap).length > 0) {
        capabilities.elicitation = elicitationCap;
      }
    }
    if (this.roots !== void 0) {
      capabilities.roots = { listChanged: true };
    }
    if (this.receiverTasks) {
      capabilities.tasks = {
        list: {},
        cancel: {},
        requests: {
          sampling: { createMessage: {} },
          elicitation: { create: {} }
        }
      };
    }
    if (Object.keys(capabilities).length > 0) {
      clientOptions.capabilities = capabilities;
    }
    this.clientCapabilities = capabilities;
    this.appRendererClientProxy = null;
    this.client = new Client(
      options.clientIdentity ?? {
        name: corePackageJson.name.split("/")[1] ?? corePackageJson.name,
        version: corePackageJson.version
      },
      Object.keys(clientOptions).length > 0 ? clientOptions : void 0
    );
  }
  buildEffectiveAuthFetch() {
    const base = this.fetchFn ?? fetch;
    return createFetchTracker(base, {
      trackRequest: (entry) => this.dispatchFetchRequest({ ...entry, category: "auth" }),
      updateResponseBody: (id, body) => this.dispatchFetchRequestBodyUpdate(id, body)
    });
  }
  createMessageTrackingCallbacks() {
    return {
      trackRequest: (message, origin) => {
        const entry = {
          id: crypto.randomUUID(),
          timestamp: /* @__PURE__ */ new Date(),
          direction: "request",
          origin,
          message
        };
        this.dispatchTypedEvent("message", entry);
      },
      trackResponse: (message, origin) => {
        const entry = {
          id: crypto.randomUUID(),
          timestamp: /* @__PURE__ */ new Date(),
          direction: "response",
          origin,
          message
        };
        this.dispatchTypedEvent("message", entry);
      },
      trackNotification: (message, origin) => {
        const entry = {
          id: crypto.randomUUID(),
          timestamp: /* @__PURE__ */ new Date(),
          direction: "notification",
          origin,
          message
        };
        this.dispatchTypedEvent("message", entry);
      }
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
  /**
   * Merge per-call metadata with this client's `defaultMetadata` (from
   * `InspectorClientOptions.defaultMetadata`, set from
   * `InspectorServerSettings.metadata`). Call-time keys override defaults.
   * Returns `undefined` when the combined map is empty so callers can skip
   * injecting an empty `_meta` field.
   */
  mergeMeta(callMetadata) {
    const defaults = this.defaultMetadata;
    const hasDefaults = defaults && Object.keys(defaults).length > 0;
    const hasCall = callMetadata && Object.keys(callMetadata).length > 0;
    if (!hasDefaults && !hasCall) return void 0;
    return { ...defaults ?? {}, ...callMetadata ?? {} };
  }
  getRequestOptions(progressToken) {
    const opts = {
      resetTimeoutOnProgress: this.resetTimeoutOnProgress
    };
    if (this.requestTimeout !== void 0) {
      opts.timeout = this.requestTimeout;
    }
    if (this.progress) {
      const token = progressToken;
      const onprogress = (progress) => {
        const payload = {
          ...progress,
          ...token != null && { progressToken: token }
        };
        this.dispatchTypedEvent("progressNotification", payload);
      };
      opts.onprogress = onprogress;
    }
    return opts;
  }
  isHttpOAuthConfig() {
    const serverType = getServerType(this.transportConfig);
    return (serverType === "sse" || serverType === "streamable-http") && !!this.oauthManager;
  }
  /**
   * True when task status is completed, failed, or cancelled.
   * We use this private helper instead of the SDK's experimental isTerminal()
   * to avoid depending on experimental API and to get a type predicate so
   * TypeScript narrows status to "completed" | "failed" | "cancelled" after the check.
   */
  static isTerminalTaskStatus(status) {
    return status === "completed" || status === "failed" || status === "cancelled";
  }
  createReceiverTask(opts) {
    const taskId = crypto.randomUUID();
    const ttlMs = opts.ttl ?? (typeof this.receiverTaskTtlMs === "function" ? this.receiverTaskTtlMs() : this.receiverTaskTtlMs);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const task = {
      taskId,
      status: opts.initialStatus,
      ttl: ttlMs,
      createdAt: now,
      lastUpdatedAt: now,
      ...opts.pollInterval != null && { pollInterval: opts.pollInterval },
      ...opts.statusMessage != null && { statusMessage: opts.statusMessage }
    };
    let resolvePayload;
    let rejectPayload;
    const payloadPromise = new Promise((resolve4, reject) => {
      resolvePayload = resolve4;
      rejectPayload = reject;
    });
    const record = {
      task,
      payloadPromise,
      resolvePayload,
      rejectPayload
    };
    record.cleanupTimeoutId = setTimeout(() => {
      record.cleanupTimeoutId = void 0;
      this.receiverTaskRecords.delete(taskId);
    }, ttlMs);
    this.receiverTaskRecords.set(taskId, record);
    return record;
  }
  emitReceiverTaskStatus(task) {
    if (!this.client) return;
    try {
      const notification = TaskStatusNotificationSchema.parse({
        method: "notifications/tasks/status",
        params: task
      });
      this.client.notification(notification).catch((err) => {
        this.logger.warn(
          { err, taskId: task.taskId },
          "receiver task status notification failed"
        );
      });
    } catch (err) {
      this.logger.warn(
        { err, taskId: task.taskId },
        "receiver task status notification failed"
      );
    }
  }
  upsertReceiverTask(updatedTask) {
    const record = this.receiverTaskRecords.get(updatedTask.taskId);
    if (record) {
      record.task = updatedTask;
      this.emitReceiverTaskStatus(updatedTask);
    }
  }
  getReceiverTask(taskId) {
    return this.receiverTaskRecords.get(taskId);
  }
  listReceiverTasks() {
    return Array.from(this.receiverTaskRecords.values()).map((r) => r.task);
  }
  async getReceiverTaskPayload(taskId) {
    const record = this.receiverTaskRecords.get(taskId);
    if (!record) {
      throw new McpError2(ErrorCode2.InvalidParams, `Unknown taskId: ${taskId}`);
    }
    return record.payloadPromise;
  }
  cancelReceiverTask(taskId) {
    const record = this.receiverTaskRecords.get(taskId);
    if (!record) {
      throw new McpError2(ErrorCode2.InvalidParams, `Unknown taskId: ${taskId}`);
    }
    if (_InspectorClient.isTerminalTaskStatus(record.task.status)) {
      return record.task;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const updatedTask = {
      ...record.task,
      status: "cancelled",
      lastUpdatedAt: now
    };
    record.task = updatedTask;
    record.rejectPayload(new Error("Task cancelled"));
    if (record.cleanupTimeoutId != null) {
      clearTimeout(record.cleanupTimeoutId);
      record.cleanupTimeoutId = void 0;
    }
    this.emitReceiverTaskStatus(updatedTask);
    return updatedTask;
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
    if (!this.baseTransport) {
      const transportOptions = {
        fetchFn: this.fetchFn,
        pipeStderr: this.pipeStderr,
        onStderr: (entry) => {
          this.dispatchStderrLog(entry);
        },
        onFetchRequest: (entry) => {
          this.dispatchFetchRequest({ ...entry, category: "transport" });
        },
        onFetchResponseBody: (id, body) => {
          this.dispatchFetchRequestBodyUpdate(id, body);
        },
        ...this.serverSettings && { settings: this.serverSettings }
      };
      const oauthManager = this.oauthManager;
      if (this.isHttpOAuthConfig() && oauthManager) {
        const provider = await oauthManager.createOAuthProviderForTransport();
        transportOptions.authProvider = provider;
      }
      const { transport: baseTransport } = this.transportClientFactory(
        this.transportConfig,
        transportOptions
      );
      this.baseTransport = baseTransport;
      const messageTracking = this.createMessageTrackingCallbacks();
      this.transport = new MessageTrackingTransport(
        baseTransport,
        messageTracking
      );
      this.attachTransportListeners(this.baseTransport);
    }
    if (!this.transport) {
      throw new Error("Transport not initialized");
    }
    try {
      this.status = "connecting";
      this.dispatchTypedEvent("statusChange", this.status);
      const connectTimeoutMs = this.serverSettings?.connectionTimeout ?? 0;
      const connectPromise = this.client.connect(this.transport);
      if (connectTimeoutMs > 0) {
        connectPromise.catch(() => {
        });
        let timer;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(
              new Error(
                `Connection timed out after ${connectTimeoutMs} ms`
              )
            ),
            connectTimeoutMs
          );
        });
        try {
          await Promise.race([connectPromise, timeoutPromise]);
        } catch (err) {
          await this.disconnect().catch(() => {
          });
          throw err;
        } finally {
          if (timer) clearTimeout(timer);
        }
      } else {
        await connectPromise;
      }
      this.status = "connected";
      this.dispatchTypedEvent("statusChange", this.status);
      await this.fetchServerInfo();
      this.dispatchTypedEvent("connect");
      if (this.initialLoggingLevel && this.capabilities?.logging) {
        await this.client.setLoggingLevel(
          this.initialLoggingLevel,
          this.getRequestOptions()
        );
      }
      if (this.sample && this.client) {
        this.client.setRequestHandler(CreateMessageRequestSchema, (request) => {
          const paramsTask = request.params?.task;
          if (this.receiverTasks && paramsTask != null) {
            const record = this.createReceiverTask({
              ttl: paramsTask.ttl,
              initialStatus: "input_required",
              statusMessage: "Awaiting user input"
            });
            void (async () => {
              const samplingRequest = new SamplingCreateMessage(
                request,
                (result) => {
                  record.resolvePayload(result);
                  const now = (/* @__PURE__ */ new Date()).toISOString();
                  const updated = {
                    ...record.task,
                    status: "completed",
                    lastUpdatedAt: now
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
                (error) => {
                  record.rejectPayload(error);
                  const now = (/* @__PURE__ */ new Date()).toISOString();
                  const updated = {
                    ...record.task,
                    status: "failed",
                    lastUpdatedAt: now,
                    statusMessage: error instanceof Error ? error.message : String(error)
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
                (id) => this.removePendingSample(id)
              );
              this.addPendingSample(samplingRequest);
            })();
            return Promise.resolve({ task: record.task });
          }
          return new Promise((resolve4, reject) => {
            const samplingRequest = new SamplingCreateMessage(
              request,
              (result) => {
                resolve4(result);
              },
              (error) => {
                reject(error);
              },
              (id) => this.removePendingSample(id)
            );
            this.addPendingSample(samplingRequest);
          });
        });
      }
      if (this.elicit && this.client) {
        this.client.setRequestHandler(ElicitRequestSchema, (request) => {
          const paramsTask = request.params?.task;
          if (this.receiverTasks && paramsTask != null) {
            const record = this.createReceiverTask({
              ttl: paramsTask.ttl,
              initialStatus: "input_required",
              statusMessage: "Awaiting user input"
            });
            void (async () => {
              const elicitationRequest = new ElicitationCreateMessage(
                request,
                (result) => {
                  record.resolvePayload(result);
                  const now = (/* @__PURE__ */ new Date()).toISOString();
                  const updated = {
                    ...record.task,
                    status: "completed",
                    lastUpdatedAt: now
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                },
                (id) => this.removePendingElicitation(id),
                (error) => {
                  record.rejectPayload(error);
                  const now = (/* @__PURE__ */ new Date()).toISOString();
                  const updated = {
                    ...record.task,
                    status: "failed",
                    lastUpdatedAt: now,
                    statusMessage: error.message
                  };
                  record.task = updated;
                  this.upsertReceiverTask(updated);
                }
              );
              this.addPendingElicitation(elicitationRequest);
            })();
            return Promise.resolve({ task: record.task });
          }
          return new Promise((resolve4) => {
            const elicitationRequest = new ElicitationCreateMessage(
              request,
              (result) => {
                resolve4(result);
              },
              (id) => this.removePendingElicitation(id)
            );
            this.addPendingElicitation(elicitationRequest);
          });
        });
      }
      if (this.roots !== void 0 && this.client) {
        this.client.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots: this.roots ?? [] };
        });
      }
      if (this.receiverTasks && this.client) {
        this.client.setRequestHandler(ListTasksRequestSchema, async () => ({
          tasks: this.listReceiverTasks()
        }));
        this.client.setRequestHandler(GetTaskRequestSchema, async (req) => {
          const record = this.getReceiverTask(req.params.taskId);
          if (!record) {
            throw new McpError2(
              ErrorCode2.InvalidParams,
              `Unknown taskId: ${req.params.taskId}`
            );
          }
          return record.task;
        });
        this.client.setRequestHandler(
          GetTaskPayloadRequestSchema,
          async (req) => this.getReceiverTaskPayload(req.params.taskId)
        );
        this.client.setRequestHandler(
          CancelTaskRequestSchema,
          async (req) => this.cancelReceiverTask(req.params.taskId)
        );
      }
      if (this.client) {
        this.client.setNotificationHandler(
          RootsListChangedNotificationSchema,
          async () => {
            this.dispatchTypedEvent("rootsChange", this.roots || []);
          }
        );
      }
      if (this.client) {
        if (this.listChangedNotifications.tools && this.capabilities?.tools?.listChanged) {
          this.client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
              this.dispatchTypedEvent("toolsListChanged");
            }
          );
        }
        if (this.listChangedNotifications.resources && this.capabilities?.resources?.listChanged) {
          this.client.setNotificationHandler(
            ResourceListChangedNotificationSchema,
            async () => {
              this.dispatchTypedEvent("resourcesListChanged");
              this.dispatchTypedEvent("resourceTemplatesListChanged");
            }
          );
        }
        if (this.listChangedNotifications.prompts && this.capabilities?.prompts?.listChanged) {
          this.client.setNotificationHandler(
            PromptListChangedNotificationSchema,
            async () => {
              this.dispatchTypedEvent("promptsListChanged");
            }
          );
        }
        if (this.capabilities?.tasks) {
          this.client.setNotificationHandler(
            TasksListChangedNotificationSchema,
            async () => {
              this.dispatchTypedEvent("tasksListChanged");
            }
          );
          this.client.setNotificationHandler(
            TaskStatusNotificationSchema,
            async (notification) => {
              const task = notification.params;
              this.dispatchTypedEvent("taskStatusChange", {
                taskId: task.taskId,
                task
              });
            }
          );
        }
        if (this.capabilities?.resources?.subscribe === true) {
          this.client.setNotificationHandler(
            ResourceUpdatedNotificationSchema,
            async (notification) => {
              const uri = notification.params.uri;
              if (this.subscribedResources.has(uri)) {
                this.dispatchTypedEvent("resourceUpdated", { uri });
              }
            }
          );
        }
        const urlElicitEnabled = this.elicit && typeof this.elicit === "object" && this.elicit.url === true;
        if (urlElicitEnabled) {
          this.client.setNotificationHandler(
            ElicitationCompleteNotificationSchema,
            async (notification) => {
              const { elicitationId } = notification.params;
              const pending = this.pendingElicitations.find(
                (e) => e.request.params?.mode === "url" && e.request.params?.elicitationId === elicitationId
              );
              if (pending) {
                pending.completeIfPending();
              }
            }
          );
        }
      }
    } catch (error) {
      this.status = "error";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent(
        "error",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }
  /**
   * Disconnect from the MCP server.
   * @param safeDisconnectTimeout If > 0, poll every 10ms until SDK _responseHandlers is empty or this many ms have elapsed, then close. Default 0 = close immediately.
   */
  async disconnect(safeDisconnectTimeout = 0) {
    if (this.client) {
      if (safeDisconnectTimeout > 0) {
        const protocol = this.client;
        const handlers = protocol._responseHandlers;
        const deadline = Date.now() + safeDisconnectTimeout;
        while (handlers?.size !== void 0 && handlers.size > 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
      try {
        await this.client.close();
      } catch {
      }
    }
    this.baseTransport = null;
    this.transport = null;
    if (this.status !== "disconnected") {
      this.status = "disconnected";
      this.dispatchTypedEvent("statusChange", this.status);
      this.dispatchTypedEvent("disconnect");
    }
    this.pendingSamples = [];
    for (const elicitation of this.pendingElicitations) {
      elicitation.cancel();
    }
    this.pendingElicitations = [];
    this.subscribedResources.clear();
    for (const record of this.receiverTaskRecords.values()) {
      if (record.cleanupTimeoutId != null) {
        clearTimeout(record.cleanupTimeoutId);
      }
    }
    this.receiverTaskRecords.clear();
    this.appRendererClientProxy = null;
    this.capabilities = void 0;
    this.serverInfo = void 0;
    this.instructions = void 0;
    this.protocolVersion = void 0;
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
    this.dispatchTypedEvent("pendingElicitationsChange", this.pendingElicitations);
    this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
    this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
    this.dispatchTypedEvent("instructionsChange", this.instructions);
    this.dispatchTypedEvent("protocolVersionChange", this.protocolVersion);
  }
  /**
   * Returns a client proxy for use by AppRenderer / @mcp-ui. Delegates to the
   * internal MCP Client. Returns null when not connected. Use this instead of
   * accessing the raw client so behavior can be adapted here later if needed.
   */
  getAppRendererClient() {
    if (!this.client || this.status !== "connected") return null;
    if (this.appRendererClientProxy !== null)
      return this.appRendererClientProxy;
    const target = this.client;
    this.appRendererClientProxy = new Proxy(this.client, {
      get(proxyTarget, prop, receiver) {
        const value = Reflect.get(proxyTarget, prop, receiver);
        if (prop === "setNotificationHandler" && typeof value === "function") {
          return (...args) => {
            return value.apply(target, args);
          };
        }
        return value;
      }
    });
    return this.appRendererClientProxy;
  }
  /**
   * Send a ping request to the server. Resolves when the server responds.
   */
  async ping() {
    if (!this.client) {
      throw new Error("Client not initialized");
    }
    await this.client.request(
      { method: "ping" },
      EmptyResultSchema,
      this.getRequestOptions()
    );
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
    return getServerType(this.transportConfig);
  }
  /**
   * Get task capabilities from server
   * @returns Task capabilities or undefined if not supported
   */
  getTaskCapabilities() {
    if (!this.capabilities?.tasks) {
      return void 0;
    }
    return {
      list: !!this.capabilities.tasks.list,
      cancel: !!this.capabilities.tasks.cancel
    };
  }
  /**
   * Get requestor task status by taskId (tasks we created on the server)
   * @param taskId Task identifier
   * @returns Task status
   */
  async getRequestorTask(taskId) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const task = await this.client.experimental.tasks.getTask(
      taskId,
      this.getRequestOptions()
    );
    this.dispatchTypedEvent("requestorTaskUpdated", {
      taskId: task.taskId,
      task
    });
    return task;
  }
  /**
   * Get requestor task result by taskId (tasks we created on the server)
   * @param taskId Task identifier
   * @returns Task result
   */
  async getRequestorTaskResult(taskId) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    return await this.client.experimental.tasks.getTaskResult(
      taskId,
      CallToolResultSchema,
      this.getRequestOptions()
    );
  }
  /**
   * Cancel a running requestor task (task we created on the server)
   * @param taskId Task identifier
   * @returns Cancel result
   */
  async cancelRequestorTask(taskId) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    await this.client.experimental.tasks.cancelTask(
      taskId,
      this.getRequestOptions()
    );
    this.dispatchTypedEvent("taskCancelled", { taskId });
  }
  /**
   * List all requestor tasks with optional pagination (tasks we created on the server)
   * @param cursor Optional pagination cursor
   * @returns List of tasks with optional next cursor
   */
  async listRequestorTasks(cursor) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    return await this.client.experimental.tasks.listTasks(
      cursor,
      this.getRequestOptions()
    );
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
    this.dispatchTypedEvent(
      "pendingElicitationsChange",
      this.pendingElicitations
    );
    this.dispatchTypedEvent("newPendingElicitation", elicitation);
  }
  /**
   * Remove a pending elicitation request by ID
   */
  removePendingElicitation(id) {
    const index = this.pendingElicitations.findIndex((e) => e.id === id);
    if (index !== -1) {
      this.pendingElicitations.splice(index, 1);
      this.dispatchTypedEvent(
        "pendingElicitationsChange",
        this.pendingElicitations
      );
    }
  }
  /**
   * Get server capabilities
   */
  getCapabilities() {
    return this.capabilities;
  }
  /**
   * Get the capabilities this client advertises to the server. Snapshotted
   * from the initialize-time build in setupClient(); does not reflect later
   * registerCapabilities() calls on the underlying SDK Client.
   */
  getClientCapabilities() {
    return this.clientCapabilities;
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
   * Get the MCP protocol version negotiated with the server during the
   * initialize handshake (e.g. "2025-06-18"). Undefined when not connected.
   */
  getProtocolVersion() {
    return this.protocolVersion;
  }
  /**
   * The per-server settings this client was constructed with (headers,
   * timeouts, roots, OAuth, the auto-refresh-on-list-changed option, etc.).
   * Read by the managed list state to decide whether to auto-refresh on
   * `list_changed` notifications (#1402).
   */
  getServerSettings() {
    return this.serverSettings;
  }
  /**
   * Replace the in-memory per-server settings on a live client. Lets a settings
   * edit (e.g. toggling auto-refresh-on-list-changed) take effect on the
   * current connection without a reconnect — the managed list state reads
   * `getServerSettings()` at notification time, so the next `list_changed`
   * notification honors the new value (#1444). Connection-time inputs
   * (transport, OAuth, timeouts) still only apply on the next connect.
   */
  setServerSettings(settings) {
    this.serverSettings = settings;
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
   * Fetch a single page of tools without updating the client's internal list.
   */
  async listTools(cursor, metadata) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params = {
      ...effectiveMeta ? { _meta: effectiveMeta } : {},
      ...cursor ? { cursor } : {}
    };
    const response = await this.client.listTools(
      params,
      this.getRequestOptions(metadata?.progressToken)
    );
    const tools = [...response.tools || []];
    return { tools, nextCursor: response.nextCursor };
  }
  /**
   * Call a tool. Caller must provide the Tool (e.g. from a state manager).
   * @param tool The tool to call (use tool.name for the request)
   * @param args Tool arguments
   * @param generalMetadata Optional general metadata
   * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
   * @param taskOptions Optional task options (e.g. ttl) for task-augmented requests
   * @returns Tool call response
   */
  async callTool(tool, args, generalMetadata, toolSpecificMetadata, taskOptions, options) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    if (tool.execution?.taskSupport === "required") {
      throw new Error(
        `Tool "${tool.name}" requires task support. Use callToolStream() instead of callTool().`
      );
    }
    let urlElicitationAttempt = 0;
    const presentedUrls = /* @__PURE__ */ new Set();
    while (true) {
      try {
        return await this.attemptToolCall(
          tool,
          args,
          generalMetadata,
          toolSpecificMetadata,
          taskOptions,
          options
        );
      } catch (error) {
        const urlElicitations = getUrlElicitationsFromError(error);
        if (urlElicitations && urlElicitations.length > 0 && urlElicitationAttempt < MAX_URL_ELICITATION_RETRIES) {
          const repeated = urlElicitations.find(
            (e) => presentedUrls.has(e.url)
          );
          if (repeated) {
            const loopError = new UrlElicitationLoopError(repeated.url);
            this.dispatchFailedToolCall(
              tool,
              args,
              generalMetadata,
              toolSpecificMetadata,
              loopError.message
            );
            throw loopError;
          }
          urlElicitationAttempt++;
          for (const e of urlElicitations) {
            presentedUrls.add(e.url);
          }
          const action = await this.runUrlElicitations(urlElicitations);
          if (action === "accept") {
            continue;
          }
          const abortError = new Error(
            `Tool call cancelled: required URL elicitation was ${action === "decline" ? "declined" : "cancelled"}.`
          );
          this.dispatchFailedToolCall(
            tool,
            args,
            generalMetadata,
            toolSpecificMetadata,
            abortError.message
          );
          throw abortError;
        }
        if (urlElicitations && urlElicitations.length > 0) {
          this.logger.warn(
            { tool: tool.name, attempts: urlElicitationAttempt },
            `Tool "${tool.name}" still required URL elicitations after ${MAX_URL_ELICITATION_RETRIES} attempts; giving up.`
          );
        }
        this.dispatchFailedToolCall(
          tool,
          args,
          generalMetadata,
          toolSpecificMetadata,
          error instanceof Error ? error.message : String(error)
        );
        throw error;
      }
    }
  }
  /**
   * Run a single tools/call attempt: convert args, issue the request, validate,
   * and return a successful {@link ToolCallInvocation}. Throws on any error
   * (including a `-32042` UrlElicitationRequired response); {@link callTool}'s
   * retry loop owns the elicitation handling and failure bookkeeping.
   */
  async attemptToolCall(tool, args, generalMetadata, toolSpecificMetadata, taskOptions, options) {
    const client = this.client;
    if (!client) {
      throw new Error("Client is not connected");
    }
    let convertedArgs = args;
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
    const callMetadata = generalMetadata || toolSpecificMetadata ? { ...generalMetadata || {}, ...toolSpecificMetadata || {} } : void 0;
    const timestamp = /* @__PURE__ */ new Date();
    const metadata = this.mergeMeta(callMetadata);
    const callParams = {
      name: tool.name,
      arguments: convertedArgs,
      _meta: metadata
    };
    if (taskOptions?.ttl != null) {
      callParams.task = { ttl: taskOptions.ttl };
    }
    const requestOptions = this.getRequestOptions(metadata?.progressToken);
    const result = options?.skipOutputValidation ? await client.request(
      { method: "tools/call", params: callParams },
      CallToolResultSchema,
      requestOptions
    ) : await client.callTool(callParams, void 0, requestOptions);
    const outputValidationError = options?.skipOutputValidation ? this.validateToolOutput(tool, result) : void 0;
    const invocation = {
      toolName: tool.name,
      params: args,
      result,
      timestamp,
      success: true,
      metadata,
      outputValidationError
    };
    this.dispatchTypedEvent("toolCallResultChange", {
      toolName: tool.name,
      params: args,
      result: invocation.result,
      timestamp,
      success: true,
      metadata,
      outputValidationError
    });
    return invocation;
  }
  /**
   * Record a failed tools/call as a `toolCallResultChange` event (history + the
   * Tools panel) without throwing. {@link callTool} calls this before rethrowing
   * so a failure — whether a transport error, a declined URL elicitation, or a
   * non-spec `-32042` — lands in the request history exactly once.
   */
  dispatchFailedToolCall(tool, args, generalMetadata, toolSpecificMetadata, errorMessage) {
    const callMetadata = generalMetadata || toolSpecificMetadata ? { ...generalMetadata || {}, ...toolSpecificMetadata || {} } : void 0;
    const metadata = this.mergeMeta(callMetadata);
    this.dispatchTypedEvent("toolCallResultChange", {
      toolName: tool.name,
      params: args,
      result: null,
      timestamp: /* @__PURE__ */ new Date(),
      success: false,
      error: errorMessage,
      metadata
    });
  }
  /**
   * Surface the URL elicitations carried by a `-32042` error, one at a time and
   * in order (per the spec's "URL mode with elicitation required error" flow),
   * returning as soon as the user declines/cancels one. Returns `"accept"` only
   * when every elicitation was accepted, which is {@link callTool}'s signal to
   * retry the original call.
   */
  async runUrlElicitations(elicitations) {
    for (const params of elicitations) {
      const action = await this.awaitUrlElicitation(params);
      if (action !== "accept") {
        return action;
      }
    }
    return "accept";
  }
  /**
   * Add one error-path URL elicitation to the pending queue (so it renders in
   * the same modal as request-path elicitations) and resolve with the user's
   * action. Unlike the request-path handler there is no server request to
   * answer — accepting it just unblocks the retry; the server's optional
   * `notifications/elicitation/complete` resolves it as accepted too (via
   * `completeIfPending`).
   */
  awaitUrlElicitation(params) {
    return new Promise((resolve4) => {
      const request = {
        method: "elicitation/create",
        params
      };
      const message = new ElicitationCreateMessage(
        request,
        (result) => resolve4(result.action),
        (id) => this.removePendingElicitation(id)
      );
      this.addPendingElicitation(message);
    });
  }
  /**
   * Non-fatally validate a delivered tool result against the tool's outputSchema
   * (used by the skipOutputValidation path). Delegates to the pure
   * {@link validateToolOutput} helper with this client's lazily-built Ajv
   * validator. Returns an advisory message, or undefined when valid.
   */
  validateToolOutput(tool, result) {
    this.outputValidator ??= new AjvJsonSchemaValidator();
    return validateToolOutput(this.outputValidator, tool, result);
  }
  /**
   * Call a tool with task support (streaming).
   * Caller must provide the Tool (e.g. from a state manager).
   * @param tool The tool to call (use tool.name for the request)
   * @param args Tool arguments
   * @param generalMetadata Optional general metadata
   * @param toolSpecificMetadata Optional tool-specific metadata (takes precedence over general)
   * @param taskOptions Optional task options (e.g. ttl) for task-augmented requests
   * @returns Tool call response
   */
  async callToolStream(tool, args, generalMetadata, toolSpecificMetadata, taskOptions) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    try {
      let convertedArgs = args;
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
      const callMetadata = generalMetadata || toolSpecificMetadata ? { ...generalMetadata || {}, ...toolSpecificMetadata || {} } : void 0;
      const timestamp = /* @__PURE__ */ new Date();
      const metadata = this.mergeMeta(callMetadata);
      const streamParams = {
        name: tool.name,
        arguments: convertedArgs
      };
      if (metadata) {
        streamParams._meta = metadata;
      }
      if (taskOptions?.ttl != null) {
        streamParams.task = { ttl: taskOptions.ttl };
      }
      let finalResult;
      let taskId;
      let error;
      const requestOptions = this.getRequestOptions(metadata?.progressToken);
      if (this.progress) {
        const innerOnProgress = requestOptions.onprogress;
        requestOptions.onprogress = (progress) => {
          innerOnProgress?.(progress);
          if (taskId) {
            this.dispatchTypedEvent("requestorTaskProgress", {
              taskId,
              progress
            });
          }
        };
      }
      const stream = this.client.experimental.tasks.callToolStream(
        streamParams,
        void 0,
        // Use default CallToolResultSchema
        requestOptions
      );
      for await (const message of stream) {
        switch (message.type) {
          case "taskCreated":
            taskId = message.task.taskId;
            this.dispatchTypedEvent("toolCallTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task
            });
            this.dispatchTypedEvent("requestorTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task
            });
            break;
          case "taskStatus":
            if (!taskId) {
              taskId = message.task.taskId;
            }
            this.dispatchTypedEvent("toolCallTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task
            });
            this.dispatchTypedEvent("requestorTaskUpdated", {
              taskId: message.task.taskId,
              task: message.task
            });
            break;
          case "result":
            finalResult = message.result;
            if (taskId) {
              const completedTask = {
                taskId,
                ttl: null,
                status: "completed",
                statusMessage: "Task completed",
                lastUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
              };
              this.dispatchTypedEvent("toolCallTaskUpdated", {
                taskId,
                task: completedTask,
                result: finalResult
              });
              this.dispatchTypedEvent("requestorTaskUpdated", {
                taskId,
                task: completedTask,
                result: finalResult
              });
            }
            break;
          case "error": {
            const errorMessage = message.error.message || "Task execution failed";
            error = new Error(errorMessage);
            if (taskId) {
              const failedTask = {
                taskId,
                ttl: null,
                status: "failed",
                statusMessage: errorMessage,
                lastUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
              };
              this.dispatchTypedEvent("toolCallTaskUpdated", {
                taskId,
                task: failedTask,
                error: message.error
              });
              this.dispatchTypedEvent("requestorTaskUpdated", {
                taskId,
                task: failedTask,
                error: message.error
              });
            }
            break;
          }
        }
      }
      if (error) {
        throw error;
      }
      if (!finalResult && taskId) {
        try {
          finalResult = await this.client.experimental.tasks.getTaskResult(
            taskId,
            void 0,
            this.getRequestOptions()
            // no metadata for fallback
          );
        } catch (resultError) {
          throw new Error(
            `Tool call did not return a result: ${resultError instanceof Error ? resultError.message : String(resultError)}`
          );
        }
      }
      if (!finalResult) {
        throw new Error("Tool call did not return a result");
      }
      const invocation = {
        toolName: tool.name,
        params: args,
        result: finalResult,
        timestamp,
        success: true,
        metadata
      };
      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: tool.name,
        params: args,
        result: invocation.result,
        timestamp,
        success: true,
        metadata
      });
      return invocation;
    } catch (error) {
      const callMetadata = generalMetadata || toolSpecificMetadata ? { ...generalMetadata || {}, ...toolSpecificMetadata || {} } : void 0;
      const timestamp = /* @__PURE__ */ new Date();
      const metadata = this.mergeMeta(callMetadata);
      this.dispatchTypedEvent("toolCallResultChange", {
        toolName: tool.name,
        params: args,
        result: null,
        timestamp,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metadata
      });
      throw error;
    }
  }
  /**
   * List available resources with pagination support (stateless; state managers hold the list).
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing resources array and optional nextCursor
   */
  async listResources(cursor, metadata) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params = {
      ...effectiveMeta ? { _meta: effectiveMeta } : {},
      ...cursor ? { cursor } : {}
    };
    const response = await this.client.listResources(
      params,
      this.getRequestOptions(metadata?.progressToken)
    );
    return {
      resources: response.resources || [],
      nextCursor: response.nextCursor
    };
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
    const effectiveMeta = this.mergeMeta(metadata);
    const params = {
      uri,
      ...effectiveMeta ? { _meta: effectiveMeta } : {}
    };
    const result = await this.client.readResource(
      params,
      this.getRequestOptions(metadata?.progressToken)
    );
    const invocation = {
      result,
      timestamp: /* @__PURE__ */ new Date(),
      uri,
      metadata: effectiveMeta
    };
    this.dispatchTypedEvent("resourceContentChange", {
      uri,
      content: invocation,
      timestamp: invocation.timestamp
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
    const uriTemplateString = uriTemplate;
    let expandedUri;
    try {
      const uriTemplate2 = new UriTemplate(uriTemplateString);
      expandedUri = uriTemplate2.expand(params);
    } catch (error) {
      throw new Error(
        `Failed to expand URI template "${uriTemplate}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const readInvocation = await this.readResource(expandedUri, metadata);
    const invocation = {
      uriTemplate: uriTemplateString,
      expandedUri,
      result: readInvocation.result,
      timestamp: readInvocation.timestamp,
      params,
      metadata: readInvocation.metadata
    };
    this.dispatchTypedEvent("resourceTemplateContentChange", {
      uriTemplate: uriTemplateString,
      content: invocation,
      params,
      timestamp: invocation.timestamp
    });
    return invocation;
  }
  /**
   * List resource templates with pagination support (stateless; state managers hold the list).
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing resourceTemplates array and optional nextCursor
   */
  async listResourceTemplates(cursor, metadata) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params = {
      ...effectiveMeta ? { _meta: effectiveMeta } : {},
      ...cursor ? { cursor } : {}
    };
    const response = await this.client.listResourceTemplates(
      params,
      this.getRequestOptions(metadata?.progressToken)
    );
    return {
      resourceTemplates: response.resourceTemplates || [],
      nextCursor: response.nextCursor
    };
  }
  /**
   * List available prompts with pagination support
   * @param cursor Optional cursor for pagination
   * @param metadata Optional metadata to include in the request
   * @returns Object containing prompts array and optional nextCursor
   */
  async listPrompts(cursor, metadata) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    const effectiveMeta = this.mergeMeta(metadata);
    const params = {
      ...effectiveMeta ? { _meta: effectiveMeta } : {},
      ...cursor ? { cursor } : {}
    };
    const response = await this.client.listPrompts(
      params,
      this.getRequestOptions(metadata?.progressToken)
    );
    return {
      prompts: response.prompts || [],
      nextCursor: response.nextCursor
    };
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
    const stringArgs = args ? convertPromptArguments(args) : {};
    const effectiveMeta = this.mergeMeta(metadata);
    const params = {
      name,
      arguments: stringArgs,
      ...effectiveMeta ? { _meta: effectiveMeta } : {}
    };
    const result = await this.client.getPrompt(
      params,
      this.getRequestOptions(metadata?.progressToken)
    );
    const invocation = {
      result,
      timestamp: /* @__PURE__ */ new Date(),
      name,
      params: Object.keys(stringArgs).length > 0 ? stringArgs : void 0,
      metadata: effectiveMeta
    };
    this.dispatchTypedEvent("promptContentChange", {
      name,
      content: invocation,
      timestamp: invocation.timestamp
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
      const effectiveMeta = this.mergeMeta(metadata);
      const params = {
        ref,
        argument: {
          name: argumentName,
          value: argumentValue
        },
        ...context ? { context: { arguments: context } } : {},
        ...effectiveMeta ? { _meta: effectiveMeta } : {}
      };
      const response = await this.client.complete(
        params,
        this.getRequestOptions(metadata?.progressToken)
      );
      return {
        values: response.completion.values || [],
        total: response.completion.total,
        hasMore: response.completion.hasMore
      };
    } catch (error) {
      if (error instanceof McpError2 && error.code === ErrorCode2.MethodNotFound || error instanceof Error && (error.message.includes("Method not found") || error.message.includes("does not support completions"))) {
        return { values: [] };
      }
      throw new Error(
        `Failed to get completions: ${error instanceof Error ? error.message : String(error)}`
      );
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
      this.capabilities = this.client.getServerCapabilities();
      this.dispatchTypedEvent("capabilitiesChange", this.capabilities);
      this.serverInfo = this.client.getServerVersion();
      this.instructions = this.client.getInstructions();
      this.dispatchTypedEvent("serverInfoChange", this.serverInfo);
      if (this.instructions !== void 0) {
        this.dispatchTypedEvent("instructionsChange", this.instructions);
      }
      if (this.transport instanceof MessageTrackingTransport) {
        this.protocolVersion = this.transport.protocolVersion;
        this.dispatchTypedEvent("protocolVersionChange", this.protocolVersion);
      }
    } catch {
    }
  }
  dispatchStderrLog(entry) {
    this.dispatchTypedEvent("stderrLog", entry);
  }
  dispatchFetchRequest(entry) {
    this.logger.info(
      {
        component: "InspectorClient",
        category: entry.category,
        fetchRequest: {
          url: entry.url,
          method: entry.method,
          headers: entry.requestHeaders,
          body: entry.requestBody ?? "[no body]"
        },
        fetchResponse: entry.error ? { error: entry.error } : {
          status: entry.responseStatus,
          statusText: entry.responseStatusText,
          headers: entry.responseHeaders,
          body: entry.responseBody
        }
      },
      `${entry.category} fetch`
    );
    this.dispatchTypedEvent("fetchRequest", entry);
  }
  dispatchFetchRequestBodyUpdate(id, responseBody) {
    this.dispatchTypedEvent("fetchRequestBodyUpdate", { id, responseBody });
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
   * Dispatch saveSession so FetchRequestLogState (or other listeners) can persist.
   * Call before OAuth redirect; listeners use sessionStorage with this sessionId.
   */
  saveSession() {
    if (!this.sessionId) return;
    this.dispatchTypedEvent("saveSession", { sessionId: this.sessionId });
  }
  /**
   * Get current roots
   */
  getRoots() {
    return this.roots !== void 0 ? [...this.roots] : [];
  }
  /**
   * Set roots and notify server if it supports roots/listChanged
   * Note: This will enable roots capability if it wasn't already enabled
   */
  async setRoots(roots) {
    if (!this.client) {
      throw new Error("Client is not connected");
    }
    if (this.roots === void 0) {
      this.roots = [];
    }
    this.roots = [...roots];
    this.dispatchTypedEvent("rootsChange", this.roots);
    try {
      await this.client.notification({
        method: "notifications/roots/list_changed"
      });
    } catch (error) {
      this.logger.error(
        { error },
        "Failed to send roots/list_changed notification"
      );
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
      this.dispatchTypedEvent(
        "resourceSubscriptionsChange",
        Array.from(this.subscribedResources)
      );
    } catch (error) {
      throw new Error(
        `Failed to subscribe to resource: ${error instanceof Error ? error.message : String(error)}`
      );
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
      this.dispatchTypedEvent(
        "resourceSubscriptionsChange",
        Array.from(this.subscribedResources)
      );
    } catch (error) {
      throw new Error(
        `Failed to unsubscribe from resource: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  // ============================================================================
  // OAuth Support (delegated to oauthManager)
  // ============================================================================
  ensureOAuthManager() {
    if (!this.oauthManager) {
      throw new Error("OAuth not configured. Call setOAuthConfig() first.");
    }
    return this.oauthManager;
  }
  /**
   * Get server URL from transport config (full URL including path, for OAuth discovery)
   */
  getServerUrl() {
    if (this.transportConfig.type === "sse" || this.transportConfig.type === "streamable-http") {
      return this.transportConfig.url;
    }
    throw new Error(
      "OAuth is only supported for HTTP-based transports (SSE, streamable-http)"
    );
  }
  /**
   * Set OAuth configuration
   */
  setOAuthConfig(config) {
    if (!this.oauthManager) {
      throw new Error(
        "OAuth config must be set at creation. Pass oauth in constructor."
      );
    }
    this.oauthManager.setOAuthConfig(config);
  }
  /**
   * Initiates OAuth flow using SDK's auth() function (normal mode)
   * Can be called directly by user or automatically triggered by 401 errors
   */
  async authenticate() {
    return this.ensureOAuthManager().authenticate();
  }
  /**
   * Starts guided OAuth flow (step-by-step). Runs only the first step.
   * Use proceedOAuthStep() to advance. When oauthStep is "authorization_code",
   * set authorizationCode and call proceedOAuthStep() to complete.
   */
  async beginGuidedAuth() {
    return this.ensureOAuthManager().beginGuidedAuth();
  }
  /**
   * Runs guided OAuth flow to completion. If already started (via beginGuidedAuth),
   * continues from current step. Otherwise initializes and runs from the start.
   * Returns the authorization URL when user must authorize, or undefined if already complete.
   */
  async runGuidedAuth() {
    return this.ensureOAuthManager().runGuidedAuth();
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
    return this.ensureOAuthManager().setGuidedAuthorizationCode(
      authorizationCode,
      completeFlow
    );
  }
  /**
   * Completes OAuth flow with authorization code.
   * For guided mode, this calls setGuidedAuthorizationCode(code, true) internally.
   * For normal mode, uses SDK auth() directly.
   */
  async completeOAuthFlow(authorizationCode) {
    return this.ensureOAuthManager().completeOAuthFlow(authorizationCode);
  }
  /**
   * Gets current OAuth tokens (if authorized)
   */
  async getOAuthTokens() {
    if (!this.oauthManager) {
      return void 0;
    }
    return this.oauthManager.getOAuthTokens();
  }
  /**
   * Clears OAuth tokens and client information
   */
  clearOAuthTokens() {
    this.oauthManager?.clearOAuthTokens();
  }
  /**
   * Checks if client is currently OAuth authorized
   */
  async isOAuthAuthorized() {
    if (!this.oauthManager) {
      return false;
    }
    return this.oauthManager.isOAuthAuthorized();
  }
  /**
   * Get current OAuth state machine state (for guided mode)
   */
  getOAuthState() {
    return this.oauthManager?.getOAuthState();
  }
  /**
   * Get current OAuth step (for guided mode)
   */
  getOAuthStep() {
    return this.oauthManager?.getOAuthStep();
  }
  /**
   * Manually progress to next step in guided OAuth flow
   */
  async proceedOAuthStep() {
    return this.ensureOAuthManager().proceedOAuthStep();
  }
};

// ../../core/mcp/state/managedListState.ts
var MAX_PAGES = 100;
var DEFAULT_LIST_CHANGED_DEBOUNCE_MS = 250;
var ManagedListState = class extends TypedEventTarget {
  items = [];
  client = null;
  unsubscribe = null;
  _metadata = void 0;
  listChanged = false;
  config;
  // Debounce a burst of `list_changed` notifications into a single
  // refresh (or one indicator light) once it settles.
  listChangedTimer = null;
  // Second line of defense beyond the debounce, for the auto-refresh path:
  // while a refresh is fetching, a new (post-debounce) notification queues a
  // single re-run instead
  // of firing another concurrent paginated fetch.
  running = false;
  runQueued = false;
  constructor(client, config) {
    super();
    this.client = client;
    this.config = config;
    const onConnect = () => {
      void this.refresh();
    };
    const onListChanged = () => {
      if (this.listChangedTimer !== null) clearTimeout(this.listChangedTimer);
      this.listChangedTimer = setTimeout(() => {
        this.listChangedTimer = null;
        this.runListChanged();
      }, config.debounceMs);
    };
    const onStatusChange = () => {
      if (this.client?.getStatus() === "disconnected") {
        if (this.listChangedTimer !== null) {
          clearTimeout(this.listChangedTimer);
          this.listChangedTimer = null;
        }
        this.items = [];
        this.dispatchChange();
        this.setListChanged(false);
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener(config.listChangedEvent, onListChanged);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.listChangedTimer !== null) {
        clearTimeout(this.listChangedTimer);
        this.listChangedTimer = null;
      }
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener(config.listChangedEvent, onListChanged);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }
  /**
   * The debounced list-changed action. With auto-refresh on, pull the new list
   * (guarded against overlap so a slow older fetch can't clobber a newer list
   * via last-write-wins `applyItems`). With auto-refresh off, lights the
   * indicator without any network — the user pulls the new list via Refresh
   * (#1402, #1444). Lists without an indicator (resource templates) do nothing
   * in the off case.
   */
  runListChanged() {
    if (this.running) {
      this.runQueued = true;
      return;
    }
    void this.runListChangedOnce();
  }
  async runListChangedOnce() {
    this.running = true;
    try {
      do {
        this.runQueued = false;
        if (this.client?.getServerSettings()?.autoRefreshOnListChanged) {
          await this.refresh();
        } else if (this.config.supportsIndicator) {
          this.setListChanged(true);
        }
      } while (this.runQueued);
    } finally {
      this.running = false;
    }
  }
  /** Defensive copy of the current list. */
  getItems() {
    return [...this.items];
  }
  /** Whether a `list_changed` arrived since the last refresh (indicator on). */
  getListChanged() {
    return this.listChanged;
  }
  /**
   * Clear the list-changed flag — called when the user refreshes the list. The
   * blind light on the notification leaves the indicator set until the user
   * acknowledges by pulling.
   */
  clearListChanged() {
    this.setListChanged(false);
  }
  /**
   * Dispatch a configured event by name. `dispatchTypedEvent`'s
   * `EventMap[K] extends void ? [] : [detail]` overload can't resolve when the
   * key is a generic `keyof M`, so we narrow the method signature here. The
   * concrete subclass event maps keep the call sites type-safe.
   */
  emit(type, detail) {
    this.dispatchTypedEvent(type, detail);
  }
  setListChanged(value) {
    if (this.listChanged === value) return;
    this.listChanged = value;
    this.emit("listChangedChange", value);
  }
  setMetadata(metadata) {
    this._metadata = metadata;
  }
  async refresh(metadata) {
    const next = await this.fetchAll(metadata);
    if (next === null) return this.getItems();
    this.applyItems(next);
    return this.getItems();
  }
  /**
   * Fetch all pages, then `applyItems` commits them (see `refresh`). Returns
   * `null` when not connected, or
   * `[]` when the server doesn't advertise the gating capability (calling the
   * list method there returns -32601 "Method not found", which would spam the
   * console; empty list is the right semantics).
   */
  async fetchAll(metadata) {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") return null;
    if (!client.getCapabilities()?.[this.config.capabilityKey]) return [];
    const effectiveMetadata = metadata ?? this._metadata;
    let items = [];
    let cursor;
    let pageCount = 0;
    do {
      const page = await this.config.fetchPage(
        client,
        cursor,
        effectiveMetadata
      );
      items = cursor ? [...items, ...page.items] : page.items;
      cursor = page.nextCursor;
      pageCount++;
      if (pageCount >= MAX_PAGES) {
        throw new Error(
          `Maximum pagination limit (${MAX_PAGES} pages) reached while listing ${this.config.itemLabel}`
        );
      }
    } while (cursor);
    return items;
  }
  /** Commit a fetched list as the current one and notify subscribers. */
  applyItems(items) {
    this.items = items;
    this.dispatchChange();
  }
  dispatchChange() {
    this.emit(this.config.changeEvent, this.getItems());
  }
  /** Unsubscribe from the client and drop the list; idempotent. */
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.items = [];
  }
};

// ../../core/mcp/state/managedToolsState.ts
var ManagedToolsState = class extends ManagedListState {
  constructor(client, debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS) {
    super(client, {
      changeEvent: "toolsChange",
      listChangedEvent: "toolsListChanged",
      capabilityKey: "tools",
      itemLabel: "tools",
      supportsIndicator: true,
      debounceMs,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listTools(cursor, metadata);
        return { items: result.tools, nextCursor: result.nextCursor };
      }
    });
  }
  getTools() {
    return this.getItems();
  }
};

// ../../core/mcp/state/managedResourcesState.ts
var ManagedResourcesState = class extends ManagedListState {
  constructor(client, debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS) {
    super(client, {
      changeEvent: "resourcesChange",
      listChangedEvent: "resourcesListChanged",
      capabilityKey: "resources",
      itemLabel: "resources",
      supportsIndicator: true,
      debounceMs,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listResources(cursor, metadata);
        return { items: result.resources, nextCursor: result.nextCursor };
      }
    });
  }
  getResources() {
    return this.getItems();
  }
};

// ../../core/mcp/state/managedResourceTemplatesState.ts
var ManagedResourceTemplatesState = class extends ManagedListState {
  constructor(client, debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS) {
    super(client, {
      changeEvent: "resourceTemplatesChange",
      listChangedEvent: "resourceTemplatesListChanged",
      // Templates are gated on the broader `resources` capability.
      capabilityKey: "resources",
      itemLabel: "resource templates",
      supportsIndicator: false,
      debounceMs,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listResourceTemplates(cursor, metadata);
        return {
          items: result.resourceTemplates,
          nextCursor: result.nextCursor
        };
      }
    });
  }
  getResourceTemplates() {
    return this.getItems();
  }
};

// ../../core/mcp/state/managedPromptsState.ts
var ManagedPromptsState = class extends ManagedListState {
  constructor(client, debounceMs = DEFAULT_LIST_CHANGED_DEBOUNCE_MS) {
    super(client, {
      changeEvent: "promptsChange",
      listChangedEvent: "promptsListChanged",
      capabilityKey: "prompts",
      itemLabel: "prompts",
      supportsIndicator: true,
      debounceMs,
      fetchPage: async (c, cursor, metadata) => {
        const result = await c.listPrompts(cursor, metadata);
        return { items: result.prompts, nextCursor: result.nextCursor };
      }
    });
  }
  getPrompts() {
    return this.getItems();
  }
};

// ../../core/mcp/node/config.ts
import { existsSync, readFileSync } from "fs";
import { resolve as resolve2 } from "path";

// ../../core/storage/store-io.ts
import * as path from "path";
import * as fs from "fs/promises";
import { readFile, writeFile } from "atomically";
function getDefaultMcpConfigPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "mcp.json");
}

// ../../core/mcp/serverList.ts
var VALID_SERVER_TYPES = /* @__PURE__ */ new Set([
  "stdio",
  "sse",
  "streamable-http"
]);
function normalizeServerType(config) {
  const type = config.type;
  let normalizedType;
  if (typeof type !== "string") {
    normalizedType = "stdio";
  } else if (type === "http") {
    normalizedType = "streamable-http";
  } else if (VALID_SERVER_TYPES.has(type)) {
    normalizedType = type;
  } else {
    normalizedType = "stdio";
  }
  return { ...config, type: normalizedType };
}
var INSPECTOR_FIELD_KEY_MAP = {
  headers: true,
  metadata: true,
  connectionTimeout: true,
  requestTimeout: true,
  taskTtl: true,
  autoRefreshOnListChanged: true,
  oauth: true,
  roots: true
};
var INSPECTOR_FIELD_KEYS = new Set(
  Object.keys(INSPECTOR_FIELD_KEY_MAP)
);

// ../../core/mcp/node/config.ts
function parseKeyValuePair(value, previous = {}) {
  const parts = value.split("=");
  const key = parts[0] ?? "";
  const val = parts.slice(1).join("=");
  if (!key || val === void 0 || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`
    );
  }
  return { ...previous, [key]: val };
}
function parseHeaderPair(value, previous = {}) {
  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`
    );
  }
  const key = value.slice(0, colonIndex).trim();
  const val = value.slice(colonIndex + 1).trim();
  if (key === "" || val === "") {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`
    );
  }
  return { ...previous, [key]: val };
}
function loadMcpServersConfig(configPath) {
  try {
    const resolvedPath = resolve2(process.cwd(), configPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }
    const configContent = readFileSync(resolvedPath, "utf-8");
    const config = JSON.parse(configContent);
    if (!config.mcpServers) {
      throw new Error("Configuration file must contain an mcpServers element");
    }
    const normalizedServers = {};
    for (const [name, raw] of Object.entries(config.mcpServers)) {
      normalizedServers[name] = normalizeServerType(
        raw
      );
    }
    return { ...config, mcpServers: normalizedServers };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Error loading configuration: ${error.message}`);
    }
    throw new Error("Error loading configuration: Unknown error");
  }
}
function loadServerFromConfig(configPath, serverName) {
  const config = loadMcpServersConfig(configPath);
  if (!config.mcpServers[serverName]) {
    const available = Object.keys(config.mcpServers).join(", ");
    throw new Error(
      `Server '${serverName}' not found in config file. Available servers: ${available}`
    );
  }
  return config.mcpServers[serverName];
}
function buildConfigFromOptions(options) {
  const target = options.target ?? [];
  const first = target[0];
  const rest = target.slice(1);
  const urlFromTarget = first && (first.startsWith("http://") || first.startsWith("https://")) ? first : null;
  const url = urlFromTarget ?? options.serverUrl ?? null;
  if (url) {
    if (rest.length > 0 && urlFromTarget) {
      throw new Error("Arguments cannot be passed to a URL-based MCP server.");
    }
    let transportType;
    const t = options.transport === "http" ? "streamable-http" : options.transport;
    if (t === "sse" || t === "streamable-http") {
      transportType = t;
    } else {
      const u = new URL(url);
      if (u.pathname.endsWith("/mcp")) {
        transportType = "streamable-http";
      } else if (u.pathname.endsWith("/sse")) {
        transportType = "sse";
      } else {
        throw new Error(
          `Transport type not specified and could not be determined from URL: ${url}.`
        );
      }
    }
    if (transportType === "sse") {
      const config3 = { type: "sse", url };
      return config3;
    }
    const config2 = { type: "streamable-http", url };
    return config2;
  }
  if (target.length === 0 || !first) {
    throw new Error(
      "Target is required. Specify a URL or a command to execute."
    );
  }
  if (options.transport && options.transport !== "stdio") {
    throw new Error("Only stdio transport can be used with local commands.");
  }
  const config = { type: "stdio", command: first };
  if (rest.length > 0) config.args = rest;
  if (options.env && Object.keys(options.env).length > 0)
    config.env = options.env;
  if (options.cwd?.trim()) config.cwd = options.cwd.trim();
  return config;
}
function applyOverrides(config, overrides) {
  if (config.type === "stdio") {
    const c = { ...config };
    if (overrides.env && Object.keys(overrides.env).length > 0) {
      c.env = { ...c.env ?? {}, ...overrides.env };
    }
    if (overrides.cwd) c.cwd = overrides.cwd;
    return c;
  }
  return config;
}
function hasAdHocServerOptions(options) {
  return options.target != null && options.target.length > 0 || Boolean(options.transport) || Boolean(options.serverUrl?.trim());
}
function withDefaultConfigPath(options) {
  if (options.configPath?.trim() || hasAdHocServerOptions(options)) {
    return options;
  }
  return { ...options, configPath: getDefaultMcpConfigPath() };
}
function resolveServerConfigs(options, mode) {
  const hasConfigPath = Boolean(options.configPath?.trim());
  const hasAdHoc = hasAdHocServerOptions(options);
  if (mode === "single") {
    if (hasConfigPath && options.serverName) {
      const config = loadServerFromConfig(
        options.configPath,
        options.serverName
      );
      return [
        applyOverrides(config, {
          env: options.env,
          cwd: options.cwd
        })
      ];
    }
    if (hasConfigPath && !options.serverName) {
      const configPath = options.configPath;
      const mcpConfig = loadMcpServersConfig(configPath);
      const servers = Object.keys(mcpConfig.mcpServers);
      if (servers.length === 0)
        throw new Error("No servers found in config file");
      if (servers.length > 1) {
        throw new Error(
          `Multiple servers found in config file. Please specify one with --server. Available servers: ${servers.join(", ")}`
        );
      }
      const serverName = servers[0];
      if (!serverName) throw new Error("No servers found in config file");
      const config = loadServerFromConfig(configPath, serverName);
      return [
        applyOverrides(config, {
          env: options.env,
          cwd: options.cwd
        })
      ];
    }
    return [buildConfigFromOptions(options)];
  }
  if (mode === "multi") {
    if (hasConfigPath && hasAdHoc) {
      throw new Error(
        "In multi-server mode with a config file, do not pass --transport, --server-url, or positional command/URL. Use only --config with optional -e, --cwd."
      );
    }
    if (hasConfigPath && options.configPath) {
      const configPath = options.configPath;
      const mcpConfig = loadMcpServersConfig(configPath);
      const configs = Object.values(mcpConfig.mcpServers).map(
        (c) => applyOverrides({ ...c }, {
          env: options.env,
          cwd: options.cwd
        })
      );
      return configs;
    }
    return [buildConfigFromOptions(options)];
  }
  return [];
}
function resolveLaunchServerConfigs(options, mode) {
  return resolveServerConfigs(withDefaultConfigPath(options), mode);
}

// ../../core/mcp/node/transport.ts
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
function headersFromSettings(settings) {
  if (!settings || settings.headers.length === 0) return void 0;
  const out = {};
  for (const { key, value } of settings.headers) {
    if (key.trim() === "") continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : void 0;
}
function createTransportNode(config, options = {}) {
  const serverType = getServerType(config);
  const {
    fetchFn: optionsFetchFn,
    onStderr,
    pipeStderr = false,
    onFetchRequest,
    onFetchResponseBody,
    authProvider,
    settings
  } = options;
  const baseFetch = optionsFetchFn ?? globalThis.fetch;
  if (serverType === "stdio") {
    const stdioConfig = config;
    const transport = new StdioClientTransport({
      command: stdioConfig.command,
      args: stdioConfig.args || [],
      env: stdioConfig.env,
      cwd: stdioConfig.cwd,
      stderr: pipeStderr ? "pipe" : void 0
    });
    if (pipeStderr && transport.stderr && onStderr) {
      transport.stderr.on("data", (data) => {
        const logEntry = data.toString().trim();
        if (logEntry) {
          onStderr({
            timestamp: /* @__PURE__ */ new Date(),
            message: logEntry
          });
        }
      });
    }
    return { transport };
  } else if (serverType === "sse") {
    const sseConfig = config;
    const url = new URL(sseConfig.url);
    const sseFetch = sseConfig.eventSourceInit?.fetch || baseFetch;
    const trackedFetch = onFetchRequest ? createFetchTracker(sseFetch, {
      trackRequest: onFetchRequest,
      updateResponseBody: onFetchResponseBody
    }) : sseFetch;
    const headers = headersFromSettings(settings);
    const eventSourceInit = {
      ...sseConfig.eventSourceInit,
      ...headers && { headers },
      fetch: trackedFetch
    };
    const requestInit = {
      ...sseConfig.requestInit,
      ...headers && { headers }
    };
    const postFetch = onFetchRequest ? createFetchTracker(baseFetch, {
      trackRequest: onFetchRequest,
      updateResponseBody: onFetchResponseBody
    }) : baseFetch;
    const transport = new SSEClientTransport(url, {
      authProvider,
      eventSourceInit,
      requestInit,
      fetch: postFetch
    });
    return { transport };
  } else {
    const httpConfig = config;
    const url = new URL(httpConfig.url);
    const headers = headersFromSettings(settings);
    const requestInit = {
      ...httpConfig.requestInit,
      ...headers && { headers }
    };
    const transportFetch = onFetchRequest ? createFetchTracker(baseFetch, {
      trackRequest: onFetchRequest,
      updateResponseBody: onFetchResponseBody
    }) : baseFetch;
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider,
      requestInit,
      fetch: transportFetch
    });
    return { transport };
  }
}

// src/cli.ts
import {
  LoggingLevelSchema
} from "@modelcontextprotocol/sdk/types.js";
var validLogLevels = Object.values(
  LoggingLevelSchema.enum
);
function headersToServerSettings(headers) {
  if (!headers || Object.keys(headers).length === 0) {
    return void 0;
  }
  return {
    headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
    metadata: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    autoRefreshOnListChanged: false,
    roots: []
  };
}
async function callMethod(serverConfig, serverSettings, args) {
  const __dirname = dirname2(fileURLToPath(import.meta.url));
  const packageJsonPath = join2(__dirname, "../package.json");
  const packageJsonData = await import(pathToFileURL(packageJsonPath).href, {
    with: { type: "json" }
  });
  const packageJson = packageJsonData.default;
  const [, name = packageJson.name] = packageJson.name.split("/");
  const version = packageJson.version;
  const clientIdentity = { name, version };
  const inspectorClient = new InspectorClient(serverConfig, {
    environment: {
      transport: createTransportNode
    },
    clientIdentity,
    initialLoggingLevel: "debug",
    progress: false,
    sample: false,
    elicit: false,
    serverSettings
  });
  let managedToolsState = null;
  let managedResourcesState = null;
  let managedResourceTemplatesState = null;
  let managedPromptsState = null;
  try {
    await inspectorClient.connect();
    let result;
    if (args.method === "tools/list" || args.method === "tools/call") {
      managedToolsState = new ManagedToolsState(inspectorClient);
      managedToolsState.setMetadata(args.metadata);
      await managedToolsState.refresh();
    }
    if (args.method === "resources/list") {
      managedResourcesState = new ManagedResourcesState(inspectorClient);
      managedResourcesState.setMetadata(args.metadata);
      await managedResourcesState.refresh();
    } else if (args.method === "resources/templates/list") {
      managedResourceTemplatesState = new ManagedResourceTemplatesState(
        inspectorClient
      );
      managedResourceTemplatesState.setMetadata(args.metadata);
      await managedResourceTemplatesState.refresh();
    } else if (args.method === "prompts/list") {
      managedPromptsState = new ManagedPromptsState(inspectorClient);
      managedPromptsState.setMetadata(args.metadata);
      await managedPromptsState.refresh();
    }
    if (args.method === "tools/list") {
      result = { tools: managedToolsState.getTools() };
    } else if (args.method === "tools/call") {
      if (!args.toolName) {
        throw new Error(
          "Tool name is required for tools/call method. Use --tool-name to specify the tool name."
        );
      }
      const tool = managedToolsState.getTools().find((t) => t.name === args.toolName);
      if (!tool) {
        result = {
          content: [
            {
              type: "text",
              text: `Tool '${args.toolName}' not found.`
            }
          ],
          isError: true
        };
      } else {
        const invocation = await inspectorClient.callTool(
          tool,
          args.toolArg || {},
          args.metadata,
          args.toolMeta
        );
        if (invocation.result !== null) {
          result = invocation.result;
        } else {
          result = {
            content: [
              {
                type: "text",
                text: invocation.error || "Tool call failed"
              }
            ],
            isError: true
          };
        }
      }
    } else if (args.method === "resources/list") {
      result = {
        resources: managedResourcesState.getResources()
      };
    } else if (args.method === "resources/read") {
      if (!args.uri) {
        throw new Error(
          "URI is required for resources/read method. Use --uri to specify the resource URI."
        );
      }
      const invocation = await inspectorClient.readResource(
        args.uri,
        args.metadata
      );
      result = invocation.result;
    } else if (args.method === "resources/templates/list") {
      result = {
        resourceTemplates: managedResourceTemplatesState.getResourceTemplates()
      };
    } else if (args.method === "prompts/list") {
      result = { prompts: managedPromptsState.getPrompts() };
    } else if (args.method === "prompts/get") {
      if (!args.promptName) {
        throw new Error(
          "Prompt name is required for prompts/get method. Use --prompt-name to specify the prompt name."
        );
      }
      const invocation = await inspectorClient.getPrompt(
        args.promptName,
        args.promptArgs || {},
        args.metadata
      );
      result = invocation.result;
    } else if (args.method === "logging/setLevel") {
      if (!args.logLevel) {
        throw new Error(
          "Log level is required for logging/setLevel method. Use --log-level to specify the log level."
        );
      }
      await inspectorClient.setLoggingLevel(args.logLevel);
      result = {};
    } else {
      throw new Error(
        `Unsupported method: ${args.method}. Supported methods include: tools/list, tools/call, resources/list, resources/read, resources/templates/list, prompts/list, prompts/get, logging/setLevel`
      );
    }
    await awaitableLog(JSON.stringify(result, null, 2));
  } finally {
    managedToolsState?.destroy();
    managedResourcesState?.destroy();
    managedResourceTemplatesState?.destroy();
    managedPromptsState?.destroy();
    await inspectorClient.disconnect();
  }
}
function parseKeyValuePair2(value, previous = {}) {
  const parts = value.split("=");
  const key = parts[0];
  const val = parts.slice(1).join("=");
  if (!key || val === void 0 || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`
    );
  }
  let parsedValue;
  try {
    parsedValue = JSON.parse(val);
  } catch {
    parsedValue = val;
  }
  return { ...previous, [key]: parsedValue };
}
function parseArgs(argv) {
  const program = new Command();
  const rawArgs = argv ?? process.argv;
  const scriptArgs = rawArgs.slice(2);
  const dashDashIndex = scriptArgs.indexOf("--");
  let targetArgs = [];
  let optionArgs = [];
  if (dashDashIndex >= 0) {
    targetArgs = scriptArgs.slice(0, dashDashIndex);
    optionArgs = scriptArgs.slice(dashDashIndex + 1);
  } else {
    let i = 0;
    while (i < scriptArgs.length && !scriptArgs[i].startsWith("-")) {
      targetArgs.push(scriptArgs[i]);
      i++;
    }
    optionArgs = scriptArgs.slice(i);
  }
  const preArgs = [
    rawArgs[0] ?? "node",
    rawArgs[1] ?? "inspector-cli",
    ...optionArgs
  ];
  program.name("inspector-cli").allowUnknownOption().argument(
    "[target...]",
    "Command and arguments or URL of the MCP server (or use --config and --server)"
  ).option("--config <path>", "Config file path").option("--server <name>", "Server name from config file").option(
    "-e <env>",
    "Environment variables for the server (KEY=VALUE)",
    parseKeyValuePair,
    {}
  ).option("--method <method>", "Method to invoke").option("--tool-name <toolName>", "Tool name (for tools/call method)").option(
    "--tool-arg <pairs...>",
    "Tool argument as key=value pair",
    parseKeyValuePair2,
    {}
  ).option("--uri <uri>", "URI of the resource (for resources/read method)").option(
    "--prompt-name <promptName>",
    "Name of the prompt (for prompts/get method)"
  ).option(
    "--prompt-args <pairs...>",
    "Prompt arguments as key=value pairs",
    parseKeyValuePair2,
    {}
  ).option(
    "--log-level <level>",
    "Logging level (for logging/setLevel method)",
    (value) => {
      if (!validLogLevels.includes(value)) {
        throw new Error(
          `Invalid log level: ${value}. Valid levels are: ${validLogLevels.join(", ")}`
        );
      }
      return value;
    }
  ).option("--cwd <path>", "Working directory for stdio server process").option(
    "--transport <type>",
    "Transport type (sse, http, or stdio). Auto-detected from URL: /mcp \u2192 http, /sse \u2192 sse, commands \u2192 stdio",
    (value) => {
      const validTransports = ["sse", "http", "stdio"];
      if (!validTransports.includes(value)) {
        throw new Error(
          `Invalid transport type: ${value}. Valid types are: ${validTransports.join(", ")}`
        );
      }
      return value;
    }
  ).option("--server-url <url>", "Server URL for SSE/HTTP transport").option(
    "--header <headers...>",
    'HTTP headers as "HeaderName: Value" pairs (for HTTP/SSE transports)',
    parseHeaderPair,
    {}
  ).option(
    "--metadata <pairs...>",
    "General metadata as key=value pairs (applied to all methods)",
    parseKeyValuePair2,
    {}
  ).option(
    "--tool-metadata <pairs...>",
    "Tool-specific metadata as key=value pairs (for tools/call method only)",
    parseKeyValuePair2,
    {}
  );
  program.parse(preArgs);
  const options = program.opts();
  const serverOptions = {
    configPath: options.config,
    serverName: options.server,
    target: targetArgs.length > 0 ? targetArgs : void 0,
    transport: options.transport,
    serverUrl: options.serverUrl,
    cwd: options.cwd,
    env: options.e
  };
  const configs = resolveLaunchServerConfigs(serverOptions, "single");
  const serverConfig = configs[0];
  if (!serverConfig) {
    throw new Error(
      "Could not resolve server config. Specify a URL or command, or use --config and --server."
    );
  }
  if (!options.method) {
    throw new Error(
      "Method is required. Use --method to specify the method to invoke."
    );
  }
  const methodArgs = {
    method: options.method,
    toolName: options.toolName,
    toolArg: options.toolArg,
    uri: options.uri,
    promptName: options.promptName,
    promptArgs: options.promptArgs,
    logLevel: options.logLevel,
    metadata: options.metadata ? Object.fromEntries(
      Object.entries(options.metadata).map(([key, value]) => [
        key,
        String(value)
      ])
    ) : void 0,
    toolMeta: options.toolMetadata ? Object.fromEntries(
      Object.entries(options.toolMetadata).map(([key, value]) => [
        key,
        String(value)
      ])
    ) : void 0
  };
  return {
    serverConfig,
    serverSettings: headersToServerSettings(options.header),
    methodArgs
  };
}
async function runCli(argv) {
  const { serverConfig, serverSettings, methodArgs } = parseArgs(
    argv ?? process.argv
  );
  await callMethod(serverConfig, serverSettings, methodArgs);
}

// src/index.ts
var __filename = fileURLToPath2(import.meta.url);
var isMain = process.argv[1] !== void 0 && resolve3(process.argv[1]) === resolve3(__filename);
if (isMain) {
  runCli(process.argv).then(() => process.exit(0)).catch(handleError);
}
export {
  runCli,
  validLogLevels
};
//# sourceMappingURL=index.js.map