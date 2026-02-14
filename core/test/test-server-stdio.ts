#!/usr/bin/env node

/**
 * Test MCP server for stdio transport testing
 * Can be used programmatically or run as a standalone executable
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type {
  ServerConfig,
  ResourceDefinition,
} from "./test-server-fixtures.js";
import {
  getDefaultServerConfig,
  createMcpServer,
} from "./test-server-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class TestServerStdio {
  private mcpServer: McpServer;
  private config: ServerConfig;
  private transport?: StdioServerTransport;

  constructor(config: ServerConfig) {
    // Provide callback to customize resource handlers for stdio-specific dynamic resources
    const configWithCallback: ServerConfig = {
      ...config,
      onRegisterResource: (resource: ResourceDefinition) => {
        // Only provide custom handler for dynamic resources
        if (
          resource.name === "test-cwd" ||
          resource.name === "test-env" ||
          resource.name === "test-argv"
        ) {
          return async () => {
            let text: string;
            if (resource.name === "test-cwd") {
              text = process.cwd();
            } else if (resource.name === "test-env") {
              text = JSON.stringify(process.env, null, 2);
            } else if (resource.name === "test-argv") {
              text = JSON.stringify(process.argv, null, 2);
            } else {
              text = resource.text ?? "";
            }

            return {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType || "text/plain",
                  text,
                },
              ],
            };
          };
        }
        // Return undefined to use default handler
        return undefined;
      },
    };
    this.config = config;
    this.mcpServer = createMcpServer(configWithCallback);
  }

  /**
   * Start the server with stdio transport
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.mcpServer.connect(this.transport);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.mcpServer.close();
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
  }
}

/**
 * Create a stdio MCP test server
 */
export function createTestServerStdio(config: ServerConfig): TestServerStdio {
  return new TestServerStdio(config);
}

/**
 * Get the path to the test MCP server script.
 * Uses the actual loaded module path so it works when loaded from source (.ts) or build (.js).
 */
export function getTestMcpServerPath(): string {
  return fileURLToPath(import.meta.url);
}

/**
 * Get the command and args to run the test MCP server
 */
export function getTestMcpServerCommand(): { command: string; args: string[] } {
  return {
    command: "tsx",
    args: [getTestMcpServerPath()],
  };
}

// If run as a standalone script, start with default config
// Check if this file is being executed directly (not imported)
const isMainModule =
  import.meta.url.endsWith(process.argv[1] || "") ||
  (process.argv[1]?.endsWith("test-server-stdio.ts") ?? false) ||
  (process.argv[1]?.endsWith("test-server-stdio.js") ?? false);

if (isMainModule) {
  const server = new TestServerStdio(getDefaultServerConfig());
  server
    .start()
    .then(() => {
      // Server is now running and listening on stdio
      // Keep the process alive
    })
    .catch((error) => {
      console.error("Failed to start test MCP server:", error);
      process.exit(1);
    });
}
