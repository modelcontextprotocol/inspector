import * as fs from "fs";
import { Command } from "commander";
type McpResponse = Record<string, unknown>;
import { handleError } from "./error-handler.js";
import { awaitableLog } from "./utils/awaitable-log.js";
import type { MCPServerConfig } from "@modelcontextprotocol/inspector-core/mcp/types.js";
import { InspectorClient } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import {
  ManagedToolsState,
  ManagedResourcesState,
  ManagedResourceTemplatesState,
  ManagedPromptsState,
} from "@modelcontextprotocol/inspector-core/mcp/state/index.js";
import {
  createTransportNode,
  resolveServerConfigs,
  parseKeyValuePair as parseEnvPair,
  parseHeaderPair,
} from "@modelcontextprotocol/inspector-core/mcp/node/index.js";
import type { JsonValue } from "@modelcontextprotocol/inspector-core/mcp/index.js";
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
};

async function callMethod(
  serverConfig: MCPServerConfig,
  args: MethodArgs & { method: string },
): Promise<void> {
  const pathA = "../package.json";
  const pathB = "../../package.json";
  const packageJsonData = await import(fs.existsSync(pathA) ? pathA : pathB, {
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
  });

  let managedToolsState: ManagedToolsState | null = null;
  let managedResourcesState: ManagedResourcesState | null = null;
  let managedResourceTemplatesState: ManagedResourceTemplatesState | null =
    null;
  let managedPromptsState: ManagedPromptsState | null = null;

  try {
    await inspectorClient.connect();

    let result: McpResponse;

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

    await awaitableLog(JSON.stringify(result, null, 2));
  } finally {
    managedToolsState?.destroy();
    managedResourcesState?.destroy();
    managedResourceTemplatesState?.destroy();
    managedPromptsState?.destroy();
    await inspectorClient.disconnect();
  }
}

function parseKeyValuePair(
  value: string,
  previous: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  const parts = value.split("=");
  const key = parts[0];
  const val = parts.slice(1).join("=");

  if (val === undefined || val === "") {
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
  methodArgs: MethodArgs & { method: string };
} {
  const program = new Command();
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
    .option("--config <path>", "Config file path")
    .option("--server <name>", "Server name from config file")
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
    );

  program.parse(preArgs);

  const options = program.opts() as {
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
  };

  const serverOptions = {
    configPath: options.config,
    serverName: options.server,
    target: targetArgs.length > 0 ? targetArgs : undefined,
    transport: options.transport,
    serverUrl: options.serverUrl,
    cwd: options.cwd,
    env: options.e,
    headers: options.header,
  };

  const configs = resolveServerConfigs(serverOptions, "single");
  const serverConfig = configs[0];
  if (!serverConfig) {
    throw new Error(
      "Could not resolve server config. Specify a URL or command, or use --config and --server.",
    );
  }

  if (!options.method) {
    throw new Error(
      "Method is required. Use --method to specify the method to invoke.",
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
  };

  return { serverConfig, methodArgs };
}

export async function runCli(argv?: string[]): Promise<void> {
  const { serverConfig, methodArgs } = parseArgs(argv ?? process.argv);
  await callMethod(serverConfig, methodArgs);
}

export async function main(): Promise<void> {
  process.on("uncaughtException", (error) => {
    handleError(error);
  });

  try {
    await runCli();
    process.exit(0);
  } catch (error) {
    handleError(error);
  }
}
