import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { findActualExecutable } from "spawn-rx";

export type TransportOptions = {
  transportType: "sse" | "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
};

function createSSETransport(options: TransportOptions): Transport {
  const baseUrl = new URL(options.url ?? "");
  const sseUrl = baseUrl.pathname.endsWith("/sse")
    ? baseUrl
    : new URL("/sse", baseUrl);

  return new SSEClientTransport(sseUrl);
}

function createHTTPTransport(options: TransportOptions): Transport {
  const baseUrl = new URL(options.url ?? "");
  const mcpUrl = baseUrl.pathname.endsWith("/mcp")
    ? baseUrl
    : new URL("/mcp", baseUrl);

  return new StreamableHTTPClientTransport(mcpUrl);
}

function createStdioTransport(options: TransportOptions): Transport {
  let args: string[] = [];

  if (options.args !== undefined) {
    args = options.args;
  }

  const processEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      processEnv[key] = value;
    }
  }

  const defaultEnv = getDefaultEnvironment();

  const env: Record<string, string> = {
    ...processEnv,
    ...defaultEnv,
  };

  const { cmd: actualCommand, args: actualArgs } = findActualExecutable(
    options.command ?? "",
    args,
  );

  return new StdioClientTransport({
    command: actualCommand,
    args: actualArgs,
    env,
    stderr: "pipe",
  });
}

export function createTransport(options: TransportOptions): Transport {
  const { transportType } = options;

  try {
    if (transportType === "stdio") {
      return createStdioTransport(options);
    }

    if (transportType === "sse") {
      return createSSETransport(options);
    }

    if (transportType === "http") {
      return createHTTPTransport(options);
    }

    throw new Error(`Unsupported transport type: ${transportType}`);
  } catch (error) {
    throw new Error(
      `Failed to create transport: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
