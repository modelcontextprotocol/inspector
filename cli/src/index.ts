#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Command } from "commander";
import {
  callTool,
  connect,
  disconnect,
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
import { handleError } from "./error-handler.js";
import { createTransport, TransportOptions } from "./transport.js";

import packageJson from "../package.json" with { type: "json" };

type Args = {
  target: string[];
  method?: string;
  promptName?: string;
  promptArgs?: Record<string, string>;
  uri?: string;
  logLevel?: LogLevel;
  toolName?: string;
  toolArg?: Record<string, string>;
};

function createTransportOptions(target: string[]): TransportOptions {
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

  return {
    transportType: isUrl ? "sse" : "stdio",
    command: isUrl ? undefined : command,
    args: isUrl ? undefined : commandArgs,
    url: isUrl ? command : undefined,
  };
}

async function callMethod(args: Args): Promise<void> {
  const transportOptions = createTransportOptions(args.target);
  const transport = createTransport(transportOptions);

  const [_, name = packageJson.name] = packageJson.name.split("/");
  const version = packageJson.version;
  const clientIdentity = { name, version };

  const client = new Client(clientIdentity);

  try {
    await connect(client, transport);

    let result: McpResponse;

    // Tools methods
    if (args.method === "tools/list") {
      result = await listTools(client);
    } else if (args.method === "tools/call") {
      if (!args.toolName) {
        throw new Error(
          "Tool name is required for tools/call method. Use --tool-name to specify the tool name.",
        );
      }

      result = await callTool(client, args.toolName, args.toolArg || {});
    }
    // Resources methods
    else if (args.method === "resources/list") {
      result = await listResources(client);
    } else if (args.method === "resources/read") {
      if (!args.uri) {
        throw new Error(
          "URI is required for resources/read method. Use --uri to specify the resource URI.",
        );
      }

      result = await readResource(client, args.uri);
    } else if (args.method === "resources/templates/list") {
      result = await listResourceTemplates(client);
    }
    // Prompts methods
    else if (args.method === "prompts/list") {
      result = await listPrompts(client);
    } else if (args.method === "prompts/get") {
      if (!args.promptName) {
        throw new Error(
          "Prompt name is required for prompts/get method. Use --prompt-name to specify the prompt name.",
        );
      }

      result = await getPrompt(client, args.promptName, args.promptArgs || {});
    }
    // Logging methods
    else if (args.method === "logging/setLevel") {
      if (!args.logLevel) {
        throw new Error(
          "Log level is required for logging/setLevel method. Use --log-level to specify the log level.",
        );
      }

      result = await setLoggingLevel(client, args.logLevel);
    } else {
      throw new Error(
        `Unsupported method: ${args.method}. Supported methods include: tools/list, tools/call, resources/list, resources/read, resources/templates/list, prompts/list, prompts/get, logging/setLevel`,
      );
    }

    console.log(JSON.stringify(result, null, 2));
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
  previous: Record<string, string> = {},
): Record<string, string> {
  const parts = value.split("=");
  const key = parts[0];
  const val = parts.slice(1).join("=");

  if (val === undefined || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`,
    );
  }

  return { ...previous, [key as string]: val };
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
    );

  // Parse only the arguments before --
  program.parse(preArgs);

  const options = program.opts() as Omit<Args, "target">;
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
  };
}

async function main(): Promise<void> {
  process.on("uncaughtException", (error) => {
    handleError(error);
  });

  try {
    const args = parseArgs();
    await callMethod(args);
  } catch (error) {
    handleError(error);
  }
}

main();
