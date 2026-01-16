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
  ToolDefinition,
  PromptDefinition,
  ResourceDefinition,
} from "./test-fixtures.js";
import { getDefaultServerConfig } from "./test-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class TestServerStdio {
  private mcpServer: McpServer;
  private config: ServerConfig;
  private transport?: StdioServerTransport;

  constructor(config: ServerConfig) {
    this.config = config;
    const capabilities: {
      tools?: {};
      resources?: {};
      prompts?: {};
      logging?: {};
    } = {};

    // Only include capabilities for features that are present in config
    if (config.tools !== undefined) {
      capabilities.tools = {};
    }
    if (config.resources !== undefined) {
      capabilities.resources = {};
    }
    if (config.prompts !== undefined) {
      capabilities.prompts = {};
    }
    if (config.logging === true) {
      capabilities.logging = {};
    }

    this.mcpServer = new McpServer(config.serverInfo, {
      capabilities,
    });

    this.setupHandlers();
  }

  private setupHandlers() {
    // Set up tools
    if (this.config.tools && this.config.tools.length > 0) {
      for (const tool of this.config.tools) {
        this.mcpServer.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
          },
          async (args) => {
            const result = await tool.handler(args as Record<string, any>);
            // If handler returns content array directly (like get-annotated-message), use it
            if (result && Array.isArray(result.content)) {
              return { content: result.content };
            }
            // If handler returns message (like echo), format it
            if (result && typeof result.message === "string") {
              return {
                content: [
                  {
                    type: "text",
                    text: result.message,
                  },
                ],
              };
            }
            // Otherwise, stringify the result
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result),
                },
              ],
            };
          },
        );
      }
    }

    // Set up resources
    if (this.config.resources && this.config.resources.length > 0) {
      for (const resource of this.config.resources) {
        this.mcpServer.registerResource(
          resource.name,
          resource.uri,
          {
            description: resource.description,
            mimeType: resource.mimeType,
          },
          async () => {
            // For dynamic resources, get fresh text
            let text = resource.text;
            if (resource.name === "test-cwd") {
              text = process.cwd();
            } else if (resource.name === "test-env") {
              text = JSON.stringify(process.env, null, 2);
            } else if (resource.name === "test-argv") {
              text = JSON.stringify(process.argv, null, 2);
            }

            return {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType || "text/plain",
                  text: text || "",
                },
              ],
            };
          },
        );
      }
    }

    // Set up prompts
    if (this.config.prompts && this.config.prompts.length > 0) {
      for (const prompt of this.config.prompts) {
        this.mcpServer.registerPrompt(
          prompt.name,
          {
            description: prompt.description,
            argsSchema: prompt.argsSchema,
          },
          async (args) => {
            if (prompt.name === "args-prompt" && args) {
              const city = (args as any).city as string;
              const state = (args as any).state as string;
              return {
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: `This is a prompt with arguments: city=${city}, state=${state}`,
                    },
                  },
                ],
              };
            } else {
              return {
                messages: [
                  {
                    role: "user",
                    content: {
                      type: "text",
                      text: "This is a simple prompt for testing purposes.",
                    },
                  },
                ],
              };
            }
          },
        );
      }
    }
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
 * Get the path to the test MCP server script
 */
export function getTestMcpServerPath(): string {
  return path.resolve(__dirname, "test-server-stdio.ts");
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
  import.meta.url.endsWith(process.argv[1]) ||
  process.argv[1]?.endsWith("test-server-stdio.ts") ||
  process.argv[1]?.endsWith("test-server-stdio.js");

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
