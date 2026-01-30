#!/usr/bin/env node

import * as fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Command } from "commander";
import {
  callTool,
  clearCapturedLogs,
  connect,
  disconnect,
  getCapturedLogs,
  getPrompt,
  listPrompts,
  listResources,
  listResourceTemplates,
  listTools,
  LogLevel,
  McpResponse,
  readResource,
  setLoggingLevel,
  validLogLevels,
} from "./client/index.js";
import { discover } from "./discover.js";
import { handleError } from "./error-handler.js";
import {
  categorizeError,
  formatStructuredOutput,
  StructuredCliError,
  type StructuredOutput,
} from "./output.js";
import { createTransport, TransportOptions } from "./transport.js";
import { awaitableLog } from "./utils/awaitable-log.js";

// JSON value type for CLI arguments
type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

type Args = {
  target: string[];
  method?: string;
  promptName?: string;
  promptArgs?: Record<string, JsonValue>;
  uri?: string;
  logLevel?: LogLevel;
  toolName?: string;
  toolArg?: Record<string, JsonValue>;
  toolMeta?: Record<string, string>;
  transport?: "sse" | "stdio" | "http";
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  structured?: boolean;
  failOnError?: boolean;
};

// Map of methods to their required server capability key
const METHOD_CAPABILITY_MAP: Record<string, string> = {
  "tools/list": "tools",
  "tools/call": "tools",
  "resources/list": "resources",
  "resources/read": "resources",
  "resources/templates/list": "resources",
  "prompts/list": "prompts",
  "prompts/get": "prompts",
  "logging/setLevel": "logging",
};

function createTransportOptions(
  target: string[],
  transport?: "sse" | "stdio" | "http",
  headers?: Record<string, string>,
): TransportOptions {
  if (target.length === 0) {
    throw new Error(
      "Target is required. Specify a URL or a command to execute.",
    );
  }

  const [command, ...commandArgs] = target;

  if (!command) {
    throw new Error("Command is required.");
  }

  const isUrl = command.startsWith("http://") || command.startsWith("https://");

  if (isUrl && commandArgs.length > 0) {
    throw new Error("Arguments cannot be passed to a URL-based MCP server.");
  }

  let transportType: "sse" | "stdio" | "http";
  if (transport) {
    if (!isUrl && transport !== "stdio") {
      throw new Error("Only stdio transport can be used with local commands.");
    }
    if (isUrl && transport === "stdio") {
      throw new Error("stdio transport cannot be used with URLs.");
    }
    transportType = transport;
  } else if (isUrl) {
    const url = new URL(command);
    if (url.pathname.endsWith("/mcp")) {
      transportType = "http";
    } else if (url.pathname.endsWith("/sse")) {
      transportType = "sse";
    } else {
      transportType = "sse";
    }
  } else {
    transportType = "stdio";
  }

  return {
    transportType,
    command: isUrl ? undefined : command,
    args: isUrl ? undefined : commandArgs,
    url: isUrl ? command : undefined,
    headers,
  };
}

function checkCapability(client: Client, method: string): void {
  const requiredCapability = METHOD_CAPABILITY_MAP[method];
  if (!requiredCapability) {
    return; // discover, ping have no capability requirement
  }

  const capabilities = client.getServerCapabilities() ?? {};
  if (!(capabilities as Record<string, unknown>)[requiredCapability]) {
    throw new StructuredCliError(
      `Server does not support ${requiredCapability} capability (required for ${method})`,
      "capability",
    );
  }
}

async function callMethod(args: Args): Promise<void> {
  clearCapturedLogs();
  const startTime = Date.now();

  // Read package.json to get name and version for client identity
  const pathA = "../package.json"; // We're in package @modelcontextprotocol/inspector-cli
  const pathB = "../../package.json"; // We're in package @modelcontextprotocol/inspector
  let packageJson: { name: string; version: string };
  let packageJsonData = await import(fs.existsSync(pathA) ? pathA : pathB, {
    with: { type: "json" },
  });
  packageJson = packageJsonData.default;

  const transportOptions = createTransportOptions(
    args.target,
    args.transport,
    args.headers,
  );
  const transport = createTransport(transportOptions);

  const [, name = packageJson.name] = packageJson.name.split("/");
  const version = packageJson.version;
  const clientIdentity = { name, version };

  const client = new Client(clientIdentity);

  let result: McpResponse;
  let hasApplicationError = false;

  try {
    await connect(client, transport);

    // Capability gating: verify server supports this method
    checkCapability(client, args.method!);

    // Tools methods
    if (args.method === "tools/list") {
      result = await listTools(client, args.metadata);
    } else if (args.method === "tools/call") {
      if (!args.toolName) {
        throw new StructuredCliError(
          "Tool name is required for tools/call method. Use --tool-name to specify the tool name.",
          "validation",
        );
      }

      result = await callTool(
        client,
        args.toolName,
        args.toolArg || {},
        args.metadata,
        args.toolMeta,
      );
      // Check if the tool returned an application-level error
      if (result.isError) {
        hasApplicationError = true;
      }
    }
    // Resources methods
    else if (args.method === "resources/list") {
      result = await listResources(client, args.metadata);
    } else if (args.method === "resources/read") {
      if (!args.uri) {
        throw new StructuredCliError(
          "URI is required for resources/read method. Use --uri to specify the resource URI.",
          "validation",
        );
      }

      result = await readResource(client, args.uri, args.metadata);
    } else if (args.method === "resources/templates/list") {
      result = await listResourceTemplates(client, args.metadata);
    }
    // Prompts methods
    else if (args.method === "prompts/list") {
      result = await listPrompts(client, args.metadata);
    } else if (args.method === "prompts/get") {
      if (!args.promptName) {
        throw new StructuredCliError(
          "Prompt name is required for prompts/get method. Use --prompt-name to specify the prompt name.",
          "validation",
        );
      }

      result = await getPrompt(
        client,
        args.promptName,
        args.promptArgs || {},
        args.metadata,
      );
    }
    // Logging methods
    else if (args.method === "logging/setLevel") {
      if (!args.logLevel) {
        throw new StructuredCliError(
          "Log level is required for logging/setLevel method. Use --log-level to specify the log level.",
          "validation",
        );
      }

      result = await setLoggingLevel(client, args.logLevel);
    }
    // Discovery pseudo-method
    else if (args.method === "discover") {
      result = (await discover(client)) as unknown as McpResponse;
    }
    // Ping method
    else if (args.method === "ping") {
      result = await client.ping();
    } else {
      throw new StructuredCliError(
        `Unsupported method: ${args.method}. Supported methods include: tools/list, tools/call, resources/list, resources/read, resources/templates/list, prompts/list, prompts/get, logging/setLevel, discover, ping`,
        "validation",
      );
    }

    const durationMs = Date.now() - startTime;
    const logs = getCapturedLogs();

    if (args.structured) {
      const output: StructuredOutput = {
        structuredVersion: 1,
        success: !hasApplicationError,
        method: args.method!,
        durationMs,
        result: result as Record<string, unknown>,
        error: null,
        logs,
      };
      await awaitableLog(formatStructuredOutput(output));
    } else {
      // Raw mode: emit logs to stderr, result to stdout
      for (const log of logs) {
        console.error(
          `[${log.timestamp}] [${log.level}]${log.logger ? ` [${log.logger}]` : ""} ${log.message}`,
        );
      }
      await awaitableLog(JSON.stringify(result, null, 2));
    }

    if (args.failOnError && hasApplicationError) {
      process.exit(1);
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const logs = getCapturedLogs();

    if (args.structured) {
      const structuredError = categorizeError(error);
      const output: StructuredOutput = {
        structuredVersion: 1,
        success: false,
        method: args.method ?? "unknown",
        durationMs,
        result: null,
        error: structuredError,
        logs,
      };
      await awaitableLog(formatStructuredOutput(output));
      process.exit(1);
    } else {
      throw error;
    }
  } finally {
    try {
      await disconnect(transport);
    } catch (disconnectError) {
      throw disconnectError;
    }
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

  // Try to parse as JSON first
  let parsedValue: JsonValue;
  try {
    parsedValue = JSON.parse(val) as JsonValue;
  } catch {
    // If JSON parsing fails, keep as string
    parsedValue = val;
  }

  return { ...previous, [key as string]: parsedValue };
}

function parseHeaderPair(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const colonIndex = value.indexOf(":");

  if (colonIndex === -1) {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`,
    );
  }

  const key = value.slice(0, colonIndex).trim();
  const val = value.slice(colonIndex + 1).trim();

  if (key === "" || val === "") {
    throw new Error(
      `Invalid header format: ${value}. Use "HeaderName: Value" format.`,
    );
  }

  return { ...previous, [key]: val };
}

function parseArgs(): Args {
  const program = new Command();

  // Find if there's a -- in the arguments and split them
  const argSeparatorIndex = process.argv.indexOf("--");
  let preArgs = process.argv;
  let postArgs: string[] = [];

  if (argSeparatorIndex !== -1) {
    preArgs = process.argv.slice(0, argSeparatorIndex);
    postArgs = process.argv.slice(argSeparatorIndex + 1);
  }

  program
    .name("inspector-cli")
    .allowUnknownOption()
    .argument("<target...>", "Command and arguments or URL of the MCP server")
    //
    // Method selection
    //
    .option("--method <method>", "Method to invoke")
    //
    // Tool-related options
    //
    .option("--tool-name <toolName>", "Tool name (for tools/call method)")
    .option(
      "--tool-arg <pairs...>",
      "Tool argument as key=value pair",
      parseKeyValuePair,
      {},
    )
    //
    // Resource-related options
    //
    .option("--uri <uri>", "URI of the resource (for resources/read method)")
    //
    // Prompt-related options
    //
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
    //
    // Logging options
    //
    .option(
      "--log-level <level>",
      "Logging level (for logging/setLevel method)",
      (value: string) => {
        if (!validLogLevels.includes(value as any)) {
          throw new Error(
            `Invalid log level: ${value}. Valid levels are: ${validLogLevels.join(", ")}`,
          );
        }

        return value as LogLevel;
      },
    )
    //
    // Transport options
    //
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
    //
    // HTTP headers
    //
    .option(
      "--header <headers...>",
      'HTTP headers as "HeaderName: Value" pairs (for HTTP/SSE transports)',
      parseHeaderPair,
      {},
    )
    //
    // Metadata options
    //
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
    //
    // CI debugging output options
    //
    .option(
      "--structured",
      "Output structured envelope with error taxonomy, logs, and timing",
    )
    .option(
      "--fail-on-error",
      "Exit with code 1 on server-side application errors (isError: true)",
    );

  // Parse only the arguments before --
  program.parse(preArgs);

  const options = program.opts() as Omit<Args, "target"> & {
    header?: Record<string, string>;
    metadata?: Record<string, JsonValue>;
    toolMetadata?: Record<string, JsonValue>;
  };

  let remainingArgs = program.args;

  // Add back any arguments that came after --
  const finalArgs = [...remainingArgs, ...postArgs];

  if (!options.method) {
    throw new Error(
      "Method is required. Use --method to specify the method to invoke.",
    );
  }

  return {
    target: finalArgs,
    ...options,
    headers: options.header, // commander.js uses 'header' field, map to 'headers'
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
}

async function main(): Promise<void> {
  process.on("uncaughtException", (error) => {
    handleError(error);
  });

  try {
    const args = parseArgs();
    await callMethod(args);

    // Explicitly exit to ensure process terminates in CI
    process.exit(0);
  } catch (error) {
    handleError(error);
  }
}

main();
