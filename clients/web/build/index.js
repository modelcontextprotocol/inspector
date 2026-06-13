#!/usr/bin/env node

// src/index.ts
import { resolve as resolve6 } from "path";
import { fileURLToPath as fileURLToPath5 } from "url";

// server/run-web.ts
import { resolve as resolve5, join as join5, dirname as dirname5 } from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
import { Command } from "commander";

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
function validateStoreId(storeId) {
  return /^[a-zA-Z0-9_-]+$/.test(storeId) && storeId.length > 0;
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
function serializeStore(data) {
  return JSON.stringify(data, null, 2);
}
function parseStore(raw) {
  return JSON.parse(raw);
}

// ../../core/mcp/types.ts
var DEFAULT_TASK_TTL_MS = 6e4;

// ../../core/auth/secret-fields.ts
var SECRET_FIELD_OAUTH_CLIENT_SECRET = "oauth-client-secret";
var envSecretField = (envKey) => `env:${envKey}`;

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
function cleanRoots(roots) {
  return roots.filter((r) => r.uri.trim() !== "").map((r) => {
    const trimmedName = r.name?.trim();
    const { name: _name, ...rest } = r;
    return trimmedName ? { ...rest, name: trimmedName } : rest;
  });
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
function inspectorSettingsToStoredFields(settings) {
  const out = {};
  const headersRecord = {};
  for (const { key, value } of settings.headers) {
    if (key.trim() === "") continue;
    headersRecord[key] = value;
  }
  if (Object.keys(headersRecord).length > 0) {
    out.headers = headersRecord;
  }
  const metadataFiltered = settings.metadata.filter(
    (m) => m.key.trim() !== ""
  );
  if (metadataFiltered.length > 0) {
    out.metadata = metadataFiltered;
  }
  if (settings.connectionTimeout > 0) {
    out.connectionTimeout = settings.connectionTimeout;
  }
  if (settings.requestTimeout > 0) {
    out.requestTimeout = settings.requestTimeout;
  }
  if (settings.taskTtl > 0 && settings.taskTtl !== DEFAULT_TASK_TTL_MS) {
    out.taskTtl = settings.taskTtl;
  }
  if (settings.autoRefreshOnListChanged) {
    out.autoRefreshOnListChanged = true;
  }
  const oauthFields = {};
  if (settings.oauthClientId) oauthFields.clientId = settings.oauthClientId;
  if (settings.oauthClientSecret)
    oauthFields.clientSecret = settings.oauthClientSecret;
  if (settings.oauthScopes) oauthFields.scopes = settings.oauthScopes;
  if (Object.keys(oauthFields).length > 0) {
    out.oauth = oauthFields;
  }
  const rootsFiltered = cleanRoots(settings.roots);
  if (rootsFiltered.length > 0) {
    out.roots = rootsFiltered;
  }
  return out;
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
function stripInspectorFields(stored) {
  const out = {};
  for (const [k, v] of Object.entries(
    stored
  )) {
    if (INSPECTOR_FIELD_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}
var isStdioStored = (stored) => stored.type === "stdio" || stored.type === void 0;
function extractSecretsFromStored(stored) {
  const secrets = {};
  const stripped = { ...stored };
  if (stored.oauth?.clientSecret) {
    secrets[SECRET_FIELD_OAUTH_CLIENT_SECRET] = stored.oauth.clientSecret;
    const restOauth = {};
    if (stored.oauth.clientId !== void 0)
      restOauth.clientId = stored.oauth.clientId;
    if (stored.oauth.scopes !== void 0)
      restOauth.scopes = stored.oauth.scopes;
    if (Object.keys(restOauth).length > 0) {
      stripped.oauth = restOauth;
    } else {
      delete stripped.oauth;
    }
  }
  if (isStdioStored(stripped)) {
    const env = stripped.env;
    if (env) {
      const newEnv = {};
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string" && v.length > 0) {
          secrets[envSecretField(k)] = v;
        }
        newEnv[k] = "";
      }
      stripped.env = newEnv;
    }
  }
  return { stripped, secrets };
}
function mergeSecretsIntoStored(stored, secrets) {
  const out = { ...stored };
  const oauthSecret = secrets[SECRET_FIELD_OAUTH_CLIENT_SECRET];
  if (oauthSecret) {
    out.oauth = { ...out.oauth ?? {}, clientSecret: oauthSecret };
  }
  if (isStdioStored(out) && out.env) {
    const newEnv = { ...out.env };
    let mutated = false;
    for (const k of Object.keys(out.env)) {
      const val = secrets[envSecretField(k)];
      if (val !== void 0) {
        newEnv[k] = val;
        mutated = true;
      }
    }
    if (mutated) {
      out.env = newEnv;
    }
  }
  return out;
}
function expectedSecretFields(stored) {
  const fields = [];
  fields.push(SECRET_FIELD_OAUTH_CLIENT_SECRET);
  if (isStdioStored(stored) && stored.env) {
    for (const k of Object.keys(stored.env)) {
      fields.push(envSecretField(k));
    }
  }
  return fields;
}
var DEFAULT_SEED_CONFIG = {
  mcpServers: {
    "filesystem-server-default": {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "everything-server-default": {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
};

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

// server/web-server-config.ts
import pino from "pino";

// ../../core/mcp/remote/constants.ts
var LEGACY_AUTH_TOKEN_ENV = "MCP_PROXY_AUTH_TOKEN";
var API_SERVER_ENV_VARS = {
  /**
   * Auth token for authenticating requests to the remote API server.
   * Used by the x-mcp-remote-auth header (or Authorization header if changed).
   */
  AUTH_TOKEN: "MCP_INSPECTOR_API_TOKEN"
};
var INSPECTOR_API_TOKEN_GLOBAL = "__INSPECTOR_API_TOKEN__";

// server/sandbox-controller.ts
import { createServer } from "http";
import { readFileSync as readFileSync2 } from "fs";
import { dirname as dirname2, join as join2 } from "path";
import { fileURLToPath } from "url";
var __dirname = dirname2(fileURLToPath(import.meta.url));
function resolveSandboxPort() {
  const fromSandbox = process.env.MCP_SANDBOX_PORT;
  if (fromSandbox !== void 0 && fromSandbox !== "") {
    const n = parseInt(fromSandbox, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const fromServer = process.env.SERVER_PORT;
  if (fromServer !== void 0 && fromServer !== "") {
    const n = parseInt(fromServer, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 0;
}
function createSandboxController(options) {
  const { port, host = "localhost" } = options;
  let server = null;
  let sandboxUrl = null;
  let sandboxHtml;
  try {
    const sandboxHtmlPath = join2(__dirname, "../static/sandbox_proxy.html");
    sandboxHtml = readFileSync2(sandboxHtmlPath, "utf-8");
  } catch (e) {
    sandboxHtml = "<!DOCTYPE html><html><body>Sandbox not loaded: " + String(e.message) + "</body></html>";
  }
  return {
    async start() {
      if (server && sandboxUrl) {
        const p = parseInt(new URL(sandboxUrl).port, 10);
        return { port: p, url: sandboxUrl };
      }
      return new Promise((resolve7) => {
        let settled = false;
        const settle = (value) => {
          if (settled) return;
          settled = true;
          resolve7(value);
        };
        server = createServer((req, res) => {
          if (req.method !== "GET" || req.url !== "/sandbox" && req.url !== "/sandbox/") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache"
          });
          res.end(sandboxHtml);
        });
        server.on("error", (err) => {
          if (err.code === "EADDRINUSE") {
            console.error(
              `Sandbox: port ${port || "dynamic"} in use. MCP Apps tab may not work.`
            );
          } else {
            console.error("Sandbox server error:", err);
          }
          server = null;
          settle({ port: 0, url: "" });
        });
        server.listen(port, host, () => {
          const addr = server.address();
          const actualPort = typeof addr === "object" && addr !== null && "port" in addr ? addr.port : addr;
          sandboxUrl = `http://${host}:${actualPort}/sandbox`;
          settle({ port: actualPort, url: sandboxUrl });
        });
      });
    },
    async close() {
      if (!server) return;
      return new Promise((resolve7) => {
        server.close(() => {
          server = null;
          sandboxUrl = null;
          resolve7();
        });
      });
    },
    getUrl() {
      return sandboxUrl;
    }
  };
}

// server/web-server-config.ts
function defaultEnvironmentFromProcess(extra) {
  const keys = process.platform === "win32" ? [
    "APPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PROCESSOR_ARCHITECTURE",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "USERNAME",
    "USERPROFILE",
    "PROGRAMFILES"
  ] : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];
  const out = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value && !value.startsWith("()")) {
      out[key] = value;
    }
  }
  if (extra) {
    Object.assign(out, extra);
  }
  return out;
}
function webServerConfigToInitialPayload(config) {
  const mc = config.initialMcpConfig;
  const defaultEnvironment = defaultEnvironmentFromProcess(
    mc && "env" in mc && mc.env ? mc.env : void 0
  );
  if (!mc) {
    return { defaultEnvironment };
  }
  if (mc.type === "stdio" || mc.type === void 0) {
    return {
      defaultCommand: mc.command,
      defaultArgs: mc.args ?? [],
      defaultTransport: "stdio",
      defaultCwd: mc.cwd,
      defaultEnvironment
    };
  }
  if (mc.type === "sse") {
    return {
      defaultTransport: "sse",
      defaultServerUrl: mc.url,
      defaultEnvironment
    };
  }
  if (mc.type === "streamable-http") {
    return {
      defaultTransport: "streamable-http",
      defaultServerUrl: mc.url,
      defaultEnvironment
    };
  }
  const c = mc;
  return {
    defaultTransport: "streamable-http",
    defaultServerUrl: c.url,
    defaultEnvironment
  };
}
function printServerBanner(config, actualPort, resolvedToken, sandboxUrl) {
  const baseUrl = `http://${config.hostname}:${actualPort}`;
  const url = config.dangerouslyOmitAuth || !resolvedToken ? baseUrl : `${baseUrl}?${API_SERVER_ENV_VARS.AUTH_TOKEN}=${resolvedToken}`;
  console.log(`
MCP Inspector Web is up and running at:
   ${url}
`);
  if (sandboxUrl) {
    console.log(`   Sandbox (MCP Apps): ${sandboxUrl}
`);
  }
  if (config.dangerouslyOmitAuth) {
    console.log("   Auth: disabled (DANGEROUSLY_OMIT_AUTH)\n");
  } else {
    console.log(`   Auth token: ${resolvedToken}
`);
  }
  if (config.autoOpen) {
    console.log("Opening browser...");
  }
  return url;
}
function buildWebServerConfig(options = {}) {
  const { initialMcpConfig = null } = options;
  const port = parseInt(process.env.CLIENT_PORT ?? "6274", 10);
  const hostname = process.env.HOST ?? "localhost";
  const baseUrl = `http://${hostname}:${port}`;
  const dangerouslyOmitAuth = !!process.env.DANGEROUSLY_OMIT_AUTH;
  const authToken = dangerouslyOmitAuth ? "" : process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] ?? process.env[LEGACY_AUTH_TOKEN_ENV] ?? "";
  const sandboxPort = resolveSandboxPort();
  let logger;
  if (process.env.MCP_LOG_FILE) {
    logger = pino(
      { level: "info" },
      pino.destination({
        dest: process.env.MCP_LOG_FILE,
        append: true,
        mkdir: true
      })
    );
  }
  return {
    port,
    hostname,
    authToken,
    dangerouslyOmitAuth,
    initialMcpConfig,
    storageDir: process.env.MCP_STORAGE_DIR,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [
      baseUrl
    ],
    sandboxPort,
    sandboxHost: hostname,
    logger,
    autoOpen: resolveAutoOpen()
  };
}
function buildWebServerConfigFromEnv() {
  return buildWebServerConfig({ initialMcpConfig: null });
}
function resolveAutoOpen() {
  const flag = process.env.MCP_AUTO_OPEN_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return !process.env.VITEST;
}

// server/start-vite-dev-server.ts
import { join as join3, dirname as dirname3, resolve as resolve3 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { createServer as createServer2 } from "vite";
import react from "@vitejs/plugin-react";

// server/vite-hono-plugin.ts
import open from "open";

// ../../core/mcp/remote/node/server.ts
import { randomBytes, timingSafeEqual } from "crypto";
import { stat as fsStat } from "fs/promises";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { watch as chokidarWatch } from "chokidar";

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

// ../../core/mcp/remote/node/remote-session.ts
var RemoteSession = class {
  sessionId;
  transport;
  eventQueue = [];
  eventConsumer = null;
  transportDead = false;
  transportError = null;
  constructor(sessionId) {
    this.sessionId = sessionId;
  }
  setTransport(transport) {
    this.transport = transport;
  }
  setEventConsumer(consumer) {
    this.eventConsumer = consumer;
    while (this.eventQueue.length > 0) {
      const ev = this.eventQueue.shift();
      consumer(ev);
    }
  }
  clearEventConsumer() {
    this.eventConsumer = null;
    return this.transportDead;
  }
  markTransportDead(error) {
    this.transportDead = true;
    this.transportError = error;
    this.pushEvent({
      type: "transport_error",
      data: {
        error,
        code: -32e3
        // MCP error code for connection closed
      }
    });
  }
  isTransportDead() {
    return this.transportDead;
  }
  getTransportError() {
    return this.transportError;
  }
  hasEventConsumer() {
    return this.eventConsumer !== null;
  }
  pushEvent(event) {
    if (this.eventConsumer) {
      this.eventConsumer(event);
    } else {
      this.eventQueue.push(event);
    }
  }
  onMessage(message) {
    this.pushEvent({ type: "message", data: message });
  }
  onFetchRequest(entry) {
    this.pushEvent({
      type: "fetch_request",
      data: {
        ...entry,
        timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp
      }
    });
  }
  onFetchResponseBody(id, responseBody) {
    this.pushEvent({
      type: "fetch_request_body_update",
      data: { id, responseBody }
    });
  }
  onStderr(entry) {
    this.pushEvent({
      type: "stdio_log",
      data: {
        timestamp: entry.timestamp.toISOString(),
        message: entry.message
      }
    });
  }
};

// ../../core/mcp/remote/node/tokenAuthProvider.ts
function createTokenAuthProvider(tokens) {
  if (!tokens) return void 0;
  return {
    async tokens() {
      return tokens;
    },
    async clientInformation() {
      return void 0;
    },
    async saveTokens() {
    },
    codeVerifier() {
      return void 0;
    },
    async saveCodeVerifier() {
    },
    clear() {
    },
    redirectToAuthorization() {
    },
    state() {
      return "";
    }
  };
}

// ../../core/auth/node/secret-store.ts
import {
  AsyncEntry,
  findCredentialsAsync
} from "@napi-rs/keyring";
var SERVICE_NAME = "mcp-inspector";
function parseAccount(account) {
  const idx = account.indexOf(":");
  if (idx <= 0 || idx === account.length - 1) return null;
  return {
    serverId: account.slice(0, idx),
    field: account.slice(idx + 1)
  };
}
var buildAccount = (serverId, field) => `${serverId}:${field}`;
var KeychainUnavailableError = class extends Error {
  constructor(cause) {
    super(
      `OS keychain is not available. On Linux, install libsecret / gnome-keyring. Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = "KeychainUnavailableError";
  }
};
var KeyringSecretStore = class {
  async get(serverId, field) {
    const entry = new AsyncEntry(SERVICE_NAME, buildAccount(serverId, field));
    try {
      const v = await entry.getPassword();
      return v ?? null;
    } catch {
      return null;
    }
  }
  async set(serverId, field, value) {
    const entry = new AsyncEntry(SERVICE_NAME, buildAccount(serverId, field));
    try {
      await entry.setPassword(value);
    } catch (err) {
      throw new KeychainUnavailableError(err);
    }
  }
  async delete(serverId, field) {
    const entry = new AsyncEntry(SERVICE_NAME, buildAccount(serverId, field));
    try {
      await entry.deleteCredential();
    } catch {
    }
  }
  async deleteAllForServer(serverId) {
    let creds;
    try {
      creds = await findCredentialsAsync(SERVICE_NAME);
    } catch {
      return;
    }
    const prefix = `${serverId}:`;
    for (const c of creds) {
      if (!c.account.startsWith(prefix)) continue;
      const parsed = parseAccount(c.account);
      if (!parsed || parsed.serverId !== serverId) continue;
      await this.delete(serverId, parsed.field);
    }
  }
};

// ../../core/mcp/remote/node/server.ts
function createOriginMiddleware(allowedOrigins) {
  return async (c, next) => {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      await next();
      return;
    }
    const origin = c.req.header("origin");
    if (c.req.method === "OPTIONS") {
      if (origin && allowedOrigins.includes(origin)) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        c.header(
          "Access-Control-Allow-Headers",
          "Content-Type, x-mcp-remote-auth"
        );
        c.header("Access-Control-Max-Age", "86400");
        return c.body(null, 204);
      }
      return c.json(
        {
          error: "Forbidden",
          message: "Invalid origin. Request blocked to prevent DNS rebinding attacks."
        },
        403
      );
    }
    if (origin) {
      if (!allowedOrigins.includes(origin)) {
        return c.json(
          {
            error: "Forbidden",
            message: "Invalid origin. Request blocked to prevent DNS rebinding attacks. Configure allowed origins via allowedOrigins option."
          },
          403
        );
      }
      c.header("Access-Control-Allow-Origin", origin);
    }
    await next();
  };
}
function createAuthMiddleware(authToken) {
  return async (c, next) => {
    const authHeader = c.req.header("x-mcp-remote-auth");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Authentication required. Use the x-mcp-remote-auth header with Bearer token."
        },
        401
      );
    }
    const providedToken = authHeader.substring(7);
    const expectedToken = authToken;
    const providedBuffer = Buffer.from(providedToken);
    const expectedBuffer = Buffer.from(expectedToken);
    if (providedBuffer.length !== expectedBuffer.length) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Authentication required. Use the x-mcp-remote-auth header with Bearer token."
        },
        401
      );
    }
    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Authentication required. Use the x-mcp-remote-auth header with Bearer token."
        },
        401
      );
    }
    await next();
  };
}
function forwardLogEvent(logger, logEvent) {
  const levelLabel = (logEvent?.level?.label ?? "info").toLowerCase();
  const method = logger[levelLabel];
  if (typeof method !== "function") return;
  const bindings = Object.assign(
    {},
    ...Array.isArray(logEvent.bindings) ? logEvent.bindings : []
  );
  const messages = Array.isArray(logEvent.messages) ? logEvent.messages : [];
  if (messages.length === 0) {
    method.call(logger, bindings);
    return;
  }
  const first = messages[0];
  if (typeof first === "object" && first !== null && !Array.isArray(first)) {
    const obj = { ...bindings, ...first };
    const msg = messages[1];
    const args = messages.slice(2);
    method.call(
      logger,
      obj,
      msg,
      ...args
    );
  } else {
    const msg = messages[0];
    const args = messages.slice(1);
    method.call(
      logger,
      bindings,
      msg,
      ...args
    );
  }
}
function createRemoteApp(options) {
  const dangerouslyOmitAuth = !!options.dangerouslyOmitAuth;
  const authToken = dangerouslyOmitAuth ? "" : options.authToken || process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] || randomBytes(32).toString("hex");
  const app = new Hono();
  const sessions = /* @__PURE__ */ new Map();
  const { logger: fileLogger, allowedOrigins } = options;
  const storageDir = options.storageDir ?? getDefaultStorageDir();
  const mcpConfigPath = options.mcpConfigPath ?? getDefaultMcpConfigPath();
  const secretStore = options.secretStore ?? new KeyringSecretStore();
  const serverEventSubscribers = /* @__PURE__ */ new Set();
  let mcpConfigWatcher = null;
  let lastWrittenMtimeMs = null;
  const broadcastServerListChange = () => {
    const payload = JSON.stringify({ type: "change" });
    for (const send of serverEventSubscribers) {
      try {
        send(payload);
      } catch {
      }
    }
  };
  const writeMcpAndTrackMtime = async (data) => {
    let externalEditDetected = false;
    if (lastWrittenMtimeMs !== null) {
      try {
        const s = await fsStat(mcpConfigPath);
        if (s.mtimeMs !== lastWrittenMtimeMs) {
          externalEditDetected = true;
        }
      } catch {
        externalEditDetected = true;
      }
    }
    await writeStoreFile(mcpConfigPath, data);
    try {
      const s = await fsStat(mcpConfigPath);
      lastWrittenMtimeMs = s.mtimeMs;
    } catch {
    }
    if (externalEditDetected) {
      broadcastServerListChange();
    }
  };
  const handleWatcherEvent = async (event) => {
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    if (event !== "unlink") {
      try {
        const s = await fsStat(mcpConfigPath);
        if (lastWrittenMtimeMs !== null && s.mtimeMs === lastWrittenMtimeMs) {
          return;
        }
      } catch {
      }
    }
    broadcastServerListChange();
  };
  const handleWatcherError = (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (fileLogger) {
      fileLogger.warn({ err: msg }, "mcp.json watcher error");
    } else {
      console.warn("[mcp.json watcher]", msg);
    }
  };
  const ensureWatcher = () => {
    if (mcpConfigWatcher) return;
    mcpConfigWatcher = chokidarWatch(mcpConfigPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
    });
    mcpConfigWatcher.on("all", (event) => {
      void handleWatcherEvent(event);
    });
    mcpConfigWatcher.on("error", handleWatcherError);
  };
  const maybeStopWatcher = async () => {
    if (serverEventSubscribers.size > 0) return;
    if (!mcpConfigWatcher) return;
    const w = mcpConfigWatcher;
    mcpConfigWatcher = null;
    try {
      await w.close();
    } catch {
    }
  };
  app.use("*", createOriginMiddleware(allowedOrigins));
  if (!dangerouslyOmitAuth) {
    app.use("*", createAuthMiddleware(authToken));
  }
  app.get("/api/config", (c) => {
    const payload = options.sandboxUrl ? { ...options.initialConfig, sandboxUrl: options.sandboxUrl } : options.initialConfig;
    return c.json(payload);
  });
  app.post("/api/mcp/connect", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const config = body.config;
    if (!config) {
      return c.json({ error: "Missing config" }, 400);
    }
    const sessionId = crypto.randomUUID();
    const session = new RemoteSession(sessionId);
    let transport;
    try {
      const authProvider = createTokenAuthProvider(body.oauthTokens);
      const result = createTransportNode(config, {
        pipeStderr: true,
        onStderr: (entry) => session.onStderr(entry),
        onFetchRequest: (entry) => session.onFetchRequest(entry),
        onFetchResponseBody: (id, body2) => session.onFetchResponseBody(id, body2),
        authProvider,
        settings: body.settings
      });
      transport = result.transport;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to create transport: ${msg}` }, 500);
    }
    session.setTransport(transport);
    transport.onmessage = (msg) => session.onMessage(msg);
    let transportFailed = false;
    let transportError = null;
    const originalOnclose = transport.onclose;
    const originalOnerror = transport.onerror;
    transport.onerror = (err) => {
      transportFailed = true;
      transportError = err instanceof Error ? err.message : String(err);
      originalOnerror?.(err);
    };
    transport.onclose = () => {
      const session2 = sessions.get(sessionId);
      if (session2) {
        const errorMsg = transportError || "Transport closed - process may have exited";
        session2.markTransportDead(errorMsg);
        if (!session2.hasEventConsumer()) {
          setTimeout(() => {
            const stale = sessions.get(sessionId);
            if (stale && !stale.hasEventConsumer()) {
              sessions.delete(sessionId);
            }
          }, 3e4);
        }
      } else {
        transportFailed = true;
        transportError = transportError || "Transport closed during start - process may have failed";
      }
      originalOnclose?.();
    };
    try {
      await transport.start();
      if (transportFailed) {
        const errorMsg = transportError || "Transport failed during start";
        return c.json({ error: `Failed to start transport: ${errorMsg}` }, 500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err.code ?? err.status;
      const is401 = status === 401;
      return c.json(
        { error: `Failed to start transport: ${msg}` },
        is401 ? 401 : 500
      );
    }
    sessions.set(sessionId, session);
    return c.json({ sessionId });
  });
  app.post("/api/mcp/send", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const { sessionId, message, relatedRequestId } = body;
    if (!sessionId || !message) {
      return c.json({ error: "Missing sessionId or message" }, 400);
    }
    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    if (session.isTransportDead()) {
      const errorMsg = session.getTransportError() || "Transport closed";
      return c.json({ error: errorMsg }, 500);
    }
    try {
      await session.transport.send(message, {
        relatedRequestId
      });
      return c.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err.code ?? err.status;
      const is401 = status === 401;
      return c.json({ error: msg }, is401 ? 401 : 500);
    }
  });
  app.get("/api/mcp/events", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) {
      return c.json({ error: "Missing sessionId query" }, 400);
    }
    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return streamSSE(c, async (stream) => {
      session.setEventConsumer((event) => {
        const data = JSON.stringify(event);
        void stream.writeSSE({
          event: event.type,
          data
        });
      });
      if (session.isTransportDead()) {
        await new Promise((resolve7) => setTimeout(resolve7, 0));
        session.clearEventConsumer();
        sessions.delete(sessionId);
        return;
      }
      stream.onAbort(() => {
        const shouldCleanup = session.clearEventConsumer();
        stream.close();
        if (shouldCleanup || session.isTransportDead()) {
          sessions.delete(sessionId);
        }
      });
      await new Promise((resolve7) => {
        stream.onAbort(() => {
          resolve7();
        });
      });
    });
  });
  app.post("/api/mcp/disconnect", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const sessionId = body.sessionId;
    if (!sessionId) {
      return c.json({ error: "Missing sessionId" }, 400);
    }
    const session = sessions.get(sessionId);
    if (session) {
      session.clearEventConsumer();
      await session.transport.close();
      sessions.delete(sessionId);
    }
    return c.json({ ok: true });
  });
  app.post("/api/fetch", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const { url, method = "GET", headers = {}, body: reqBody } = body;
    if (!url) {
      return c.json({ error: "Missing url" }, 400);
    }
    try {
      const res = await fetch(url, {
        method,
        headers: new Headers(headers),
        body: reqBody
      });
      const resHeaders = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      const contentType = res.headers.get("content-type");
      const isStream = contentType?.includes("text/event-stream") || contentType?.includes("application/x-ndjson");
      let resBody;
      if (!isStream && res.body) {
        resBody = await res.text();
      }
      return c.json({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: resBody
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
  app.post("/api/log", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (fileLogger) {
      forwardLogEvent(fileLogger, body);
    }
    return c.json({ ok: true });
  });
  app.get("/api/storage/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId || !validateStoreId(storeId)) {
      return c.json({ error: "Invalid storeId" }, 400);
    }
    const filePath = getStoreFilePath(storageDir, storeId);
    try {
      const raw = await readStoreFile(filePath);
      if (raw === null) {
        return c.json({}, 200);
      }
      const store = parseStore(raw);
      return c.json(store);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to read store: ${msg}` }, 500);
    }
  });
  app.post("/api/storage/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId || !validateStoreId(storeId)) {
      return c.json({ error: "Invalid storeId" }, 400);
    }
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const filePath = getStoreFilePath(storageDir, storeId);
    try {
      const jsonData = serializeStore(body);
      await writeStoreFile(filePath, jsonData);
      return c.json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to write store: ${msg}` }, 500);
    }
  });
  app.delete("/api/storage/:storeId", async (c) => {
    const storeId = c.req.param("storeId");
    if (!storeId || !validateStoreId(storeId)) {
      return c.json({ error: "Invalid storeId" }, 400);
    }
    const filePath = getStoreFilePath(storageDir, storeId);
    try {
      await deleteStoreFile(filePath);
      return c.json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to delete store: ${msg}` }, 500);
    }
  });
  const logWarn = (bindings, msg) => {
    if (fileLogger) {
      fileLogger.warn(bindings, msg);
    } else {
      console.warn("[mcp.json]", msg, bindings);
    }
  };
  const isStringRecord = (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    for (const val of Object.values(v)) {
      if (typeof val !== "string") return false;
    }
    return true;
  };
  const isKvArray = (v) => {
    if (!Array.isArray(v)) return false;
    return v.every(
      (e) => e !== null && typeof e === "object" && typeof e.key === "string" && typeof e.value === "string"
    );
  };
  const isOauthObject = (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const o = v;
    for (const k of ["clientId", "clientSecret", "scopes"]) {
      if (o[k] !== void 0 && typeof o[k] !== "string") return false;
    }
    return true;
  };
  const isRootArray = (v) => {
    if (!Array.isArray(v)) return false;
    return v.every((e) => {
      if (e === null || typeof e !== "object") return false;
      const o = e;
      if (typeof o.uri !== "string") return false;
      if (o.name !== void 0 && typeof o.name !== "string") return false;
      return true;
    });
  };
  const isNonNegNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const normalizeMcpServers = (raw) => {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const [id, val] of Object.entries(raw)) {
      if (!val || typeof val !== "object") continue;
      const valObj = val;
      if ("settings" in valObj) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "settings" },
          "Dropping legacy `settings` node from mcp.json entry \u2014 fields now live at the top level. Re-enter via the settings form or hand-edit the file into the flat shape."
        );
        delete valObj.settings;
      }
      if ("headers" in valObj && !isStringRecord(valObj.headers)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "headers" },
          "Dropping malformed `headers` field \u2014 expected `Record<string, string>`."
        );
        delete valObj.headers;
      }
      if ("metadata" in valObj && !isKvArray(valObj.metadata)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "metadata" },
          "Dropping malformed `metadata` field \u2014 expected `Array<{ key: string, value: string }>`."
        );
        delete valObj.metadata;
      }
      if ("connectionTimeout" in valObj && !isNonNegNumber(valObj.connectionTimeout)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "connectionTimeout" },
          "Dropping malformed `connectionTimeout` field \u2014 expected non-negative number."
        );
        delete valObj.connectionTimeout;
      }
      if ("requestTimeout" in valObj && !isNonNegNumber(valObj.requestTimeout)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "requestTimeout" },
          "Dropping malformed `requestTimeout` field \u2014 expected non-negative number."
        );
        delete valObj.requestTimeout;
      }
      if ("taskTtl" in valObj && !isNonNegNumber(valObj.taskTtl)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "taskTtl" },
          "Dropping malformed `taskTtl` field \u2014 expected non-negative number."
        );
        delete valObj.taskTtl;
      }
      if ("oauth" in valObj && !isOauthObject(valObj.oauth)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "oauth" },
          "Dropping malformed `oauth` field \u2014 expected `{ clientId?, clientSecret?, scopes? }`."
        );
        delete valObj.oauth;
      }
      if ("roots" in valObj && !isRootArray(valObj.roots)) {
        logWarn(
          { route: "/api/servers", id, droppedKey: "roots" },
          "Dropping malformed `roots` field \u2014 expected `Array<{ uri: string, name?: string }>`."
        );
        delete valObj.roots;
      }
      out[id] = normalizeServerType(
        valObj
      );
    }
    return out;
  };
  const SMUGGLE_GUARDED_KEYS = /* @__PURE__ */ new Set([
    ...INSPECTOR_FIELD_KEYS,
    "settings"
  ]);
  const buildStoredEntry = (id, config, settings) => {
    const configObj = config !== null && typeof config === "object" ? config : {};
    const smuggled = [];
    const configOnly = {};
    for (const [k, v] of Object.entries(configObj)) {
      if (SMUGGLE_GUARDED_KEYS.has(k)) {
        smuggled.push(k);
        continue;
      }
      configOnly[k] = v;
    }
    if (smuggled.length > 0) {
      logWarn(
        { route: "/api/servers", id, smuggledKeys: smuggled },
        "Stripping Inspector-extension keys from request body's `config` \u2014 those must travel through the top-level `settings` field, not nested inside `config`."
      );
    }
    const normalized = normalizeServerType(
      configOnly
    );
    if (settings !== void 0) {
      Object.assign(normalized, inspectorSettingsToStoredFields(settings));
    }
    return normalized;
  };
  const validateSettings = (raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "settings must be an object" };
    }
    const obj = raw;
    const isKvArray2 = (v) => {
      if (!Array.isArray(v)) return false;
      return v.every(
        (e) => e !== null && typeof e === "object" && typeof e.key === "string" && typeof e.value === "string"
      );
    };
    if (!isKvArray2(obj.headers)) {
      return {
        ok: false,
        error: "settings.headers must be an array of { key, value }"
      };
    }
    if (!isKvArray2(obj.metadata)) {
      return {
        ok: false,
        error: "settings.metadata must be an array of { key, value }"
      };
    }
    if (typeof obj.connectionTimeout !== "number" || obj.connectionTimeout < 0) {
      return {
        ok: false,
        error: "settings.connectionTimeout must be a non-negative number"
      };
    }
    if (typeof obj.requestTimeout !== "number" || obj.requestTimeout < 0) {
      return {
        ok: false,
        error: "settings.requestTimeout must be a non-negative number"
      };
    }
    if (obj.taskTtl !== void 0 && (typeof obj.taskTtl !== "number" || obj.taskTtl < 0)) {
      return {
        ok: false,
        error: "settings.taskTtl must be a non-negative number"
      };
    }
    if (obj.autoRefreshOnListChanged !== void 0 && typeof obj.autoRefreshOnListChanged !== "boolean") {
      return {
        ok: false,
        error: "settings.autoRefreshOnListChanged must be a boolean"
      };
    }
    for (const optional of [
      "oauthClientId",
      "oauthClientSecret",
      "oauthScopes"
    ]) {
      if (obj[optional] !== void 0 && typeof obj[optional] !== "string") {
        return { ok: false, error: `settings.${optional} must be a string` };
      }
    }
    if (obj.roots !== void 0 && !isRootArray(obj.roots)) {
      return {
        ok: false,
        error: "settings.roots must be an array of { uri, name? }"
      };
    }
    const value = {
      headers: obj.headers,
      metadata: obj.metadata,
      connectionTimeout: obj.connectionTimeout,
      requestTimeout: obj.requestTimeout,
      // Absent → product default, matching the read side
      // (storedFieldsToInspectorSettings). The default is the omit-sentinel in
      // inspectorSettingsToStoredFields, so this won't write a spurious taskTtl
      // to disk for a client that didn't send one.
      taskTtl: typeof obj.taskTtl === "number" ? obj.taskTtl : DEFAULT_TASK_TTL_MS,
      // Absent → false, matching the read side. The omit-on-false logic lives
      // in inspectorSettingsToStoredFields, so a false value writes nothing.
      autoRefreshOnListChanged: obj.autoRefreshOnListChanged === true,
      // Absent → empty list, matching the read side
      // (storedFieldsToInspectorSettings). Empty rows are dropped on the way
      // to disk by inspectorSettingsToStoredFields, so an empty array here
      // writes no spurious `roots` field.
      roots: isRootArray(obj.roots) ? obj.roots : []
    };
    if (typeof obj.oauthClientId === "string" && obj.oauthClientId !== "") {
      value.oauthClientId = obj.oauthClientId;
    }
    if (typeof obj.oauthClientSecret === "string" && obj.oauthClientSecret !== "") {
      value.oauthClientSecret = obj.oauthClientSecret;
    }
    if (typeof obj.oauthScopes === "string" && obj.oauthScopes !== "") {
      value.oauthScopes = obj.oauthScopes;
    }
    return { ok: true, value };
  };
  let writeQueue = Promise.resolve();
  const withWriteLock = async (fn) => {
    const prev = writeQueue;
    let release = () => {
    };
    writeQueue = new Promise((r) => {
      release = r;
    });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  };
  const readMcpConfig = async () => {
    const raw = await readStoreFile(mcpConfigPath);
    if (raw === null) return { mcpServers: {} };
    const parsed = parseStore(raw);
    return { mcpServers: normalizeMcpServers(parsed?.mcpServers) };
  };
  const writeKeychainEntriesFor = async (id, secrets) => {
    await Promise.all(
      Object.entries(secrets).map(
        ([field, value]) => secretStore.set(id, field, value)
      )
    );
  };
  const readKeychainEntriesFor = async (id, fields) => {
    const values = await Promise.all(
      fields.map(async (field) => [field, await secretStore.get(id, field)])
    );
    const out = {};
    for (const [field, v] of values) {
      if (v !== null) out[field] = v;
    }
    return out;
  };
  const hasPlaintextSecrets = (config) => {
    for (const stored of Object.values(config.mcpServers)) {
      const { secrets } = extractSecretsFromStored(stored);
      if (Object.keys(secrets).length > 0) return true;
    }
    return false;
  };
  const migratePlaintextSecrets = async (config) => {
    let changed = false;
    const next = { mcpServers: {} };
    try {
      for (const [id, stored] of Object.entries(config.mcpServers)) {
        const { stripped, secrets } = extractSecretsFromStored(stored);
        if (Object.keys(secrets).length === 0) {
          next.mcpServers[id] = stored;
          continue;
        }
        for (const [field, value] of Object.entries(secrets)) {
          const existing = await secretStore.get(id, field);
          if (existing === null) {
            await secretStore.set(id, field, value);
          }
        }
        next.mcpServers[id] = stripped;
        changed = true;
      }
    } catch (err) {
      if (err instanceof KeychainUnavailableError) {
        if (fileLogger) {
          fileLogger.warn(
            { err: err.message },
            "Keychain unavailable; skipping plaintext-secret migration on this read. Existing mcp.json plaintext values are preserved."
          );
        }
        return { migrated: config, changed: false };
      }
      throw err;
    }
    return { migrated: next, changed };
  };
  const rehydrateConfig = async (config) => {
    const out = { mcpServers: {} };
    for (const [id, stored] of Object.entries(config.mcpServers)) {
      const fields = expectedSecretFields(stored);
      const secrets = await readKeychainEntriesFor(id, fields);
      out.mcpServers[id] = mergeSecretsIntoStored(stored, secrets);
    }
    return out;
  };
  const computeObsoleteFields = (previousFields, nextSecrets) => {
    const nextFieldSet = new Set(Object.keys(nextSecrets));
    const obsolete = [];
    for (const field of previousFields) {
      if (!nextFieldSet.has(field)) obsolete.push(field);
    }
    return obsolete;
  };
  const deleteKeychainFields = async (id, fields) => {
    await Promise.all(fields.map((field) => secretStore.delete(id, field)));
  };
  const keychainErrorResponse = (c, err) => {
    if (err instanceof KeychainUnavailableError) {
      return c.json({ error: err.message }, 503);
    }
    return void 0;
  };
  app.get("/api/servers", async (c) => {
    try {
      const raw = await readStoreFile(mcpConfigPath);
      if (raw !== null) {
        const parsed = parseStore(raw);
        const onDisk = {
          mcpServers: normalizeMcpServers(parsed?.mcpServers)
        };
        if (!hasPlaintextSecrets(onDisk)) {
          return c.json(await rehydrateConfig(onDisk));
        }
      }
      const settled = await withWriteLock(async () => {
        const rawInside = await readStoreFile(mcpConfigPath);
        if (rawInside === null) {
          await writeMcpAndTrackMtime(serializeStore(DEFAULT_SEED_CONFIG));
          return DEFAULT_SEED_CONFIG;
        }
        const parsedInside = parseStore(rawInside);
        const inside = {
          mcpServers: normalizeMcpServers(parsedInside?.mcpServers)
        };
        if (!hasPlaintextSecrets(inside)) return inside;
        const { migrated, changed } = await migratePlaintextSecrets(inside);
        if (changed) {
          await writeMcpAndTrackMtime(serializeStore(migrated));
        }
        return migrated;
      });
      return c.json(await rehydrateConfig(settled));
    } catch (error) {
      const keychainResp = keychainErrorResponse(c, error);
      if (keychainResp) return keychainResp;
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to read server list: ${msg}` }, 500);
    }
  });
  app.post("/api/servers", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (typeof body.id !== "string" || !validateStoreId(body.id)) {
      return c.json(
        {
          error: "Invalid id: must be non-empty and contain only alphanumeric, hyphen, or underscore"
        },
        400
      );
    }
    if (!body.config || typeof body.config !== "object") {
      return c.json({ error: "Missing or invalid config" }, 400);
    }
    let postSettings;
    if (body.settings !== void 0 && body.settings !== null) {
      const validated = validateSettings(body.settings);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      postSettings = validated.value;
    }
    const id = body.id;
    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (id in current.mcpServers) {
          return c.json({ error: `Server '${id}' already exists` }, 409);
        }
        const built = buildStoredEntry(id, body.config, postSettings);
        const { stripped, secrets } = extractSecretsFromStored(built);
        await secretStore.deleteAllForServer(id);
        await writeKeychainEntriesFor(id, secrets);
        current.mcpServers[id] = stripped;
        await writeMcpAndTrackMtime(serializeStore(current));
        return c.json({ ok: true });
      });
    } catch (error) {
      const keychainResp = keychainErrorResponse(c, error);
      if (keychainResp) return keychainResp;
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to add server: ${msg}` }, 500);
    }
  });
  app.put("/api/servers/order", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (!Array.isArray(body.order) || !body.order.every((id) => typeof id === "string")) {
      return c.json({ error: "order must be an array of strings" }, 400);
    }
    const order = body.order;
    if (new Set(order).size !== order.length) {
      return c.json({ error: "order contains duplicate ids" }, 400);
    }
    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        const currentIds = Object.keys(current.mcpServers);
        const currentSet = new Set(currentIds);
        const sameSet = currentIds.length === order.length && order.every((id) => currentSet.has(id));
        if (!sameSet) {
          return c.json(
            {
              error: "order does not match the current server set (it may have changed on disk)"
            },
            409
          );
        }
        const next = { mcpServers: {} };
        for (const id of order) {
          next.mcpServers[id] = current.mcpServers[id];
        }
        await writeMcpAndTrackMtime(serializeStore(next));
        return c.json({ ok: true });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to reorder servers: ${msg}` }, 500);
    }
  });
  app.put("/api/servers/:id", async (c) => {
    const originalId = c.req.param("id");
    if (!originalId || !validateStoreId(originalId)) {
      return c.json({ error: "Invalid id" }, 400);
    }
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    if (body.config !== void 0 && (body.config === null || typeof body.config !== "object")) {
      return c.json({ error: "Invalid config" }, 400);
    }
    let settingsIntent;
    if (body.settings === void 0) {
      settingsIntent = { kind: "preserve" };
    } else if (body.settings === null) {
      settingsIntent = { kind: "clear" };
    } else {
      const validated = validateSettings(body.settings);
      if (!validated.ok) return c.json({ error: validated.error }, 400);
      settingsIntent = { kind: "apply", value: validated.value };
    }
    const newId = typeof body.id === "string" ? body.id : originalId;
    if (!validateStoreId(newId)) {
      return c.json({ error: "Invalid new id" }, 400);
    }
    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (!(originalId in current.mcpServers)) {
          return c.json({ error: `Server '${originalId}' not found` }, 404);
        }
        if (newId !== originalId && newId in current.mcpServers) {
          return c.json({ error: `Server '${newId}' already exists` }, 409);
        }
        const existing = current.mcpServers[originalId];
        if (!existing) {
          return c.json(
            { error: `Server '${originalId}' not found` },
            404
          );
        }
        const existingConfig = stripInspectorFields(existing);
        const existingSettings = storedFieldsToInspectorSettings(existing);
        const nextConfig = body.config !== void 0 ? body.config : existingConfig;
        let nextSettings;
        switch (settingsIntent.kind) {
          case "preserve":
            nextSettings = existingSettings;
            break;
          case "clear":
            nextSettings = void 0;
            break;
          case "apply":
            nextSettings = settingsIntent.value;
            break;
        }
        const built = buildStoredEntry(newId, nextConfig, nextSettings);
        const { stripped, secrets } = extractSecretsFromStored(built);
        const next = { mcpServers: {} };
        for (const [key, val] of Object.entries(current.mcpServers)) {
          if (key === originalId) {
            next.mcpServers[newId] = stripped;
          } else {
            next.mcpServers[key] = val;
          }
        }
        if (newId !== originalId) {
          await writeKeychainEntriesFor(newId, secrets);
          await writeMcpAndTrackMtime(serializeStore(next));
          await secretStore.deleteAllForServer(originalId);
        } else {
          const previousFields = new Set(expectedSecretFields(existing));
          const obsolete = computeObsoleteFields(previousFields, secrets);
          await writeKeychainEntriesFor(newId, secrets);
          await writeMcpAndTrackMtime(serializeStore(next));
          await deleteKeychainFields(newId, obsolete);
        }
        return c.json({ ok: true });
      });
    } catch (error) {
      const keychainResp = keychainErrorResponse(c, error);
      if (keychainResp) return keychainResp;
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to update server: ${msg}` }, 500);
    }
  });
  app.delete("/api/servers/:id", async (c) => {
    const id = c.req.param("id");
    if (!id || !validateStoreId(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }
    try {
      return await withWriteLock(async () => {
        const current = await readMcpConfig();
        if (!(id in current.mcpServers)) {
          await secretStore.deleteAllForServer(id);
          return c.json({ ok: true });
        }
        delete current.mcpServers[id];
        await writeMcpAndTrackMtime(serializeStore(current));
        await secretStore.deleteAllForServer(id);
        return c.json({ ok: true });
      });
    } catch (error) {
      const keychainResp = keychainErrorResponse(c, error);
      if (keychainResp) return keychainResp;
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Failed to delete server: ${msg}` }, 500);
    }
  });
  app.get("/api/servers/events", async (c) => {
    return streamSSE(c, async (stream) => {
      const send = (data) => {
        void stream.writeSSE({ event: "change", data });
      };
      serverEventSubscribers.add(send);
      ensureWatcher();
      stream.onAbort(() => {
        serverEventSubscribers.delete(send);
        void maybeStopWatcher();
        stream.close();
      });
      await new Promise((resolve7) => {
        stream.onAbort(() => resolve7());
      });
    });
  });
  return {
    app,
    authToken,
    close: async () => {
      serverEventSubscribers.clear();
      await maybeStopWatcher();
    }
  };
}

// server/inject-auth-token.ts
function serializeTokenForScript(token) {
  return JSON.stringify(token).replace(/</g, "\\u003c");
}
function injectAuthToken(html, token) {
  if (!token) return html;
  const script = `<script>window.${INSPECTOR_API_TOKEN_GLOBAL} = ${serializeTokenForScript(
    token
  )};</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + script + html.slice(headClose);
  }
  const bodyClose = html.indexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + script + html.slice(bodyClose);
  }
  return script + html;
}

// server/vite-hono-plugin.ts
function honoMiddlewarePlugin(config) {
  let resolvedAuthToken = "";
  return {
    name: "hono-api-middleware",
    // Embed the API token into the dev-served index.html so a reload at the
    // bare URL (no `?MCP_INSPECTOR_API_TOKEN=…`) still authenticates. The
    // prod server applies the same injection in `server.ts`.
    transformIndexHtml(html) {
      return injectAuthToken(html, resolvedAuthToken);
    },
    // `apply: 'serve'` keeps the plugin out of `vite build`, but Vitest still
    // instantiates a Vite server in middleware mode (no HTTP server) for
    // transforms and invokes `configureServer` regardless. Returning early
    // when `server.httpServer` is missing keeps the plugin inert in that
    // context — only an actual `vite dev` (or `vite preview`) instance has
    // an HTTP server to attach to.
    apply: "serve",
    async configureServer(server) {
      if (process.env.VITEST) {
        return;
      }
      if (!server.httpServer) {
        return;
      }
      const sandboxController = createSandboxController({
        port: config.sandboxPort,
        host: config.sandboxHost
      });
      await sandboxController.start();
      const {
        app: honoApp,
        authToken: resolvedToken,
        close: closeApi
      } = createRemoteApp({
        authToken: config.dangerouslyOmitAuth ? void 0 : config.authToken,
        dangerouslyOmitAuth: config.dangerouslyOmitAuth,
        storageDir: config.storageDir,
        allowedOrigins: config.allowedOrigins,
        sandboxUrl: sandboxController.getUrl() ?? void 0,
        logger: config.logger,
        initialConfig: webServerConfigToInitialPayload(config)
      });
      resolvedAuthToken = config.dangerouslyOmitAuth ? "" : resolvedToken;
      const originalClose = server.close.bind(server);
      server.close = async () => {
        await closeApi();
        await sandboxController.close();
        return originalClose();
      };
      const sandboxUrl = sandboxController.getUrl();
      const logBanner = () => {
        const address = server.httpServer?.address();
        const actualPort = typeof address === "object" && address !== null ? address.port : config.port;
        const url = printServerBanner(
          config,
          actualPort,
          resolvedToken,
          sandboxUrl ?? void 0
        );
        if (config.autoOpen) {
          open(url);
        }
      };
      server.httpServer.once("listening", () => {
        setImmediate(logBanner);
      });
      const honoMiddleware = async (req, res, next) => {
        try {
          const pathname = req.url || "";
          if (!pathname.startsWith("/api")) {
            return next();
          }
          const url = `http://${req.headers.host}${pathname}`;
          const headers = new Headers();
          Object.entries(req.headers).forEach(
            ([key, value]) => {
              if (value) {
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(", ") : value
                );
              }
            }
          );
          const init = { method: req.method, headers };
          if (req.method !== "GET" && req.method !== "HEAD") {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            await new Promise((resolve7) => {
              req.once("end", () => resolve7());
              req.once("error", () => resolve7());
              req.once("close", () => resolve7());
            });
            if (chunks.length > 0) {
              init.body = Buffer.concat(chunks);
            }
          }
          const response = await honoApp.fetch(new Request(url, init));
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const isSSE = response.headers.get("content-type")?.includes("text/event-stream");
          if (isSSE) {
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
          }
          if (response.body) {
            res.flushHeaders?.();
            const reader = response.body.getReader();
            const isDisconnect = (code) => code === "ERR_STREAM_DESTROYED" || code === "EPIPE" || code === "ECONNRESET";
            let clientGone = false;
            const onClose = () => {
              clientGone = true;
              reader.cancel().catch(() => {
              });
            };
            const onError = (err) => {
              clientGone = true;
              reader.cancel().catch(() => {
              });
              if (!isDisconnect(err.code)) {
                console.error("[Hono Middleware] Response error:", err);
              }
            };
            res.on("close", onClose);
            res.on("error", onError);
            const pump = async () => {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done || clientGone || res.destroyed) break;
                  await new Promise((resolve7, reject) => {
                    res.write(
                      Buffer.from(value),
                      (err) => err ? reject(err) : resolve7()
                    );
                  });
                }
              } catch (err) {
                const code = err?.code;
                if (!clientGone && !res.destroyed && !isDisconnect(code)) {
                  console.error("[Hono Middleware] Stream error:", err);
                }
              } finally {
                res.off("close", onClose);
                res.off("error", onError);
                await reader.cancel().catch(() => {
                });
                if (!res.writableEnded && !res.destroyed) {
                  res.end();
                }
              }
            };
            void pump();
          } else {
            res.end();
          }
        } catch (error) {
          next(error);
        }
      };
      server.middlewares.use(honoMiddleware);
    }
  };
}

// server/vite-base-config.ts
function getViteBaseConfig() {
  return {
    optimizeDeps: {
      // Node-only modules that the dev backend (core/mcp/remote/node/*,
      // core/mcp/node/*) consumes. Excluding them from Vite's dep-pre-bundling
      // step keeps `vite dev` from trying to scan/bundle them into the
      // browser graph during startup.
      exclude: [
        "@modelcontextprotocol/sdk/client/stdio.js",
        // `atomically` is reached only through `core/storage/store-io.ts`,
        // which is imported by `core/mcp/remote/node/server.ts` (the Hono
        // app). The module never lands in the browser graph; excluding it
        // keeps Vite's dev-time scanner from chasing it through the plugin's
        // node-only import chain.
        "atomically",
        // `chokidar` is only loaded inside `core/mcp/remote/node/server.ts`
        // when the lazy mcp.json watcher starts. It transitively imports
        // `readdirp` and core node fs/os modules; excluding it keeps Vite's
        // dep scanner from walking into them during dev startup.
        "chokidar",
        "cross-spawn",
        "which",
        // `@napi-rs/keyring` is loaded only inside
        // `core/auth/node/secret-store.ts` from the Hono `/api/servers`
        // handlers. It's a native-binding package (no browser code path) so
        // excluding it keeps Vite's dep scanner from chasing into the
        // platform-specific binaries during dev startup.
        "@napi-rs/keyring"
      ]
    }
  };
}

// server/start-vite-dev-server.ts
var __dirname2 = dirname3(fileURLToPath2(import.meta.url));
async function startViteDevServer(config) {
  const root = resolve3(join3(__dirname2, ".."));
  const baseConfig = getViteBaseConfig();
  const inlineConfig = {
    ...baseConfig,
    configFile: false,
    root,
    server: {
      port: config.port,
      host: config.hostname
    },
    plugins: [react(), honoMiddlewarePlugin(config)]
  };
  const server = await createServer2(inlineConfig);
  await server.listen();
  return {
    async close() {
      await server.close();
    }
  };
}

// server/server.ts
import { readFileSync as readFileSync3 } from "fs";
import { join as join4, dirname as dirname4, resolve as resolve4 } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import { randomBytes as randomBytes2 } from "crypto";
import open2 from "open";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono as Hono2 } from "hono";
var __filename = fileURLToPath3(import.meta.url);
var __dirname3 = dirname4(__filename);
async function startHonoServer(config) {
  const sandboxController = createSandboxController({
    port: config.sandboxPort,
    host: config.sandboxHost
  });
  await sandboxController.start();
  const resolvedAuthToken = config.authToken || (config.dangerouslyOmitAuth ? "" : randomBytes2(32).toString("hex"));
  const rootPath = config.staticRoot ?? __dirname3;
  const { app: apiApp, close: closeApi } = createRemoteApp({
    authToken: config.dangerouslyOmitAuth ? void 0 : resolvedAuthToken,
    dangerouslyOmitAuth: config.dangerouslyOmitAuth,
    storageDir: config.storageDir,
    allowedOrigins: config.allowedOrigins,
    sandboxUrl: sandboxController.getUrl() ?? void 0,
    logger: config.logger,
    initialConfig: webServerConfigToInitialPayload(config)
  });
  const app = new Hono2();
  app.use("/api/*", async (c) => {
    return apiApp.fetch(c.req.raw);
  });
  const serveIndexHtml = (c) => {
    const indexPath = join4(rootPath, "index.html");
    const html = readFileSync3(indexPath, "utf-8");
    c.header("Cache-Control", "no-store");
    return c.html(injectAuthToken(html, resolvedAuthToken));
  };
  app.get("/", async (c) => {
    try {
      return serveIndexHtml(c);
    } catch (error) {
      console.error("Error serving index.html:", error);
      return c.notFound();
    }
  });
  app.use("/*", serveStatic({ root: rootPath }));
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.notFound();
    }
    try {
      return serveIndexHtml(c);
    } catch (error) {
      console.error("Error serving index.html:", error);
      return c.notFound();
    }
  });
  const httpServer = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.hostname
    },
    (info) => {
      const sandboxUrl = sandboxController.getUrl();
      const url = printServerBanner(
        config,
        info.port,
        resolvedAuthToken,
        sandboxUrl ?? void 0
      );
      if (config.autoOpen) {
        open2(url);
      }
    }
  );
  httpServer.on("error", (err) => {
    if (err.message.includes("EADDRINUSE")) {
      console.error(
        `MCP Inspector PORT IS IN USE at http://${config.hostname}:${config.port}`
      );
      process.exit(1);
    } else {
      throw err;
    }
  });
  return {
    async close() {
      await closeApi();
      await sandboxController.close();
      if ("closeAllConnections" in httpServer) {
        httpServer.closeAllConnections();
      }
      await new Promise((resolve7, reject) => {
        httpServer.close((err) => err ? reject(err) : resolve7());
      });
    }
  };
}
async function runStandalone() {
  const config = buildWebServerConfigFromEnv();
  const handle = await startHonoServer(config);
  const shutdown = () => {
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
var isMain = process.argv[1] !== void 0 && resolve4(process.argv[1]) === resolve4(__filename);
if (isMain) {
  void runStandalone();
}

// server/run-web.ts
var __dirname4 = dirname5(fileURLToPath4(import.meta.url));
function ensureStdioCwd(config) {
  if ((config.type === "stdio" || config.type === void 0) && config.command && !config.cwd) {
    return { ...config, cwd: resolve5(process.cwd()) };
  }
  return config;
}
async function runWeb(argv) {
  const program = new Command();
  const argSeparatorIndex = argv.indexOf("--");
  let preArgs = argv;
  let postArgs = [];
  if (argSeparatorIndex !== -1) {
    preArgs = argv.slice(0, argSeparatorIndex);
    postArgs = argv.slice(argSeparatorIndex + 1);
  }
  program.name("mcp-inspector-web").description("Web UI for MCP Inspector").allowExcessArguments().allowUnknownOption().option(
    "-e <env>",
    "environment variables in KEY=VALUE format",
    parseKeyValuePair,
    {}
  ).option("--config <path>", "config file path").option("--server <name>", "server name from config file").option("--transport <type>", "transport type (stdio, sse, http)").option("--server-url <url>", "server URL for SSE/HTTP transport").option("--cwd <path>", "working directory for stdio server process").option(
    "--header <headers...>",
    'HTTP headers as "HeaderName: Value" pairs (for HTTP/SSE transports)',
    parseHeaderPair,
    {}
  ).option("--dev", "run in development mode (Vite)").parse(preArgs);
  const opts = program.opts();
  const args = program.args;
  const target = [...args, ...postArgs];
  const isDev = !!opts.dev;
  const hasServerInput = opts.config || target.length > 0 || opts.serverUrl || opts.transport && opts.transport !== "stdio";
  let initialMcpConfig = null;
  if (hasServerInput) {
    const serverOptions = {
      configPath: opts.config,
      serverName: opts.server,
      target: target.length > 0 ? target : void 0,
      transport: opts.transport,
      serverUrl: opts.serverUrl,
      cwd: opts.cwd,
      env: opts.e
    };
    if (opts.header && Object.keys(opts.header).length > 0) {
      console.warn(
        "Warning: --header is accepted but initial HTTP headers are configured via server settings in the web UI (post-#1358)."
      );
    }
    try {
      const configs = resolveServerConfigs(serverOptions, "single");
      const config = configs[0];
      if (!config) {
        console.error(
          "Error: Could not resolve server config. Use --config and --server, or pass a command/URL."
        );
        process.exit(1);
      }
      initialMcpConfig = ensureStdioCwd(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not resolve server config.";
      console.error("Error:", message);
      process.exit(1);
    }
  }
  const webConfig = buildWebServerConfig({ initialMcpConfig });
  if (!isDev) {
    webConfig.staticRoot = join5(__dirname4, "..", "dist");
  }
  console.log(
    isDev ? "Starting MCP inspector in development mode..." : "Starting MCP inspector..."
  );
  let handle;
  try {
    if (isDev) {
      handle = await startViteDevServer(webConfig);
    } else {
      handle = await startHonoServer(webConfig);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Web client failed to start.";
    console.error("Error:", message);
    process.exit(1);
  }
  const shutdown = () => {
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return new Promise(() => {
  });
}

// src/index.ts
var __filename2 = fileURLToPath5(import.meta.url);
var isMain2 = process.argv[1] !== void 0 && resolve6(process.argv[1]) === resolve6(__filename2);
if (isMain2) {
  runWeb(process.argv).then((code) => process.exit(code ?? 0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
export {
  runWeb
};
//# sourceMappingURL=index.js.map