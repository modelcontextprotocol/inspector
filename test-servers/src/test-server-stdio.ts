#!/usr/bin/env node

/**
 * Test MCP server for stdio transport testing
 * Can be used programmatically or run as a standalone executable
 *
 * Run with {@link CRASHABLE_FLAG} it also serves {@link createCrashServerTool},
 * which kills this process at a point the test chooses — the fixture for the
 * Inspector's mid-session crash reconciliation (#2437). That tool lives here,
 * and only reaches a server through this file's standalone entry, because it
 * calls `process.exit`: wired into the in-process HTTP server it would end the
 * test runner rather than the server.
 */

import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "url";
import type {
  ServerConfig,
  ResourceDefinition,
  ToolDefinition,
} from "./test-server-fixtures.js";
import {
  getDefaultServerConfig,
  createMcpServer,
  createCollectFormElicitationTool,
  createCollectSampleTool,
} from "./test-server-fixtures.js";

/** argv flag that makes the standalone server serve {@link createCrashServerTool}. */
export const CRASHABLE_FLAG = "--crashable";

/** Name of the tool {@link createCrashServerTool} registers. */
export const CRASH_SERVER_TOOL_NAME = "crash_server";

/**
 * Create a `crash_server` tool that ends this server's process, so a test can
 * crash a session at a point it picks rather than relying on whatever path
 * happens to drop the connection.
 *
 * - `respond: false` (the default) exits without answering, so the
 *   `tools/call` that triggered it — and anything else in flight, such as a
 *   pending elicitation or sampling request — is still outstanding when the
 *   process dies.
 * - `respond: true` answers first and exits `delayMs` later, so the crash
 *   lands on an idle session with nothing in flight.
 * - `stderr` is written before exiting, standing in for a real server's dying
 *   words. The exit waits for the write to flush: pipe writes are asynchronous
 *   on macOS, so exiting straight after one can drop it.
 *
 * ⚠️ Only for a server running in a process of its own (the standalone entry
 * below, behind {@link CRASHABLE_FLAG}) — see the module header.
 */
export function createCrashServerTool(): ToolDefinition {
  return {
    name: CRASH_SERVER_TOOL_NAME,
    description:
      "Exit this server process (test fixture for mid-session crash handling)",
    inputSchema: {
      respond: z
        .boolean()
        .optional()
        .describe("Answer this call before exiting (default false)"),
      delayMs: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Milliseconds to wait before exiting (default 0)"),
      exitCode: z
        .number()
        .int()
        .optional()
        .describe("Process exit code (default 1)"),
      stderr: z
        .string()
        .optional()
        .describe("Message to write to stderr just before exiting"),
    },
    handler: async (params: Record<string, unknown>) => {
      const respond = params.respond === true;
      const delayMs = typeof params.delayMs === "number" ? params.delayMs : 0;
      const exitCode =
        typeof params.exitCode === "number" ? params.exitCode : 1;
      const stderr =
        typeof params.stderr === "string" ? params.stderr : undefined;
      const exit = () => {
        if (stderr === undefined) process.exit(exitCode);
        process.stderr.write(`${stderr}\n`, () => process.exit(exitCode));
      };
      if (respond) {
        setTimeout(exit, delayMs);
        return {
          content: [
            {
              type: "text",
              text: `Exiting in ${delayMs}ms (code ${exitCode})`,
            },
          ],
        };
      }
      // Never settles: the process is gone before an answer could be sent.
      return new Promise(() => {
        setTimeout(exit, delayMs);
      });
    },
  };
}

/**
 * The standalone server's config for {@link CRASHABLE_FLAG}: the default
 * config plus the crash tool, and the two peer-request tools a test pairs with
 * it to have a sampling or elicitation request pending when the process dies.
 */
export function getCrashableServerConfig(): ServerConfig {
  const config = getDefaultServerConfig();
  return {
    ...config,
    tools: [
      ...(config.tools ?? []),
      createCollectFormElicitationTool(),
      createCollectSampleTool(),
      createCrashServerTool(),
    ],
  };
}

export class TestServerStdio {
  private mcpServer: McpServer;
  private transport?: StdioServerTransport;

  constructor(config: ServerConfig) {
    // Provide callback to customize resource handlers for stdio-specific dynamic resources
    const configWithCallback: ServerConfig = {
      ...config,
      onRegisterResource: (resource: ResourceDefinition) => {
        // Only provide custom handler for dynamic resources
        if (
          resource.name === "test_cwd" ||
          resource.name === "test_env" ||
          resource.name === "test_argv"
        ) {
          return async () => {
            let text: string;
            if (resource.name === "test_cwd") {
              text = process.cwd();
            } else if (resource.name === "test_env") {
              text = JSON.stringify(process.env, null, 2);
            } else if (resource.name === "test_argv") {
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
 * Uses node to run the built output (test package must be built first)
 */
export function getTestMcpServerCommand(): { command: string; args: string[] } {
  return {
    command: "node",
    args: [getTestMcpServerPath()],
  };
}

/**
 * {@link getTestMcpServerCommand} for the crashable variant: the same server
 * started with {@link CRASHABLE_FLAG}, serving {@link getCrashableServerConfig}.
 */
export function getCrashableTestMcpServerCommand(): {
  command: string;
  args: string[];
} {
  return {
    command: "node",
    args: [getTestMcpServerPath(), CRASHABLE_FLAG],
  };
}

// If run as a standalone script, start with default config
// Check if this file is being executed directly (not imported)
const isMainModule =
  import.meta.url.endsWith(process.argv[1] || "") ||
  (process.argv[1]?.endsWith("test-server-stdio.ts") ?? false) ||
  (process.argv[1]?.endsWith("test-server-stdio.js") ?? false);

if (isMainModule) {
  const server = new TestServerStdio(
    process.argv.includes(CRASHABLE_FLAG)
      ? getCrashableServerConfig()
      : getDefaultServerConfig(),
  );
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
