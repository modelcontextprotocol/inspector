import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Command } from "commander";
type McpResponse = Record<string, unknown>;
import { awaitableLog } from "./utils/awaitable-log.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
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
import { CliExitCodeError, EXIT_CODES } from "./error-handler.js";
import {
  LoggingLevelSchema,
  type LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";

export const validLogLevels: LoggingLevel[] = Object.values(
  LoggingLevelSchema.enum,
);

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
 * Default connect timeout (ms) for ad-hoc server invocations. Without this an
 * unreachable server (e.g. a partner edge that drops the SYN) hangs the CLI
 * indefinitely; the value is generous enough for cold-start OAuth discovery
 * round-trips while still failing fast on a black-holed host.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

async function callMethod(
  serverConfig: MCPServerConfig,
  serverSettings: InspectorServerSettings | undefined,
  args: MethodArgs & { method: string },
): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = join(__dirname, "../package.json");
  const packageJsonData = await import(pathToFileURL(packageJsonPath).href, {
    with: { type: "json" },
  });
  const packageJson = packageJsonData.default as {
    name: string;
    version: string;
  };

  const [, name = packageJson.name] = packageJson.name.split("/");
  const version = packageJson.version;
  const clientIdentity = { name, version };

  const inspectorClient = new InspectorClient(serverConfig, {
    environment: {
      transport: createTransportNode,
    },
    clientIdentity,
    initialLoggingLevel: "debug",
    progress: false,
    sample: false,
    elicit: false,
    serverSettings,
  });

  let managedToolsState: ManagedToolsState | null = null;
  let managedResourcesState: ManagedResourcesState | null = null;
  let managedResourceTemplatesState: ManagedResourceTemplatesState | null =
    null;
  let managedPromptsState: ManagedPromptsState | null = null;

  try {
    await inspectorClient.connect();

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
      result = { tools: managedToolsState!.getTools() };
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
      } else {
        appInfo = await collectAppInfo(inspectorClient, tool, args.metadata);
        if (args.appInfo) {
          // --app-info: probe-only — emit the app metadata and skip the tool
          // call entirely. The result is the AppInfo block; the no-app exit
          // code is handled after disconnect below.
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

    await emitResult(result, appInfo, args);
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
async function emitResult(
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
    await awaitableLog(JSON.stringify(result, null, 2));
    if (appInfo?.hasApp) {
      await awaitableLog("\n--- MCP App Info ---\n");
      await awaitableLog(JSON.stringify(appInfo, null, 2) + "\n");
    }
  }

  // A tool that returned `isError:true` (or whose call failed) is still
  // printed above so the caller sees the payload, but the process exits
  // TOOL_ERROR so `&&` chains don't proceed on a failed call.
  if ((result as { isError?: unknown }).isError === true) {
    throw new CliExitCodeError(
      EXIT_CODES.TOOL_ERROR,
      `Tool '${args.toolName}' returned isError:true.`,
      { code: "tool_is_error" },
    );
  }
}

/**
 * {@link AppInfo} plus a CLI-only `resourceError` so a `resources/read` failure
 * during the probe is reported instead of being silently swallowed (which would
 * make "no CSP declared" indistinguishable from "resource unreadable").
 */
type CliAppInfo = AppInfo & { resourceError?: string };

/**
 * Build the CLI's app-info for a tool: extract the tool-side `_meta.ui` and,
 * when the tool advertises a UI resource, follow it with a `resources/read` so
 * the resource-side csp/permissions/domain are included. A read failure is
 * tolerated — the tool-side info is still returned with `resourceError` set,
 * since "tool says it has an app but the resource is unreadable" is itself a
 * useful probe result.
 */
async function collectAppInfo(
  client: InspectorClient,
  tool: Parameters<typeof extractAppInfo>[0],
  metadata: Record<string, string> | undefined,
): Promise<CliAppInfo> {
  const base = extractAppInfo(tool);
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
 * OAuth state (`new URL().href` lowercases the host, normalises the scheme,
 * and adds a trailing `/` for bare-origin URLs). The CLI must look up by the
 * same key the web side wrote, so a trailing-slash or case mismatch doesn't
 * miss a token that's sitting one key over.
 *
 * TODO: dedupe with `core/auth/store.ts` once that module exports the same
 * normaliser.
 */
export function normalizeServerUrl(serverUrl: string): string {
  try {
    return new URL(serverUrl).href;
  } catch {
    return serverUrl;
  }
}

/**
 * Resolve the path to the OAuth state file. Precedence:
 *  1. `MCP_INSPECTOR_OAUTH_STATE_PATH` (deprecated; kept for tests/scripts that
 *     already pin to a fixture file)
 *  2. `<MCP_STORAGE_DIR>/oauth.json` — `MCP_STORAGE_DIR` is what the web
 *     backend honours, so setting it once points both sides at the same file
 *  3. `~/.mcp-inspector/storage/oauth.json` (the default)
 */
export function resolveOAuthStatePath(): string {
  const explicit = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
  if (explicit) return explicit;
  const dir = process.env.MCP_STORAGE_DIR;
  if (dir) return join(dir, "oauth.json");
  // Fall through to NodeOAuthStorage's own default; the function in
  // `core/auth/node/storage-node.ts` has the same `~/.mcp-inspector/storage`
  // resolution. Returning an explicit path here lets `--list-stored-auth` and
  // `--print-handoff` report the actual file location.
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return join(home, ".mcp-inspector", "storage", "oauth.json");
}

/** Shape of the Zustand-persist blob the OAuth store writes to disk. */
type PersistedOAuthBlob = {
  state?: {
    servers?: Record<string, { tokens?: { access_token?: string } }>;
  };
};

/**
 * Read the OAuth state file directly (bypassing the Zustand store cache) so
 * each call sees the current on-disk state. Returns the `servers` map, or an
 * empty object when the file is absent or unreadable.
 */
async function readOAuthServers(
  statePath: string,
): Promise<NonNullable<NonNullable<PersistedOAuthBlob["state"]>["servers"]>> {
  const { readFile } = await import("node:fs/promises");
  try {
    const text = await readFile(statePath, "utf8");
    const blob = JSON.parse(text) as PersistedOAuthBlob;
    return blob.state?.servers ?? {};
  } catch {
    return {};
  }
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
    const token =
      servers[key]?.tokens?.access_token ??
      servers[serverUrl]?.tokens?.access_token;
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
 * to relay to a human so they can complete OAuth via port-forward and have the
 * token land where the CLI will find it.
 */
function buildHandoff(serverUrl: string, statePath: string): McpResponse {
  const host = process.env.HOST || "127.0.0.1";
  const clientPort = process.env.CLIENT_PORT || "6274";
  const sandboxPort = process.env.MCP_SANDBOX_PORT || "6275";
  const apiToken = process.env.MCP_INSPECTOR_API_TOKEN;
  const params = new URLSearchParams({
    serverUrl,
    transport: "http",
  });
  if (apiToken) params.set("autoConnect", apiToken);
  return {
    serverUrl: normalizeServerUrl(serverUrl),
    deepLink: `http://${host}:${clientPort}/?${params.toString()}`,
    portForwardCmd: `coder port-forward <workspace> --tcp ${clientPort}:${clientPort} --tcp ${sandboxPort}:${sandboxPort}`,
    oauthStatePath: statePath,
    apiToken: apiToken ?? null,
    note:
      apiToken === undefined
        ? "MCP_INSPECTOR_API_TOKEN is not set; deep-link autoConnect gate will reject — launch the web inspector with a known token first."
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
function withConnectTimeout(
  settings: InspectorServerSettings | undefined,
  connectionTimeout: number | undefined,
): InspectorServerSettings | undefined {
  if (connectionTimeout === undefined) return settings;
  if (settings) return { ...settings, connectionTimeout };
  return {
    headers: [],
    metadata: [],
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
      "Probe the tool's MCP App UI metadata (resourceUri, csp, permissions, domain) and emit it as one JSON line; exit 2 when the tool has no app. Use with --method tools/call --tool-name <name>; the tool itself is not invoked.",
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
      "--use-stored-auth",
      "Read the OAuth access token for --server-url from the OAuth state file (written by the web inspector) and inject it as Authorization: Bearer.",
    )
    .option(
      "--wait-for-auth <sec>",
      "Poll the OAuth state file until a token for --server-url appears (or the timeout elapses), then proceed as if --use-stored-auth were set. Use after handing off to a human to complete OAuth via port-forward.",
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
      "Print the server URLs that have a stored OAuth token (one JSON array on stdout) and exit. No server connection is made.",
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
    useStoredAuth?: boolean;
    connectTimeout?: number;
    format?: OutputFormat;
    toolArgsJson?: string;
    waitForAuth?: number;
    listStoredAuth?: boolean;
    printHandoff?: boolean;
  };

  const oauthStatePath = resolveOAuthStatePath();

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

  const serverOptions = {
    // `?.trim() ||` (not `??`) so an explicit empty `--catalog ""` still falls
    // back to MCP_CATALOG_PATH — keeps CLI and TUI flag resolution identical.
    catalogPath: options.catalog?.trim() || process.env.MCP_CATALOG_PATH,
    configPath: options.config?.trim() || undefined,
    target: targetArgs.length > 0 ? targetArgs : undefined,
    transport: options.transport,
    serverUrl: options.serverUrl,
    cwd: options.cwd,
    env: options.e,
    // `--header` is merged into the resolved server's settings (overriding any
    // file-level headers); file timeouts/OAuth are preserved. See #1482.
    headers: options.header,
  };

  if (options.waitForAuth !== undefined || options.useStoredAuth) {
    if (!options.serverUrl) {
      throw new Error(
        `${options.waitForAuth !== undefined ? "--wait-for-auth" : "--use-stored-auth"} requires --server-url`,
      );
    }
    // Read the OAuth state file directly so the lookup is normalised the same
    // way the web inspector wrote it (`new URL().href`), and so `--wait-for-
    // auth` sees fresh on-disk state on each poll. Header injection is the
    // prototype path — wiring NodeOAuthStorage into the SDK auth provider (so
    // refresh works) is a follow-up.
    let token: string | undefined;
    if (options.waitForAuth !== undefined) {
      token = await waitForStoredToken(
        options.serverUrl,
        oauthStatePath,
        options.waitForAuth,
      );
    } else {
      const servers = await readOAuthServers(oauthStatePath);
      const key = normalizeServerUrl(options.serverUrl);
      token =
        servers[key]?.tokens?.access_token ??
        servers[options.serverUrl]?.tokens?.access_token;
      if (!token) {
        const stored = Object.keys(servers);
        throw new CliExitCodeError(
          EXIT_CODES.AUTH_REQUIRED,
          `No stored OAuth token for ${key} in ${oauthStatePath}. Complete the OAuth flow in the web inspector first.` +
            (stored.length > 0 ? ` Stored keys: ${stored.join(", ")}.` : ""),
          { code: "no_stored_token", url: options.serverUrl },
        );
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
  const entries = loadServerEntries(serverOptions);
  const selected = selectServerEntry(entries, options.server);
  const serverConfig = selected.config;
  const adHoc =
    serverOptions.target !== undefined ||
    Boolean(serverOptions.transport) ||
    Boolean(serverOptions.serverUrl);
  const serverSettings = withConnectTimeout(
    selected.settings,
    options.connectTimeout ?? (adHoc ? DEFAULT_CONNECT_TIMEOUT_MS : undefined),
  );

  if (!options.method) {
    throw new Error(
      "Method is required. Use --method to specify the method to invoke.",
    );
  }

  if (options.appInfo && options.method !== "tools/call") {
    throw new Error(
      "--app-info requires --method tools/call (and --tool-name <name>).",
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
  };
}

export async function runCli(argv?: string[]): Promise<void> {
  const parsed = await parseArgs(argv ?? process.argv);
  if (parsed.shortCircuit) return;
  await callMethod(
    parsed.serverConfig,
    parsed.serverSettings,
    parsed.methodArgs,
  );
}
