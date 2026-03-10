#!/usr/bin/env node

import { Command } from "commander";
import { render } from "ink";
import type { MCPServerConfig } from "@modelcontextprotocol/inspector-core/mcp/types.js";
import {
  getNamedServerConfigs,
  resolveServerConfigs,
  parseKeyValuePair,
  parseHeaderPair,
} from "@modelcontextprotocol/inspector-core/mcp/node/index.js";
import App from "./src/App.js";

export async function runTui(args?: string[]): Promise<void> {
  const program = new Command();

  program
    .name("mcp-inspector-tui")
    .description("Terminal UI for MCP Inspector")
    .option(
      "--config <path>",
      "Path to MCP servers config file (or use ad-hoc server options below)",
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
      "--callback-url <url>",
      "OAuth redirect/callback listener URL (default: http://127.0.0.1:0/oauth/callback)",
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
    config?: string;
    e?: Record<string, string>;
    cwd?: string;
    header?: Record<string, string>;
    clientId?: string;
    clientSecret?: string;
    clientMetadataUrl?: string;
    callbackUrl?: string;
    transport?: "stdio" | "sse" | "http";
    serverUrl?: string;
  };
  const targetArgs = program.args as string[];

  let mcpServers: Record<string, MCPServerConfig>;
  const serverOptions = {
    configPath: options.config?.trim() || undefined,
    target: targetArgs.length > 0 ? targetArgs : undefined,
    cwd: options.cwd?.trim() || undefined,
    env: options.e,
    headers: options.header,
    transport: options.transport,
    serverUrl: options.serverUrl?.trim() || undefined,
  };

  try {
    if (serverOptions.configPath) {
      mcpServers = getNamedServerConfigs(serverOptions);
    } else {
      const configs = resolveServerConfigs(serverOptions, "multi");
      if (configs.length === 0) {
        program.error(
          "At least one server is required. Use --config <path> or ad-hoc target (command/URL).",
        );
      }
      mcpServers = { default: configs[0]! };
    }
  } catch (err) {
    if (err instanceof Error) {
      program.error(err.message);
    }
    throw err;
  }

  interface CallbackUrlConfig {
    hostname: string;
    port: number;
    pathname: string;
  }

  function parseCallbackUrl(raw?: string): CallbackUrlConfig {
    if (!raw) {
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" };
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch (err) {
      program.error(
        `Invalid callback URL: ${(err as Error)?.message ?? String(err)}`,
      );
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" }; // never reached; program.error() throws
    }
    if (url.protocol !== "http:") {
      program.error("Callback URL must use http scheme");
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" }; // never reached; program.error() throws
    }
    const hostname = url.hostname;
    if (!hostname) {
      program.error("Callback URL must include a hostname");
      return { hostname: "127.0.0.1", port: 0, pathname: "/oauth/callback" }; // never reached; program.error() throws
    }
    const pathname = url.pathname || "/";
    let port: number;
    if (url.port === "") {
      port = 80;
    } else {
      port = Number(url.port);
      if (
        !Number.isFinite(port) ||
        !Number.isInteger(port) ||
        port < 0 ||
        port > 65535
      ) {
        program.error("Callback URL port must be between 0 and 65535");
      }
    }
    return { hostname, port, pathname };
  }

  const callbackUrlConfig = parseCallbackUrl(options.callbackUrl);

  // Intercept stdout.write to filter out \x1b[3J (Erase Saved Lines)
  // This prevents Ink's clearTerminal from clearing scrollback on macOS Terminal
  // We can't access Ink's internal instance to prevent clearTerminal from being called,
  // so we filter the escape code instead.
  // Pattern is built with String.fromCharCode(0x1b) instead of a regex literal containing
  // \x1b so that the source has no control character (satisfies no-control-regex).
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

  // Enter alternate screen buffer before rendering
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?1049h");
  }

  // Render the app
  const instance = render(
    <App
      mcpServers={mcpServers}
      clientId={options.clientId}
      clientSecret={options.clientSecret}
      clientMetadataUrl={options.clientMetadataUrl}
      callbackUrlConfig={callbackUrlConfig}
    />,
  );

  // Wait for exit, then switch back from alternate screen
  try {
    await instance.waitUntilExit();
    // Unmount has completed - clearTerminal was patched to not include \x1b[3J
    // Switch back from alternate screen
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
