import { Command } from "commander";
type McpResponse = Record<string, unknown>;
import { awaitableLog } from "./utils/awaitable-log.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  InspectorClientEnvironment,
} from "@inspector/core/mcp/types.js";
import {
  DEFAULT_MAX_FETCH_REQUESTS,
  DEFAULT_TASK_TTL_MS,
} from "@inspector/core/mcp/types.js";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import {
  ManagedToolsState,
  ManagedResourcesState,
  ManagedResourceTemplatesState,
  ManagedPromptsState,
} from "@inspector/core/mcp/state/index.js";
import {
  createTransportNode,
  loadServerEntries,
  selectServerEntry,
  parseKeyValuePair as parseEnvPair,
  parseHeaderPair,
} from "@inspector/core/mcp/node/index.js";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import { extractAppInfo } from "@inspector/core/mcp/apps.js";
import type { AppInfo } from "@inspector/core/mcp/apps.js";
import { getStateFilePath } from "@inspector/core/auth/node/storage-node.js";
import {
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
  type OAuthPersistSnapshot,
} from "@inspector/core/auth/oauth-persist.js";
import { getAuthorizationServerUrl } from "@inspector/core/auth/discovery.js";
import {
  refreshAuthorization,
  discoverAuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { CliExitCodeError, EXIT_CODES } from "./error-handler.js";
import {
  ConsoleNavigation,
  MutableRedirectUrlProvider,
} from "@inspector/core/auth/index.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/index.js";
import {
  connectInspectorWithOAuth,
  withCliAuthRecoveryRetry,
} from "./cliOAuth.js";
import {
  DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
  formatRunnerOAuthRedirectUrl,
  parseRunnerOAuthCallbackUrl,
  type RunnerOAuthCallbackConfig,
} from "@inspector/core/auth/node/runner-oauth-callback.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  buildRunnerClientAuthOptions,
  isOAuthCapableServerConfig,
  loadRunnerClientConfig,
  type RunnerClientConfigOverrides,
} from "@inspector/core/client/runner.js";
import {
  LoggingLevelSchema,
  type LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { readInspectorVersion } from "@inspector/core/node/version.js";

export const validLogLevels: LoggingLevel[] = Object.values(
  LoggingLevelSchema.enum,
);

/** Client identity name the CLI reports to servers. */
const CLI_CLIENT_NAME = "inspector-cli";

/**
 * Default connect timeout (ms) for ad-hoc server invocations. Without this an
 * unreachable server (e.g. a partner edge that drops the SYN) hangs the CLI
 * indefinitely; the value is generous enough for cold-start OAuth discovery
 * round-trips while still failing fast on a black-holed host.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

type OutputFormat = "text" | "json";

type MethodArgs = {
  method?: string;
  promptName?: string;
  promptArgs?: Record<string, JsonValue>;
  uri?: string;
  logLevel?: LoggingLevel;
  toolName?: string;
  toolArg?: Record<string, JsonValue>;
  toolMeta?: Record<string, string>;
  metadata?: Record<string, string>;
  appInfo?: boolean;
  format?: OutputFormat;
};

/**
 * {@link AppInfo} plus a CLI-only `resourceError` so a `resources/read` failure
 * during the probe is reported instead of being silently swallowed (which would
 * make "no CSP declared" indistinguishable from "resource unreadable").
 */
export type CliAppInfo = AppInfo & { resourceError?: string };

/**
 * Discriminated outcome from {@link callMethod}'s per-method runner. Most
 * methods return a `result` (with optional collected `appInfo`) for
 * {@link emitResult} to format; the `tools/list --app-info` NDJSON path writes
 * its lines itself and reports `emitted` so the caller skips a second write.
 */
type MethodOutcome =
  | { kind: "result"; result: McpResponse; appInfo?: CliAppInfo }
  | { kind: "emitted" };

async function callMethod(
  serverConfig: MCPServerConfig,
  serverSettings: InspectorServerSettings | undefined,
  args: MethodArgs & { method: string },
  clientConfig: ClientConfig,
  cliAuthOverrides: RunnerClientConfigOverrides,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
): Promise<void> {
  // Version comes from the single source of truth — the root package.json —
  // via the shared core reader, not the CLI's own manifest.
  const clientIdentity = {
    name: CLI_CLIENT_NAME,
    version: readInspectorVersion(import.meta.url),
  };

  const environment: InspectorClientEnvironment = {
    transport: createTransportNode,
  };
  const redirectUrlProvider = new MutableRedirectUrlProvider();
  if (isOAuthCapableServerConfig(serverConfig)) {
    redirectUrlProvider.redirectUrl =
      formatRunnerOAuthRedirectUrl(callbackUrlConfig);
    environment.oauth = {
      storage: new NodeOAuthStorage(),
      navigation: new ConsoleNavigation(),
      redirectUrlProvider,
    };
  }

  const clientAuthOptions = buildRunnerClientAuthOptions(
    clientConfig,
    serverSettings,
    cliAuthOverrides,
  );

  const inspectorClient = new InspectorClient(serverConfig, {
    environment,
    clientIdentity,
    initialLoggingLevel: "debug",
    progress: false,
    sample: false,
    elicit: false,
    serverSettings,
    ...clientAuthOptions,
  });

  let managedToolsState: ManagedToolsState | null = null;
  let managedResourcesState: ManagedResourcesState | null = null;
  let managedResourceTemplatesState: ManagedResourceTemplatesState | null =
    null;
  let managedPromptsState: ManagedPromptsState | null = null;

  const runMethod = async (): Promise<MethodOutcome> => {
    let result: McpResponse;
    let appInfo: CliAppInfo | undefined;

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
        inspectorClient,
      );
      managedResourceTemplatesState.setMetadata(args.metadata);
      await managedResourceTemplatesState.refresh();
    } else if (args.method === "prompts/list") {
      managedPromptsState = new ManagedPromptsState(inspectorClient);
      managedPromptsState.setMetadata(args.metadata);
      await managedPromptsState.refresh();
    }

    if (args.method === "tools/list") {
      const tools = managedToolsState!.getTools();
      if (args.appInfo) {
        // NDJSON: one app-info line per tool, all on a single connection. A
        // caller that wants only the App tools can `| jq -c 'select(.hasApp)'`.
        // collectAppInfo never throws — a tool with a malformed `_meta.ui`
        // surfaces as `{hasApp:false, resourceError}` — so one bad tool can't
        // abort the whole listing. Emitted verbatim as NDJSON regardless of
        // --format (the list-probe shape is fixed; --format json only reshapes
        // the single-result paths).
        for (const tool of tools) {
          const info = await collectAppInfo(
            inspectorClient,
            tool,
            args.metadata,
          );
          await awaitableLog(JSON.stringify(info) + "\n");
        }
        return { kind: "emitted" };
      }
      result = { tools };
    } else if (args.method === "tools/call") {
      if (!args.toolName) {
        throw new Error(
          "Tool name is required for tools/call method. Use --tool-name to specify the tool name.",
        );
      }

      const tool = managedToolsState!
        .getTools()
        .find((t) => t.name === args.toolName);
      if (!tool) {
        // Distinct from `isError:true` and (for --app-info) from "tool has no
        // app": the named tool does not exist on the server. Exit TOOL_ERROR
        // with `code: "tool_not_found"` so a caller can tell a typo/rename
        // apart from a real tool failure or a no-app probe result.
        throw new CliExitCodeError(
          EXIT_CODES.TOOL_ERROR,
          `Tool '${args.toolName}' not found on server.`,
          { code: "tool_not_found" },
        );
      }

      // Only collect app-info when the caller asked for it (`--app-info` or
      // `--format json`); a plain text-mode `tools/call` shouldn't fail just
      // because the tool's `_meta.ui.resourceUri` is malformed or its resource
      // is unreadable.
      if (args.appInfo || args.format === "json") {
        appInfo = await collectAppInfo(inspectorClient, tool, args.metadata);
      }
      if (args.appInfo) {
        // --app-info: probe-only — emit the app metadata and skip the tool
        // call entirely. The no-app exit code is handled in emitResult.
        result = { ...appInfo };
      } else {
        const invocation = await inspectorClient.callTool(
          tool,
          args.toolArg || {},
          args.metadata,
          args.toolMeta,
        );
        if (invocation.result !== null) {
          result = invocation.result;
        } else {
          /* v8 ignore next 9 -- unreachable: InspectorClient.callTool either
             throws on a tool-execution/transport error (caught by the outer
             try) or returns an invocation whose `result` is guaranteed
             non-null (attemptToolCall throws if finalResult is falsy). This
             else is defensive only. */
          result = {
            content: [
              {
                type: "text" as const,
                text: invocation.error || "Tool call failed",
              },
            ],
            isError: true,
          };
        }
      }
    } else if (args.method === "resources/list") {
      result = {
        resources: managedResourcesState!.getResources(),
      };
    } else if (args.method === "resources/read") {
      if (!args.uri) {
        throw new Error(
          "URI is required for resources/read method. Use --uri to specify the resource URI.",
        );
      }

      const invocation = await inspectorClient.readResource(
        args.uri,
        args.metadata,
      );
      result = invocation.result;
    } else if (args.method === "resources/templates/list") {
      result = {
        resourceTemplates:
          managedResourceTemplatesState!.getResourceTemplates(),
      };
    } else if (args.method === "prompts/list") {
      result = { prompts: managedPromptsState!.getPrompts() };
    } else if (args.method === "prompts/get") {
      if (!args.promptName) {
        throw new Error(
          "Prompt name is required for prompts/get method. Use --prompt-name to specify the prompt name.",
        );
      }

      const invocation = await inspectorClient.getPrompt(
        args.promptName,
        args.promptArgs || {},
        args.metadata,
      );
      result = invocation.result;
    } else if (args.method === "initialize") {
      // Connect-only probe: emit the cached InitializeResult fields so a
      // caller can read serverInfo / protocolVersion / capabilities /
      // instructions without picking a list method.
      result = {
        serverInfo: inspectorClient.getServerInfo(),
        protocolVersion: inspectorClient.getProtocolVersion(),
        capabilities: inspectorClient.getCapabilities(),
        instructions: inspectorClient.getInstructions(),
      };
    } else if (args.method === "logging/setLevel") {
      if (!args.logLevel) {
        throw new Error(
          "Log level is required for logging/setLevel method. Use --log-level to specify the log level.",
        );
      }

      await inspectorClient.setLoggingLevel(args.logLevel);
      result = {};
    } else {
      throw new Error(
        `Unsupported method: ${args.method}. Supported methods include: initialize, tools/list, tools/call, resources/list, resources/read, resources/templates/list, prompts/list, prompts/get, logging/setLevel`,
      );
    }

    return { kind: "result", result, appInfo };
  };

  try {
    await connectInspectorWithOAuth(
      inspectorClient,
      serverConfig,
      redirectUrlProvider,
      callbackUrlConfig,
      serverSettings,
    );

    const outcome = await withCliAuthRecoveryRetry(
      inspectorClient,
      redirectUrlProvider,
      callbackUrlConfig,
      serverSettings,
      runMethod,
    );

    // The NDJSON `tools/list --app-info` path already wrote its lines; every
    // other method hands its result to emitResult for format/exit handling.
    if (outcome.kind === "result") {
      await emitResult(outcome.result, outcome.appInfo, args);
    }
  } finally {
    managedToolsState?.destroy();
    managedResourcesState?.destroy();
    managedResourceTemplatesState?.destroy();
    managedPromptsState?.destroy();
    await inspectorClient.disconnect();
  }
}

/**
 * Write the method result (and any app-info) to stdout, honouring `--format`
 * and `--app-info`, then map `isError`/no-app outcomes onto the exit-code map.
 * Extracted from `callMethod` so the format/exit handling is in one place.
 */
export async function emitResult(
  result: McpResponse,
  appInfo: CliAppInfo | undefined,
  args: MethodArgs,
): Promise<void> {
  const json = args.format === "json";

  if (args.appInfo) {
    const info: CliAppInfo = appInfo ?? {
      hasApp: false,
      toolName: args.toolName ?? "",
    };
    // Single-line JSON either way; --format json wraps it under an `appInfo`
    // key so the envelope shape is uniform with the non-probe path.
    await awaitableLog(JSON.stringify(json ? { appInfo: info } : info) + "\n");
    if (!info.hasApp) {
      throw new CliExitCodeError(
        EXIT_CODES.NO_APP,
        `Tool '${args.toolName}' has no MCP App UI resource (_meta.ui.resourceUri).`,
      );
    }
    return;
  }

  if (json) {
    // One JSON object on stdout — `result` plus, when present, `appInfo` as a
    // sibling key. No `--- MCP App Info ---` banner, so `| jq` works for App
    // tools as well as plain ones.
    const envelope: Record<string, unknown> = { result };
    if (appInfo?.hasApp) envelope.appInfo = appInfo;
    await awaitableLog(JSON.stringify(envelope) + "\n");
  } else {
    // Text mode emits the result only; app-info is not collected on this path
    // (use `--format json` or `--app-info` to get it).
    await awaitableLog(JSON.stringify(result, null, 2) + "\n");
  }

  // A tool that returned `isError:true` (or whose call failed) is still printed
  // above so the caller sees the payload, but the process exits TOOL_ERROR so
  // `&&` chains don't proceed on a failed call.
  if ((result as { isError?: unknown }).isError === true) {
    throw new CliExitCodeError(
      EXIT_CODES.TOOL_ERROR,
      `Tool '${args.toolName}' returned isError:true.`,
      { code: "tool_is_error" },
    );
  }
}

/**
 * Build the CLI's app-info for a tool: extract the tool-side `_meta.ui` and,
 * when the tool advertises a UI resource, follow it with a `resources/read` so
 * the resource-side csp/permissions/domain are included.
 *
 * Never throws — the two failure modes both fold into a `{hasApp:false,
 * resourceError}` result rather than propagating:
 *  - a malformed `_meta.ui.resourceUri` (extractAppInfo throws), so the
 *    `tools/list --app-info` NDJSON loop stays per-tool tolerant (one bad tool
 *    can't abort the whole listing);
 *  - a `resources/read` failure, since "tool says it has an app but the
 *    resource is unreadable" is itself a useful probe result.
 */
export async function collectAppInfo(
  client: Pick<InspectorClient, "readResource">,
  tool: Parameters<typeof extractAppInfo>[0],
  metadata: Record<string, string> | undefined,
): Promise<CliAppInfo> {
  let base: AppInfo;
  try {
    base = extractAppInfo(tool);
  } catch (e) {
    return {
      hasApp: false,
      toolName: tool.name,
      resourceError: e instanceof Error ? e.message : String(e),
    };
  }
  if (!base.hasApp || base.resourceUri === undefined) return base;
  try {
    const read = await client.readResource(base.resourceUri, metadata);
    return extractAppInfo(tool, read.result);
  } catch (e) {
    return {
      ...base,
      resourceError: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Canonicalise a server URL the same way the web inspector does before storing
 * OAuth state (`new URL().href` lowercases the host, normalises the scheme, and
 * adds a trailing `/` for bare-origin URLs). The CLI must look up by the same
 * key the web side wrote, so a trailing-slash or case mismatch doesn't miss a
 * token that's sitting one key over. Falls back to the raw string when the URL
 * can't be parsed (e.g. an ad-hoc non-URL target).
 */
export function normalizeServerUrl(serverUrl: string): string {
  try {
    return new URL(serverUrl).href;
  } catch {
    return serverUrl;
  }
}

/** The subset of a stored server's OAuth state the CLI reads/refreshes. */
type StoredServerState = {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  serverMetadata?: OAuthMetadata;
};
/** The stored-server map shape the CLI reads out of the OAuth state file. */
type StoredServers = Record<string, StoredServerState>;

/**
 * Read the OAuth state file directly (bypassing the Zustand store cache) so
 * each call sees the current on-disk state — required for `--wait-for-auth`
 * polling. Returns the full snapshot, or an empty one when the file is absent
 * or unreadable. Uses the shared {@link parseOAuthPersistBlob} so both the
 * plain `{servers,idpSessions}` and legacy `{state,version}` layouts are
 * accepted, matching whatever the web backend wrote.
 */
async function readOAuthSnapshot(
  statePath: string,
): Promise<OAuthPersistSnapshot> {
  const { readFile } = await import("node:fs/promises");
  try {
    const text = await readFile(statePath, "utf8");
    const snapshot = parseOAuthPersistBlob(text);
    if (snapshot) return snapshot;
  } catch {
    // Absent/unreadable/malformed → fall through to the empty snapshot below.
  }
  return { servers: {}, idpSessions: {} };
}

/**
 * Read just the `servers` map. Thin wrapper over {@link readOAuthSnapshot} for
 * the read-only lookups (`findStoredToken`, `--wait-for-auth`, key listing).
 */
async function readOAuthServers(statePath: string): Promise<StoredServers> {
  return (await readOAuthSnapshot(statePath)).servers as StoredServers;
}

/**
 * Look up a stored server's OAuth state, trying the URL-normalised key first
 * (how the web store writes it) and the raw string second. Returns the matched
 * key so a write-back updates the same entry.
 */
function findStoredServerState(
  servers: StoredServers,
  serverUrl: string,
): { key: string; state: StoredServerState } | undefined {
  const normalized = normalizeServerUrl(serverUrl);
  if (servers[normalized])
    return { key: normalized, state: servers[normalized] };
  if (servers[serverUrl]) return { key: serverUrl, state: servers[serverUrl] };
  return undefined;
}

/**
 * Look up a stored access token for `serverUrl`, trying the URL-normalised key
 * first (how the web store writes it) and the raw string second.
 */
function findStoredToken(
  servers: StoredServers,
  serverUrl: string,
): string | undefined {
  return findStoredServerState(servers, serverUrl)?.state.tokens?.access_token;
}

/**
 * Injectable dependencies for {@link refreshStoredAuthToken}, so the refresh
 * grant + auth-server discovery can be faked in unit tests without standing up
 * a real OAuth token endpoint. Both default to the SDK implementations.
 */
export interface RefreshStoredAuthDeps {
  refresh?: typeof refreshAuthorization;
  discover?: typeof discoverAuthorizationServerMetadata;
}

/**
 * Run the OAuth `refresh_token` grant for a stored server and persist the
 * rotated tokens back to `statePath` (same `{servers,idpSessions}` shape the
 * web backend writes), returning the fresh access token.
 *
 * Reuses the SDK's {@link refreshAuthorization} (not a hand-rolled token
 * request) with the stored `clientInformation` + `serverMetadata`; when the
 * metadata wasn't persisted it is discovered from the resolved authorization
 * server. A missing refresh token or client information, or a failed grant,
 * throws {@link CliExitCodeError} with {@link EXIT_CODES.AUTH_REQUIRED} so the
 * caller exits with the documented code and a clear message.
 */
export async function refreshStoredAuthToken(
  serverUrl: string,
  statePath: string,
  deps: RefreshStoredAuthDeps = {},
): Promise<string> {
  const refresh = deps.refresh ?? refreshAuthorization;
  const discover = deps.discover ?? discoverAuthorizationServerMetadata;

  const snapshot = await readOAuthSnapshot(statePath);
  const servers = snapshot.servers as StoredServers;
  const found = findStoredServerState(servers, serverUrl);
  const refreshToken = found?.state.tokens?.refresh_token;
  const clientInformation = found?.state.clientInformation;
  if (!found || !refreshToken) {
    throw new CliExitCodeError(
      EXIT_CODES.AUTH_REQUIRED,
      `No stored refresh token for ${normalizeServerUrl(serverUrl)} in ${statePath}. Complete the OAuth flow in the web inspector first.`,
      { code: "no_stored_token", url: serverUrl },
    );
  }
  if (!clientInformation) {
    throw new CliExitCodeError(
      EXIT_CODES.AUTH_REQUIRED,
      `Stored auth for ${normalizeServerUrl(serverUrl)} has a refresh token but no client information; cannot refresh. Re-authorize in the web inspector.`,
      { code: "no_stored_token", url: serverUrl },
    );
  }

  const authServerUrl = found.state.serverMetadata?.issuer
    ? new URL(found.state.serverMetadata.issuer)
    : getAuthorizationServerUrl(serverUrl);
  const metadata =
    found.state.serverMetadata ?? (await discover(authServerUrl)) ?? undefined;

  let tokens: OAuthTokens;
  try {
    tokens = await refresh(authServerUrl, {
      metadata,
      clientInformation,
      refreshToken,
      resource: new URL(serverUrl),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliExitCodeError(
      EXIT_CODES.AUTH_REQUIRED,
      `Failed to refresh the stored OAuth token for ${normalizeServerUrl(serverUrl)}: ${message}. Re-authorize in the web inspector.`,
      { code: "refresh_failed", url: serverUrl },
    );
  }

  // Persist the rotated tokens back under the same key, preserving every other
  // server entry and the idpSessions block, so web and CLI stay consistent.
  servers[found.key] = { ...found.state, tokens };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(statePath, serializeOAuthPersistBlob(snapshot), "utf8");

  return tokens.access_token;
}

/**
 * Poll the OAuth state file until a token for `serverUrl` appears (or the
 * timeout elapses). Used by `--wait-for-auth` so an automated caller can hand
 * off to a human for the OAuth dance and resume once the token lands. The
 * lookup is normalised, so a trailing-slash mismatch between the URL the human
 * opened and the one the agent passed still resolves.
 */
async function waitForStoredToken(
  serverUrl: string,
  statePath: string,
  timeoutSec: number,
): Promise<string> {
  const key = normalizeServerUrl(serverUrl);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const servers = await readOAuthServers(statePath);
    const token = findStoredToken(servers, serverUrl);
    if (token) return token;
    if (Date.now() >= deadline) {
      const stored = Object.keys(servers);
      throw new CliExitCodeError(
        EXIT_CODES.AUTH_REQUIRED,
        `--wait-for-auth timed out after ${timeoutSec}s; no stored OAuth token for ${key} in ${statePath}.` +
          (stored.length > 0
            ? ` Stored keys: ${stored.join(", ")}.`
            : " No tokens stored yet."),
        { code: "auth_wait_timeout", url: serverUrl },
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Build the JSON `--print-handoff` emits: everything an automated caller needs
 * to relay to a human so they can complete OAuth in a browser and have the
 * token land where the CLI will find it.
 *
 * NOTE: the `deepLink` query shape (serverUrl/transport/autoConnect) is the
 * interim format pending the web deep-link auto-connect work (#1576); reconcile
 * with that issue's canonical handoff format once it lands.
 */
function buildHandoff(serverUrl: string, statePath: string): McpResponse {
  const host = process.env.HOST || "127.0.0.1";
  const clientPort = process.env.CLIENT_PORT || "6274";
  const sandboxPort = process.env.MCP_SANDBOX_PORT || "6275";
  // Treat an empty MCP_INSPECTOR_API_TOKEN the same as unset — an empty token
  // can't satisfy the deep-link autoConnect gate.
  const apiToken = process.env.MCP_INSPECTOR_API_TOKEN || undefined;
  // TODO(#1576): interim deep-link shape. `transport: "http"` is hardcoded even
  // for SSE servers, and `autoConnect=<token>` is NOT one of the three token
  // sources the web app reads (window.__INSPECTOR_API_TOKEN__ /
  // ?MCP_INSPECTOR_API_TOKEN / sessionStorage — see CLAUDE.md). Reconcile both
  // with #1576's canonical handoff/deep-link format once it lands.
  const params = new URLSearchParams({ serverUrl, transport: "http" });
  if (apiToken) params.set("autoConnect", apiToken);
  return {
    serverUrl: normalizeServerUrl(serverUrl),
    deepLink: `http://${host}:${clientPort}/?${params.toString()}`,
    portForwardCmd: `coder port-forward <workspace> --tcp ${clientPort}:${clientPort} --tcp ${sandboxPort}:${sandboxPort}`,
    oauthStatePath: statePath,
    apiToken: apiToken ?? null,
    note:
      apiToken === undefined
        ? "MCP_INSPECTOR_API_TOKEN is not set; the deep-link autoConnect gate will reject — launch the web inspector with a known token first."
        : undefined,
  };
}

/**
 * Apply a connection timeout to a resolved server's settings, building a
 * minimal {@link InspectorServerSettings} when none came from the file. Ad-hoc
 * invocations get {@link DEFAULT_CONNECT_TIMEOUT_MS} so a black-holed host
 * fails fast; catalog/config invocations keep their file-level timeout unless
 * `--connect-timeout` is passed explicitly.
 */
export function withConnectTimeout(
  settings: InspectorServerSettings | undefined,
  connectionTimeout: number | undefined,
): InspectorServerSettings | undefined {
  if (connectionTimeout === undefined) return settings;
  if (settings) return { ...settings, connectionTimeout };
  return {
    headers: [],
    metadata: [],
    env: [],
    connectionTimeout,
    requestTimeout: 0,
    taskTtl: DEFAULT_TASK_TTL_MS,
    maxFetchRequests: DEFAULT_MAX_FETCH_REQUESTS,
    autoRefreshOnListChanged: false,
    roots: [],
  };
}

function parseKeyValuePair(
  value: string,
  previous: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  const parts = value.split("=");
  const key = parts[0];
  const val = parts.slice(1).join("=");

  if (!key || val === undefined || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`,
    );
  }

  let parsedValue: JsonValue;
  try {
    parsedValue = JSON.parse(val) as JsonValue;
  } catch {
    parsedValue = val;
  }

  return { ...previous, [key as string]: parsedValue };
}

type ParseResult =
  | {
      shortCircuit?: undefined;
      serverConfig: MCPServerConfig;
      serverSettings: InspectorServerSettings | undefined;
      methodArgs: MethodArgs & { method: string };
      clientConfigPath?: string;
      clientId?: string;
      clientSecret?: string;
      clientMetadataUrl?: string;
      callbackUrl?: string;
    }
  // Short-circuit modes (`--list-stored-auth`, `--print-handoff`) do their own
  // output and need no server connection; runCli returns immediately.
  | { shortCircuit: true };

async function parseArgs(argv?: string[]): Promise<ParseResult> {
  const program = new Command();
  // On a parse/usage ERROR (exitCode !== 0), throw the CommanderError instead
  // of letting commander call process.exit(). The binary entry (index.ts) still
  // routes any thrown error through handleError → process.exit, so external
  // behavior is unchanged — but in-process callers (the test harness in
  // __tests__/helpers/cli-runner.ts) can now catch the error instead of having
  // commander tear down the whole test worker. For --help / --version
  // (exitCode 0) we return without throwing, so commander falls through to its
  // normal clean process.exit(0) after printing — preserving that UX. See #1484.
  program.exitOverride((err) => {
    /* v8 ignore next -- the `exitCode === 0` arm only fires for --help/--version,
       which cannot run through the in-process test runner (it would call the
       real process.exit(0) and tear down the vitest worker). That UX is covered
       out-of-process in e2e.test.ts; here only the throwing arm is exercised. */
    if (err.exitCode !== 0) throw err;
  });
  const rawArgs = argv ?? process.argv;
  const scriptArgs = rawArgs.slice(2);
  const dashDashIndex = scriptArgs.indexOf("--");
  let targetArgs: string[] = [];
  let optionArgs: string[] = [];
  if (dashDashIndex >= 0) {
    targetArgs = scriptArgs.slice(0, dashDashIndex);
    optionArgs = scriptArgs.slice(dashDashIndex + 1);
  } else {
    let i = 0;
    while (i < scriptArgs.length && !scriptArgs[i]!.startsWith("-")) {
      targetArgs.push(scriptArgs[i]!);
      i++;
    }
    optionArgs = scriptArgs.slice(i);
  }
  const preArgs: string[] = [
    rawArgs[0] ?? "node",
    rawArgs[1] ?? "inspector-cli",
    ...optionArgs,
  ];

  program
    .name("inspector-cli")
    .allowUnknownOption()
    .argument(
      "[target...]",
      "Command and arguments or URL of the MCP server (or use --config and --server)",
    )
    .option(
      "--catalog <path>",
      "Writable catalog file (created if missing; default: ~/.mcp-inspector/mcp.json, or MCP_CATALOG_PATH)",
    )
    .option(
      "--config <path>",
      "Read-only session config file (served as-is, never written or seeded; errors if absent)",
    )
    .option("--server <name>", "Server name from config/catalog file")
    .option(
      "-e <env>",
      "Environment variables for the server (KEY=VALUE)",
      parseEnvPair,
      {},
    )
    .option("--method <method>", "Method to invoke")
    .option("--tool-name <toolName>", "Tool name (for tools/call method)")
    .option(
      "--tool-arg <pairs...>",
      "Tool argument as key=value pair",
      parseKeyValuePair,
      {},
    )
    .option("--uri <uri>", "URI of the resource (for resources/read method)")
    .option(
      "--prompt-name <promptName>",
      "Name of the prompt (for prompts/get method)",
    )
    .option(
      "--prompt-args <pairs...>",
      "Prompt arguments as key=value pairs",
      parseKeyValuePair,
      {},
    )
    .option(
      "--log-level <level>",
      "Logging level (for logging/setLevel method)",
      (value: string) => {
        if (!validLogLevels.includes(value as LoggingLevel)) {
          throw new Error(
            `Invalid log level: ${value}. Valid levels are: ${validLogLevels.join(", ")}`,
          );
        }
        return value as LoggingLevel;
      },
    )
    .option("--cwd <path>", "Working directory for stdio server process")
    .option(
      "--transport <type>",
      "Transport type (sse, http, or stdio). Auto-detected from URL: /mcp → http, /sse → sse, commands → stdio",
      (value: string) => {
        const validTransports = ["sse", "http", "stdio"];
        if (!validTransports.includes(value)) {
          throw new Error(
            `Invalid transport type: ${value}. Valid types are: ${validTransports.join(", ")}`,
          );
        }
        return value as "sse" | "http" | "stdio";
      },
    )
    .option("--server-url <url>", "Server URL for SSE/HTTP transport")
    .option(
      "--header <headers...>",
      'HTTP headers as "HeaderName: Value" pairs (for HTTP/SSE transports)',
      parseHeaderPair,
      {},
    )
    .option(
      "--metadata <pairs...>",
      "General metadata as key=value pairs (applied to all methods)",
      parseKeyValuePair,
      {},
    )
    .option(
      "--tool-metadata <pairs...>",
      "Tool-specific metadata as key=value pairs (for tools/call method only)",
      parseKeyValuePair,
      {},
    )
    .option(
      "--app-info",
      "Probe the tool's MCP App UI metadata (resourceUri, csp, permissions, domain) and emit it as one JSON line; exit 2 when the tool has no app. Use with --method tools/call --tool-name <name> (the tool itself is not invoked) or --method tools/list (one NDJSON line per tool).",
    )
    .option(
      "--connect-timeout <ms>",
      `Connection timeout in ms (default ${DEFAULT_CONNECT_TIMEOUT_MS} for ad-hoc --server-url / target invocations; 0 = no timeout).`,
      (v: string) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--connect-timeout must be a non-negative number.`);
        }
        return n;
      },
    )
    .option(
      "--format <format>",
      "Output format: text (default; pretty-printed) or json (one JSON object on stdout, no banners).",
      (v: string): OutputFormat => {
        if (v !== "text" && v !== "json") {
          throw new Error(`--format must be 'text' or 'json'.`);
        }
        return v;
      },
    )
    .option(
      "--tool-args-json <json>",
      'Tool arguments as a single JSON object (e.g. \'{"zip":"10001"}\'). Values are passed verbatim — no key=value coercion. Mutually exclusive with --tool-arg.',
    )
    .option(
      "--client-config <path>",
      "Install-level client config (default: ~/.mcp-inspector/storage/client.json, or MCP_CLIENT_CONFIG_PATH)",
    )
    .option(
      "--client-id <id>",
      "OAuth client ID (static client) for HTTP servers",
    )
    .option(
      "--client-secret <secret>",
      "OAuth client secret (for confidential clients)",
    )
    .option(
      "--client-metadata-url <url>",
      "OAuth Client ID Metadata Document URL (CIMD) for HTTP servers",
    )
    .option(
      "--callback-url <url>",
      `OAuth redirect/callback listener URL (default: ${DEFAULT_RUNNER_OAUTH_CALLBACK_URL}, or MCP_OAUTH_CALLBACK_URL)`,
    )
    .option(
      "--use-stored-auth",
      "Read the OAuth access token for --server-url from the OAuth state file (written by the web inspector) and inject it as Authorization: Bearer.",
    )
    .option(
      "--wait-for-auth <sec>",
      "Poll the OAuth state file until a token for --server-url appears (or the timeout elapses), then proceed as if --use-stored-auth were set. Use after handing off to a human to complete OAuth in a browser.",
      (v: string) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(
            `--wait-for-auth must be a positive number of seconds.`,
          );
        }
        return n;
      },
    )
    .option(
      "--list-stored-auth",
      "Print the server URLs that have a stored OAuth token (one JSON object on stdout) and exit. No server connection is made.",
    )
    .option(
      "--print-handoff",
      "Print a JSON handoff block (deepLink, portForwardCmd, oauthStatePath, apiToken) for --server-url and exit. No server connection is made.",
    );

  program.parse(preArgs);

  const options = program.opts() as {
    catalog?: string;
    config?: string;
    server?: string;
    e?: Record<string, string>;
    method?: string;
    toolName?: string;
    toolArg?: Record<string, JsonValue>;
    uri?: string;
    promptName?: string;
    promptArgs?: Record<string, JsonValue>;
    logLevel?: LoggingLevel;
    metadata?: Record<string, JsonValue>;
    toolMetadata?: Record<string, JsonValue>;
    cwd?: string;
    transport?: "sse" | "http" | "stdio";
    serverUrl?: string;
    header?: Record<string, string>;
    appInfo?: boolean;
    connectTimeout?: number;
    format?: OutputFormat;
    toolArgsJson?: string;
    clientConfig?: string;
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    callbackUrl?: string;
    useStoredAuth?: boolean;
    waitForAuth?: number;
    listStoredAuth?: boolean;
    printHandoff?: boolean;
  };

  // State-path precedence (getStateFilePath): MCP_INSPECTOR_OAUTH_STATE_PATH →
  // <MCP_STORAGE_DIR>/oauth.json → ~/.mcp-inspector/storage/oauth.json — the
  // same file the web backend writes, so tokens are shared across surfaces.
  const oauthStatePath = getStateFilePath();

  // Short-circuit modes that need no server connection.
  if (options.listStoredAuth) {
    const servers = await readOAuthServers(oauthStatePath);
    const withToken = Object.entries(servers)
      .filter(([, v]) => Boolean(v.tokens?.access_token))
      .map(([k]) => k);
    await awaitableLog(
      JSON.stringify({ oauthStatePath, storedServerUrls: withToken }) + "\n",
    );
    return { shortCircuit: true };
  }
  if (options.printHandoff) {
    if (!options.serverUrl) {
      throw new Error("--print-handoff requires --server-url");
    }
    await awaitableLog(
      JSON.stringify(buildHandoff(options.serverUrl, oauthStatePath)) + "\n",
    );
    return { shortCircuit: true };
  }

  // Honour MCP_CATALOG_PATH only when no ad-hoc target is given. Applying it
  // unconditionally meant a homespace that exports the env var could never run
  // `--server-url …` (serverSourceConflict rejects catalog + ad-hoc).
  const adHoc =
    targetArgs.length > 0 ||
    Boolean(options.transport) ||
    Boolean(options.serverUrl?.trim());
  const envCatalog = adHoc ? undefined : process.env.MCP_CATALOG_PATH;

  const serverOptions = {
    // `?.trim() ||` (not `??`) so an explicit empty `--catalog ""` still falls
    // back to MCP_CATALOG_PATH — keeps CLI and TUI flag resolution identical.
    catalogPath: options.catalog?.trim() || envCatalog,
    configPath: options.config?.trim() || undefined,
    target: targetArgs.length > 0 ? targetArgs : undefined,
    transport: options.transport,
    serverUrl: options.serverUrl,
    cwd: options.cwd,
    env: options.e,
    // `--header` is merged into the resolved server's settings (overriding any
    // file-level headers); file timeouts/OAuth are preserved. See #1482.
    headers: options.header as Record<string, string> | undefined,
  };

  if (options.waitForAuth !== undefined || options.useStoredAuth) {
    if (!options.serverUrl) {
      throw new Error(
        `${options.waitForAuth !== undefined ? "--wait-for-auth" : "--use-stored-auth"} requires --server-url`,
      );
    }
    // Read the OAuth state file directly so the lookup is normalised the same
    // way the web inspector wrote it (`new URL().href`), and so `--wait-for-
    // auth` sees fresh on-disk state on each poll. When a `refresh_token` is
    // stored, the CLI runs the SDK refresh grant and injects the fresh access
    // token (persisting the rotation) rather than blindly injecting a possibly-
    // stale stored access token (#1665) — the stored blob carries no expiry, so
    // the refresh token is the durable credential. Without a refresh token it
    // falls back to injecting the stored access token; a stale one surfaces as
    // HTTP 401 → exit 3 (auth_required).
    let token: string;
    if (options.waitForAuth !== undefined) {
      token = await waitForStoredToken(
        options.serverUrl,
        oauthStatePath,
        options.waitForAuth,
      );
    } else {
      const servers = await readOAuthServers(oauthStatePath);
      const stored = findStoredServerState(servers, options.serverUrl);
      if (stored?.state.tokens?.refresh_token) {
        token = await refreshStoredAuthToken(options.serverUrl, oauthStatePath);
      } else {
        const found = findStoredToken(servers, options.serverUrl);
        if (!found) {
          const key = normalizeServerUrl(options.serverUrl);
          const storedKeys = Object.keys(servers);
          throw new CliExitCodeError(
            EXIT_CODES.AUTH_REQUIRED,
            `No stored OAuth token for ${key} in ${oauthStatePath}. Complete the OAuth flow in the web inspector first.` +
              (storedKeys.length > 0
                ? ` Stored keys: ${storedKeys.join(", ")}.`
                : ""),
            { code: "no_stored_token", url: options.serverUrl },
          );
        }
        token = found;
      }
    }
    serverOptions.headers = {
      ...(serverOptions.headers ?? {}),
      Authorization: `Bearer ${token}`,
    };
  }

  // Shared with the TUI: resolves the catalog/config source (or ad-hoc target),
  // enforces the conflict matrix, and lifts disk headers/timeouts/OAuth into
  // per-server settings. `--server` selects one when the file has several.
  const entries = await loadServerEntries(serverOptions);
  const selected = selectServerEntry(entries, options.server);
  const serverConfig = selected.config;
  // Ad-hoc invocations get a default connect timeout so a black-holed host
  // fails fast; catalog/config runs keep their file-level timeout unless
  // `--connect-timeout` is passed explicitly.
  const serverSettings = withConnectTimeout(
    selected.settings,
    options.connectTimeout ?? (adHoc ? DEFAULT_CONNECT_TIMEOUT_MS : undefined),
  );

  if (!options.method) {
    throw new Error(
      "Method is required. Use --method to specify the method to invoke.",
    );
  }

  if (
    options.appInfo &&
    options.method !== "tools/call" &&
    options.method !== "tools/list"
  ) {
    throw new Error(
      "--app-info requires --method tools/call (with --tool-name) or --method tools/list.",
    );
  }

  // --tool-args-json passes arguments verbatim with no key=value coercion (so
  // `"012"` stays a string and nested objects work without shell escaping).
  let toolArg = options.toolArg;
  if (options.toolArgsJson !== undefined) {
    if (toolArg && Object.keys(toolArg).length > 0) {
      throw new Error(
        "--tool-args-json cannot be combined with --tool-arg; pick one.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.toolArgsJson);
    } catch (e) {
      throw new Error(
        `--tool-args-json is not valid JSON: ${(e as Error).message}`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("--tool-args-json must be a JSON object.");
    }
    toolArg = parsed as Record<string, JsonValue>;
  }

  const methodArgs: MethodArgs & { method: string } = {
    method: options.method,
    toolName: options.toolName,
    toolArg,
    uri: options.uri,
    promptName: options.promptName,
    promptArgs: options.promptArgs,
    logLevel: options.logLevel,
    metadata: options.metadata
      ? Object.fromEntries(
          Object.entries(options.metadata).map(([key, value]) => [
            key,
            String(value),
          ]),
        )
      : undefined,
    toolMeta: options.toolMetadata
      ? Object.fromEntries(
          Object.entries(options.toolMetadata).map(([key, value]) => [
            key,
            String(value),
          ]),
        )
      : undefined,
    appInfo: options.appInfo === true,
    format: options.format,
  };

  return {
    serverConfig,
    serverSettings,
    methodArgs,
    clientConfigPath: options.clientConfig,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    clientMetadataUrl: options.clientMetadataUrl,
    callbackUrl: options.callbackUrl,
  };
}

export async function runCli(argv?: string[]): Promise<void> {
  const parsed = await parseArgs(argv ?? process.argv);
  // `--list-stored-auth` / `--print-handoff` already wrote their output.
  if (parsed.shortCircuit) return;
  const {
    serverConfig,
    serverSettings,
    methodArgs,
    clientConfigPath,
    clientId,
    clientSecret,
    clientMetadataUrl,
    callbackUrl,
  } = parsed;
  const clientConfig = await loadRunnerClientConfig({ clientConfigPath });
  const callbackUrlConfig = parseRunnerOAuthCallbackUrl(callbackUrl);
  await callMethod(
    serverConfig,
    serverSettings,
    methodArgs,
    clientConfig,
    {
      clientId,
      clientSecret,
      clientMetadataUrl,
    },
    callbackUrlConfig,
  );
}
