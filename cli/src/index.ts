#!/usr/bin/env node

import * as fs from "fs";
import { Command } from "commander";
// CLI helper functions moved to InspectorClient methods
type McpResponse = Record<string, unknown>;
import { handleError } from "./error-handler.js";
import { awaitableLog } from "./utils/awaitable-log.js";
import type {
  MCPServerConfig,
  StdioServerConfig,
  SseServerConfig,
  StreamableHttpServerConfig,
} from "@modelcontextprotocol/inspector-shared/mcp/types.js";
import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/inspectorClient.js";
import type { JsonValue } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import {
  LoggingLevelSchema,
  type LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

export const validLogLevels: LoggingLevel[] = Object.values(
  LoggingLevelSchema.enum,
);

type Args = {
  target: string[];
  method?: string;
  promptName?: string;
  promptArgs?: Record<string, JsonValue>;
  uri?: string;
  logLevel?: LoggingLevel;
  toolName?: string;
  toolArg?: Record<string, JsonValue>;
  toolMeta?: Record<string, string>;
  transport?: "sse" | "stdio" | "http";
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
};

/**
 * Converts CLI Args to MCPServerConfig format
 * This will be used to create an InspectorClient
 */
function argsToMcpServerConfig(args: Args): MCPServerConfig {
  if (args.target.length === 0) {
    throw new Error(
      "Target is required. Specify a URL or a command to execute.",
    );
  }

  const [firstTarget, ...targetArgs] = args.target;

  if (!firstTarget) {
    throw new Error("Target is required.");
  }

  const isUrl =
    firstTarget.startsWith("http://") || firstTarget.startsWith("https://");

  // Validation: URLs cannot have additional arguments
  if (isUrl && targetArgs.length > 0) {
    throw new Error("Arguments cannot be passed to a URL-based MCP server.");
  }

  // Validation: Transport/URL combinations
  if (args.transport) {
    if (!isUrl && args.transport !== "stdio") {
      throw new Error("Only stdio transport can be used with local commands.");
    }
    if (isUrl && args.transport === "stdio") {
      throw new Error("stdio transport cannot be used with URLs.");
    }
  }

  // Handle URL-based transports (SSE or streamable-http)
  if (isUrl) {
    const url = new URL(firstTarget);

    // Determine transport type
    let transportType: "sse" | "streamable-http";
    if (args.transport) {
      // Convert CLI's "http" to "streamable-http"
      if (args.transport === "http") {
        transportType = "streamable-http";
      } else if (args.transport === "sse") {
        transportType = "sse";
      } else {
        // Should not happen due to validation above, but default to SSE
        transportType = "sse";
      }
    } else {
      // Auto-detect from URL path
      if (url.pathname.endsWith("/mcp")) {
        transportType = "streamable-http";
      } else if (url.pathname.endsWith("/sse")) {
        transportType = "sse";
      } else {
        // Default to SSE if path doesn't match known patterns
        transportType = "sse";
      }
    }

    // Create SSE or streamable-http config
    if (transportType === "sse") {
      const config: SseServerConfig = {
        type: "sse",
        url: firstTarget,
      };
      if (args.headers) {
        config.headers = args.headers;
      }
      return config;
    } else {
      const config: StreamableHttpServerConfig = {
        type: "streamable-http",
        url: firstTarget,
      };
      if (args.headers) {
        config.headers = args.headers;
      }
      return config;
    }
  }

  // Handle stdio transport (command-based)
  const config: StdioServerConfig = {
    type: "stdio",
    command: firstTarget,
  };

  if (targetArgs.length > 0) {
    config.args = targetArgs;
  }

  const processEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      processEnv[key] = value;
    }
  }

  const defaultEnv = getDefaultEnvironment();

  const env: Record<string, string> = {
    ...defaultEnv,
    ...processEnv,
  };

  config.env = env;

  return config;
}

async function callMethod(args: Args): Promise<void> {
  // Read package.json to get name and version for client identity
  const pathA = "../package.json"; // We're in package @modelcontextprotocol/inspector-cli
  const pathB = "../../package.json"; // We're in package @modelcontextprotocol/inspector
  let packageJson: { name: string; version: string };
  let packageJsonData = await import(fs.existsSync(pathA) ? pathA : pathB, {
    with: { type: "json" },
  });
  packageJson = packageJsonData.default;

  const [, name = packageJson.name] = packageJson.name.split("/");
  const version = packageJson.version;
  const clientIdentity = { name, version };

  const inspectorClient = new InspectorClient(argsToMcpServerConfig(args), {
    clientIdentity,
    autoFetchServerContents: false, // CLI doesn't need auto-fetching, it calls methods directly
    initialLoggingLevel: "debug", // Set debug logging level for CLI
    sample: false, // CLI doesn't need sampling capability
    elicit: false, // CLI doesn't need elicitation capability
  });

  try {
    await inspectorClient.connect();

    let result: McpResponse;

    // Tools methods
    if (args.method === "tools/list") {
      result = { tools: await inspectorClient.listAllTools(args.metadata) };
    } else if (args.method === "tools/call") {
      if (!args.toolName) {
        throw new Error(
          "Tool name is required for tools/call method. Use --tool-name to specify the tool name.",
        );
      }

      const invocation = await inspectorClient.callTool(
        args.toolName,
        args.toolArg || {},
        args.metadata,
        args.toolMeta,
      );
      // Extract the result from the invocation object for CLI compatibility
      if (invocation.result !== null) {
        // Success case: result is a valid CallToolResult
        result = invocation.result;
      } else {
        // Error case: construct an error response matching CallToolResult structure
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
    // Resources methods
    else if (args.method === "resources/list") {
      result = {
        resources: await inspectorClient.listAllResources(args.metadata),
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
      // Extract the result from the invocation object for CLI compatibility
      result = invocation.result;
    } else if (args.method === "resources/templates/list") {
      result = {
        resourceTemplates: await inspectorClient.listAllResourceTemplates(
          args.metadata,
        ),
      };
    }
    // Prompts methods
    else if (args.method === "prompts/list") {
      result = { prompts: await inspectorClient.listAllPrompts(args.metadata) };
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
      // Extract the result from the invocation object for CLI compatibility
      result = invocation.result;
    }
    // Logging methods
    else if (args.method === "logging/setLevel") {
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
    try {
      await inspectorClient.disconnect();
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
        if (!validLogLevels.includes(value as LoggingLevel)) {
          throw new Error(
            `Invalid log level: ${value}. Valid levels are: ${validLogLevels.join(", ")}`,
          );
        }

        return value as LoggingLevel;
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
