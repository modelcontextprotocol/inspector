#!/usr/bin/env node

// index.ts
import { resolve as resolve4 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// tui.tsx
import { Command } from "commander";
import { render } from "ink";

// ../../core/mcp/node/config.ts
import { existsSync, readFileSync } from "fs";
import { resolve as resolve2 } from "path";

// ../../core/storage/store-io.ts
import * as path from "path";
import * as fs from "fs/promises";
import { readFile, writeFile } from "atomically";
function getDefaultStorageDir() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "storage");
}
function getDefaultMcpConfigPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "mcp.json");
}
function getStoreFilePath(storageDir, storeId) {
  return path.join(storageDir, `${storeId}.json`);
}
async function readStoreFile(filePath) {
  try {
    const data = await readFile(filePath, { encoding: "utf-8" });
    return data;
  } catch (error) {
    const err = error;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
var pendingWrites = /* @__PURE__ */ new Map();
async function writeStoreFile(filePath, data) {
  const key = path.resolve(filePath);
  const run = async () => {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await writeFile(filePath, data, {
      encoding: "utf-8",
      mode: 384
    });
  };
  const prior = pendingWrites.get(key);
  const tracked = (prior ?? Promise.resolve()).catch(() => {
  }).then(run);
  pendingWrites.set(key, tracked);
  try {
    await tracked;
  } finally {
    if (pendingWrites.get(key) === tracked) {
      pendingWrites.delete(key);
    }
  }
}
async function deleteStoreFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const err = error;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
}

// ../../core/mcp/types.ts
var DEFAULT_TASK_TTL_MS = 6e4;

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
function storedFieldsToInspectorSettings(stored) {
  const hasAny = stored.headers !== void 0 || stored.metadata !== void 0 || stored.connectionTimeout !== void 0 || stored.requestTimeout !== void 0 || stored.taskTtl !== void 0 || stored.autoRefreshOnListChanged !== void 0 || stored.oauth !== void 0 || stored.roots !== void 0;
  if (!hasAny) return void 0;
  const headersPairs = stored.headers ? Object.entries(stored.headers).map(([key, value]) => ({ key, value })) : [];
  const settings = {
    headers: headersPairs,
    metadata: stored.metadata ?? [],
    connectionTimeout: stored.connectionTimeout ?? 0,
    requestTimeout: stored.requestTimeout ?? 0,
    // Unlike the timeouts (0 = "SDK default"), task TTL has a concrete product
    // default so the form shows it and "Run as task" has a value to send.
    taskTtl: stored.taskTtl ?? DEFAULT_TASK_TTL_MS,
    autoRefreshOnListChanged: stored.autoRefreshOnListChanged ?? false,
    // Defaults to an empty list so the form always has a concrete array to
    // render controlled rows from. An absent on-disk `roots` reads back as
    // `[]`, which `inspectorSettingsToStoredFields` then omits on write.
    roots: stored.roots ?? []
  };
  if (stored.oauth?.clientId) settings.oauthClientId = stored.oauth.clientId;
  if (stored.oauth?.clientSecret)
    settings.oauthClientSecret = stored.oauth.clientSecret;
  if (stored.oauth?.scopes) settings.oauthScopes = stored.oauth.scopes;
  return settings;
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
function mcpConfigToServerEntries(config) {
  return Object.entries(config.mcpServers).map(([id, raw]) => {
    const inspectorFields = {};
    const sdkOnly = {};
    for (const [k, v] of Object.entries(raw)) {
      if (INSPECTOR_FIELD_KEYS.has(k)) {
        inspectorFields[k] = v;
      } else {
        sdkOnly[k] = v;
      }
    }
    const normalizedConfig = normalizeServerType(
      sdkOnly
    );
    const entry = {
      id,
      name: id,
      config: normalizedConfig,
      connection: { status: "disconnected" }
    };
    const settings = storedFieldsToInspectorSettings(inspectorFields);
    if (settings !== void 0) entry.settings = settings;
    return entry;
  });
}

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

// ../../core/mcp/node/transport.ts
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

// ../../core/mcp/node/transport.ts
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

// src/App.tsx
import {
  useState as useState17,
  useMemo as useMemo2,
  useEffect as useEffect17,
  useCallback as useCallback8,
  useRef as useRef10
} from "react";
import { Box as Box15, Text as Text15, useInput as useInput13, useApp } from "ink";
import { readFileSync as readFileSync2 } from "fs";
import { fileURLToPath } from "url";
import { dirname as dirname2, join as join2 } from "path";

// ../../core/mcp/inspectorClient.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

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
  constructor(request, resolve5, reject, onRemove) {
    this.onRemove = onRemove;
    this.id = `sampling-${crypto.randomUUID()}`;
    this.timestamp = /* @__PURE__ */ new Date();
    this.request = request;
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY];
    this.taskId = relatedTask?.taskId;
    this.resolvePromise = resolve5;
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
  constructor(request, resolve5, onRemove, reject) {
    this.onRemove = onRemove;
    this.id = `elicitation-${crypto.randomUUID()}`;
    this.timestamp = /* @__PURE__ */ new Date();
    this.request = request;
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY2];
    this.taskId = relatedTask?.taskId;
    this.resolvePromise = resolve5;
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

// ../../core/auth/utils.ts
var parseOAuthCallbackParams = (location) => {
  const params = new URLSearchParams(location);
  const code = params.get("code");
  if (code) {
    return { successful: true, code };
  }
  const error = params.get("error");
  const error_description = params.get("error_description");
  const error_uri = params.get("error_uri");
  if (error) {
    return { successful: false, error, error_description, error_uri };
  }
  return {
    successful: false,
    error: "invalid_request",
    error_description: "Missing code or error in response",
    error_uri: null
  };
};
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
var generateOAuthErrorDescription = (params) => {
  const error = params.error;
  const errorDescription = params.error_description;
  const errorUri = params.error_uri;
  return [
    `Error: ${error}.`,
    errorDescription ? `Details: ${errorDescription}.` : "",
    errorUri ? `More info: ${errorUri}.` : ""
  ].filter(Boolean).join("\n");
};

// ../../core/auth/providers.ts
var MutableRedirectUrlProvider = class {
  redirectUrl = "";
  getRedirectUrl() {
    return this.redirectUrl;
  }
};
var CallbackNavigation = class {
  authorizationUrl = null;
  callback;
  constructor(callback) {
    this.callback = callback;
  }
  navigateToAuthorization(authorizationUrl) {
    this.authorizationUrl = authorizationUrl;
    const result = this.callback(authorizationUrl);
    if (result instanceof Promise) {
      void result;
    }
  }
  getAuthorizationUrl() {
    return this.authorizationUrl;
  }
};
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
    const payloadPromise = new Promise((resolve5, reject) => {
      resolvePayload = resolve5;
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
          return new Promise((resolve5, reject) => {
            const samplingRequest = new SamplingCreateMessage(
              request,
              (result) => {
                resolve5(result);
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
          return new Promise((resolve5) => {
            const elicitationRequest = new ElicitationCreateMessage(
              request,
              (result) => {
                resolve5(result);
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
    return new Promise((resolve5) => {
      const request = {
        method: "elicitation/create",
        params
      };
      const message = new ElicitationCreateMessage(
        request,
        (result) => resolve5(result.action),
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

// ../../core/mcp/state/messageLogState.ts
var MessageLogState = class extends TypedEventTarget {
  messages = [];
  /** Pending request entries by JSON-RPC message id for matching responses. */
  pendingRequestEntries = /* @__PURE__ */ new Map();
  client = null;
  unsubscribe = null;
  maxMessages;
  constructor(client, options = {}) {
    super();
    this.maxMessages = options.maxMessages ?? 1e3;
    this.client = client;
    const pushEntry = (entry) => {
      if (this.maxMessages > 0 && this.messages.length >= this.maxMessages) {
        this.messages.shift();
      }
      this.messages.push(entry);
      this.dispatchTypedEvent("message", entry);
      this.dispatchTypedEvent("messagesChange", this.getMessages());
    };
    const onMessage = (event) => {
      const entry = event.detail;
      if (entry.direction === "request") {
        const reqId = "id" in entry.message ? entry.message.id : void 0;
        if (reqId !== void 0) {
          this.pendingRequestEntries.set(reqId, entry);
        }
        pushEntry(entry);
        return;
      }
      if (entry.direction === "response") {
        const messageId = "id" in entry.message ? entry.message.id : void 0;
        const requestEntry = messageId !== void 0 ? this.pendingRequestEntries.get(messageId) : void 0;
        if (requestEntry) {
          this.pendingRequestEntries.delete(messageId);
          requestEntry.response = entry.message;
          requestEntry.duration = entry.timestamp.getTime() - requestEntry.timestamp.getTime();
          this.dispatchTypedEvent("message", requestEntry);
          this.dispatchTypedEvent("messagesChange", this.getMessages());
          return;
        }
      }
      pushEntry(entry);
    };
    const onStatusChange = () => {
      if (this.client?.getStatus() === "disconnected") {
        this.messages = [];
        this.pendingRequestEntries.clear();
        this.dispatchTypedEvent("messagesChange", []);
      }
    };
    this.client.addEventListener("message", onMessage);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("message", onMessage);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }
  getMessages(predicate) {
    if (predicate) {
      return this.messages.filter(predicate);
    }
    return [...this.messages];
  }
  /**
   * Remove messages from history. When `predicate` is provided, removes only
   * entries for which predicate returns true. When omitted, clears all messages.
   * Dispatches messagesChange only if the list actually changed.
   */
  clearMessages(predicate) {
    const before = this.messages.length;
    this.messages = predicate ? this.messages.filter((m) => !predicate(m)) : [];
    if (predicate) {
      const survivors = new Set(this.messages);
      for (const [id, entry] of this.pendingRequestEntries) {
        if (!survivors.has(entry)) {
          this.pendingRequestEntries.delete(id);
        }
      }
    } else {
      this.pendingRequestEntries.clear();
    }
    if (this.messages.length !== before) {
      this.dispatchTypedEvent("messagesChange", this.getMessages());
    }
  }
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.messages = [];
    this.pendingRequestEntries.clear();
  }
};

// ../../core/mcp/state/fetchRequestLogState.ts
var FetchRequestLogState = class extends TypedEventTarget {
  fetchRequests = [];
  client = null;
  unsubscribe = null;
  maxFetchRequests;
  constructor(client, options = {}) {
    super();
    this.maxFetchRequests = options.maxFetchRequests ?? 1e3;
    this.client = client;
    const onFetchRequest = (event) => {
      const entry = event.detail;
      if (this.maxFetchRequests > 0 && this.fetchRequests.length >= this.maxFetchRequests) {
        this.fetchRequests.shift();
      }
      this.fetchRequests.push(entry);
      this.dispatchTypedEvent("fetchRequest", entry);
      this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
    };
    this.client.addEventListener("fetchRequest", onFetchRequest);
    const onFetchRequestBodyUpdate = (event) => {
      const { id, responseBody } = event.detail;
      const idx = this.fetchRequests.findIndex((e) => e.id === id);
      if (idx === -1) return;
      this.fetchRequests[idx] = {
        ...this.fetchRequests[idx],
        responseBody
      };
      this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
    };
    this.client.addEventListener(
      "fetchRequestBodyUpdate",
      onFetchRequestBodyUpdate
    );
    const sessionStorage = options.sessionStorage;
    const sessionId = options.sessionId;
    if (sessionStorage) {
      const onSaveSession = (event) => {
        const { sessionId: id } = event.detail;
        const state = {
          fetchRequests: this.getFetchRequests(),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        sessionStorage.saveSession(id, state).catch(() => {
        });
      };
      this.client.addEventListener("saveSession", onSaveSession);
      this.unsubscribe = () => {
        if (this.client) {
          this.client.removeEventListener("fetchRequest", onFetchRequest);
          this.client.removeEventListener(
            "fetchRequestBodyUpdate",
            onFetchRequestBodyUpdate
          );
          this.client.removeEventListener("saveSession", onSaveSession);
        }
        this.client = null;
      };
      if (sessionId) {
        sessionStorage.loadSession(sessionId).then((state) => {
          if (this.client && state?.fetchRequests?.length) {
            this.hydrateFetchRequests(state.fetchRequests);
          }
        }).catch(() => {
        });
      }
    } else {
      this.unsubscribe = () => {
        if (this.client) {
          this.client.removeEventListener("fetchRequest", onFetchRequest);
          this.client.removeEventListener(
            "fetchRequestBodyUpdate",
            onFetchRequestBodyUpdate
          );
        }
        this.client = null;
      };
    }
  }
  // Restore persisted entries (e.g. the pre-redirect OAuth Network log loaded
  // on the `/oauth/callback` page). Merges rather than replaces: the async
  // load races against entries appended live by the resuming connect
  // (`completeOAuthFlow` + transport handshake), so we must not clobber
  // whichever arrived first. Restored entries are older, so they go in front;
  // duplicates (by id) already present from a live append are skipped.
  hydrateFetchRequests(entries) {
    if (entries.length === 0) return;
    const existingIds = new Set(this.fetchRequests.map((e) => e.id));
    const restored = entries.filter((e) => !existingIds.has(e.id));
    if (restored.length === 0) return;
    const merged = [...restored, ...this.fetchRequests];
    this.fetchRequests = this.maxFetchRequests > 0 ? merged.slice(-this.maxFetchRequests) : merged;
    this.dispatchTypedEvent("fetchRequestsChange", this.getFetchRequests());
  }
  getFetchRequests() {
    return [...this.fetchRequests];
  }
  /**
   * Clear all fetch requests. Dispatches fetchRequestsChange only if the list
   * was non-empty.
   */
  clearFetchRequests() {
    if (this.fetchRequests.length === 0) return;
    this.fetchRequests = [];
    this.dispatchTypedEvent("fetchRequestsChange", []);
  }
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.fetchRequests = [];
  }
};

// ../../core/mcp/state/stderrLogState.ts
var StderrLogState = class extends TypedEventTarget {
  stderrLogs = [];
  client = null;
  unsubscribe = null;
  maxStderrLogEvents;
  constructor(client, options = {}) {
    super();
    this.maxStderrLogEvents = options.maxStderrLogEvents ?? 1e3;
    this.client = client;
    const onStderrLog = (event) => {
      const entry = event.detail;
      if (this.maxStderrLogEvents > 0 && this.stderrLogs.length >= this.maxStderrLogEvents) {
        this.stderrLogs.shift();
      }
      this.stderrLogs.push(entry);
      this.dispatchTypedEvent("stderrLog", entry);
      this.dispatchTypedEvent("stderrLogsChange", this.getStderrLogs());
    };
    this.client.addEventListener("stderrLog", onStderrLog);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("stderrLog", onStderrLog);
      }
      this.client = null;
    };
  }
  getStderrLogs() {
    return [...this.stderrLogs];
  }
  /**
   * Clear all stderr log entries. Dispatches stderrLogsChange only if the
   * list was non-empty.
   */
  clearStderrLogs() {
    if (this.stderrLogs.length === 0) return;
    this.stderrLogs = [];
    this.dispatchTypedEvent("stderrLogsChange", []);
  }
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stderrLogs = [];
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

// ../../core/react/useInspectorClient.ts
import { useState, useEffect, useCallback } from "react";
var EMPTY_CLIENT_CAPABILITIES = Object.freeze({});
function useInspectorClient(inspectorClient) {
  const [status, setStatus] = useState(
    inspectorClient?.getStatus() ?? "disconnected"
  );
  const [capabilities, setCapabilities] = useState(inspectorClient?.getCapabilities());
  const [serverInfo, setServerInfo] = useState(
    inspectorClient?.getServerInfo()
  );
  const [instructions, setInstructions] = useState(
    inspectorClient?.getInstructions()
  );
  const [protocolVersion, setProtocolVersion] = useState(
    inspectorClient?.getProtocolVersion()
  );
  useEffect(() => {
    if (!inspectorClient) {
      setStatus("disconnected");
      setCapabilities(void 0);
      setServerInfo(void 0);
      setInstructions(void 0);
      setProtocolVersion(void 0);
      return;
    }
    setStatus(inspectorClient.getStatus());
    setCapabilities(inspectorClient.getCapabilities());
    setServerInfo(inspectorClient.getServerInfo());
    setInstructions(inspectorClient.getInstructions());
    setProtocolVersion(inspectorClient.getProtocolVersion());
    const onStatusChange = (event) => {
      setStatus(event.detail);
    };
    const onCapabilitiesChange = (event) => {
      setCapabilities(event.detail);
    };
    const onServerInfoChange = (event) => {
      setServerInfo(event.detail);
    };
    const onInstructionsChange = (event) => {
      setInstructions(event.detail);
    };
    const onProtocolVersionChange = (event) => {
      setProtocolVersion(event.detail);
    };
    inspectorClient.addEventListener("statusChange", onStatusChange);
    inspectorClient.addEventListener(
      "capabilitiesChange",
      onCapabilitiesChange
    );
    inspectorClient.addEventListener("serverInfoChange", onServerInfoChange);
    inspectorClient.addEventListener(
      "instructionsChange",
      onInstructionsChange
    );
    inspectorClient.addEventListener(
      "protocolVersionChange",
      onProtocolVersionChange
    );
    return () => {
      inspectorClient.removeEventListener("statusChange", onStatusChange);
      inspectorClient.removeEventListener(
        "capabilitiesChange",
        onCapabilitiesChange
      );
      inspectorClient.removeEventListener(
        "serverInfoChange",
        onServerInfoChange
      );
      inspectorClient.removeEventListener(
        "instructionsChange",
        onInstructionsChange
      );
      inspectorClient.removeEventListener(
        "protocolVersionChange",
        onProtocolVersionChange
      );
    };
  }, [inspectorClient]);
  const connect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.connect();
  }, [inspectorClient]);
  const disconnect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.disconnect();
  }, [inspectorClient]);
  return {
    status,
    capabilities,
    // Read lazily on every render rather than subscribed: client capabilities
    // are built once in InspectorClient's constructor (from `sample`, `elicit`,
    // `roots`, `receiverTasks`) and never mutate during a session, so there's
    // no event to subscribe to. The module-scope frozen empty object is the
    // stable fallback when no client is attached.
    clientCapabilities: inspectorClient?.getClientCapabilities() ?? EMPTY_CLIENT_CAPABILITIES,
    serverInfo,
    instructions,
    protocolVersion,
    appRendererClient: inspectorClient?.getAppRendererClient() ?? null,
    connect,
    disconnect
  };
}

// ../../core/react/useManagedTools.ts
import { useState as useState2, useEffect as useEffect2, useCallback as useCallback2 } from "react";
function useManagedTools(client, managedToolsState) {
  const [tools, setTools] = useState2(
    managedToolsState?.getTools() ?? []
  );
  const [listChanged, setListChanged] = useState2(
    managedToolsState?.getListChanged() ?? false
  );
  useEffect2(() => {
    if (!managedToolsState) {
      setTools([]);
      setListChanged(false);
      return;
    }
    setTools(managedToolsState.getTools());
    setListChanged(managedToolsState.getListChanged());
    const onToolsChange = (event) => {
      setTools(event.detail);
    };
    const onListChangedChange = (event) => {
      setListChanged(event.detail);
    };
    managedToolsState.addEventListener("toolsChange", onToolsChange);
    managedToolsState.addEventListener(
      "listChangedChange",
      onListChangedChange
    );
    return () => {
      managedToolsState.removeEventListener("toolsChange", onToolsChange);
      managedToolsState.removeEventListener(
        "listChangedChange",
        onListChangedChange
      );
    };
  }, [managedToolsState]);
  const refresh = useCallback2(async () => {
    if (!managedToolsState || !client) return [];
    managedToolsState.clearListChanged();
    const next = await managedToolsState.refresh();
    setTools(next);
    return next;
  }, [client, managedToolsState]);
  return { tools, listChanged, refresh };
}

// ../../core/react/useManagedResources.ts
import { useState as useState3, useEffect as useEffect3, useCallback as useCallback3 } from "react";
function useManagedResources(client, managedResourcesState) {
  const [resources, setResources] = useState3(
    managedResourcesState?.getResources() ?? []
  );
  const [listChanged, setListChanged] = useState3(
    managedResourcesState?.getListChanged() ?? false
  );
  useEffect3(() => {
    if (!managedResourcesState) {
      setResources([]);
      setListChanged(false);
      return;
    }
    setResources(managedResourcesState.getResources());
    setListChanged(managedResourcesState.getListChanged());
    const onResourcesChange = (event) => {
      setResources(event.detail);
    };
    const onListChangedChange = (event) => {
      setListChanged(event.detail);
    };
    managedResourcesState.addEventListener(
      "resourcesChange",
      onResourcesChange
    );
    managedResourcesState.addEventListener(
      "listChangedChange",
      onListChangedChange
    );
    return () => {
      managedResourcesState.removeEventListener(
        "resourcesChange",
        onResourcesChange
      );
      managedResourcesState.removeEventListener(
        "listChangedChange",
        onListChangedChange
      );
    };
  }, [managedResourcesState]);
  const refresh = useCallback3(async () => {
    if (!managedResourcesState || !client) return [];
    managedResourcesState.clearListChanged();
    const next = await managedResourcesState.refresh();
    setResources(next);
    return next;
  }, [client, managedResourcesState]);
  return { resources, listChanged, refresh };
}

// ../../core/react/useManagedResourceTemplates.ts
import { useState as useState4, useEffect as useEffect4, useCallback as useCallback4 } from "react";
function useManagedResourceTemplates(client, managedResourceTemplatesState) {
  const [resourceTemplates, setResourceTemplates] = useState4(managedResourceTemplatesState?.getResourceTemplates() ?? []);
  useEffect4(() => {
    if (!managedResourceTemplatesState) {
      setResourceTemplates([]);
      return;
    }
    setResourceTemplates(managedResourceTemplatesState.getResourceTemplates());
    const onResourceTemplatesChange = (event) => {
      setResourceTemplates(event.detail);
    };
    managedResourceTemplatesState.addEventListener(
      "resourceTemplatesChange",
      onResourceTemplatesChange
    );
    return () => {
      managedResourceTemplatesState.removeEventListener(
        "resourceTemplatesChange",
        onResourceTemplatesChange
      );
    };
  }, [managedResourceTemplatesState]);
  const refresh = useCallback4(async () => {
    if (!managedResourceTemplatesState || !client) return [];
    const next = await managedResourceTemplatesState.refresh();
    setResourceTemplates(next);
    return next;
  }, [client, managedResourceTemplatesState]);
  return { resourceTemplates, refresh };
}

// ../../core/react/useManagedPrompts.ts
import { useState as useState5, useEffect as useEffect5, useCallback as useCallback5 } from "react";
function useManagedPrompts(client, managedPromptsState) {
  const [prompts, setPrompts] = useState5(
    managedPromptsState?.getPrompts() ?? []
  );
  const [listChanged, setListChanged] = useState5(
    managedPromptsState?.getListChanged() ?? false
  );
  useEffect5(() => {
    if (!managedPromptsState) {
      setPrompts([]);
      setListChanged(false);
      return;
    }
    setPrompts(managedPromptsState.getPrompts());
    setListChanged(managedPromptsState.getListChanged());
    const onPromptsChange = (event) => {
      setPrompts(event.detail);
    };
    const onListChangedChange = (event) => {
      setListChanged(event.detail);
    };
    managedPromptsState.addEventListener("promptsChange", onPromptsChange);
    managedPromptsState.addEventListener(
      "listChangedChange",
      onListChangedChange
    );
    return () => {
      managedPromptsState.removeEventListener(
        "promptsChange",
        onPromptsChange
      );
      managedPromptsState.removeEventListener(
        "listChangedChange",
        onListChangedChange
      );
    };
  }, [managedPromptsState]);
  const refresh = useCallback5(async () => {
    if (!managedPromptsState || !client) return [];
    managedPromptsState.clearListChanged();
    const next = await managedPromptsState.refresh();
    setPrompts(next);
    return next;
  }, [client, managedPromptsState]);
  return { prompts, listChanged, refresh };
}

// ../../core/react/useMessageLog.ts
import { useState as useState6, useEffect as useEffect6 } from "react";
function useMessageLog(messageLogState) {
  const [messages, setMessages] = useState6(
    messageLogState?.getMessages() ?? []
  );
  useEffect6(() => {
    if (!messageLogState) {
      setMessages([]);
      return;
    }
    setMessages(messageLogState.getMessages());
    const onMessagesChange = (event) => {
      setMessages(event.detail);
    };
    messageLogState.addEventListener("messagesChange", onMessagesChange);
    return () => {
      messageLogState.removeEventListener("messagesChange", onMessagesChange);
    };
  }, [messageLogState]);
  return { messages };
}

// ../../core/react/useFetchRequestLog.ts
import { useState as useState7, useEffect as useEffect7 } from "react";
function useFetchRequestLog(fetchRequestLogState) {
  const [fetchRequests, setFetchRequests] = useState7(
    fetchRequestLogState?.getFetchRequests() ?? []
  );
  useEffect7(() => {
    if (!fetchRequestLogState) {
      setFetchRequests([]);
      return;
    }
    setFetchRequests(fetchRequestLogState.getFetchRequests());
    const onFetchRequestsChange = (event) => {
      setFetchRequests(event.detail);
    };
    fetchRequestLogState.addEventListener(
      "fetchRequestsChange",
      onFetchRequestsChange
    );
    return () => {
      fetchRequestLogState.removeEventListener(
        "fetchRequestsChange",
        onFetchRequestsChange
      );
    };
  }, [fetchRequestLogState]);
  return { fetchRequests };
}

// ../../core/react/useStderrLog.ts
import { useState as useState8, useEffect as useEffect8 } from "react";
function useStderrLog(stderrLogState) {
  const [stderrLogs, setStderrLogs] = useState8(
    stderrLogState?.getStderrLogs() ?? []
  );
  useEffect8(() => {
    if (!stderrLogState) {
      setStderrLogs([]);
      return;
    }
    setStderrLogs(stderrLogState.getStderrLogs());
    const onStderrLogsChange = (event) => {
      setStderrLogs(event.detail);
    };
    stderrLogState.addEventListener("stderrLogsChange", onStderrLogsChange);
    return () => {
      stderrLogState.removeEventListener(
        "stderrLogsChange",
        onStderrLogsChange
      );
    };
  }, [stderrLogState]);
  return { stderrLogs };
}

// ../../core/auth/oauth-storage.ts
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema
} from "@modelcontextprotocol/sdk/shared/auth.js";
var OAuthStorageBase = class {
  store;
  constructor(store) {
    this.store = store;
  }
  async getClientInformation(serverUrl, isPreregistered) {
    const state = this.store.getState().getServerState(serverUrl);
    const clientInfo = isPreregistered ? state.preregisteredClientInformation : state.clientInformation;
    if (!clientInfo) {
      return void 0;
    }
    return await OAuthClientInformationSchema.parseAsync(clientInfo);
  }
  async saveClientInformation(serverUrl, clientInformation) {
    this.store.getState().setServerState(serverUrl, {
      clientInformation
    });
  }
  async savePreregisteredClientInformation(serverUrl, clientInformation) {
    this.store.getState().setServerState(serverUrl, {
      preregisteredClientInformation: clientInformation
    });
  }
  clearClientInformation(serverUrl, isPreregistered) {
    const updates = {};
    if (isPreregistered) {
      updates.preregisteredClientInformation = void 0;
    } else {
      updates.clientInformation = void 0;
    }
    this.store.getState().setServerState(serverUrl, updates);
  }
  async getTokens(serverUrl) {
    const state = this.store.getState().getServerState(serverUrl);
    if (!state.tokens) {
      return void 0;
    }
    return await OAuthTokensSchema.parseAsync(state.tokens);
  }
  async saveTokens(serverUrl, tokens) {
    this.store.getState().setServerState(serverUrl, { tokens });
  }
  clearTokens(serverUrl) {
    this.store.getState().setServerState(serverUrl, { tokens: void 0 });
  }
  getCodeVerifier(serverUrl) {
    const state = this.store.getState().getServerState(serverUrl);
    return state.codeVerifier;
  }
  async saveCodeVerifier(serverUrl, codeVerifier) {
    this.store.getState().setServerState(serverUrl, { codeVerifier });
  }
  clearCodeVerifier(serverUrl) {
    this.store.getState().setServerState(serverUrl, { codeVerifier: void 0 });
  }
  getScope(serverUrl) {
    const state = this.store.getState().getServerState(serverUrl);
    return state.scope;
  }
  async saveScope(serverUrl, scope) {
    this.store.getState().setServerState(serverUrl, { scope });
  }
  clearScope(serverUrl) {
    this.store.getState().setServerState(serverUrl, { scope: void 0 });
  }
  getServerMetadata(serverUrl) {
    const state = this.store.getState().getServerState(serverUrl);
    return state.serverMetadata || null;
  }
  async saveServerMetadata(serverUrl, metadata) {
    this.store.getState().setServerState(serverUrl, { serverMetadata: metadata });
  }
  clearServerMetadata(serverUrl) {
    this.store.getState().setServerState(serverUrl, { serverMetadata: void 0 });
  }
  clear(serverUrl) {
    this.store.getState().clearServerState(serverUrl);
  }
};

// ../../core/auth/store.ts
import { createStore } from "zustand/vanilla";
import { persist } from "zustand/middleware";
function createOAuthStore(storage) {
  return createStore()(
    persist(
      (set, get) => ({
        servers: {},
        getServerState: (serverUrl) => {
          return get().servers[serverUrl] || {};
        },
        setServerState: (serverUrl, updates) => {
          set((state) => ({
            servers: {
              ...state.servers,
              [serverUrl]: {
                ...state.servers[serverUrl],
                ...updates
              }
            }
          }));
        },
        clearServerState: (serverUrl) => {
          set((state) => {
            const rest = { ...state.servers };
            delete rest[serverUrl];
            return { servers: rest };
          });
        }
      }),
      {
        name: "mcp-inspector-oauth",
        storage
      }
    )
  );
}

// ../../core/storage/adapters/file-storage.ts
import { createJSONStorage as createJSONStorage2 } from "zustand/middleware";
function createFileStorageAdapter(options) {
  return createJSONStorage2(() => ({
    getItem: async () => readStoreFile(options.filePath),
    // Do not introduce an `await` before writeStoreFile() here: it registers
    // the write in pendingWrites synchronously, which is load-bearing for
    // flushStoreFileWrites() (a microtask hop before registration would make a
    // flush called right after setItem find an empty map and return early,
    // silently regressing tests to non-deterministic).
    setItem: async (_name, value) => writeStoreFile(options.filePath, value),
    removeItem: async () => deleteStoreFile(options.filePath)
  }));
}

// ../../core/auth/node/storage-node.ts
var DEFAULT_STATE_PATH = getStoreFilePath(getDefaultStorageDir(), "oauth");
function getStateFilePath(customPath) {
  return customPath ?? DEFAULT_STATE_PATH;
}
var storeCache = /* @__PURE__ */ new Map();
function getOAuthStore(stateFilePath) {
  const key = getStateFilePath(stateFilePath);
  let store = storeCache.get(key);
  if (!store) {
    const filePath = getStateFilePath(stateFilePath);
    const storage = createFileStorageAdapter({ filePath });
    store = createOAuthStore(storage);
    storeCache.set(key, store);
  }
  return store;
}
var NodeOAuthStorage = class extends OAuthStorageBase {
  /**
   * @param storagePath - Optional path to state file. Default: ~/.mcp-inspector/oauth/state.json
   */
  constructor(storagePath) {
    super(getOAuthStore(storagePath));
  }
};

// ../../core/auth/node/oauth-callback-server.ts
import { createServer } from "http";
var DEFAULT_HOSTNAME = "127.0.0.1";
var DEFAULT_CALLBACK_PATH = "/oauth/callback";
var SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth complete</title></head>
<body><p>OAuth complete. You can close this window.</p></body>
</html>`;
function errorHtml(message) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth error</title></head>
<body><p>OAuth failed: ${escapeHtml(message)}</p></body>
</html>`;
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
var OAuthCallbackServer = class {
  server = null;
  port = 0;
  callbackPath = DEFAULT_CALLBACK_PATH;
  handled = false;
  onCallback;
  onError;
  /**
   * Start the server. Listens on the given port (default 0 = random).
   * Returns port and redirectUrl for use as oauth.redirectUrl.
   */
  async start(options = {}) {
    const {
      port = 0,
      hostname = DEFAULT_HOSTNAME,
      path: path3 = DEFAULT_CALLBACK_PATH,
      onCallback,
      onError
    } = options;
    if (!path3.startsWith("/")) {
      return Promise.reject(
        new Error("Callback path must start with '/' (absolute path)")
      );
    }
    this.onCallback = onCallback;
    this.onError = onError;
    this.handled = false;
    this.callbackPath = path3;
    return new Promise((resolve5, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", reject);
      this.server.listen(port, hostname, () => {
        const a = this.server.address();
        if (!a || typeof a === "string") {
          reject(new Error("Failed to get server address"));
          return;
        }
        this.port = a.port;
        resolve5({
          port: this.port,
          redirectUrl: buildRedirectUrl(hostname, this.port, path3)
        });
      });
    });
  }
  /**
   * Stop the server. Idempotent.
   */
  async stop() {
    if (!this.server) return;
    await new Promise((resolve5) => {
      this.server.close(() => resolve5());
    });
    this.server = null;
  }
  handleRequest(req, res) {
    const needJson = req.headers["accept"]?.includes("application/json");
    const send = (status, body, contentType = "text/html; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    };
    if (req.method !== "GET") {
      send(405, needJson ? '{"error":"Method Not Allowed"}' : SUCCESS_HTML);
      return;
    }
    let pathname;
    let search;
    let state;
    try {
      const u = new URL(req.url ?? "", "http://placeholder");
      pathname = u.pathname;
      search = u.search;
      state = u.searchParams.get("state") ?? void 0;
    } catch {
      send(400, needJson ? '{"error":"Bad Request"}' : SUCCESS_HTML);
      return;
    }
    if (pathname !== this.callbackPath) {
      send(404, needJson ? '{"error":"Not Found"}' : SUCCESS_HTML);
      return;
    }
    if (this.handled) {
      send(
        409,
        needJson ? '{"error":"Callback already handled"}' : SUCCESS_HTML
      );
      return;
    }
    const params = parseOAuthCallbackParams(search);
    if (params.successful) {
      this.handled = true;
      const cb = this.onCallback;
      if (cb) {
        cb({ code: params.code, state }).then(() => {
          send(200, SUCCESS_HTML);
          void this.stop();
        }).catch((err) => {
          const msg2 = err instanceof Error ? err.message : String(err);
          this.onError?.({ error: "callback_error", error_description: msg2 });
          send(500, errorHtml(msg2));
          void this.stop();
        });
      } else {
        send(200, SUCCESS_HTML);
        void this.stop();
      }
      return;
    }
    this.handled = true;
    const msg = generateOAuthErrorDescription(params);
    this.onError?.({
      error: params.error,
      error_description: params.error_description ?? void 0
    });
    send(400, errorHtml(msg));
  }
};
function createOAuthCallbackServer() {
  return new OAuthCallbackServer();
}
function buildRedirectUrl(host, port, path3) {
  const needsBrackets = host.includes(":") && !host.startsWith("[");
  const formattedHost = needsBrackets ? `[${host}]` : host;
  return `http://${formattedHost}:${port}${path3}`;
}

// src/logger.ts
import path2 from "path";
import pino from "pino";
var tuiLoggerInstance;
function getTuiLogger() {
  if (!tuiLoggerInstance) {
    const logDir = process.env.MCP_INSPECTOR_LOG_DIR ?? path2.join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".mcp-inspector"
    );
    const logPath = path2.join(logDir, "auth.log");
    tuiLoggerInstance = pino(
      {
        name: "mcp-inspector-tui",
        level: process.env.LOG_LEVEL ?? "info"
      },
      pino.destination({ dest: logPath, append: true, mkdir: true })
    );
  }
  return tuiLoggerInstance;
}

// src/utils/openUrl.ts
import open from "open";
async function openUrl(url) {
  await open(typeof url === "string" ? url : url.href);
}

// src/components/Tabs.tsx
import { Box, Text } from "ink";

// src/components/tabsConfig.ts
var tabs = [
  { id: "info", label: "Info", accelerator: "i" },
  { id: "auth", label: "Auth", accelerator: "a" },
  { id: "resources", label: "Resources", accelerator: "r" },
  { id: "prompts", label: "Prompts", accelerator: "p" },
  { id: "tools", label: "Tools", accelerator: "t" },
  { id: "messages", label: "Messages", accelerator: "m" },
  { id: "requests", label: "HTTP Requests", accelerator: "h" },
  { id: "logging", label: "Logging", accelerator: "l" }
];

// src/components/Tabs.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function Tabs({
  activeTab,
  width,
  counts = {},
  focused = false,
  showAuth = true,
  showLogging = true,
  showRequests = false
}) {
  let visibleTabs = tabs;
  if (!showAuth) {
    visibleTabs = visibleTabs.filter((tab) => tab.id !== "auth");
  }
  if (!showLogging) {
    visibleTabs = visibleTabs.filter((tab) => tab.id !== "logging");
  }
  if (!showRequests) {
    visibleTabs = visibleTabs.filter((tab) => tab.id !== "requests");
  }
  return /* @__PURE__ */ jsx(
    Box,
    {
      width,
      flexShrink: 0,
      borderStyle: "single",
      borderTop: false,
      borderLeft: false,
      borderRight: false,
      borderBottom: true,
      flexDirection: "row",
      justifyContent: "space-between",
      flexWrap: "wrap",
      paddingX: 1,
      children: visibleTabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const count = counts[tab.id];
        const countText = count !== void 0 ? ` (${count})` : "";
        const firstChar = tab.label[0];
        const restOfLabel = tab.label.slice(1);
        return /* @__PURE__ */ jsx(Box, { flexShrink: 0, children: /* @__PURE__ */ jsxs(
          Text,
          {
            bold: isActive,
            ...isActive && focused ? {} : { color: isActive ? "cyan" : "gray" },
            backgroundColor: isActive && focused ? "yellow" : void 0,
            children: [
              isActive ? "\u25B6 " : "  ",
              /* @__PURE__ */ jsx(Text, { underline: true, children: firstChar }),
              restOfLabel,
              countText
            ]
          }
        ) }, tab.id);
      })
    }
  );
}

// src/components/InfoTab.tsx
import { useRef } from "react";
import { Box as Box2, Text as Text2, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function InfoTab({
  serverName,
  serverConfig,
  serverState,
  width,
  height,
  focused = false
}) {
  const scrollViewRef = useRef(null);
  useInput(
    (input, key) => {
      if (focused) {
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    { isActive: focused }
  );
  return /* @__PURE__ */ jsxs2(Box2, { width, height, flexDirection: "column", paddingX: 1, children: [
    /* @__PURE__ */ jsx2(Box2, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx2(Text2, { bold: true, backgroundColor: focused ? "yellow" : void 0, children: "Info" }) }),
    serverName ? /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx2(Box2, { height: height - 4, overflow: "hidden", paddingTop: 1, children: /* @__PURE__ */ jsxs2(ScrollView, { ref: scrollViewRef, height: height - 4, children: [
        /* @__PURE__ */ jsx2(Box2, { flexShrink: 0, marginTop: 1, children: /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Server Configuration" }) }),
        serverConfig ? /* @__PURE__ */ jsx2(
          Box2,
          {
            flexShrink: 0,
            marginTop: 1,
            paddingLeft: 2,
            flexDirection: "column",
            children: serverConfig.type === void 0 || serverConfig.type === "stdio" ? /* @__PURE__ */ jsxs2(Fragment, { children: [
              /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Type: stdio" }),
              /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "Command: ",
                serverConfig.command
              ] }),
              serverConfig.args && serverConfig.args.length > 0 && /* @__PURE__ */ jsxs2(Box2, { marginTop: 1, flexDirection: "column", children: [
                /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Args:" }),
                serverConfig.args.map((arg, idx) => /* @__PURE__ */ jsx2(
                  Box2,
                  {
                    paddingLeft: 2,
                    marginTop: idx === 0 ? 0 : 0,
                    children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: arg })
                  },
                  `arg-${idx}`
                ))
              ] }),
              serverConfig.env && Object.keys(serverConfig.env).length > 0 && /* @__PURE__ */ jsx2(Box2, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "Env:",
                " ",
                Object.entries(serverConfig.env).map(([k, v]) => `${k}=${v}`).join(", ")
              ] }) }),
              serverConfig.cwd && /* @__PURE__ */ jsx2(Box2, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "CWD: ",
                serverConfig.cwd
              ] }) })
            ] }) : serverConfig.type === "sse" ? /* @__PURE__ */ jsxs2(Fragment, { children: [
              /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Type: sse" }),
              /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "URL: ",
                serverConfig.url
              ] }),
              serverConfig.headers && Object.keys(serverConfig.headers).length > 0 && /* @__PURE__ */ jsx2(Box2, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "Headers:",
                " ",
                Object.entries(serverConfig.headers).map(([k, v]) => `${k}=${v}`).join(", ")
              ] }) })
            ] }) : serverConfig.type === "streamable-http" ? /* @__PURE__ */ jsxs2(Fragment, { children: [
              /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Type: streamable-http" }),
              /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "URL: ",
                serverConfig.url
              ] }),
              serverConfig.headers && Object.keys(serverConfig.headers).length > 0 && /* @__PURE__ */ jsx2(Box2, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                "Headers:",
                " ",
                Object.entries(serverConfig.headers).map(([k, v]) => `${k}=${v}`).join(", ")
              ] }) })
            ] }) : null
          }
        ) : /* @__PURE__ */ jsx2(Box2, { marginTop: 1, paddingLeft: 2, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "No configuration available" }) }),
        serverState && serverState.status === "connected" && serverState.serverInfo && /* @__PURE__ */ jsxs2(Fragment, { children: [
          /* @__PURE__ */ jsx2(Box2, { flexShrink: 0, marginTop: 2, children: /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Server Information" }) }),
          /* @__PURE__ */ jsxs2(
            Box2,
            {
              flexShrink: 0,
              marginTop: 1,
              paddingLeft: 2,
              flexDirection: "column",
              children: [
                serverState.serverInfo.name && /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                  "Name: ",
                  serverState.serverInfo.name
                ] }),
                serverState.serverInfo.version && /* @__PURE__ */ jsx2(Box2, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text2, { dimColor: true, children: [
                  "Version: ",
                  serverState.serverInfo.version
                ] }) }),
                serverState.instructions && /* @__PURE__ */ jsxs2(Box2, { marginTop: 1, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Instructions:" }),
                  /* @__PURE__ */ jsx2(Box2, { paddingLeft: 2, marginTop: 1, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: serverState.instructions }) })
                ] })
              ]
            }
          )
        ] }),
        serverState && serverState.status === "error" && /* @__PURE__ */ jsxs2(Box2, { flexShrink: 0, marginTop: 2, children: [
          /* @__PURE__ */ jsx2(Text2, { bold: true, color: "red", children: "Error" }),
          serverState.error && /* @__PURE__ */ jsx2(Box2, { marginTop: 1, paddingLeft: 2, children: /* @__PURE__ */ jsx2(Text2, { color: "red", children: serverState.error }) })
        ] }),
        serverState && serverState.status === "disconnected" && /* @__PURE__ */ jsx2(Box2, { flexShrink: 0, marginTop: 2, children: /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "Server not connected" }) })
      ] }) }),
      focused && /* @__PURE__ */ jsx2(
        Box2,
        {
          flexShrink: 0,
          height: 1,
          justifyContent: "center",
          backgroundColor: "gray",
          children: /* @__PURE__ */ jsx2(Text2, { bold: true, color: "white", children: "\u2191/\u2193 to scroll, + to zoom" })
        }
      )
    ] }) : null
  ] });
}

// src/components/AuthTab.tsx
import { useState as useState9, useEffect as useEffect9, useCallback as useCallback6, useRef as useRef2 } from "react";
import { Box as Box4, Text as Text4, useInput as useInput2 } from "ink";
import { ScrollView as ScrollView2 } from "ink-scroll-view";

// src/components/SelectableItem.tsx
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function SelectableItem({
  isSelected,
  bold,
  children
}) {
  return /* @__PURE__ */ jsxs3(Box3, { flexShrink: 0, flexDirection: "row", children: [
    /* @__PURE__ */ jsx3(Box3, { width: 2, children: /* @__PURE__ */ jsx3(Text3, { bold, children: isSelected ? "\u25B6 " : "  " }) }),
    /* @__PURE__ */ jsx3(Text3, { bold, children })
  ] });
}

// src/components/AuthTab.tsx
import { Fragment as Fragment2, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var STEP_LABELS = {
  metadata_discovery: "Metadata Discovery",
  client_registration: "Client Registration",
  authorization_redirect: "Preparing Authorization",
  authorization_code: "Request Authorization Code",
  token_request: "Token Request",
  complete: "Authentication Complete"
};
var STEP_ORDER = [
  "metadata_discovery",
  "client_registration",
  "authorization_redirect",
  "authorization_code",
  "token_request",
  "complete"
];
function stepIndex(step) {
  const i = STEP_ORDER.indexOf(step);
  return i >= 0 ? i : 0;
}
function AuthTab({
  serverName,
  inspectorClient,
  oauthStatus,
  oauthMessage,
  width,
  height,
  focused = false,
  selectedAction,
  onSelectedActionChange,
  onQuickAuth,
  onGuidedStart,
  onGuidedAdvance,
  onRunGuidedToCompletion,
  onClearOAuth,
  isOAuthCapable
}) {
  const scrollViewRef = useRef2(null);
  const [oauthState, setOauthState] = useState9(
    void 0
  );
  const [guidedStarted, setGuidedStarted] = useState9(false);
  const [clearedConfirmation, setClearedConfirmation] = useState9(false);
  useEffect9(() => {
    if (!inspectorClient) {
      setOauthState(void 0);
      setGuidedStarted(false);
      return;
    }
    const update = () => setOauthState(inspectorClient.getOAuthState());
    update();
    const onStepChange = () => update();
    inspectorClient.addEventListener("oauthStepChange", onStepChange);
    inspectorClient.addEventListener("oauthComplete", onStepChange);
    return () => {
      inspectorClient.removeEventListener("oauthStepChange", onStepChange);
      inspectorClient.removeEventListener("oauthComplete", onStepChange);
    };
  }, [inspectorClient]);
  useEffect9(() => {
    setGuidedStarted(false);
  }, [serverName]);
  useEffect9(() => {
    if (selectedAction !== "clear") {
      setClearedConfirmation(false);
    }
  }, [selectedAction]);
  const guidedFlowStarted = !!oauthState?.oauthStep;
  const currentStep = oauthState?.oauthStep ?? "metadata_discovery";
  const needsAuthCode = currentStep === "authorization_code" && oauthState?.authorizationUrl;
  const isComplete = currentStep === "complete";
  const handleContinue = useCallback6(async () => {
    if (!guidedStarted) {
      await onGuidedStart();
      setGuidedStarted(true);
    } else if (!needsAuthCode && !isComplete) {
      await onGuidedAdvance();
    }
  }, [
    guidedStarted,
    needsAuthCode,
    isComplete,
    onGuidedStart,
    onGuidedAdvance
  ]);
  useInput2(
    (input, key) => {
      if (!focused || !isOAuthCapable) return;
      const lower = input.toLowerCase();
      if (lower === "g") {
        onSelectedActionChange("guided");
        return;
      }
      if (lower === "q") {
        onSelectedActionChange("quick");
        return;
      }
      if (lower === "s") {
        onSelectedActionChange("clear");
        return;
      }
      if (key.leftArrow) {
        onSelectedActionChange(
          selectedAction === "guided" ? "clear" : selectedAction === "quick" ? "guided" : "quick"
        );
      } else if (key.rightArrow) {
        onSelectedActionChange(
          selectedAction === "guided" ? "quick" : selectedAction === "quick" ? "clear" : "guided"
        );
      } else if (key.upArrow && scrollViewRef.current) {
        scrollViewRef.current.scrollBy(-1);
      } else if (key.downArrow && scrollViewRef.current) {
        scrollViewRef.current.scrollBy(1);
      } else if (key.pageUp && scrollViewRef.current) {
        const h = scrollViewRef.current.getViewportHeight() || 1;
        scrollViewRef.current.scrollBy(-h);
      } else if (key.pageDown && scrollViewRef.current) {
        const h = scrollViewRef.current.getViewportHeight() || 1;
        scrollViewRef.current.scrollBy(h);
      } else if (key.return) {
        if (selectedAction === "guided") onRunGuidedToCompletion();
        else if (selectedAction === "quick") onQuickAuth();
        else if (selectedAction === "clear") {
          onClearOAuth();
          setClearedConfirmation(true);
        }
      } else if (input === " " && selectedAction === "guided") {
        handleContinue();
      }
    },
    {
      isActive: focused
    }
  );
  if (!serverName || !isOAuthCapable) {
    return /* @__PURE__ */ jsx4(Box4, { width, height, paddingX: 1, paddingY: 1, children: /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Select an OAuth-capable server (SSE or Streamable HTTP) to configure authentication." }) });
  }
  return /* @__PURE__ */ jsxs4(Box4, { width, height, flexDirection: "column", paddingX: 1, children: [
    /* @__PURE__ */ jsx4(Box4, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx4(Text4, { bold: true, backgroundColor: focused ? "yellow" : void 0, children: "Authentication" }) }),
    /* @__PURE__ */ jsxs4(
      Box4,
      {
        flexGrow: 0,
        overflow: "hidden",
        flexDirection: "column",
        gap: 0,
        paddingY: 0,
        children: [
          /* @__PURE__ */ jsxs4(Box4, { flexShrink: 0, flexDirection: "column", gap: 0, paddingBottom: 1, children: [
            /* @__PURE__ */ jsxs4(Box4, { flexDirection: "row", gap: 2, children: [
              /* @__PURE__ */ jsxs4(
                SelectableItem,
                {
                  isSelected: selectedAction === "guided",
                  bold: selectedAction === "guided",
                  children: [
                    /* @__PURE__ */ jsx4(Text4, { underline: true, children: "G" }),
                    "uided Auth"
                  ]
                }
              ),
              /* @__PURE__ */ jsxs4(
                SelectableItem,
                {
                  isSelected: selectedAction === "quick",
                  bold: selectedAction === "quick",
                  children: [
                    /* @__PURE__ */ jsx4(Text4, { underline: true, children: "Q" }),
                    "uick Auth"
                  ]
                }
              ),
              /* @__PURE__ */ jsxs4(
                SelectableItem,
                {
                  isSelected: selectedAction === "clear",
                  bold: selectedAction === "clear",
                  children: [
                    "Clear OAuth ",
                    /* @__PURE__ */ jsx4(Text4, { underline: true, children: "S" }),
                    "tate"
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", children: [
              selectedAction === "guided" && /* @__PURE__ */ jsxs4(Fragment2, { children: [
                /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Press [Space] to advance one step through guided auth." }),
                /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Press [Enter] to run guided auth to completion." })
              ] }),
              selectedAction === "quick" && /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Press [Enter] to run quick auth." }),
              selectedAction === "clear" && /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Press [Enter] to clear OAuth state." })
            ] })
          ] }),
          /* @__PURE__ */ jsxs4(ScrollView2, { ref: scrollViewRef, height: height - 10, children: [
            selectedAction === "guided" && /* @__PURE__ */ jsxs4(Box4, { flexShrink: 0, flexDirection: "column", children: [
              /* @__PURE__ */ jsx4(Text4, { bold: true, children: "Guided OAuth Flow Progress" }),
              STEP_ORDER.map((step) => {
                const stepIdx = stepIndex(step);
                const currentIdx = stepIndex(currentStep);
                const completed = guidedFlowStarted && (stepIdx < currentIdx || step === currentStep && isComplete);
                const inProgress = guidedFlowStarted && step === currentStep && !isComplete;
                const details = oauthState ? getStepDetails(oauthState, step) : null;
                const icon = completed ? "\u2713" : inProgress ? "\u2192" : "\u25CB";
                const color = completed ? "green" : inProgress ? "cyan" : "gray";
                return /* @__PURE__ */ jsxs4(
                  Box4,
                  {
                    marginTop: 1,
                    flexDirection: "column",
                    paddingLeft: 2,
                    children: [
                      /* @__PURE__ */ jsxs4(Text4, { color, children: [
                        icon,
                        " ",
                        STEP_LABELS[step],
                        inProgress && " (in progress)"
                      ] }),
                      completed && details && /* @__PURE__ */ jsx4(Box4, { marginTop: 1, paddingLeft: 2, flexDirection: "column", children: /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: details }) }),
                      inProgress && details && /* @__PURE__ */ jsx4(Box4, { marginTop: 1, paddingLeft: 2, flexDirection: "column", children: /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: details }) })
                    ]
                  },
                  step
                );
              }),
              oauthState && needsAuthCode && oauthState?.authorizationUrl && /* @__PURE__ */ jsxs4(Box4, { marginTop: 2, flexDirection: "column", children: [
                /* @__PURE__ */ jsx4(Text4, { bold: true, children: "Authorization URL opened in browser" }),
                /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: oauthState.authorizationUrl.toString() }) }),
                /* @__PURE__ */ jsx4(Box4, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Complete authorization in the browser. You will be redirected and the flow will complete automatically." }) })
              ] })
            ] }, "guided"),
            selectedAction === "quick" && /* @__PURE__ */ jsxs4(Box4, { flexShrink: 0, flexDirection: "column", children: [
              oauthStatus === "authenticating" && /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "Authenticating..." }),
              oauthStatus === "error" && oauthMessage && /* @__PURE__ */ jsx4(Text4, { color: "red", children: oauthMessage }),
              oauthStatus === "success" && oauthState && oauthState.authType === "normal" && (oauthState.oauthTokens || oauthState.oauthClientInfo) && /* @__PURE__ */ jsxs4(Fragment2, { children: [
                /* @__PURE__ */ jsx4(Text4, { bold: true, children: "Quick Auth Results" }),
                oauthState.oauthClientInfo && /* @__PURE__ */ jsx4(Box4, { marginTop: 1, flexDirection: "column", paddingLeft: 2, children: /* @__PURE__ */ jsxs4(Text4, { dimColor: true, children: [
                  "Client:",
                  " ",
                  JSON.stringify(oauthState.oauthClientInfo, null, 2)
                ] }) }),
                oauthState.oauthTokens && /* @__PURE__ */ jsx4(Box4, { marginTop: 1, flexDirection: "column", paddingLeft: 2, children: /* @__PURE__ */ jsxs4(Text4, { dimColor: true, children: [
                  "Access Token:",
                  " ",
                  oauthState.oauthTokens.access_token?.slice(0, 20),
                  "..."
                ] }) })
              ] })
            ] }, "quick"),
            selectedAction === "clear" && clearedConfirmation && /* @__PURE__ */ jsx4(Box4, { flexShrink: 0, flexDirection: "column", children: /* @__PURE__ */ jsx4(Text4, { color: "green", children: "OAuth state cleared." }) }, "clear")
          ] })
        ]
      }
    ),
    focused && /* @__PURE__ */ jsx4(
      Box4,
      {
        flexShrink: 0,
        height: 1,
        justifyContent: "center",
        backgroundColor: "gray",
        children: /* @__PURE__ */ jsx4(Text4, { bold: true, color: "white", children: "\u2190/\u2192 select, G/Q/S or Enter run, \u2191/\u2193 scroll" })
      }
    )
  ] });
}
function getStepDetails(state, step) {
  switch (step) {
    case "metadata_discovery":
      if (state.resourceMetadata || state.oauthMetadata) {
        const parts = [];
        if (state.resourceMetadata) {
          parts.push(
            `Resource: ${JSON.stringify(state.resourceMetadata, null, 2)}`
          );
        }
        if (state.oauthMetadata) {
          parts.push(`OAuth: ${JSON.stringify(state.oauthMetadata, null, 2)}`);
        }
        return parts.join("\n");
      }
      return null;
    case "client_registration":
      if (state.oauthClientInfo) {
        return JSON.stringify(state.oauthClientInfo, null, 2);
      }
      return null;
    case "authorization_redirect":
      if (state.authorizationUrl) {
        return `URL: ${state.authorizationUrl.toString()}`;
      }
      return null;
    case "authorization_code":
      return state.authorizationCode ? `Code received: ${state.authorizationCode.slice(0, 10)}...` : null;
    case "token_request":
      return "Exchanging code for tokens...";
    case "complete":
      if (state.oauthTokens) {
        return `Tokens: access_token=${state.oauthTokens.access_token?.slice(0, 15)}...`;
      }
      return null;
    default:
      return null;
  }
}

// src/components/ResourcesTab.tsx
import { useState as useState11, useEffect as useEffect11, useRef as useRef3, useMemo } from "react";
import { Box as Box5, Text as Text5, useInput as useInput3 } from "ink";
import { ScrollView as ScrollView3 } from "ink-scroll-view";

// src/hooks/useSelectableList.ts
import { useState as useState10, useEffect as useEffect10, useCallback as useCallback7 } from "react";
function clampFirstVisible(first, selected, visibleCount) {
  if (selected < first) return selected;
  if (selected >= first + visibleCount) return selected - visibleCount + 1;
  return first;
}
function useSelectableList(itemCount, visibleCount, options) {
  const [selectedIndex, setSelectedIndex] = useState10(0);
  const [firstVisible, setFirstVisible] = useState10(0);
  const setSelection = useCallback7(
    (newIndex) => {
      setSelectedIndex(newIndex);
      setFirstVisible(
        (prev) => clampFirstVisible(prev, newIndex, visibleCount)
      );
    },
    [visibleCount]
  );
  useEffect10(() => {
    if (options?.resetWhen !== void 0) {
      setSelectedIndex(0);
      setFirstVisible(0);
    }
  }, [options?.resetWhen]);
  useEffect10(() => {
    if (itemCount > 0 && selectedIndex >= itemCount) {
      const newIndex = itemCount - 1;
      setSelectedIndex(newIndex);
      setFirstVisible(
        (prev) => clampFirstVisible(prev, newIndex, visibleCount)
      );
    }
  }, [itemCount, selectedIndex, visibleCount]);
  return { selectedIndex, firstVisible, setSelection };
}

// src/components/ResourcesTab.tsx
import { Fragment as Fragment3, jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function ResourcesTab({
  resources,
  resourceTemplates = [],
  inspectorClient,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  onFetchResource,
  onFetchTemplate,
  modalOpen = false
}) {
  const [error, setError] = useState11(null);
  const [resourceContent, setResourceContent] = useState11(null);
  const [loading, setLoading] = useState11(false);
  const [shouldFetchResource, setShouldFetchResource] = useState11(
    null
  );
  const scrollViewRef = useRef3(null);
  const allItems = useMemo(
    () => [
      ...resources.map((r) => ({ type: "resource", data: r })),
      ...resourceTemplates.map((t) => ({ type: "template", data: t }))
    ],
    [resources, resourceTemplates]
  );
  const totalCount = useMemo(
    () => resources.length + resourceTemplates.length,
    [resources.length, resourceTemplates.length]
  );
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    totalCount,
    visibleCount,
    { resetWhen: resources }
  );
  const selectedItem = useMemo(
    () => allItems[selectedIndex] || null,
    [allItems, selectedIndex]
  );
  useInput3(
    (input, key) => {
      if (key.return && selectedItem && inspectorClient && (onFetchResource || onFetchTemplate)) {
        if (selectedItem.type === "resource" && selectedItem.data.uri) {
          setShouldFetchResource(selectedItem.data.uri);
          if (onFetchResource) {
            onFetchResource(selectedItem.data);
          }
        } else if (selectedItem.type === "template" && onFetchTemplate) {
          onFetchTemplate(selectedItem.data);
        }
        return;
      }
      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < totalCount - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        if (input === "+" && resourceContent && onViewDetails) {
          onViewDetails({ content: resourceContent });
          return;
        }
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    {
      isActive: !modalOpen && (focusedPane === "list" || focusedPane === "details")
    }
  );
  useEffect11(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  const prevResourcesRef = useRef3(resources);
  useEffect11(() => {
    if (prevResourcesRef.current !== resources) {
      setResourceContent(null);
      setShouldFetchResource(null);
      prevResourcesRef.current = resources;
    }
  }, [resources]);
  const isResource = selectedItem?.type === "resource";
  const isTemplate = selectedItem?.type === "template";
  const selectedResource = isResource ? selectedItem.data : null;
  const selectedTemplate = isTemplate ? selectedItem.data : null;
  useEffect11(() => {
    if (!shouldFetchResource || !inspectorClient) return;
    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const invocation = await inspectorClient.readResource(shouldFetchResource);
        setResourceContent(invocation.result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to read resource"
        );
        setResourceContent(null);
      } finally {
        setLoading(false);
        setShouldFetchResource(null);
      }
    };
    fetchContent();
  }, [shouldFetchResource, inspectorClient]);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  const prevCountRef = useRef3(totalCount);
  useEffect11(() => {
    if (prevCountRef.current !== totalCount) {
      prevCountRef.current = totalCount;
      onCountChange?.(totalCount);
    }
  }, [totalCount, onCountChange]);
  return /* @__PURE__ */ jsxs5(Box5, { flexDirection: "row", width, height, children: [
    /* @__PURE__ */ jsxs5(
      Box5,
      {
        width: listWidth,
        height,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: true,
        flexDirection: "column",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx5(Box5, { paddingY: 1, children: /* @__PURE__ */ jsxs5(
            Text5,
            {
              bold: true,
              backgroundColor: focusedPane === "list" ? "yellow" : void 0,
              children: [
                "Resources (",
                totalCount,
                ")"
              ]
            }
          ) }),
          error ? /* @__PURE__ */ jsx5(Box5, { paddingY: 1, children: /* @__PURE__ */ jsx5(Text5, { color: "red", children: error }) }) : totalCount === 0 ? /* @__PURE__ */ jsx5(Box5, { paddingY: 1, children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: "No resources available" }) }) : /* @__PURE__ */ jsx5(
            Box5,
            {
              flexDirection: "column",
              height: visibleCount,
              overflow: "hidden",
              flexShrink: 0,
              children: allItems.slice(firstVisible, firstVisible + visibleCount).map((item, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                const label = item.type === "resource" ? item.data.name || item.data.uri || `Resource ${index + 1}` : item.data.name || `Template ${index - resources.length + 1}`;
                const key = item.type === "resource" ? item.data.uri || index : item.data.uriTemplate || index;
                return /* @__PURE__ */ jsx5(Box5, { paddingY: 0, flexShrink: 0, children: /* @__PURE__ */ jsxs5(Text5, { children: [
                  isSelected ? "\u25B6 " : "  ",
                  label
                ] }) }, key);
              })
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx5(
      Box5,
      {
        width: detailWidth,
        height,
        paddingX: 1,
        flexDirection: "column",
        overflow: "hidden",
        children: selectedResource ? /* @__PURE__ */ jsxs5(Fragment3, { children: [
          /* @__PURE__ */ jsx5(Box5, { flexShrink: 0, paddingTop: 1, children: /* @__PURE__ */ jsx5(
            Text5,
            {
              bold: true,
              backgroundColor: focusedPane === "details" ? "yellow" : void 0,
              ...focusedPane === "details" ? {} : { color: "cyan" },
              children: selectedResource.name || selectedResource.uri
            }
          ) }),
          /* @__PURE__ */ jsxs5(ScrollView3, { ref: scrollViewRef, height: height - 3, children: [
            selectedResource.description && /* @__PURE__ */ jsx5(Fragment3, { children: selectedResource.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx5(
              Box5,
              {
                marginTop: idx === 0 ? 1 : 0,
                flexShrink: 0,
                children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: line })
              },
              `desc-${idx}`
            )) }),
            selectedResource.uri && /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs5(Text5, { dimColor: true, children: [
              "URI: ",
              selectedResource.uri
            ] }) }),
            selectedResource.mimeType && /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs5(Text5, { dimColor: true, children: [
              "MIME Type: ",
              selectedResource.mimeType
            ] }) }),
            loading && /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx5(Text5, { color: "yellow", children: "Loading resource content..." }) }),
            !loading && resourceContent && /* @__PURE__ */ jsxs5(Fragment3, { children: [
              /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx5(Text5, { bold: true, children: "Content:" }) }),
              /* @__PURE__ */ jsx5(Box5, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: JSON.stringify(resourceContent, null, 2) }) })
            ] }),
            !loading && !resourceContent && selectedResource.uri && /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: "[Enter to Fetch Resource]" }) })
          ] }),
          focusedPane === "details" && /* @__PURE__ */ jsx5(
            Box5,
            {
              flexShrink: 0,
              height: 1,
              justifyContent: "center",
              backgroundColor: "gray",
              children: /* @__PURE__ */ jsx5(Text5, { bold: true, color: "white", children: resourceContent ? "\u2191/\u2193 to scroll, + to zoom" : "Enter to fetch, \u2191/\u2193 to scroll" })
            }
          )
        ] }) : selectedTemplate ? /* @__PURE__ */ jsxs5(Fragment3, { children: [
          /* @__PURE__ */ jsx5(Box5, { flexShrink: 0, paddingTop: 1, children: /* @__PURE__ */ jsx5(
            Text5,
            {
              bold: true,
              backgroundColor: focusedPane === "details" ? "yellow" : void 0,
              ...focusedPane === "details" ? {} : { color: "cyan" },
              children: selectedTemplate.name
            }
          ) }),
          /* @__PURE__ */ jsxs5(ScrollView3, { ref: scrollViewRef, height: height - 3, children: [
            selectedTemplate.description && /* @__PURE__ */ jsx5(Fragment3, { children: selectedTemplate.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx5(
              Box5,
              {
                marginTop: idx === 0 ? 1 : 0,
                flexShrink: 0,
                children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: line })
              },
              `desc-${idx}`
            )) }),
            selectedTemplate.uriTemplate && /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs5(Text5, { dimColor: true, children: [
              "URI Template: ",
              selectedTemplate.uriTemplate
            ] }) }),
            /* @__PURE__ */ jsx5(Box5, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: "[Enter to Fetch Resource]" }) })
          ] }),
          focusedPane === "details" && /* @__PURE__ */ jsx5(
            Box5,
            {
              flexShrink: 0,
              height: 1,
              justifyContent: "center",
              backgroundColor: "gray",
              children: /* @__PURE__ */ jsx5(Text5, { bold: true, color: "white", children: "Enter to fetch" })
            }
          )
        ] }) : /* @__PURE__ */ jsx5(Box5, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx5(Text5, { dimColor: true, children: "Select a resource or template to view details" }) })
      }
    )
  ] });
}

// src/components/PromptsTab.tsx
import { useState as useState12, useEffect as useEffect12, useRef as useRef4 } from "react";
import { Box as Box6, Text as Text6, useInput as useInput4 } from "ink";
import { ScrollView as ScrollView4 } from "ink-scroll-view";
import { Fragment as Fragment4, jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
function PromptsTab({
  prompts,
  inspectorClient,
  width,
  height,
  focusedPane = null,
  onViewDetails,
  onFetchPrompt,
  modalOpen = false
}) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    prompts.length,
    visibleCount,
    { resetWhen: prompts }
  );
  const [error, setError] = useState12(null);
  const scrollViewRef = useRef4(null);
  useInput4(
    (input, key) => {
      if (key.return && selectedPrompt && inspectorClient && onFetchPrompt) {
        if (selectedPrompt.arguments && selectedPrompt.arguments.length > 0) {
          onFetchPrompt(selectedPrompt);
        } else {
          (async () => {
            try {
              const invocation = await inspectorClient.getPrompt(
                selectedPrompt.name
              );
              if (onViewDetails) {
                onViewDetails({
                  ...selectedPrompt,
                  result: invocation.result
                });
              }
            } catch (error2) {
              setError(
                error2 instanceof Error ? error2.message : "Failed to get prompt"
              );
            }
          })();
        }
        return;
      }
      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < prompts.length - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        if (input === "+" && selectedPrompt && onViewDetails) {
          onViewDetails(selectedPrompt);
          return;
        }
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    {
      isActive: !modalOpen && (focusedPane === "list" || focusedPane === "details")
    }
  );
  useEffect12(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  const selectedPrompt = prompts[selectedIndex] || null;
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  return /* @__PURE__ */ jsxs6(Box6, { flexDirection: "row", width, height, children: [
    /* @__PURE__ */ jsxs6(
      Box6,
      {
        width: listWidth,
        height,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: true,
        flexDirection: "column",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx6(Box6, { paddingY: 1, children: /* @__PURE__ */ jsxs6(
            Text6,
            {
              bold: true,
              backgroundColor: focusedPane === "list" ? "yellow" : void 0,
              children: [
                "Prompts (",
                prompts.length,
                ")"
              ]
            }
          ) }),
          error ? /* @__PURE__ */ jsx6(Box6, { paddingY: 1, children: /* @__PURE__ */ jsx6(Text6, { color: "red", children: error }) }) : prompts.length === 0 ? /* @__PURE__ */ jsx6(Box6, { paddingY: 1, children: /* @__PURE__ */ jsx6(Text6, { dimColor: true, children: "No prompts available" }) }) : /* @__PURE__ */ jsx6(
            Box6,
            {
              flexDirection: "column",
              height: visibleCount,
              overflow: "hidden",
              flexShrink: 0,
              children: prompts.slice(firstVisible, firstVisible + visibleCount).map((prompt, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                return /* @__PURE__ */ jsx6(Box6, { paddingY: 0, flexShrink: 0, children: /* @__PURE__ */ jsxs6(Text6, { children: [
                  isSelected ? "\u25B6 " : "  ",
                  prompt.name || `Prompt ${index + 1}`
                ] }) }, prompt.name || index);
              })
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx6(
      Box6,
      {
        width: detailWidth,
        height,
        paddingX: 1,
        flexDirection: "column",
        overflow: "hidden",
        children: selectedPrompt ? /* @__PURE__ */ jsxs6(Fragment4, { children: [
          /* @__PURE__ */ jsx6(Box6, { flexShrink: 0, paddingTop: 1, children: /* @__PURE__ */ jsx6(
            Text6,
            {
              bold: true,
              backgroundColor: focusedPane === "details" ? "yellow" : void 0,
              ...focusedPane === "details" ? {} : { color: "cyan" },
              children: selectedPrompt.name
            }
          ) }),
          /* @__PURE__ */ jsxs6(ScrollView4, { ref: scrollViewRef, height: height - 5, children: [
            selectedPrompt.description && /* @__PURE__ */ jsx6(Fragment4, { children: selectedPrompt.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx6(
              Box6,
              {
                marginTop: idx === 0 ? 1 : 0,
                flexShrink: 0,
                children: /* @__PURE__ */ jsx6(Text6, { dimColor: true, children: line })
              },
              `desc-${idx}`
            )) }),
            selectedPrompt.arguments && selectedPrompt.arguments.length > 0 && /* @__PURE__ */ jsxs6(Fragment4, { children: [
              /* @__PURE__ */ jsx6(Box6, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx6(Text6, { bold: true, children: "Arguments:" }) }),
              selectedPrompt.arguments.map(
                (arg, idx) => /* @__PURE__ */ jsx6(
                  Box6,
                  {
                    marginTop: 1,
                    paddingLeft: 2,
                    flexShrink: 0,
                    children: /* @__PURE__ */ jsxs6(Text6, { dimColor: true, children: [
                      "- ",
                      arg.name,
                      ":",
                      " ",
                      arg.description ?? arg.type ?? "string"
                    ] })
                  },
                  `arg-${idx}`
                )
              )
            ] }),
            /* @__PURE__ */ jsx6(Box6, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx6(Text6, { dimColor: true, children: "[Enter to Get Prompt]" }) })
          ] }),
          focusedPane === "details" && /* @__PURE__ */ jsx6(
            Box6,
            {
              flexShrink: 0,
              height: 1,
              justifyContent: "center",
              backgroundColor: "gray",
              children: /* @__PURE__ */ jsx6(Text6, { bold: true, color: "white", children: "\u2191/\u2193 to scroll, + to zoom" })
            }
          )
        ] }) : /* @__PURE__ */ jsx6(Box6, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx6(Text6, { dimColor: true, children: "Select a prompt to view details" }) })
      }
    )
  ] });
}

// src/components/ToolsTab.tsx
import { useState as useState13, useEffect as useEffect13, useRef as useRef5 } from "react";
import { Box as Box7, Text as Text7, useInput as useInput5 } from "ink";
import { ScrollView as ScrollView5 } from "ink-scroll-view";
import { Fragment as Fragment5, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function ToolsTab({
  tools,
  isConnected,
  width,
  height,
  focusedPane = null,
  onTestTool,
  onViewDetails,
  modalOpen = false
}) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    tools.length,
    visibleCount,
    { resetWhen: tools }
  );
  const [error] = useState13(null);
  const scrollViewRef = useRef5(null);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  useInput5(
    (input, key) => {
      if (key.return && selectedTool && isConnected && onTestTool) {
        onTestTool(selectedTool);
        return;
      }
      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < tools.length - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        if (input === "+" && selectedTool && onViewDetails) {
          onViewDetails(selectedTool);
          return;
        }
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    {
      isActive: !modalOpen && (focusedPane === "list" || focusedPane === "details")
    }
  );
  useEffect13(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  const selectedTool = tools[selectedIndex] || null;
  return /* @__PURE__ */ jsxs7(Box7, { flexDirection: "row", width, height, children: [
    /* @__PURE__ */ jsxs7(
      Box7,
      {
        width: listWidth,
        height,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: true,
        flexDirection: "column",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx7(Box7, { paddingY: 1, children: /* @__PURE__ */ jsxs7(
            Text7,
            {
              bold: true,
              backgroundColor: focusedPane === "list" ? "yellow" : void 0,
              children: [
                "Tools (",
                tools.length,
                ")"
              ]
            }
          ) }),
          error ? /* @__PURE__ */ jsx7(Box7, { paddingY: 1, children: /* @__PURE__ */ jsx7(Text7, { color: "red", children: error }) }) : tools.length === 0 ? /* @__PURE__ */ jsx7(Box7, { paddingY: 1, children: /* @__PURE__ */ jsx7(Text7, { dimColor: true, children: "No tools available" }) }) : /* @__PURE__ */ jsx7(
            Box7,
            {
              flexDirection: "column",
              height: visibleCount,
              overflow: "hidden",
              flexShrink: 0,
              children: tools.slice(firstVisible, firstVisible + visibleCount).map((tool, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                return /* @__PURE__ */ jsx7(Box7, { paddingY: 0, flexShrink: 0, children: /* @__PURE__ */ jsxs7(Text7, { children: [
                  isSelected ? "\u25B6 " : "  ",
                  tool.name || `Tool ${index + 1}`
                ] }) }, tool.name || index);
              })
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx7(
      Box7,
      {
        width: detailWidth,
        height,
        paddingX: 1,
        flexDirection: "column",
        overflow: "hidden",
        children: selectedTool ? /* @__PURE__ */ jsxs7(Fragment5, { children: [
          /* @__PURE__ */ jsxs7(
            Box7,
            {
              flexShrink: 0,
              flexDirection: "row",
              justifyContent: "space-between",
              paddingTop: 1,
              children: [
                /* @__PURE__ */ jsx7(
                  Text7,
                  {
                    bold: true,
                    backgroundColor: focusedPane === "details" ? "yellow" : void 0,
                    ...focusedPane === "details" ? {} : { color: "cyan" },
                    children: selectedTool.name
                  }
                ),
                isConnected && /* @__PURE__ */ jsx7(Text7, { children: /* @__PURE__ */ jsx7(Text7, { color: "cyan", bold: true, children: "[Enter to Test]" }) })
              ]
            }
          ),
          /* @__PURE__ */ jsxs7(ScrollView5, { ref: scrollViewRef, height: height - 5, children: [
            selectedTool.description && /* @__PURE__ */ jsx7(Fragment5, { children: selectedTool.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx7(
              Box7,
              {
                marginTop: idx === 0 ? 1 : 0,
                flexShrink: 0,
                children: /* @__PURE__ */ jsx7(Text7, { dimColor: true, children: line })
              },
              `desc-${idx}`
            )) }),
            selectedTool.inputSchema && /* @__PURE__ */ jsxs7(Fragment5, { children: [
              /* @__PURE__ */ jsx7(Box7, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx7(Text7, { bold: true, children: "Input Schema:" }) }),
              JSON.stringify(selectedTool.inputSchema, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx7(
                Box7,
                {
                  marginTop: idx === 0 ? 1 : 0,
                  paddingLeft: 2,
                  flexShrink: 0,
                  children: /* @__PURE__ */ jsx7(Text7, { dimColor: true, children: line })
                },
                `schema-${idx}`
              ))
            ] })
          ] }),
          focusedPane === "details" && /* @__PURE__ */ jsx7(
            Box7,
            {
              flexShrink: 0,
              height: 1,
              justifyContent: "center",
              backgroundColor: "gray",
              children: /* @__PURE__ */ jsx7(Text7, { bold: true, color: "white", children: "\u2191/\u2193 to scroll, + to zoom" })
            }
          )
        ] }) : /* @__PURE__ */ jsx7(Box7, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx7(Text7, { dimColor: true, children: "Select a tool to view details" }) })
      }
    )
  ] });
}

// src/components/NotificationsTab.tsx
import { useEffect as useEffect14, useRef as useRef6 } from "react";
import { Box as Box8, Text as Text8, useInput as useInput6 } from "ink";
import { ScrollView as ScrollView6 } from "ink-scroll-view";
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function NotificationsTab({
  stderrLogs,
  width,
  height,
  onCountChange,
  focused = false
}) {
  const scrollViewRef = useRef6(null);
  const onCountChangeRef = useRef6(onCountChange);
  useEffect14(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);
  useEffect14(() => {
    onCountChangeRef.current?.(stderrLogs.length);
  }, [stderrLogs.length]);
  useInput6(
    (input, key) => {
      if (focused) {
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    { isActive: focused }
  );
  return /* @__PURE__ */ jsxs8(Box8, { width, height, flexDirection: "column", paddingX: 1, children: [
    /* @__PURE__ */ jsx8(Box8, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs8(Text8, { bold: true, backgroundColor: focused ? "yellow" : void 0, children: [
      "Logging (",
      stderrLogs.length,
      ")"
    ] }) }),
    stderrLogs.length === 0 ? /* @__PURE__ */ jsx8(Box8, { paddingY: 1, children: /* @__PURE__ */ jsx8(Text8, { dimColor: true, children: "No stderr output yet" }) }) : /* @__PURE__ */ jsx8(ScrollView6, { ref: scrollViewRef, height: height - 3, children: stderrLogs.map((log, index) => /* @__PURE__ */ jsxs8(
      Box8,
      {
        paddingY: 0,
        flexDirection: "row",
        flexShrink: 0,
        children: [
          /* @__PURE__ */ jsxs8(Text8, { dimColor: true, children: [
            "[",
            log.timestamp.toLocaleTimeString(),
            "] "
          ] }),
          /* @__PURE__ */ jsx8(Text8, { color: "red", children: log.message })
        ]
      },
      `log-${log.timestamp.getTime()}-${index}`
    )) })
  ] });
}

// src/components/HistoryTab.tsx
import React7, { useEffect as useEffect15, useRef as useRef7 } from "react";
import { Box as Box9, Text as Text9, useInput as useInput7 } from "ink";
import { ScrollView as ScrollView7 } from "ink-scroll-view";
import { Fragment as Fragment6, jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
function HistoryTab({
  messages,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  modalOpen = false
}) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    messages.length,
    visibleCount
  );
  const scrollViewRef = useRef7(null);
  const selectedMessage = messages[selectedIndex] || null;
  useInput7(
    (input, key) => {
      if (focusedPane === "messages") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < messages.length - 1) {
          setSelection(selectedIndex + 1);
        } else if (key.pageUp) {
          setSelection(Math.max(0, selectedIndex - visibleCount));
        } else if (key.pageDown) {
          setSelection(
            Math.min(messages.length - 1, selectedIndex + visibleCount)
          );
        }
        return;
      }
      if (focusedPane === "details") {
        if (input === "+" && selectedMessage && onViewDetails) {
          onViewDetails(selectedMessage);
          return;
        }
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    { isActive: !modalOpen && focusedPane !== void 0 }
  );
  React7.useEffect(() => {
    onCountChange?.(messages.length);
  }, [messages.length]);
  useEffect15(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  return /* @__PURE__ */ jsxs9(Box9, { flexDirection: "row", width, height, children: [
    /* @__PURE__ */ jsxs9(
      Box9,
      {
        width: listWidth,
        height,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: true,
        flexDirection: "column",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx9(Box9, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs9(
            Text9,
            {
              bold: true,
              backgroundColor: focusedPane === "messages" ? "yellow" : void 0,
              children: [
                "Messages (",
                messages.length,
                ")"
              ]
            }
          ) }),
          messages.length === 0 ? /* @__PURE__ */ jsx9(Box9, { paddingY: 1, children: /* @__PURE__ */ jsx9(Text9, { dimColor: true, children: "No messages" }) }) : /* @__PURE__ */ jsx9(
            Box9,
            {
              flexDirection: "column",
              height: visibleCount,
              overflow: "hidden",
              flexShrink: 0,
              children: messages.slice(firstVisible, firstVisible + visibleCount).map((msg, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                let label;
                if (msg.direction === "request" && "method" in msg.message) {
                  label = msg.message.method;
                } else if (msg.direction === "response") {
                  if ("result" in msg.message) {
                    label = "Response (result)";
                  } else if ("error" in msg.message) {
                    label = `Response (error: ${msg.message.error.code})`;
                  } else {
                    label = "Response";
                  }
                } else if (msg.direction === "notification" && "method" in msg.message) {
                  label = msg.message.method;
                } else {
                  label = "Unknown";
                }
                const direction = msg.direction === "request" ? "\u2192" : msg.direction === "response" ? "\u2190" : "\u2022";
                const hasResponse = msg.response !== void 0;
                return /* @__PURE__ */ jsx9(Box9, { paddingY: 0, flexShrink: 0, children: /* @__PURE__ */ jsxs9(Text9, { color: isSelected ? "white" : "white", children: [
                  isSelected ? "\u25B6 " : "  ",
                  direction,
                  " ",
                  label,
                  hasResponse ? " \u2713" : msg.direction === "request" ? " ..." : ""
                ] }) }, msg.id);
              })
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx9(
      Box9,
      {
        width: detailWidth,
        height,
        paddingX: 1,
        flexDirection: "column",
        flexShrink: 0,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: false,
        children: selectedMessage ? /* @__PURE__ */ jsxs9(Fragment6, { children: [
          /* @__PURE__ */ jsx9(Box9, { flexShrink: 0, paddingTop: 1, children: /* @__PURE__ */ jsx9(
            Text9,
            {
              bold: true,
              backgroundColor: focusedPane === "details" ? "yellow" : void 0,
              ...focusedPane === "details" ? {} : { color: "cyan" },
              children: selectedMessage.direction === "request" && "method" in selectedMessage.message ? selectedMessage.message.method : selectedMessage.direction === "response" ? "Response" : selectedMessage.direction === "notification" && "method" in selectedMessage.message ? selectedMessage.message.method : "Message"
            }
          ) }),
          /* @__PURE__ */ jsxs9(ScrollView7, { ref: scrollViewRef, height: height - 5, children: [
            /* @__PURE__ */ jsxs9(Box9, { marginTop: 1, flexDirection: "column", flexShrink: 0, children: [
              /* @__PURE__ */ jsxs9(Text9, { bold: true, children: [
                "Direction: ",
                selectedMessage.direction
              ] }),
              /* @__PURE__ */ jsx9(Box9, { marginTop: 1, children: /* @__PURE__ */ jsxs9(Text9, { dimColor: true, children: [
                selectedMessage.timestamp.toLocaleTimeString(),
                selectedMessage.duration !== void 0 && ` (${selectedMessage.duration}ms)`
              ] }) })
            ] }),
            selectedMessage.direction === "request" ? /* @__PURE__ */ jsxs9(Fragment6, { children: [
              /* @__PURE__ */ jsx9(Box9, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx9(Text9, { bold: true, children: "Request:" }) }),
              JSON.stringify(selectedMessage.message, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx9(
                Box9,
                {
                  marginTop: idx === 0 ? 1 : 0,
                  paddingLeft: 2,
                  flexShrink: 0,
                  children: /* @__PURE__ */ jsx9(Text9, { dimColor: true, children: line })
                },
                `req-${idx}`
              )),
              selectedMessage.response ? /* @__PURE__ */ jsxs9(Fragment6, { children: [
                /* @__PURE__ */ jsx9(Box9, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx9(Text9, { bold: true, children: "Response:" }) }),
                JSON.stringify(selectedMessage.response, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx9(
                  Box9,
                  {
                    marginTop: idx === 0 ? 1 : 0,
                    paddingLeft: 2,
                    flexShrink: 0,
                    children: /* @__PURE__ */ jsx9(Text9, { dimColor: true, children: line })
                  },
                  `resp-${idx}`
                ))
              ] }) : /* @__PURE__ */ jsx9(Box9, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx9(Text9, { dimColor: true, italic: true, children: "Waiting for response..." }) })
            ] }) : /* @__PURE__ */ jsxs9(Fragment6, { children: [
              /* @__PURE__ */ jsx9(Box9, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx9(Text9, { bold: true, children: selectedMessage.direction === "response" ? "Response:" : "Notification:" }) }),
              JSON.stringify(selectedMessage.message, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx9(
                Box9,
                {
                  marginTop: idx === 0 ? 1 : 0,
                  paddingLeft: 2,
                  flexShrink: 0,
                  children: /* @__PURE__ */ jsx9(Text9, { dimColor: true, children: line })
                },
                `msg-${idx}`
              ))
            ] })
          ] }),
          focusedPane === "details" && /* @__PURE__ */ jsx9(
            Box9,
            {
              flexShrink: 0,
              height: 1,
              justifyContent: "center",
              backgroundColor: "gray",
              children: /* @__PURE__ */ jsx9(Text9, { bold: true, color: "white", children: "\u2191/\u2193 to scroll, + to zoom" })
            }
          )
        ] }) : /* @__PURE__ */ jsx9(Box9, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx9(Text9, { dimColor: true, children: "Select a message to view details" }) })
      }
    )
  ] });
}

// src/components/RequestsTab.tsx
import React8, { useEffect as useEffect16, useRef as useRef8 } from "react";
import { Box as Box10, Text as Text10, useInput as useInput8 } from "ink";
import { ScrollView as ScrollView8 } from "ink-scroll-view";
import { Fragment as Fragment7, jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
function RequestsTab({
  requests,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  modalOpen = false
}) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    requests.length,
    visibleCount
  );
  const scrollViewRef = useRef8(null);
  const selectedRequest = requests[selectedIndex] || null;
  useInput8(
    (input, key) => {
      if (focusedPane === "requests") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < requests.length - 1) {
          setSelection(selectedIndex + 1);
        } else if (key.pageUp) {
          setSelection(Math.max(0, selectedIndex - visibleCount));
        } else if (key.pageDown) {
          setSelection(
            Math.min(requests.length - 1, selectedIndex + visibleCount)
          );
        }
        return;
      }
      if (focusedPane === "details") {
        if (input === "+" && selectedRequest && onViewDetails) {
          onViewDetails(selectedRequest);
          return;
        }
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    { isActive: !modalOpen && focusedPane !== void 0 }
  );
  React8.useEffect(() => {
    onCountChange?.(requests.length);
  }, [requests.length]);
  useEffect16(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  const getStatusColor = (status) => {
    if (!status) return "gray";
    if (status >= 200 && status < 300) return "green";
    if (status >= 300 && status < 400) return "yellow";
    if (status >= 400) return "red";
    return "gray";
  };
  return /* @__PURE__ */ jsxs10(Box10, { flexDirection: "row", width, height, children: [
    /* @__PURE__ */ jsxs10(
      Box10,
      {
        width: listWidth,
        height,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: true,
        flexDirection: "column",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx10(Box10, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs10(
            Text10,
            {
              bold: true,
              backgroundColor: focusedPane === "requests" ? "yellow" : void 0,
              children: [
                "Requests (",
                requests.length,
                ")"
              ]
            }
          ) }),
          requests.length === 0 ? /* @__PURE__ */ jsx10(Box10, { paddingY: 1, children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: "No requests" }) }) : /* @__PURE__ */ jsx10(
            Box10,
            {
              flexDirection: "column",
              height: visibleCount,
              overflow: "hidden",
              flexShrink: 0,
              children: requests.slice(firstVisible, firstVisible + visibleCount).map((req, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                const statusColor = getStatusColor(req.responseStatus);
                const statusText = req.responseStatus ? `${req.responseStatus}` : req.error ? "ERROR" : "...";
                const categoryLabel = req.category === "auth" ? "AUTH" : "MCP ";
                const methodPadded = req.method === "GET" ? "GET " : req.method;
                return /* @__PURE__ */ jsx10(Box10, { paddingY: 0, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text10, { color: isSelected ? "white" : "white", children: [
                  isSelected ? "\u25B6 " : "  ",
                  /* @__PURE__ */ jsx10(Text10, { children: categoryLabel }),
                  " ",
                  /* @__PURE__ */ jsx10(Text10, { color: statusColor, children: methodPadded }),
                  " ",
                  /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: statusText }),
                  req.duration !== void 0 && /* @__PURE__ */ jsxs10(Text10, { dimColor: true, children: [
                    " ",
                    req.duration,
                    "ms"
                  ] })
                ] }) }, req.id);
              })
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx10(
      Box10,
      {
        width: detailWidth,
        height,
        paddingX: 1,
        flexDirection: "column",
        flexShrink: 0,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: false,
        children: selectedRequest ? /* @__PURE__ */ jsxs10(Fragment7, { children: [
          /* @__PURE__ */ jsx10(Box10, { flexShrink: 0, paddingTop: 1, children: /* @__PURE__ */ jsxs10(
            Text10,
            {
              bold: true,
              backgroundColor: focusedPane === "details" ? "yellow" : void 0,
              ...focusedPane === "details" ? {} : { color: "cyan" },
              children: [
                selectedRequest.method,
                " ",
                selectedRequest.url
              ]
            }
          ) }),
          /* @__PURE__ */ jsxs10(ScrollView8, { ref: scrollViewRef, height: height - 5, children: [
            /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text10, { bold: true, children: [
              "Category:",
              " ",
              /* @__PURE__ */ jsx10(Text10, { children: selectedRequest.category === "auth" ? "auth" : "transport" })
            ] }) }),
            selectedRequest.responseStatus !== void 0 ? /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text10, { bold: true, children: [
              "Status:",
              " ",
              /* @__PURE__ */ jsxs10(
                Text10,
                {
                  color: getStatusColor(selectedRequest.responseStatus),
                  children: [
                    selectedRequest.responseStatus,
                    " ",
                    selectedRequest.responseStatusText || ""
                  ]
                }
              )
            ] }) }) : selectedRequest.error ? /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text10, { bold: true, color: "red", children: [
              "Error: ",
              selectedRequest.error
            ] }) }) : /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, italic: true, children: "Request in progress..." }) }),
            selectedRequest.duration !== void 0 && /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text10, { dimColor: true, children: [
              selectedRequest.timestamp.toLocaleTimeString(),
              " (",
              selectedRequest.duration,
              "ms)"
            ] }) }),
            /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { bold: true, children: "Request Headers:" }) }),
            Object.entries(selectedRequest.requestHeaders).map(
              ([key, value]) => /* @__PURE__ */ jsx10(Box10, { marginTop: 0, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsxs10(Text10, { dimColor: true, children: [
                key,
                ": ",
                value
              ] }) }, key)
            ),
            selectedRequest.requestBody && /* @__PURE__ */ jsxs10(Fragment7, { children: [
              /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { bold: true, children: "Request Body:" }) }),
              (() => {
                try {
                  const parsed = JSON.parse(selectedRequest.requestBody);
                  return JSON.stringify(parsed, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx10(
                    Box10,
                    {
                      marginTop: idx === 0 ? 1 : 0,
                      paddingLeft: 2,
                      flexShrink: 0,
                      children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: line })
                    },
                    `req-body-${idx}`
                  ));
                } catch {
                  return /* @__PURE__ */ jsx10(Box10, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: selectedRequest.requestBody }) });
                }
              })()
            ] }),
            selectedRequest.responseHeaders && Object.keys(selectedRequest.responseHeaders).length > 0 && /* @__PURE__ */ jsxs10(Fragment7, { children: [
              /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { bold: true, children: "Response Headers:" }) }),
              Object.entries(selectedRequest.responseHeaders).map(
                ([key, value]) => /* @__PURE__ */ jsx10(
                  Box10,
                  {
                    marginTop: 0,
                    paddingLeft: 2,
                    flexShrink: 0,
                    children: /* @__PURE__ */ jsxs10(Text10, { dimColor: true, children: [
                      key,
                      ": ",
                      value
                    ] })
                  },
                  key
                )
              )
            ] }),
            selectedRequest.responseBody && /* @__PURE__ */ jsxs10(Fragment7, { children: [
              /* @__PURE__ */ jsx10(Box10, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { bold: true, children: "Response Body:" }) }),
              (() => {
                try {
                  const parsed = JSON.parse(selectedRequest.responseBody);
                  return JSON.stringify(parsed, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx10(
                    Box10,
                    {
                      marginTop: idx === 0 ? 1 : 0,
                      paddingLeft: 2,
                      flexShrink: 0,
                      children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: line })
                    },
                    `resp-body-${idx}`
                  ));
                } catch {
                  return /* @__PURE__ */ jsx10(Box10, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: selectedRequest.responseBody }) });
                }
              })()
            ] })
          ] }),
          focusedPane === "details" && /* @__PURE__ */ jsx10(
            Box10,
            {
              flexShrink: 0,
              height: 1,
              justifyContent: "center",
              backgroundColor: "gray",
              children: /* @__PURE__ */ jsx10(Text10, { bold: true, color: "white", children: "\u2191/\u2193 to scroll, + to zoom" })
            }
          )
        ] }) : /* @__PURE__ */ jsx10(Box10, { paddingY: 1, flexShrink: 0, children: /* @__PURE__ */ jsx10(Text10, { dimColor: true, children: "Select a request to view details" }) })
      }
    )
  ] });
}

// src/components/ToolTestModal.tsx
import React9, { useState as useState14 } from "react";
import { Box as Box11, Text as Text11, useInput as useInput9 } from "ink";
import { Form } from "ink-form";

// src/utils/schemaToForm.ts
function schemaToForm(schema, toolName) {
  const fields = [];
  if (!schema || !schema.properties) {
    return {
      title: `Test Tool: ${toolName}`,
      sections: [{ title: "Parameters", fields: [] }]
    };
  }
  const properties = schema.properties || {};
  const required = schema.required || [];
  for (const [key, prop] of Object.entries(properties)) {
    const property = prop;
    const baseField = {
      name: key,
      label: property.title || key,
      required: required.includes(key)
    };
    let field;
    if (property.enum) {
      if (property.type === "array" && property.items?.enum) {
        field = {
          type: "select",
          ...baseField,
          options: property.items.enum.map((val) => ({
            label: String(val),
            value: String(val)
          }))
        };
      } else {
        field = {
          type: "select",
          ...baseField,
          options: property.enum.map((val) => ({
            label: String(val),
            value: String(val)
          }))
        };
      }
    } else {
      switch (property.type) {
        case "string":
          field = {
            type: "string",
            ...baseField
          };
          break;
        case "integer":
          field = {
            type: "integer",
            ...baseField,
            ...property.minimum !== void 0 && { min: property.minimum },
            ...property.maximum !== void 0 && { max: property.maximum }
          };
          break;
        case "number":
          field = {
            type: "float",
            ...baseField,
            ...property.minimum !== void 0 && { min: property.minimum },
            ...property.maximum !== void 0 && { max: property.maximum }
          };
          break;
        case "boolean":
          field = {
            type: "boolean",
            ...baseField
          };
          break;
        default:
          field = {
            type: "string",
            ...baseField
          };
      }
    }
    if (property.default !== void 0) {
      field.initialValue = property.default;
    }
    fields.push(field);
  }
  const sections = [
    {
      title: "Parameters",
      fields
    }
  ];
  return {
    title: `Test Tool: ${toolName}`,
    sections
  };
}

// src/components/ToolTestModal.tsx
import { ScrollView as ScrollView9 } from "ink-scroll-view";
import { Fragment as Fragment8, jsx as jsx11, jsxs as jsxs11 } from "react/jsx-runtime";
function ToolTestModal({
  tool,
  inspectorClient,
  width,
  height,
  onClose
}) {
  const [state, setState] = useState14("form");
  const [result, setResult] = useState14(null);
  const scrollViewRef = React9.useRef(null);
  const [terminalDimensions, setTerminalDimensions] = React9.useState({
    width: process.stdout.columns || width,
    height: process.stdout.rows || height
  });
  React9.useEffect(() => {
    const updateDimensions = () => {
      setTerminalDimensions({
        width: process.stdout.columns || width,
        height: process.stdout.rows || height
      });
    };
    process.stdout.on("resize", updateDimensions);
    updateDimensions();
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, [width, height]);
  const formStructure = tool?.inputSchema ? schemaToForm(tool.inputSchema, tool.name || "Unknown Tool") : {
    title: `Test Tool: ${tool?.name || "Unknown"}`,
    sections: [{ title: "Parameters", fields: [] }]
  };
  React9.useEffect(() => {
    return () => {
      setState("form");
      setResult(null);
    };
  }, []);
  useInput9(
    (input, key) => {
      if (key.escape) {
        setState("form");
        setResult(null);
        onClose();
        return;
      }
      if (state === "form") {
        return;
      }
      if (state === "results") {
        if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        }
      }
    },
    { isActive: true }
  );
  const handleFormSubmit = async (values) => {
    if (!inspectorClient || !tool) return;
    setState("loading");
    const startTime = Date.now();
    try {
      const invocation = await inspectorClient.callTool(tool, values);
      const duration = Date.now() - startTime;
      if (!invocation.success || invocation.result === null) {
        setResult({
          input: values,
          output: null,
          error: invocation.error || "Tool call failed",
          errorDetails: invocation,
          duration
        });
      } else {
        const result2 = invocation.result;
        const isError = "isError" in result2 && result2.isError === true;
        setResult({
          input: values,
          output: isError ? null : result2,
          error: isError ? "Tool returned an error" : void 0,
          errorDetails: isError ? result2 : void 0,
          duration
        });
      }
      setState("results");
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorObj = error instanceof Error ? { message: error.message, name: error.name, stack: error.stack } : { error: String(error) };
      setResult({
        input: values,
        output: null,
        error: error instanceof Error ? error.message : "Unknown error",
        errorDetails: errorObj,
        duration
      });
      setState("results");
    }
  };
  const modalWidth = terminalDimensions.width - 2;
  const modalHeight = terminalDimensions.height - 2;
  return /* @__PURE__ */ jsx11(
    Box11,
    {
      position: "absolute",
      width: terminalDimensions.width,
      height: terminalDimensions.height,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxs11(
        Box11,
        {
          width: modalWidth,
          height: modalHeight,
          borderStyle: "single",
          borderColor: "cyan",
          flexDirection: "column",
          paddingX: 1,
          paddingY: 1,
          backgroundColor: "black",
          children: [
            /* @__PURE__ */ jsxs11(Box11, { flexShrink: 0, marginBottom: 1, children: [
              /* @__PURE__ */ jsx11(Text11, { bold: true, color: "cyan", children: formStructure.title }),
              /* @__PURE__ */ jsx11(Text11, { children: " " }),
              /* @__PURE__ */ jsx11(Text11, { dimColor: true, children: "(Press ESC to close)" })
            ] }),
            /* @__PURE__ */ jsxs11(Box11, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: [
              state === "form" && /* @__PURE__ */ jsx11(Box11, { flexGrow: 1, width: "100%", children: /* @__PURE__ */ jsx11(
                Form,
                {
                  form: formStructure,
                  onSubmit: (value) => void handleFormSubmit(value)
                }
              ) }),
              state === "loading" && /* @__PURE__ */ jsx11(Box11, { flexGrow: 1, justifyContent: "center", alignItems: "center", children: /* @__PURE__ */ jsx11(Text11, { color: "yellow", children: "Calling tool..." }) }),
              state === "results" && result && /* @__PURE__ */ jsx11(Box11, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: /* @__PURE__ */ jsxs11(ScrollView9, { ref: scrollViewRef, children: [
                /* @__PURE__ */ jsx11(Box11, { marginBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs11(Text11, { bold: true, color: "green", children: [
                  "Duration: ",
                  result.duration,
                  "ms"
                ] }) }),
                /* @__PURE__ */ jsxs11(Box11, { marginBottom: 1, flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx11(Text11, { bold: true, color: "cyan", children: "Input:" }),
                  /* @__PURE__ */ jsx11(Box11, { paddingLeft: 2, children: /* @__PURE__ */ jsx11(Text11, { dimColor: true, children: JSON.stringify(result.input, null, 2) }) })
                ] }),
                result.error ? /* @__PURE__ */ jsxs11(Box11, { flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx11(Text11, { bold: true, color: "red", children: "Error:" }),
                  /* @__PURE__ */ jsx11(Box11, { paddingLeft: 2, children: /* @__PURE__ */ jsx11(Text11, { color: "red", children: String(result.error) }) }),
                  result.errorDetails != null ? /* @__PURE__ */ jsxs11(Fragment8, { children: [
                    /* @__PURE__ */ jsx11(Box11, { marginTop: 1, children: /* @__PURE__ */ jsx11(Text11, { bold: true, color: "red", dimColor: true, children: "Error Details:" }) }),
                    /* @__PURE__ */ jsx11(Box11, { paddingLeft: 2, children: /* @__PURE__ */ jsx11(Text11, { dimColor: true, children: JSON.stringify(result.errorDetails, null, 2) }) })
                  ] }) : null
                ] }) : /* @__PURE__ */ jsxs11(Box11, { flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx11(Text11, { bold: true, color: "green", children: "Output:" }),
                  /* @__PURE__ */ jsx11(Box11, { paddingLeft: 2, children: /* @__PURE__ */ jsx11(Text11, { dimColor: true, children: JSON.stringify(result.output, null, 2) }) })
                ] })
              ] }) })
            ] })
          ]
        }
      )
    }
  );
}

// src/components/ResourceTestModal.tsx
import React10, { useState as useState15 } from "react";
import { Box as Box12, Text as Text12, useInput as useInput10 } from "ink";
import { Form as Form2 } from "ink-form";

// src/utils/uriTemplateToForm.ts
import { UriTemplate as UriTemplate2 } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
function uriTemplateToForm(uriTemplate, templateName) {
  const fields = [];
  try {
    const template = new UriTemplate2(uriTemplate);
    const variableNames = template.variableNames || [];
    for (const variableName of variableNames) {
      const field = {
        name: variableName,
        label: variableName,
        type: "string",
        required: false
        // URI template variables are typically optional
      };
      fields.push(field);
    }
  } catch (error) {
    console.error("Failed to parse URI template:", error);
  }
  const sections = [
    {
      title: "Template Variables",
      fields
    }
  ];
  return {
    title: `Read Resource: ${templateName}`,
    sections
  };
}

// src/components/ResourceTestModal.tsx
import { ScrollView as ScrollView10 } from "ink-scroll-view";
import { Fragment as Fragment9, jsx as jsx12, jsxs as jsxs12 } from "react/jsx-runtime";
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error";
}
function ResourceTestModal({
  template,
  inspectorClient,
  width,
  height,
  onClose
}) {
  const [state, setState] = useState15("form");
  const [result, setResult] = useState15(null);
  const scrollViewRef = React10.useRef(null);
  const [terminalDimensions, setTerminalDimensions] = React10.useState({
    width: process.stdout.columns || width,
    height: process.stdout.rows || height
  });
  React10.useEffect(() => {
    const updateDimensions = () => {
      setTerminalDimensions({
        width: process.stdout.columns || width,
        height: process.stdout.rows || height
      });
    };
    process.stdout.on("resize", updateDimensions);
    updateDimensions();
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, [width, height]);
  const formStructure = uriTemplateToForm(
    template.uriTemplate,
    template.name || "Unknown Template"
  );
  React10.useEffect(() => {
    return () => {
      setState("form");
      setResult(null);
    };
  }, []);
  useInput10(
    (input, key) => {
      if (key.escape) {
        setState("form");
        setResult(null);
        onClose();
        return;
      }
      if (state === "form") {
        return;
      }
      if (state === "results") {
        if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        }
      }
    },
    { isActive: true }
  );
  const handleFormSubmit = async (values) => {
    if (!inspectorClient || !template) return;
    setState("loading");
    const startTime = Date.now();
    try {
      const invocation = await inspectorClient.readResourceFromTemplate(
        template.uriTemplate,
        values
      );
      const duration = Date.now() - startTime;
      setResult({
        input: values,
        output: invocation.result,
        // Extract the SDK result from the invocation
        duration,
        uri: invocation.expandedUri
        // Use expandedUri instead of uri
      });
      setState("results");
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      let uri = template.uriTemplate;
      if (error && typeof error === "object" && "uri" in error) {
        uri = error.uri;
      }
      const errorObj = {
        message: errorMessage
      };
      if (error instanceof Error) {
        errorObj.name = error.name;
        errorObj.stack = error.stack;
      } else if (error && typeof error === "object") {
        Object.assign(errorObj, error);
      } else {
        errorObj.error = String(error);
      }
      setResult({
        input: values,
        output: null,
        error: errorMessage,
        errorDetails: errorObj,
        duration,
        uri
      });
      setState("results");
    }
  };
  const modalWidth = terminalDimensions.width - 2;
  const modalHeight = terminalDimensions.height - 2;
  return /* @__PURE__ */ jsx12(
    Box12,
    {
      position: "absolute",
      width: terminalDimensions.width,
      height: terminalDimensions.height,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxs12(
        Box12,
        {
          width: modalWidth,
          height: modalHeight,
          borderStyle: "single",
          borderColor: "cyan",
          flexDirection: "column",
          paddingX: 1,
          paddingY: 1,
          backgroundColor: "black",
          children: [
            /* @__PURE__ */ jsxs12(Box12, { flexShrink: 0, marginBottom: 1, children: [
              /* @__PURE__ */ jsx12(Text12, { bold: true, color: "cyan", children: formStructure.title }),
              /* @__PURE__ */ jsx12(Text12, { children: " " }),
              /* @__PURE__ */ jsx12(Text12, { dimColor: true, children: "(Press ESC to close)" })
            ] }),
            /* @__PURE__ */ jsxs12(Box12, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: [
              state === "form" && /* @__PURE__ */ jsxs12(Box12, { flexGrow: 1, flexDirection: "column", children: [
                template.description && /* @__PURE__ */ jsx12(Box12, { marginBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsx12(Text12, { dimColor: true, children: template.description }) }),
                /* @__PURE__ */ jsx12(
                  Form2,
                  {
                    form: formStructure,
                    onSubmit: (values) => handleFormSubmit(values)
                  }
                )
              ] }),
              state === "loading" && /* @__PURE__ */ jsx12(Box12, { flexGrow: 1, justifyContent: "center", alignItems: "center", children: /* @__PURE__ */ jsx12(Text12, { color: "yellow", children: "Reading resource..." }) }),
              state === "results" && result && /* @__PURE__ */ jsx12(Box12, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: /* @__PURE__ */ jsxs12(ScrollView10, { ref: scrollViewRef, children: [
                /* @__PURE__ */ jsx12(Box12, { marginBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs12(Text12, { bold: true, color: "green", children: [
                  "Duration: ",
                  result.duration,
                  "ms"
                ] }) }),
                /* @__PURE__ */ jsxs12(Box12, { marginBottom: 1, flexShrink: 0, children: [
                  /* @__PURE__ */ jsxs12(Text12, { bold: true, color: "cyan", children: [
                    "URI:",
                    " "
                  ] }),
                  /* @__PURE__ */ jsx12(Text12, { dimColor: true, children: result.uri })
                ] }),
                /* @__PURE__ */ jsxs12(Box12, { marginBottom: 1, flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx12(Text12, { bold: true, color: "cyan", children: "Template Values:" }),
                  /* @__PURE__ */ jsx12(Box12, { paddingLeft: 2, children: /* @__PURE__ */ jsx12(Text12, { dimColor: true, children: JSON.stringify(result.input, null, 2) }) })
                ] }),
                result.error ? /* @__PURE__ */ jsxs12(Box12, { flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx12(Box12, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx12(Text12, { bold: true, color: "red", children: "Error:" }) }),
                  /* @__PURE__ */ jsx12(Box12, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx12(Text12, { color: "red", children: String(result.error) }) }),
                  result.errorDetails != null ? /* @__PURE__ */ jsxs12(Fragment9, { children: [
                    /* @__PURE__ */ jsx12(Box12, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx12(Text12, { bold: true, color: "red", dimColor: true, children: "Error Details:" }) }),
                    /* @__PURE__ */ jsx12(Box12, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx12(Text12, { dimColor: true, children: JSON.stringify(result.errorDetails, null, 2) }) })
                  ] }) : null
                ] }) : /* @__PURE__ */ jsxs12(Box12, { flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx12(Text12, { bold: true, color: "green", children: "Resource Content:" }),
                  /* @__PURE__ */ jsx12(Box12, { paddingLeft: 2, children: /* @__PURE__ */ jsx12(Text12, { dimColor: true, children: JSON.stringify(result.output, null, 2) }) })
                ] })
              ] }) })
            ] })
          ]
        }
      )
    }
  );
}

// src/components/PromptTestModal.tsx
import React11, { useState as useState16 } from "react";
import { Box as Box13, Text as Text13, useInput as useInput11 } from "ink";
import { Form as Form3 } from "ink-form";

// src/utils/promptArgsToForm.ts
function promptArgsToForm(promptArguments, promptName) {
  const fields = [];
  if (!promptArguments || promptArguments.length === 0) {
    return {
      title: `Get Prompt: ${promptName}`,
      sections: [{ title: "Parameters", fields: [] }]
    };
  }
  for (const arg of promptArguments) {
    const field = {
      name: arg.name,
      label: arg.name,
      type: "string",
      // Prompt arguments are always strings
      required: arg.required !== false,
      // Default to required unless explicitly false
      description: arg.description
    };
    fields.push(field);
  }
  const sections = [
    {
      title: "Prompt Arguments",
      fields
    }
  ];
  return {
    title: `Get Prompt: ${promptName}`,
    sections
  };
}

// src/components/PromptTestModal.tsx
import { ScrollView as ScrollView11 } from "ink-scroll-view";
import { Fragment as Fragment10, jsx as jsx13, jsxs as jsxs13 } from "react/jsx-runtime";
function getErrorMessage2(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error";
}
function PromptTestModal({
  prompt,
  inspectorClient,
  width,
  height,
  onClose
}) {
  const [state, setState] = useState16("form");
  const [result, setResult] = useState16(null);
  const scrollViewRef = React11.useRef(null);
  const [terminalDimensions, setTerminalDimensions] = React11.useState({
    width: process.stdout.columns || width,
    height: process.stdout.rows || height
  });
  React11.useEffect(() => {
    const updateDimensions = () => {
      setTerminalDimensions({
        width: process.stdout.columns || width,
        height: process.stdout.rows || height
      });
    };
    process.stdout.on("resize", updateDimensions);
    updateDimensions();
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, [width, height]);
  const formStructure = promptArgsToForm(
    prompt.arguments || [],
    prompt.name || "Unknown Prompt"
  );
  React11.useEffect(() => {
    return () => {
      setState("form");
      setResult(null);
    };
  }, []);
  useInput11(
    (input, key) => {
      if (key.escape) {
        setState("form");
        setResult(null);
        onClose();
        return;
      }
      if (state === "form") {
        return;
      }
      if (state === "results") {
        if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.pageDown) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        } else if (key.pageUp) {
          const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        }
      }
    },
    { isActive: true }
  );
  const handleFormSubmit = async (values) => {
    if (!inspectorClient || !prompt) return;
    setState("loading");
    const startTime = Date.now();
    try {
      const invocation = await inspectorClient.getPrompt(prompt.name, values);
      const duration = Date.now() - startTime;
      setResult({
        input: values,
        output: invocation.result,
        duration
      });
      setState("results");
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage2(error);
      const errorObj = {
        message: errorMessage
      };
      if (error instanceof Error) {
        errorObj.name = error.name;
        errorObj.stack = error.stack;
      } else if (error && typeof error === "object") {
        Object.assign(errorObj, error);
      } else {
        errorObj.error = String(error);
      }
      setResult({
        input: values,
        output: null,
        error: errorMessage,
        errorDetails: errorObj,
        duration
      });
      setState("results");
    }
  };
  const modalWidth = terminalDimensions.width - 2;
  const modalHeight = terminalDimensions.height - 2;
  return /* @__PURE__ */ jsx13(
    Box13,
    {
      position: "absolute",
      width: terminalDimensions.width,
      height: terminalDimensions.height,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxs13(
        Box13,
        {
          width: modalWidth,
          height: modalHeight,
          borderStyle: "single",
          borderColor: "cyan",
          flexDirection: "column",
          paddingX: 1,
          paddingY: 1,
          backgroundColor: "black",
          children: [
            /* @__PURE__ */ jsxs13(Box13, { flexShrink: 0, marginBottom: 1, children: [
              /* @__PURE__ */ jsx13(Text13, { bold: true, color: "cyan", children: formStructure.title }),
              /* @__PURE__ */ jsx13(Text13, { children: " " }),
              /* @__PURE__ */ jsx13(Text13, { dimColor: true, children: "(Press ESC to close)" })
            ] }),
            /* @__PURE__ */ jsxs13(Box13, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: [
              state === "form" && /* @__PURE__ */ jsxs13(Box13, { flexGrow: 1, flexDirection: "column", children: [
                prompt.description && /* @__PURE__ */ jsx13(Box13, { marginBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsx13(Text13, { dimColor: true, children: prompt.description }) }),
                /* @__PURE__ */ jsx13(
                  Form3,
                  {
                    form: formStructure,
                    onSubmit: (values) => handleFormSubmit(values)
                  }
                )
              ] }),
              state === "loading" && /* @__PURE__ */ jsx13(Box13, { flexGrow: 1, justifyContent: "center", alignItems: "center", children: /* @__PURE__ */ jsx13(Text13, { color: "yellow", children: "Getting prompt..." }) }),
              state === "results" && result && /* @__PURE__ */ jsx13(Box13, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: /* @__PURE__ */ jsxs13(ScrollView11, { ref: scrollViewRef, children: [
                /* @__PURE__ */ jsx13(Box13, { marginBottom: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs13(Text13, { bold: true, color: "green", children: [
                  "Duration: ",
                  result.duration,
                  "ms"
                ] }) }),
                Object.keys(result.input).length > 0 && /* @__PURE__ */ jsxs13(Box13, { marginBottom: 1, flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx13(Text13, { bold: true, color: "cyan", children: "Arguments:" }),
                  /* @__PURE__ */ jsx13(Box13, { paddingLeft: 2, children: /* @__PURE__ */ jsx13(Text13, { dimColor: true, children: JSON.stringify(result.input, null, 2) }) })
                ] }),
                result.error ? /* @__PURE__ */ jsxs13(Box13, { flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx13(Box13, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx13(Text13, { bold: true, color: "red", children: "Error:" }) }),
                  /* @__PURE__ */ jsx13(Box13, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx13(Text13, { color: "red", children: String(result.error) }) }),
                  result.errorDetails != null ? /* @__PURE__ */ jsxs13(Fragment10, { children: [
                    /* @__PURE__ */ jsx13(Box13, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx13(Text13, { bold: true, color: "red", dimColor: true, children: "Error Details:" }) }),
                    /* @__PURE__ */ jsx13(Box13, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx13(Text13, { dimColor: true, children: JSON.stringify(result.errorDetails, null, 2) }) })
                  ] }) : null
                ] }) : /* @__PURE__ */ jsxs13(Box13, { flexShrink: 0, flexDirection: "column", children: [
                  /* @__PURE__ */ jsx13(Text13, { bold: true, color: "green", children: "Prompt Messages:" }),
                  /* @__PURE__ */ jsx13(Box13, { paddingLeft: 2, children: /* @__PURE__ */ jsx13(Text13, { dimColor: true, children: JSON.stringify(result.output, null, 2) }) })
                ] })
              ] }) })
            ] })
          ]
        }
      )
    }
  );
}

// src/components/DetailsModal.tsx
import React12, { useRef as useRef9 } from "react";
import { Box as Box14, Text as Text14, useInput as useInput12 } from "ink";
import { ScrollView as ScrollView12 } from "ink-scroll-view";
import { jsx as jsx14, jsxs as jsxs14 } from "react/jsx-runtime";
function DetailsModal({
  title,
  content,
  width,
  height,
  onClose
}) {
  const scrollViewRef = useRef9(null);
  const [terminalDimensions, setTerminalDimensions] = React12.useState({
    width: process.stdout.columns || width,
    height: process.stdout.rows || height
  });
  React12.useEffect(() => {
    const updateDimensions = () => {
      setTerminalDimensions({
        width: process.stdout.columns || width,
        height: process.stdout.rows || height
      });
    };
    process.stdout.on("resize", updateDimensions);
    updateDimensions();
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, [width, height]);
  useInput12(
    (input, key) => {
      if (key.escape) {
        onClose();
      } else if (key.downArrow) {
        scrollViewRef.current?.scrollBy(1);
      } else if (key.upArrow) {
        scrollViewRef.current?.scrollBy(-1);
      } else if (key.pageDown) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(viewportHeight);
      } else if (key.pageUp) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(-viewportHeight);
      }
    },
    { isActive: true }
  );
  const modalWidth = terminalDimensions.width - 2;
  const modalHeight = terminalDimensions.height - 2;
  return /* @__PURE__ */ jsx14(
    Box14,
    {
      position: "absolute",
      width: terminalDimensions.width,
      height: terminalDimensions.height,
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      children: /* @__PURE__ */ jsxs14(
        Box14,
        {
          width: modalWidth,
          height: modalHeight,
          borderStyle: "single",
          borderColor: "cyan",
          flexDirection: "column",
          paddingX: 1,
          paddingY: 1,
          backgroundColor: "black",
          children: [
            /* @__PURE__ */ jsxs14(Box14, { flexShrink: 0, marginBottom: 1, children: [
              /* @__PURE__ */ jsx14(Text14, { bold: true, color: "cyan", children: title }),
              /* @__PURE__ */ jsx14(Text14, { children: " " }),
              /* @__PURE__ */ jsx14(Text14, { dimColor: true, children: "(Press ESC to close)" })
            ] }),
            /* @__PURE__ */ jsx14(Box14, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: /* @__PURE__ */ jsx14(ScrollView12, { ref: scrollViewRef, children: content }) })
          ]
        }
      )
    }
  );
}

// src/App.tsx
import { Fragment as Fragment11, jsx as jsx15, jsxs as jsxs15 } from "react/jsx-runtime";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname2(__filename);
var packagePath;
var packageJson;
try {
  packagePath = join2(__dirname, "..", "..", "package.json");
  packageJson = JSON.parse(readFileSync2(packagePath, "utf-8"));
} catch {
  packagePath = join2(__dirname, "..", "package.json");
  packageJson = JSON.parse(readFileSync2(packagePath, "utf-8"));
}
function isOAuthCapableServer(config) {
  if (!config) return false;
  const c = config;
  return c.type === "sse" || c.type === "streamable-http";
}
function App({
  mcpServers,
  clientId,
  clientSecret,
  clientMetadataUrl,
  callbackUrlConfig
}) {
  const { exit } = useApp();
  const callbackServerBaseOptions = useMemo2(
    () => ({
      port: callbackUrlConfig.port,
      hostname: callbackUrlConfig.hostname,
      path: callbackUrlConfig.pathname
    }),
    [callbackUrlConfig]
  );
  useEffect17(() => {
    getTuiLogger().info({ serverNames: Object.keys(mcpServers) }, "TUI started");
  }, [mcpServers]);
  const [selectedServer, setSelectedServer] = useState17(null);
  const [activeTab, setActiveTab] = useState17("info");
  const [focus, setFocus] = useState17("serverList");
  const [tabCounts, setTabCounts] = useState17({});
  const [oauthStatus, setOauthStatus] = useState17("idle");
  const [oauthMessage, setOauthMessage] = useState17(null);
  const oauthInProgressRef = useRef10(false);
  const [selectedAuthAction, setSelectedAuthAction] = useState17("guided");
  const [toolTestModal, setToolTestModal] = useState17(null);
  const [resourceTestModal, setResourceTestModal] = useState17(null);
  const [promptTestModal, setPromptTestModal] = useState17(null);
  const [detailsModal, setDetailsModal] = useState17(null);
  const [inspectorClients, setInspectorClients] = useState17({});
  const [managedToolsStates, setManagedToolsStates] = useState17({});
  const [managedResourcesStates, setManagedResourcesStates] = useState17({});
  const [managedResourceTemplatesStates, setManagedResourceTemplatesStates] = useState17({});
  const [managedPromptsStates, setManagedPromptsStates] = useState17({});
  const [messageLogStates, setMessageLogStates] = useState17({});
  const [fetchRequestLogStates, setFetchRequestLogStates] = useState17({});
  const [stderrLogStates, setStderrLogStates] = useState17({});
  const [dimensions, setDimensions] = useState17({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24
  });
  useEffect17(() => {
    const updateDimensions = () => {
      setDimensions({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24
      });
    };
    process.stdout.on("resize", updateDimensions);
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, []);
  const serverNames = Object.keys(mcpServers);
  const selectedServerEntry = selectedServer ? mcpServers[selectedServer] : null;
  const selectedServerConfig = selectedServerEntry?.config ?? null;
  const redirectUrlProvidersRef = useRef10({});
  useEffect17(() => {
    const newClients = {};
    const newManagers = {};
    const newManagedResourcesStates = {};
    const newManagedResourceTemplatesStates = {};
    const newManagedPromptsStates = {};
    const newMessageLogStates = {};
    const newFetchRequestLogStates = {};
    const newStderrLogStates = {};
    for (const serverName of serverNames) {
      if (!(serverName in inspectorClients)) {
        const { config: serverConfig, settings: savedSettings } = mcpServers[serverName];
        const environment = {
          transport: createTransportNode,
          logger: getTuiLogger()
        };
        const defaultMetadata = savedSettings?.metadata ? Object.fromEntries(
          savedSettings.metadata.filter((m) => m.key.trim() !== "").map((m) => [m.key, m.value])
        ) : void 0;
        const oauthFromSettings = savedSettings && (savedSettings.oauthClientId || savedSettings.oauthClientSecret || savedSettings.oauthScopes) ? {
          ...savedSettings.oauthClientId && {
            clientId: savedSettings.oauthClientId
          },
          ...savedSettings.oauthClientSecret && {
            clientSecret: savedSettings.oauthClientSecret
          },
          ...savedSettings.oauthScopes && {
            scope: savedSettings.oauthScopes
          }
        } : void 0;
        const opts = {
          environment,
          pipeStderr: true,
          ...savedSettings && savedSettings.requestTimeout > 0 && {
            timeout: savedSettings.requestTimeout
          },
          ...defaultMetadata && Object.keys(defaultMetadata).length > 0 && {
            defaultMetadata
          },
          ...savedSettings && { serverSettings: savedSettings }
        };
        if (isOAuthCapableServer(serverConfig)) {
          const redirectUrlProvider = redirectUrlProvidersRef.current[serverName] ?? (redirectUrlProvidersRef.current[serverName] = new MutableRedirectUrlProvider());
          environment.oauth = {
            storage: new NodeOAuthStorage(),
            navigation: new CallbackNavigation(
              async (url) => await openUrl(url)
            ),
            redirectUrlProvider
          };
          opts.oauth = {
            ...oauthFromSettings ?? {},
            ...clientId && { clientId },
            ...clientSecret && { clientSecret },
            ...clientMetadataUrl && { clientMetadataUrl }
          };
        }
        const client = new InspectorClient(serverConfig, opts);
        newClients[serverName] = client;
        newManagers[serverName] = new ManagedToolsState(client);
        newManagedResourcesStates[serverName] = new ManagedResourcesState(
          client
        );
        newManagedResourceTemplatesStates[serverName] = new ManagedResourceTemplatesState(client);
        newManagedPromptsStates[serverName] = new ManagedPromptsState(client);
        newMessageLogStates[serverName] = new MessageLogState(client);
        newFetchRequestLogStates[serverName] = new FetchRequestLogState(client);
        newStderrLogStates[serverName] = new StderrLogState(client);
      }
    }
    if (Object.keys(newClients).length > 0) {
      setInspectorClients((prev) => ({ ...prev, ...newClients }));
      setManagedToolsStates((prev) => ({ ...prev, ...newManagers }));
      setManagedResourcesStates((prev) => ({
        ...prev,
        ...newManagedResourcesStates
      }));
      setManagedResourceTemplatesStates((prev) => ({
        ...prev,
        ...newManagedResourceTemplatesStates
      }));
      setManagedPromptsStates((prev) => ({
        ...prev,
        ...newManagedPromptsStates
      }));
      setMessageLogStates((prev) => ({ ...prev, ...newMessageLogStates }));
      setFetchRequestLogStates((prev) => ({
        ...prev,
        ...newFetchRequestLogStates
      }));
      setStderrLogStates((prev) => ({ ...prev, ...newStderrLogStates }));
    }
  }, [clientId, clientSecret, clientMetadataUrl]);
  useEffect17(() => {
    return () => {
      Object.values(managedToolsStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(managedResourcesStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(managedResourceTemplatesStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(managedPromptsStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(messageLogStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(fetchRequestLogStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(stderrLogStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(inspectorClients).forEach((client) => {
        client.disconnect().catch(() => {
        });
      });
    };
  }, [
    inspectorClients,
    managedToolsStates,
    managedResourcesStates,
    managedResourceTemplatesStates,
    managedPromptsStates,
    messageLogStates,
    fetchRequestLogStates,
    stderrLogStates
  ]);
  useEffect17(() => {
    if (serverNames.length > 0 && selectedServer === null) {
      setSelectedServer(serverNames[0]);
    }
  }, []);
  useEffect17(() => {
    setOauthStatus("idle");
    setOauthMessage(null);
  }, [selectedServer]);
  useEffect17(() => {
    if (activeTab === "auth" && selectedServerConfig && !isOAuthCapableServer(selectedServerConfig)) {
      setActiveTab("info");
    }
  }, [activeTab, selectedServerConfig]);
  const selectedInspectorClient = useMemo2(
    () => selectedServer ? inspectorClients[selectedServer] : null,
    [selectedServer, inspectorClients]
  );
  const {
    status: inspectorStatus,
    capabilities: inspectorCapabilities,
    serverInfo: inspectorServerInfo,
    instructions: inspectorInstructions,
    connect: connectInspector,
    disconnect: disconnectInspector
  } = useInspectorClient(selectedInspectorClient);
  const selectedMessageLogState = useMemo2(
    () => selectedServer && messageLogStates[selectedServer] ? messageLogStates[selectedServer] : null,
    [selectedServer, messageLogStates]
  );
  const selectedFetchRequestLogState = useMemo2(
    () => selectedServer && fetchRequestLogStates[selectedServer] ? fetchRequestLogStates[selectedServer] : null,
    [selectedServer, fetchRequestLogStates]
  );
  const selectedStderrLogState = useMemo2(
    () => selectedServer && stderrLogStates[selectedServer] ? stderrLogStates[selectedServer] : null,
    [selectedServer, stderrLogStates]
  );
  const { messages: inspectorMessages } = useMessageLog(
    selectedMessageLogState
  );
  const { fetchRequests: inspectorFetchRequests } = useFetchRequestLog(
    selectedFetchRequestLogState
  );
  const { stderrLogs: inspectorStderrLogs } = useStderrLog(
    selectedStderrLogState
  );
  const selectedManagedToolsState = useMemo2(
    () => selectedServer && managedToolsStates[selectedServer] ? managedToolsStates[selectedServer] : null,
    [selectedServer, managedToolsStates]
  );
  const { tools: managedTools } = useManagedTools(
    selectedInspectorClient,
    selectedManagedToolsState
  );
  const selectedManagedResourcesState = useMemo2(
    () => selectedServer && managedResourcesStates[selectedServer] ? managedResourcesStates[selectedServer] : null,
    [selectedServer, managedResourcesStates]
  );
  const selectedManagedResourceTemplatesState = useMemo2(
    () => selectedServer && managedResourceTemplatesStates[selectedServer] ? managedResourceTemplatesStates[selectedServer] : null,
    [selectedServer, managedResourceTemplatesStates]
  );
  const selectedManagedPromptsState = useMemo2(
    () => selectedServer && managedPromptsStates[selectedServer] ? managedPromptsStates[selectedServer] : null,
    [selectedServer, managedPromptsStates]
  );
  const { resources: managedResources } = useManagedResources(
    selectedInspectorClient,
    selectedManagedResourcesState
  );
  const { resourceTemplates: managedResourceTemplates } = useManagedResourceTemplates(
    selectedInspectorClient,
    selectedManagedResourceTemplatesState
  );
  const { prompts: managedPrompts } = useManagedPrompts(
    selectedInspectorClient,
    selectedManagedPromptsState
  );
  const handleConnect = useCallback8(async () => {
    if (!selectedServer || !selectedInspectorClient) return;
    try {
      await connectInspector();
    } catch {
    }
  }, [selectedServer, selectedInspectorClient, connectInspector]);
  const handleDisconnect = useCallback8(async () => {
    if (!selectedServer) return;
    await disconnectInspector();
  }, [selectedServer, disconnectInspector]);
  const callbackServerRef = useRef10(null);
  const handleQuickAuth = useCallback8(async () => {
    if (!selectedServer || !selectedInspectorClient || !selectedServerConfig || !isOAuthCapableServer(selectedServerConfig)) {
      return;
    }
    if (oauthInProgressRef.current) return;
    oauthInProgressRef.current = true;
    setOauthStatus("authenticating");
    setOauthMessage(null);
    getTuiLogger().info(
      { server: selectedServer },
      "OAuth authentication started (Quick Auth)"
    );
    const existing = callbackServerRef.current;
    if (existing) {
      await existing.stop();
      callbackServerRef.current = null;
    }
    const callbackServer = createOAuthCallbackServer();
    callbackServerRef.current = callbackServer;
    let flowResolve;
    let flowReject;
    const flowDone = new Promise((resolve5, reject) => {
      flowResolve = resolve5;
      flowReject = reject;
    });
    try {
      const { redirectUrl } = await callbackServer.start({
        ...callbackServerBaseOptions,
        onCallback: async (params) => {
          try {
            await selectedInspectorClient.completeOAuthFlow(params.code);
            flowResolve();
          } catch (err) {
            flowReject(err instanceof Error ? err : new Error(String(err)));
          } finally {
            callbackServerRef.current = null;
          }
        },
        onError: (params) => {
          flowReject(
            new Error(
              params.error_description ?? params.error ?? "OAuth error"
            )
          );
          void callbackServer.stop();
          callbackServerRef.current = null;
        }
      });
      const redirectUrlProvider = redirectUrlProvidersRef.current[selectedServer];
      if (redirectUrlProvider) {
        redirectUrlProvider.redirectUrl = redirectUrl;
      }
      await selectedInspectorClient.authenticate();
      await flowDone;
      setOauthStatus("success");
      setOauthMessage("OAuth complete. Press C to connect.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOauthStatus("error");
      setOauthMessage(msg);
    } finally {
      oauthInProgressRef.current = false;
    }
  }, [
    selectedServer,
    selectedInspectorClient,
    selectedServerConfig,
    callbackServerBaseOptions
  ]);
  const handleGuidedStart = useCallback8(async () => {
    if (!selectedServer || !selectedInspectorClient || !selectedServerConfig || !isOAuthCapableServer(selectedServerConfig)) {
      return;
    }
    if (oauthInProgressRef.current) return;
    oauthInProgressRef.current = true;
    setOauthStatus("authenticating");
    setOauthMessage(null);
    getTuiLogger().info(
      { server: selectedServer },
      "OAuth authentication started (Guided Auth)"
    );
    const existing = callbackServerRef.current;
    if (existing) {
      await existing.stop();
      callbackServerRef.current = null;
    }
    const callbackServer = createOAuthCallbackServer();
    callbackServerRef.current = callbackServer;
    try {
      const { redirectUrl } = await callbackServer.start({
        ...callbackServerBaseOptions,
        onCallback: async (params) => {
          try {
            await selectedInspectorClient.completeOAuthFlow(params.code);
            setOauthStatus("success");
            setOauthMessage("OAuth complete. Press C to connect.");
          } catch (err) {
            setOauthStatus("error");
            setOauthMessage(err instanceof Error ? err.message : String(err));
          } finally {
            callbackServerRef.current = null;
          }
        },
        onError: (params) => {
          setOauthStatus("error");
          setOauthMessage(
            params.error_description ?? params.error ?? "OAuth error"
          );
          void callbackServer.stop();
          callbackServerRef.current = null;
        }
      });
      const redirectUrlProvider = redirectUrlProvidersRef.current[selectedServer];
      if (redirectUrlProvider) {
        redirectUrlProvider.redirectUrl = redirectUrl;
      }
      await selectedInspectorClient.beginGuidedAuth();
      setOauthStatus("idle");
    } catch (err) {
      setOauthStatus("error");
      setOauthMessage(err instanceof Error ? err.message : String(err));
    } finally {
      oauthInProgressRef.current = false;
    }
  }, [
    selectedServer,
    selectedInspectorClient,
    selectedServerConfig,
    callbackServerBaseOptions
  ]);
  const handleGuidedAdvance = useCallback8(async () => {
    if (!selectedInspectorClient) return;
    if (oauthInProgressRef.current) return;
    oauthInProgressRef.current = true;
    setOauthStatus("authenticating");
    setOauthMessage(null);
    getTuiLogger().info("OAuth authentication started (Guided Auth advance step)");
    try {
      await selectedInspectorClient.proceedOAuthStep();
      const state = selectedInspectorClient.getOAuthState();
      if (state?.oauthStep === "authorization_code" && state.authorizationUrl) {
        await openUrl(state.authorizationUrl);
      }
      setOauthStatus("idle");
    } catch (err) {
      setOauthStatus("error");
      setOauthMessage(err instanceof Error ? err.message : String(err));
    } finally {
      oauthInProgressRef.current = false;
    }
  }, [selectedInspectorClient]);
  const handleRunGuidedToCompletion = useCallback8(async () => {
    if (!selectedServer || !selectedInspectorClient || !selectedServerConfig || !isOAuthCapableServer(selectedServerConfig)) {
      return;
    }
    if (oauthInProgressRef.current) return;
    oauthInProgressRef.current = true;
    setOauthStatus("authenticating");
    setOauthMessage(null);
    getTuiLogger().info(
      { server: selectedServer },
      "OAuth authentication started (Run Guided Auth to completion)"
    );
    const ensureCallbackServer = async () => {
      if (callbackServerRef.current) return;
      const callbackServer = createOAuthCallbackServer();
      callbackServerRef.current = callbackServer;
      const { redirectUrl } = await callbackServer.start({
        ...callbackServerBaseOptions,
        onCallback: async (params) => {
          try {
            await selectedInspectorClient.completeOAuthFlow(params.code);
            setOauthStatus("success");
            setOauthMessage("OAuth complete. Press C to connect.");
          } catch (err) {
            setOauthStatus("error");
            setOauthMessage(err instanceof Error ? err.message : String(err));
          } finally {
            callbackServerRef.current = null;
          }
        },
        onError: (params) => {
          setOauthStatus("error");
          setOauthMessage(
            params.error_description ?? params.error ?? "OAuth error"
          );
          void callbackServer.stop();
          callbackServerRef.current = null;
        }
      });
      const redirectUrlProvider = redirectUrlProvidersRef.current[selectedServer];
      if (redirectUrlProvider) {
        redirectUrlProvider.redirectUrl = redirectUrl;
      }
    };
    try {
      await ensureCallbackServer();
      const authUrl = await selectedInspectorClient.runGuidedAuth();
      if (authUrl) {
        await openUrl(authUrl);
      }
      setOauthStatus("idle");
    } catch (err) {
      setOauthStatus("error");
      setOauthMessage(err instanceof Error ? err.message : String(err));
    } finally {
      oauthInProgressRef.current = false;
    }
  }, [
    selectedServer,
    selectedInspectorClient,
    selectedServerConfig,
    callbackServerBaseOptions
  ]);
  const handleClearOAuth = useCallback8(() => {
    if (selectedInspectorClient) {
      selectedInspectorClient.clearOAuthTokens();
      setOauthStatus("idle");
      setOauthMessage(null);
    }
  }, [selectedInspectorClient]);
  const currentServerState = useMemo2(() => {
    if (!selectedServer) return null;
    return {
      status: inspectorStatus,
      error: null,
      // InspectorClient doesn't track error in state, only emits error events
      capabilities: inspectorCapabilities,
      serverInfo: inspectorServerInfo,
      instructions: inspectorInstructions,
      resources: managedResources,
      resourceTemplates: managedResourceTemplates,
      prompts: managedPrompts,
      tools: managedTools,
      stderrLogs: inspectorStderrLogs
      // InspectorClient manages this
    };
  }, [
    selectedServer,
    inspectorStatus,
    inspectorCapabilities,
    inspectorServerInfo,
    inspectorInstructions,
    managedResources,
    managedResourceTemplates,
    managedPrompts,
    managedTools,
    inspectorStderrLogs
  ]);
  const show401AuthHint = useMemo2(() => {
    if (inspectorStatus !== "error") return false;
    if (oauthStatus === "authenticating" || oauthStatus === "success")
      return false;
    if (!selectedServerConfig || !isOAuthCapableServer(selectedServerConfig))
      return false;
    return inspectorFetchRequests.some((r) => r.responseStatus === 401);
  }, [
    inspectorStatus,
    oauthStatus,
    selectedServerConfig,
    inspectorFetchRequests
  ]);
  const renderResourceDetails = (resource) => /* @__PURE__ */ jsxs15(Fragment11, { children: [
    "uri" in resource && resource.description && /* @__PURE__ */ jsx15(Fragment11, { children: resource.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx15(
      Box15,
      {
        marginTop: idx === 0 ? 0 : 0,
        flexShrink: 0,
        children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: line })
      },
      `desc-${idx}`
    )) }),
    "uri" in resource && resource.uri && /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "URI:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: resource.uri }) })
    ] }),
    "mimeType" in resource && resource.mimeType && /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "MIME Type:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: resource.mimeType }) })
    ] }),
    /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Full JSON:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(resource, null, 2) }) })
    ] })
  ] });
  const renderPromptDetails = (prompt) => /* @__PURE__ */ jsxs15(Fragment11, { children: [
    prompt.description && /* @__PURE__ */ jsx15(Fragment11, { children: prompt.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx15(
      Box15,
      {
        marginTop: idx === 0 ? 0 : 0,
        flexShrink: 0,
        children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: line })
      },
      `desc-${idx}`
    )) }),
    prompt.arguments && prompt.arguments.length > 0 && /* @__PURE__ */ jsxs15(Fragment11, { children: [
      /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Arguments:" }) }),
      prompt.arguments.map((arg, idx) => /* @__PURE__ */ jsx15(
        Box15,
        {
          marginTop: 1,
          paddingLeft: 2,
          flexShrink: 0,
          children: /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
            "- ",
            arg.name,
            ":",
            " ",
            arg.description ?? arg.type ?? "string"
          ] })
        },
        `arg-${idx}`
      ))
    ] }),
    /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Full JSON:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(prompt, null, 2) }) })
    ] })
  ] });
  const renderToolDetails = (tool) => /* @__PURE__ */ jsxs15(Fragment11, { children: [
    tool.description && /* @__PURE__ */ jsx15(Fragment11, { children: tool.description.split("\n").map((line, idx) => /* @__PURE__ */ jsx15(
      Box15,
      {
        marginTop: idx === 0 ? 0 : 0,
        flexShrink: 0,
        children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: line })
      },
      `desc-${idx}`
    )) }),
    tool.inputSchema && /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Input Schema:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(tool.inputSchema, null, 2) }) })
    ] }),
    /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Full JSON:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(tool, null, 2) }) })
    ] })
  ] });
  const renderRequestDetails = (request) => /* @__PURE__ */ jsxs15(Fragment11, { children: [
    /* @__PURE__ */ jsx15(Box15, { flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { bold: true, children: [
      request.method,
      " ",
      request.url
    ] }) }),
    /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { bold: true, children: [
      "Category:",
      " ",
      /* @__PURE__ */ jsx15(Text15, { children: request.category === "auth" ? "auth" : "transport" })
    ] }) }),
    request.responseStatus !== void 0 ? /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { bold: true, children: [
      "Status: ",
      request.responseStatus,
      " ",
      request.responseStatusText || ""
    ] }) }) : request.error ? /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { bold: true, color: "red", children: [
      "Error: ",
      request.error
    ] }) }) : null,
    request.duration !== void 0 && /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
      request.timestamp.toLocaleTimeString(),
      " (",
      request.duration,
      "ms)"
    ] }) }),
    /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Request Headers:" }),
      Object.entries(request.requestHeaders).map(([key, value]) => /* @__PURE__ */ jsx15(Box15, { marginTop: 0, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
        key,
        ": ",
        value
      ] }) }, key))
    ] }),
    request.requestBody && /* @__PURE__ */ jsxs15(Fragment11, { children: [
      /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Request Body:" }) }),
      (() => {
        try {
          const parsed = JSON.parse(request.requestBody);
          return JSON.stringify(parsed, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx15(
            Box15,
            {
              marginTop: idx === 0 ? 1 : 0,
              paddingLeft: 2,
              flexShrink: 0,
              children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: line })
            },
            `req-body-${idx}`
          ));
        } catch {
          return /* @__PURE__ */ jsx15(Box15, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: request.requestBody }) });
        }
      })()
    ] }),
    request.responseHeaders && Object.keys(request.responseHeaders).length > 0 && /* @__PURE__ */ jsxs15(Fragment11, { children: [
      /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Response Headers:" }) }),
      Object.entries(request.responseHeaders).map(([key, value]) => /* @__PURE__ */ jsx15(Box15, { marginTop: 0, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
        key,
        ": ",
        value
      ] }) }, key))
    ] }),
    request.responseBody && /* @__PURE__ */ jsxs15(Fragment11, { children: [
      /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Response Body:" }) }),
      (() => {
        try {
          const parsed = JSON.parse(request.responseBody);
          return JSON.stringify(parsed, null, 2).split("\n").map((line, idx) => /* @__PURE__ */ jsx15(
            Box15,
            {
              marginTop: idx === 0 ? 1 : 0,
              paddingLeft: 2,
              flexShrink: 0,
              children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: line })
            },
            `resp-body-${idx}`
          ));
        } catch {
          return /* @__PURE__ */ jsx15(Box15, { marginTop: 1, paddingLeft: 2, flexShrink: 0, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: request.responseBody }) });
        }
      })()
    ] })
  ] });
  const renderMessageDetails = (message) => /* @__PURE__ */ jsxs15(Fragment11, { children: [
    /* @__PURE__ */ jsx15(Box15, { flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { bold: true, children: [
      "Direction: ",
      message.direction
    ] }) }),
    /* @__PURE__ */ jsx15(Box15, { marginTop: 1, flexShrink: 0, children: /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
      message.timestamp.toLocaleTimeString(),
      message.duration !== void 0 && ` (${message.duration}ms)`
    ] }) }),
    message.direction === "request" ? /* @__PURE__ */ jsxs15(Fragment11, { children: [
      /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
        /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Request:" }),
        /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(message.message, null, 2) }) })
      ] }),
      message.response && /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
        /* @__PURE__ */ jsx15(Text15, { bold: true, children: "Response:" }),
        /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(message.response, null, 2) }) })
      ] })
    ] }) : /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, flexShrink: 0, flexDirection: "column", children: [
      /* @__PURE__ */ jsx15(Text15, { bold: true, children: message.direction === "response" ? "Response:" : "Notification:" }),
      /* @__PURE__ */ jsx15(Box15, { paddingLeft: 2, children: /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: JSON.stringify(message.message, null, 2) }) })
    ] })
  ] });
  useEffect17(() => {
    if (!selectedServer) {
      return;
    }
    setTabCounts({
      resources: managedResources.length || 0,
      prompts: managedPrompts.length || 0,
      tools: managedTools.length || 0,
      messages: inspectorMessages.length || 0,
      requests: inspectorFetchRequests.length || 0,
      logging: inspectorStderrLogs.length || 0
    });
  }, [
    selectedServer,
    managedResources,
    managedPrompts,
    managedTools,
    inspectorMessages,
    inspectorFetchRequests,
    inspectorStderrLogs
  ]);
  useEffect17(() => {
    if (activeTab === "messages") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("messagesList");
      }
    } else if (activeTab === "requests") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("requestsList");
      }
    } else {
      if (focus === "messagesList" || focus === "messagesDetail" || focus === "requestsList" || focus === "requestsDetail") {
        setFocus("tabContentList");
      }
    }
  }, [activeTab]);
  useEffect17(() => {
    if (activeTab === "logging" && selectedServer) {
      const client = inspectorClients[selectedServer];
      if (client && client.getServerType() !== "stdio") {
        setActiveTab("info");
      }
    }
  }, [selectedServer, activeTab, inspectorClients]);
  useInput13((input, key) => {
    if (toolTestModal || resourceTestModal || promptTestModal || detailsModal) {
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
    }
    if (key.escape) {
      exit();
    }
    const showAuthTabForAccel = !!selectedServer && !!selectedServerConfig && isOAuthCapableServer(selectedServerConfig);
    const lower = input.toLowerCase();
    if (showAuthTabForAccel && (lower === "g" || lower === "q" || lower === "s")) {
      setActiveTab("auth");
      setFocus("tabContentList");
      setSelectedAuthAction(
        lower === "g" ? "guided" : lower === "q" ? "quick" : "clear"
      );
      return;
    }
    const showAuthTab = !!selectedServer && !!selectedServerConfig && isOAuthCapableServer(selectedServerConfig);
    const showLoggingTab = !!selectedServer && inspectorClients[selectedServer]?.getServerType() === "stdio";
    const showRequestsTab = !!selectedServer && (inspectorClients[selectedServer]?.getServerType() === "sse" || inspectorClients[selectedServer]?.getServerType() === "streamable-http");
    const tabAccelerators = Object.fromEntries(
      tabs.filter((tab) => {
        if (tab.id === "auth" && !showAuthTab) return false;
        if (tab.id === "logging" && !showLoggingTab) return false;
        if (tab.id === "requests" && !showRequestsTab) return false;
        return true;
      }).map((tab) => [
        tab.accelerator,
        tab.id
      ])
    );
    if (tabAccelerators[input.toLowerCase()]) {
      setActiveTab(tabAccelerators[input.toLowerCase()]);
      setFocus("tabs");
    } else if (key.tab && !key.shift) {
      const focusOrder = activeTab === "messages" ? ["serverList", "tabs", "messagesList", "messagesDetail"] : activeTab === "requests" ? ["serverList", "tabs", "requestsList", "requestsDetail"] : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const nextIndex = (currentIndex + 1) % focusOrder.length;
      setFocus(focusOrder[nextIndex]);
    } else if (key.tab && key.shift) {
      const focusOrder = activeTab === "messages" ? ["serverList", "tabs", "messagesList", "messagesDetail"] : activeTab === "requests" ? ["serverList", "tabs", "requestsList", "requestsDetail"] : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusOrder.length - 1;
      setFocus(focusOrder[prevIndex]);
    } else if (key.upArrow || key.downArrow) {
      if (focus === "serverList") {
        if (key.upArrow) {
          if (selectedServer === null) {
            setSelectedServer(serverNames[serverNames.length - 1] || null);
          } else {
            const currentIndex = serverNames.indexOf(selectedServer);
            const newIndex = currentIndex > 0 ? currentIndex - 1 : serverNames.length - 1;
            setSelectedServer(serverNames[newIndex] || null);
          }
        } else if (key.downArrow) {
          if (selectedServer === null) {
            setSelectedServer(serverNames[0] || null);
          } else {
            const currentIndex = serverNames.indexOf(selectedServer);
            const newIndex = currentIndex < serverNames.length - 1 ? currentIndex + 1 : 0;
            setSelectedServer(serverNames[newIndex] || null);
          }
        }
        return;
      }
    } else if (focus === "tabs" && (key.leftArrow || key.rightArrow)) {
      const showAuthTab2 = !!selectedServer && !!selectedServerConfig && isOAuthCapableServer(selectedServerConfig);
      const showLoggingTab2 = !!selectedServer && inspectorClients[selectedServer]?.getServerType() === "stdio";
      const showRequestsTab2 = !!selectedServer && (inspectorClients[selectedServer]?.getServerType() === "sse" || inspectorClients[selectedServer]?.getServerType() === "streamable-http");
      const allTabs = [
        "info",
        "auth",
        "resources",
        "prompts",
        "tools",
        "messages",
        "requests",
        "logging"
      ];
      const tabs2 = allTabs.filter((t) => {
        if (t === "auth" && !showAuthTab2) return false;
        if (t === "logging" && !showLoggingTab2) return false;
        if (t === "requests" && !showRequestsTab2) return false;
        return true;
      });
      const currentIndex = tabs2.indexOf(activeTab);
      if (key.leftArrow) {
        const newIndex = currentIndex > 0 ? currentIndex - 1 : tabs2.length - 1;
        setActiveTab(tabs2[newIndex]);
      } else if (key.rightArrow) {
        const newIndex = currentIndex < tabs2.length - 1 ? currentIndex + 1 : 0;
        setActiveTab(tabs2[newIndex]);
      }
    }
    if (selectedServer) {
      if (input.toLowerCase() === "c" && (inspectorStatus === "disconnected" || inspectorStatus === "error")) {
        handleConnect();
      } else if (input.toLowerCase() === "d" && (inspectorStatus === "connected" || inspectorStatus === "connecting")) {
        handleDisconnect();
      }
    }
  });
  const headerHeight = 1;
  const tabsHeight = 1;
  const availableHeight = dimensions.height - headerHeight - tabsHeight;
  const serverDetailsMinHeight = 3;
  const contentHeight = availableHeight - serverDetailsMinHeight;
  const serverListWidth = Math.floor(dimensions.width * 0.3);
  const contentWidth = dimensions.width - serverListWidth;
  const getStatusColor = (status) => {
    switch (status) {
      case "connected":
        return "green";
      case "connecting":
        return "yellow";
      case "error":
        return "red";
      default:
        return "gray";
    }
  };
  const getStatusSymbol = (status) => {
    switch (status) {
      case "connected":
        return "\u25CF";
      case "connecting":
        return "\u25D0";
      case "error":
        return "\u2717";
      default:
        return "\u25CB";
    }
  };
  return /* @__PURE__ */ jsxs15(
    Box15,
    {
      flexDirection: "column",
      width: dimensions.width,
      height: dimensions.height,
      children: [
        /* @__PURE__ */ jsxs15(
          Box15,
          {
            width: dimensions.width,
            height: headerHeight,
            borderStyle: "single",
            borderTop: false,
            borderLeft: false,
            borderRight: false,
            paddingX: 1,
            justifyContent: "space-between",
            alignItems: "center",
            children: [
              /* @__PURE__ */ jsxs15(Box15, { children: [
                /* @__PURE__ */ jsx15(Text15, { bold: true, color: "cyan", children: packageJson.name }),
                /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
                  " - ",
                  packageJson.description
                ] })
              ] }),
              /* @__PURE__ */ jsxs15(Text15, { dimColor: true, children: [
                "v",
                packageJson.version
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsxs15(
          Box15,
          {
            flexDirection: "row",
            height: availableHeight + tabsHeight,
            width: dimensions.width,
            children: [
              /* @__PURE__ */ jsxs15(
                Box15,
                {
                  width: serverListWidth,
                  height: availableHeight + tabsHeight,
                  borderStyle: "single",
                  borderTop: false,
                  borderBottom: false,
                  borderLeft: false,
                  borderRight: true,
                  flexDirection: "column",
                  paddingX: 1,
                  children: [
                    /* @__PURE__ */ jsx15(Box15, { marginTop: 1, marginBottom: 1, children: /* @__PURE__ */ jsx15(
                      Text15,
                      {
                        bold: true,
                        backgroundColor: focus === "serverList" ? "yellow" : void 0,
                        children: "MCP Servers"
                      }
                    ) }),
                    /* @__PURE__ */ jsx15(Box15, { flexDirection: "column", flexGrow: 1, children: serverNames.map((serverName) => {
                      const isSelected = selectedServer === serverName;
                      return /* @__PURE__ */ jsx15(Box15, { paddingY: 0, children: /* @__PURE__ */ jsxs15(Text15, { children: [
                        isSelected ? "\u25B6 " : "  ",
                        serverName
                      ] }) }, serverName);
                    }) }),
                    /* @__PURE__ */ jsx15(
                      Box15,
                      {
                        flexShrink: 0,
                        height: 1,
                        justifyContent: "center",
                        backgroundColor: "gray",
                        children: /* @__PURE__ */ jsx15(Text15, { bold: true, color: "white", children: "ESC to exit" })
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ jsxs15(
                Box15,
                {
                  flexGrow: 1,
                  height: availableHeight + tabsHeight,
                  flexDirection: "column",
                  children: [
                    /* @__PURE__ */ jsx15(
                      Box15,
                      {
                        width: contentWidth,
                        borderStyle: "single",
                        borderTop: false,
                        borderLeft: false,
                        borderRight: false,
                        borderBottom: true,
                        paddingX: 1,
                        paddingY: 1,
                        flexDirection: "column",
                        flexShrink: 0,
                        children: /* @__PURE__ */ jsxs15(Box15, { flexDirection: "column", children: [
                          /* @__PURE__ */ jsxs15(
                            Box15,
                            {
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                              children: [
                                /* @__PURE__ */ jsx15(Text15, { bold: true, color: "cyan", children: selectedServer }),
                                /* @__PURE__ */ jsx15(Box15, { flexDirection: "row", alignItems: "center", gap: 1, children: currentServerState && /* @__PURE__ */ jsxs15(Fragment11, { children: [
                                  /* @__PURE__ */ jsxs15(Text15, { color: getStatusColor(currentServerState.status), children: [
                                    getStatusSymbol(currentServerState.status),
                                    " ",
                                    currentServerState.status
                                  ] }),
                                  /* @__PURE__ */ jsx15(Text15, { children: " " }),
                                  (currentServerState?.status === "disconnected" || currentServerState?.status === "error") && /* @__PURE__ */ jsxs15(Text15, { color: "cyan", bold: true, children: [
                                    "[",
                                    /* @__PURE__ */ jsx15(Text15, { underline: true, children: "C" }),
                                    "onnect]"
                                  ] }),
                                  (currentServerState?.status === "connected" || currentServerState?.status === "connecting") && /* @__PURE__ */ jsxs15(Text15, { color: "red", bold: true, children: [
                                    "[",
                                    /* @__PURE__ */ jsx15(Text15, { underline: true, children: "D" }),
                                    "isconnect]"
                                  ] })
                                ] }) })
                              ]
                            }
                          ),
                          show401AuthHint && /* @__PURE__ */ jsx15(Box15, { marginTop: 1, children: /* @__PURE__ */ jsxs15(Text15, { color: "yellow", children: [
                            "401 Unauthorized. Press ",
                            /* @__PURE__ */ jsx15(Text15, { bold: true, children: "A" }),
                            " to authenticate."
                          ] }) }),
                          oauthStatus !== "idle" && /* @__PURE__ */ jsxs15(Box15, { marginTop: 1, children: [
                            oauthStatus === "authenticating" && /* @__PURE__ */ jsx15(Text15, { dimColor: true, children: "OAuth: authenticating\u2026" }),
                            oauthStatus === "success" && oauthMessage && /* @__PURE__ */ jsx15(Text15, { color: "green", children: oauthMessage }),
                            oauthStatus === "error" && oauthMessage && /* @__PURE__ */ jsxs15(Text15, { color: "red", children: [
                              "OAuth: ",
                              oauthMessage
                            ] })
                          ] })
                        ] })
                      }
                    ),
                    /* @__PURE__ */ jsx15(
                      Tabs,
                      {
                        activeTab,
                        onTabChange: setActiveTab,
                        width: contentWidth,
                        counts: tabCounts,
                        focused: focus === "tabs",
                        showAuth: !!(selectedServer && selectedServerConfig && isOAuthCapableServer(selectedServerConfig)),
                        showLogging: selectedServer && inspectorClients[selectedServer] ? inspectorClients[selectedServer].getServerType() === "stdio" : false,
                        showRequests: selectedServer && inspectorClients[selectedServer] ? (() => {
                          const serverType = inspectorClients[selectedServer].getServerType();
                          return serverType === "sse" || serverType === "streamable-http";
                        })() : false
                      }
                    ),
                    /* @__PURE__ */ jsxs15(
                      Box15,
                      {
                        flexGrow: 1,
                        minHeight: 6,
                        width: contentWidth,
                        borderTop: false,
                        borderLeft: false,
                        borderRight: false,
                        borderBottom: false,
                        children: [
                          activeTab === "info" && /* @__PURE__ */ jsx15(
                            InfoTab,
                            {
                              serverName: selectedServer,
                              serverConfig: selectedServerConfig,
                              serverState: currentServerState,
                              width: contentWidth,
                              height: contentHeight,
                              focused: focus === "tabContentList" || focus === "tabContentDetails"
                            }
                          ),
                          activeTab === "auth" && selectedServer && selectedServerConfig && isOAuthCapableServer(selectedServerConfig) ? /* @__PURE__ */ jsx15(
                            AuthTab,
                            {
                              serverName: selectedServer,
                              serverConfig: selectedServerConfig,
                              inspectorClient: selectedInspectorClient,
                              oauthStatus,
                              oauthMessage,
                              width: contentWidth,
                              height: contentHeight,
                              focused: focus === "tabContentList" || focus === "tabContentDetails",
                              selectedAction: selectedAuthAction,
                              onSelectedActionChange: setSelectedAuthAction,
                              onQuickAuth: handleQuickAuth,
                              onGuidedStart: handleGuidedStart,
                              onGuidedAdvance: handleGuidedAdvance,
                              onRunGuidedToCompletion: handleRunGuidedToCompletion,
                              onClearOAuth: handleClearOAuth,
                              isOAuthCapable: true
                            }
                          ) : null,
                          activeTab === "resources" && currentServerState?.status === "connected" && selectedInspectorClient ? /* @__PURE__ */ jsx15(
                            ResourcesTab,
                            {
                              resources: currentServerState.resources,
                              resourceTemplates: currentServerState.resourceTemplates,
                              inspectorClient: selectedInspectorClient,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) => setTabCounts((prev) => ({ ...prev, resources: count })),
                              focusedPane: focus === "tabContentDetails" ? "details" : focus === "tabContentList" ? "list" : null,
                              onViewDetails: (resource) => setDetailsModal({
                                title: `Resource: ${"uri" in resource ? resource.name || resource.uri || "Unknown" : "Resource content"}`,
                                content: renderResourceDetails(resource)
                              }),
                              onFetchResource: () => {
                              },
                              onFetchTemplate: (template) => {
                                setResourceTestModal({
                                  template,
                                  inspectorClient: selectedInspectorClient
                                });
                              },
                              modalOpen: !!(toolTestModal || resourceTestModal || detailsModal)
                            },
                            `resources-${selectedServer}`
                          ) : activeTab === "prompts" && currentServerState?.status === "connected" && selectedInspectorClient ? /* @__PURE__ */ jsx15(
                            PromptsTab,
                            {
                              prompts: currentServerState.prompts,
                              inspectorClient: selectedInspectorClient,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) => setTabCounts((prev) => ({ ...prev, prompts: count })),
                              focusedPane: focus === "tabContentDetails" ? "details" : focus === "tabContentList" ? "list" : null,
                              onViewDetails: (prompt) => setDetailsModal({
                                title: `Prompt: ${prompt.name || "Unknown"}`,
                                content: renderPromptDetails(prompt)
                              }),
                              onFetchPrompt: (prompt) => {
                                setPromptTestModal({
                                  prompt,
                                  inspectorClient: selectedInspectorClient
                                });
                              },
                              modalOpen: !!(toolTestModal || resourceTestModal || promptTestModal || detailsModal)
                            },
                            `prompts-${selectedServer}`
                          ) : activeTab === "tools" && currentServerState?.status === "connected" && selectedInspectorClient ? /* @__PURE__ */ jsx15(
                            ToolsTab,
                            {
                              tools: currentServerState.tools,
                              isConnected: inspectorStatus === "connected",
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) => setTabCounts((prev) => ({ ...prev, tools: count })),
                              focusedPane: focus === "tabContentDetails" ? "details" : focus === "tabContentList" ? "list" : null,
                              onTestTool: (tool) => setToolTestModal({
                                tool,
                                inspectorClient: selectedInspectorClient
                              }),
                              onViewDetails: (tool) => setDetailsModal({
                                title: `Tool: ${tool.name || "Unknown"}`,
                                content: renderToolDetails(tool)
                              }),
                              modalOpen: !!(toolTestModal || detailsModal)
                            },
                            `tools-${selectedServer}`
                          ) : activeTab === "messages" && selectedInspectorClient ? /* @__PURE__ */ jsx15(
                            HistoryTab,
                            {
                              serverName: selectedServer,
                              messages: inspectorMessages,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) => setTabCounts((prev) => ({ ...prev, messages: count })),
                              focusedPane: focus === "messagesDetail" ? "details" : focus === "messagesList" ? "messages" : null,
                              modalOpen: !!(toolTestModal || detailsModal),
                              onViewDetails: (message) => {
                                const label = message.direction === "request" && "method" in message.message ? message.message.method : message.direction === "response" ? "Response" : message.direction === "notification" && "method" in message.message ? message.message.method : "Message";
                                setDetailsModal({
                                  title: `Message: ${label}`,
                                  content: renderMessageDetails(message)
                                });
                              }
                            }
                          ) : activeTab === "requests" && selectedInspectorClient && (inspectorStatus === "connected" || inspectorFetchRequests.length > 0) ? /* @__PURE__ */ jsx15(
                            RequestsTab,
                            {
                              serverName: selectedServer,
                              requests: inspectorFetchRequests,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) => setTabCounts((prev) => ({ ...prev, requests: count })),
                              focusedPane: focus === "requestsDetail" ? "details" : focus === "requestsList" ? "requests" : null,
                              modalOpen: !!(toolTestModal || detailsModal),
                              onViewDetails: (request) => {
                                setDetailsModal({
                                  title: `Request: ${request.method} ${request.url}`,
                                  content: renderRequestDetails(request)
                                });
                              }
                            }
                          ) : activeTab === "logging" && selectedInspectorClient ? /* @__PURE__ */ jsx15(
                            NotificationsTab,
                            {
                              stderrLogs: inspectorStderrLogs,
                              width: contentWidth,
                              height: contentHeight,
                              onCountChange: (count) => setTabCounts((prev) => ({ ...prev, logging: count })),
                              focused: focus === "tabContentList" || focus === "tabContentDetails"
                            }
                          ) : null
                        ]
                      }
                    )
                  ]
                }
              )
            ]
          }
        ),
        toolTestModal && /* @__PURE__ */ jsx15(
          ToolTestModal,
          {
            tool: toolTestModal.tool,
            inspectorClient: toolTestModal.inspectorClient,
            width: dimensions.width,
            height: dimensions.height,
            onClose: () => setToolTestModal(null)
          }
        ),
        resourceTestModal && /* @__PURE__ */ jsx15(
          ResourceTestModal,
          {
            template: resourceTestModal.template,
            inspectorClient: resourceTestModal.inspectorClient,
            width: dimensions.width,
            height: dimensions.height,
            onClose: () => setResourceTestModal(null)
          }
        ),
        promptTestModal && /* @__PURE__ */ jsx15(
          PromptTestModal,
          {
            prompt: promptTestModal.prompt,
            inspectorClient: promptTestModal.inspectorClient,
            width: dimensions.width,
            height: dimensions.height,
            onClose: () => setPromptTestModal(null)
          }
        ),
        detailsModal && /* @__PURE__ */ jsx15(
          DetailsModal,
          {
            title: detailsModal.title,
            content: detailsModal.content,
            width: dimensions.width,
            height: dimensions.height,
            onClose: () => setDetailsModal(null)
          }
        )
      ]
    }
  );
}
var App_default = App;

// src/tui-servers.ts
import { readFileSync as readFileSync3 } from "fs";
import { resolve as resolve3 } from "path";
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
function applyStdioOverrides(config, overrides) {
  if (config.type !== "stdio") return config;
  const c = { ...config };
  if (overrides.env && Object.keys(overrides.env).length > 0) {
    c.env = { ...c.env ?? {}, ...overrides.env };
  }
  if (overrides.cwd?.trim()) {
    c.cwd = overrides.cwd.trim();
  }
  return c;
}
function mergeSettings(base, headers) {
  const fromHeaders = headersToServerSettings(headers);
  if (!fromHeaders) return base;
  if (!base) return fromHeaders;
  return { ...base, headers: fromHeaders.headers };
}
function loadTuiServers(serverOptions) {
  serverOptions = withDefaultConfigPath(serverOptions);
  const hasConfigPath = Boolean(serverOptions.configPath?.trim());
  if (hasConfigPath) {
    const configPath = serverOptions.configPath;
    const resolvedPath = resolve3(process.cwd(), configPath);
    const config = JSON.parse(readFileSync3(resolvedPath, "utf-8"));
    const entries = mcpConfigToServerEntries(config);
    const result = {};
    for (const entry of entries) {
      result[entry.name] = {
        config: applyStdioOverrides(entry.config, {
          env: serverOptions.env,
          cwd: serverOptions.cwd
        }),
        settings: mergeSettings(entry.settings, serverOptions.headers)
      };
    }
    return result;
  }
  const configs = resolveServerConfigs(serverOptions, "multi");
  if (configs.length === 0) {
    throw new Error(
      "At least one server is required. Use --config <path> or ad-hoc target (command/URL)."
    );
  }
  return {
    default: {
      config: configs[0],
      settings: headersToServerSettings(serverOptions.headers)
    }
  };
}

// tui.tsx
import { jsx as jsx16 } from "react/jsx-runtime";
async function runTui(args) {
  const program = new Command();
  program.name("mcp-inspector-tui").description("Terminal UI for MCP Inspector").option(
    "--config <path>",
    "Path to MCP servers config file (or use ad-hoc server options below)"
  ).option(
    "-e <key=value...>",
    "Environment variables for stdio servers",
    parseKeyValuePair,
    {}
  ).option("--cwd <path>", "Working directory for stdio servers").option(
    "--header <header...>",
    'HTTP headers as "Name: Value"',
    parseHeaderPair,
    {}
  ).option(
    "--client-id <id>",
    "OAuth client ID (static client) for HTTP servers"
  ).option(
    "--client-secret <secret>",
    "OAuth client secret (for confidential clients)"
  ).option(
    "--client-metadata-url <url>",
    "OAuth Client ID Metadata Document URL (CIMD) for HTTP servers"
  ).option(
    "--callback-url <url>",
    "OAuth redirect/callback listener URL (default: http://127.0.0.1:0/oauth/callback)"
  ).argument(
    "[target...]",
    "Command and args or URL for a single ad-hoc server (when not using --config)"
  ).option(
    "--transport <type>",
    "Transport: stdio, sse, or http (ad-hoc only)"
  ).option("--server-url <url>", "Server URL (ad-hoc only)").parse(args ?? process.argv);
  const options = program.opts();
  const targetArgs = program.args;
  const serverOptions = {
    configPath: options.config?.trim() || void 0,
    target: targetArgs.length > 0 ? targetArgs : void 0,
    cwd: options.cwd?.trim() || void 0,
    env: options.e,
    headers: options.header,
    transport: options.transport,
    serverUrl: options.serverUrl?.trim() || void 0
  };
  const mcpServers = loadTuiServers(serverOptions);
  function parseCallbackUrl(raw) {
    if (!raw) {
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" };
    }
    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      throw new Error(
        `Invalid callback URL: ${err?.message ?? String(err)}`
      );
    }
    if (url.protocol !== "http:") {
      throw new Error("Callback URL must use http scheme");
    }
    const hostname = url.hostname;
    if (!hostname) {
      throw new Error("Callback URL must include a hostname");
    }
    const pathname = url.pathname || "/";
    let port;
    if (url.port === "") {
      port = 80;
    } else {
      port = Number(url.port);
      if (!Number.isFinite(port) || !Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("Callback URL port must be between 0 and 65535");
      }
    }
    return { hostname, port, pathname };
  }
  const callbackUrlConfig = parseCallbackUrl(options.callbackUrl);
  const ansiEraseSavedLines = new RegExp(
    String.fromCharCode(27) + "\\[3J",
    "g"
  );
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function(chunk, encoding, cb) {
    if (typeof chunk === "string") {
      if (chunk.includes("\x1B[3J")) {
        chunk = chunk.replace(ansiEraseSavedLines, "");
      }
    } else if (Buffer.isBuffer(chunk)) {
      if (chunk.includes("\x1B[3J")) {
        let str = chunk.toString("utf8");
        str = str.replace(ansiEraseSavedLines, "");
        chunk = Buffer.from(str, "utf8");
      }
    }
    if (typeof encoding === "function") {
      return originalWrite(chunk, encoding);
    }
    return originalWrite(chunk, encoding, cb);
  };
  if (process.stdout.isTTY) {
    process.stdout.write("\x1B[?1049h");
  }
  const instance = render(
    /* @__PURE__ */ jsx16(
      App_default,
      {
        mcpServers,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        clientMetadataUrl: options.clientMetadataUrl,
        callbackUrlConfig
      }
    )
  );
  try {
    await instance.waitUntilExit();
    if (process.stdout.isTTY) {
      process.stdout.write("\x1B[?1049l");
    }
    process.exit(0);
  } catch (error) {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1B[?1049l");
    }
    console.error("TUI Error:", error);
    process.exit(1);
  }
}

// index.ts
var __filename2 = fileURLToPath2(import.meta.url);
var isMain = process.argv[1] !== void 0 && resolve4(process.argv[1]) === resolve4(__filename2);
if (isMain) {
  runTui(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
export {
  runTui
};
//# sourceMappingURL=index.js.map