#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import {
  parseKeyValuePair,
  parseHeaderPair,
} from "@inspector/core/mcp/node/index.js";
import { loadRunnerClientConfig } from "@inspector/core/client/runner.js";
import {
  parseRunnerOAuthCallbackUrl,
  DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
} from "@inspector/core/auth/node/runner-oauth-callback.js";
import App from "./src/App.js";
import { loadTuiServers } from "./src/tui-servers.js";

export async function runTui(args?: string[]): Promise<void> {
  const program = new Command();

  program
    .name("mcp-inspector-tui")
    .description("Terminal UI for MCP Inspector")
    .option(
      "--catalog <path>",
      "Writable catalog file (created if missing; default: ~/.mcp-inspector/mcp.json, or MCP_CATALOG_PATH)",
    )
    .option(
      "--config <path>",
      "Read-only session config file (served as-is, never written or seeded; errors if absent)",
    )
    .option(
      "-e <key=value...>",
      "Environment variables for stdio servers",
      parseKeyValuePair,
      {},
    )
    .option("--cwd <path>", "Working directory for stdio servers")
    .option(
      "--header <header...>",
      'HTTP headers as "Name: Value"',
      parseHeaderPair,
      {},
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
      "--client-config <path>",
      "Install-level client config (default: ~/.mcp-inspector/storage/client.json, or MCP_CLIENT_CONFIG_PATH)",
    )
    .option(
      "--callback-url <url>",
      `OAuth redirect/callback listener URL (default: ${DEFAULT_RUNNER_OAUTH_CALLBACK_URL}, or MCP_OAUTH_CALLBACK_URL)`,
    )
    .argument(
      "[target...]",
      "Command and args or URL for a single ad-hoc server (when not using --config)",
    )
    .option(
      "--transport <type>",
      "Transport: stdio, sse, or http (ad-hoc only)",
    )
    .option("--server-url <url>", "Server URL (ad-hoc only)")
    .parse(args ?? process.argv);

  const options = program.opts() as {
    catalog?: string;
    config?: string;
    e?: Record<string, string>;
    cwd?: string;
    header?: Record<string, string>;
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    clientConfig?: string;
    callbackUrl?: string;
    transport?: "stdio" | "sse" | "http";
    serverUrl?: string;
  };
  const targetArgs = program.args as string[];

  const serverOptions = {
    catalogPath: options.catalog?.trim() || process.env.MCP_CATALOG_PATH,
    configPath: options.config?.trim() || undefined,
    target: targetArgs.length > 0 ? targetArgs : undefined,
    cwd: options.cwd?.trim() || undefined,
    env: options.e,
    headers: options.header,
    transport: options.transport,
    serverUrl: options.serverUrl?.trim() || undefined,
  };

  const mcpServers = await loadTuiServers(serverOptions);

  const callbackUrlConfig = parseRunnerOAuthCallbackUrl(options.callbackUrl);

  const clientConfig = await loadRunnerClientConfig({
    clientConfigPath: options.clientConfig,
  });

  const ansiEraseSavedLines = new RegExp(
    String.fromCharCode(0x1b) + "\\[3J",
    "g",
  );
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (
    chunk: string | Buffer,
    encoding?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean {
    if (typeof chunk === "string") {
      if (chunk.includes("\x1b[3J")) {
        chunk = chunk.replace(ansiEraseSavedLines, "");
      }
    } else if (Buffer.isBuffer(chunk)) {
      if (chunk.includes("\x1b[3J")) {
        let str = chunk.toString("utf8");
        str = str.replace(ansiEraseSavedLines, "");
        chunk = Buffer.from(str, "utf8");
      }
    }
    if (typeof encoding === "function") {
      return (
        originalWrite as (
          chunk: string | Buffer,
          cb?: (err?: Error) => void,
        ) => boolean
      )(chunk, encoding);
    }
    return (
      originalWrite as (
        chunk: string | Buffer,
        encoding?: BufferEncoding,
        cb?: (err?: Error) => void,
      ) => boolean
    )(chunk, encoding, cb);
  };

  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049h");
  }

  const instance = render(
    <App
      mcpServers={mcpServers}
      clientConfig={clientConfig}
      clientId={options.clientId}
      clientSecret={options.clientSecret}
      clientMetadataUrl={options.clientMetadataUrl}
      callbackUrlConfig={callbackUrlConfig}
    />,
  );

  try {
    await instance.waitUntilExit();
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
    process.exit(0);
  } catch (error: unknown) {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1049l");
    }
    console.error("TUI Error:", error);
    process.exit(1);
  }
}
