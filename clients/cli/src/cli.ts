import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Command } from "commander";
type McpResponse = Record<string, unknown>;
import { awaitableLog } from "./utils/awaitable-log.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
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
import { CliExitCodeError } from "./error-handler.js";
import {
  LoggingLevelSchema,
  type LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";

export const validLogLevels: LoggingLevel[] = Object.values(
  LoggingLevelSchema.enum,
);

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
};

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
    let appInfo: AppInfo | undefined;

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
        result = {
          content: [
            {
              type: "text" as const,
              text: `Tool '${args.toolName}' not found.`,
            },
          ],
          isError: true,
        };
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
        `Unsupported method: ${args.method}. Supported methods include: tools/list, tools/call, resources/list, resources/read, resources/templates/list, prompts/list, prompts/get, logging/setLevel`,
      );
    }

    if (args.appInfo) {
      // Single-line JSON so callers can `| jq` or parse the line directly.
      const info = appInfo ?? { hasApp: false, toolName: args.toolName ?? "" };
      await awaitableLog(JSON.stringify(info) + "\n");
      if (!info.hasApp) {
        throw new CliExitCodeError(
          2,
          `Tool '${args.toolName}' has no MCP App UI resource (_meta.ui.resourceUri).`,
        );
      }
    } else {
      await awaitableLog(JSON.stringify(result, null, 2));
      if (appInfo?.hasApp) {
        await awaitableLog("\n--- MCP App Info ---\n");
        await awaitableLog(JSON.stringify(appInfo, null, 2) + "\n");
      }
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
 * Build the CLI's {@link AppInfo} for a tool: extract the tool-side `_meta.ui`
 * and, when the tool advertises a UI resource, follow it with a `resources/read`
 * so the resource-side csp/permissions/domain are included. A read failure is
 * tolerated — the tool-side info is still returned, since "tool says it has an
 * app but the resource is unreadable" is itself a useful probe result.
 */
async function collectAppInfo(
  client: InspectorClient,
  tool: Parameters<typeof extractAppInfo>[0],
  metadata: Record<string, string> | undefined,
): Promise<AppInfo> {
  const base = extractAppInfo(tool);
  if (!base.hasApp || base.resourceUri === undefined) return base;
  try {
    const read = await client.readResource(base.resourceUri, metadata);
    return extractAppInfo(tool, read.result);
  } catch {
    return base;
  }
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

function parseArgs(argv?: string[]): {
  serverConfig: MCPServerConfig;
  serverSettings: InspectorServerSettings | undefined;
  methodArgs: MethodArgs & { method: string };
} {
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
  };

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

  // Shared with the TUI: resolves the catalog/config source (or ad-hoc target),
  // enforces the conflict matrix, and lifts disk headers/timeouts/OAuth into
  // per-server settings. `--server` selects one when the file has several.
  const entries = loadServerEntries(serverOptions);
  const { config: serverConfig, settings: serverSettings } = selectServerEntry(
    entries,
    options.server,
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

  const methodArgs: MethodArgs & { method: string } = {
    method: options.method,
    toolName: options.toolName,
    toolArg: options.toolArg,
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
  };

  return {
    serverConfig,
    serverSettings,
    methodArgs,
  };
}

export async function runCli(argv?: string[]): Promise<void> {
  const { serverConfig, serverSettings, methodArgs } = parseArgs(
    argv ?? process.argv,
  );
  await callMethod(serverConfig, serverSettings, methodArgs);
}
