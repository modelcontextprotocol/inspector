/**
 * Shared test fixtures for composable MCP test servers
 *
 * This module provides helper functions for creating test tools, prompts, and resources.
 * For the core composable server types and createMcpServer function, see composable-test-server.ts
 */

import * as z from "zod/v4";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
} from "./composable-test-server.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Re-export types and functions from composable-test-server for backward compatibility
export type {
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
} from "./composable-test-server.js";
export { createMcpServer } from "./composable-test-server.js";

/**
 * Create an "echo" tool that echoes back the input message
 */
export function createEchoTool(): ToolDefinition {
  return {
    name: "echo",
    description: "Echo back the input message",
    inputSchema: {
      message: z.string().describe("Message to echo back"),
    },
    handler: async (params: Record<string, any>, _server?: any) => {
      return { message: `Echo: ${params.message as string}` };
    },
  };
}

/**
 * Create an "add" tool that adds two numbers together
 */
export function createAddTool(): ToolDefinition {
  return {
    name: "add",
    description: "Add two numbers together",
    inputSchema: {
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    },
    handler: async (params: Record<string, any>, _server?: any) => {
      const a = params.a as number;
      const b = params.b as number;
      return { result: a + b };
    },
  };
}

/**
 * Create a "get-sum" tool that returns the sum of two numbers (alias for add)
 */
export function createGetSumTool(): ToolDefinition {
  return {
    name: "get-sum",
    description: "Get the sum of two numbers",
    inputSchema: {
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    },
    handler: async (params: Record<string, any>, _server?: any) => {
      const a = params.a as number;
      const b = params.b as number;
      return { result: a + b };
    },
  };
}

/**
 * Create a "collectSample" tool that sends a sampling request and returns the response
 */
export function createCollectSampleTool(): ToolDefinition {
  return {
    name: "collectSample",
    description:
      "Send a sampling request with the given text and return the response",
    inputSchema: {
      text: z.string().describe("Text to send in the sampling request"),
    },
    handler: async (
      params: Record<string, any>,
      server?: McpServer,
    ): Promise<any> => {
      if (!server) {
        throw new Error("Server instance not available");
      }

      const text = params.text as string;

      // Send a sampling/createMessage request to the client
      // The server.request() method takes a request object (with method) and result schema
      try {
        const result = await server.server.request(
          {
            method: "sampling/createMessage",
            params: {
              messages: [
                {
                  role: "user" as const,
                  content: {
                    type: "text" as const,
                    text: text,
                  },
                },
              ],
              maxTokens: 100, // Required parameter
            },
          },
          CreateMessageResultSchema,
        );

        // Validate and return the result
        const validatedResult = CreateMessageResultSchema.parse(result);

        return {
          message: `Sampling response: ${JSON.stringify(validatedResult)}`,
        };
      } catch (error) {
        console.error(
          "[collectSample] Error sending/receiving sampling request:",
          error,
        );
        throw error;
      }
    },
  };
}

/**
 * Create a "sendNotification" tool that sends a notification message from the server
 */
export function createSendNotificationTool(): ToolDefinition {
  return {
    name: "sendNotification",
    description: "Send a notification message from the server",
    inputSchema: {
      message: z.string().describe("Notification message to send"),
      level: z
        .enum([
          "debug",
          "info",
          "notice",
          "warning",
          "error",
          "critical",
          "alert",
          "emergency",
        ])
        .optional()
        .describe("Log level for the notification"),
    },
    handler: async (
      params: Record<string, any>,
      server?: McpServer,
    ): Promise<any> => {
      if (!server) {
        throw new Error("Server instance not available");
      }

      const message = params.message as string;
      const level = (params.level as string) || "info";

      // Send a notification from the server
      // Notifications don't have an id and use the jsonrpc format
      try {
        await server.server.notification({
          method: "notifications/message",
          params: {
            level,
            logger: "test-server",
            data: {
              message,
            },
          },
        });

        return {
          message: `Notification sent: ${message}`,
        };
      } catch (error) {
        console.error("[sendNotification] Error sending notification:", error);
        throw error;
      }
    },
  };
}

/**
 * Create a "get-annotated-message" tool that returns a message with optional image
 */
export function createGetAnnotatedMessageTool(): ToolDefinition {
  return {
    name: "get-annotated-message",
    description: "Get an annotated message",
    inputSchema: {
      messageType: z
        .enum(["success", "error", "warning", "info"])
        .describe("Type of message"),
      includeImage: z
        .boolean()
        .optional()
        .describe("Whether to include an image"),
    },
    handler: async (params: Record<string, any>, _server?: any) => {
      const messageType = params.messageType as string;
      const includeImage = params.includeImage as boolean | undefined;
      const message = `This is a ${messageType} message`;
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [
        {
          type: "text",
          text: message,
        },
      ];

      if (includeImage) {
        content.push({
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", // 1x1 transparent PNG
          mimeType: "image/png",
        });
      }

      return { content };
    },
  };
}

/**
 * Create a "simple-prompt" prompt definition
 */
export function createSimplePrompt(): PromptDefinition {
  return {
    name: "simple-prompt",
    description: "A simple prompt for testing",
    promptString: "This is a simple prompt for testing purposes.",
  };
}

/**
 * Create an "args-prompt" prompt that accepts arguments
 */
export function createArgsPrompt(): PromptDefinition {
  return {
    name: "args-prompt",
    description: "A prompt that accepts arguments for testing",
    promptString: "This is a prompt with arguments: city={city}, state={state}",
    argsSchema: {
      city: z.string().describe("City name"),
      state: z.string().describe("State name"),
    },
  };
}

/**
 * Create an "architecture" resource definition
 */
export function createArchitectureResource(): ResourceDefinition {
  return {
    name: "architecture",
    uri: "demo://resource/static/document/architecture.md",
    description: "Architecture documentation",
    mimeType: "text/markdown",
    text: `# Architecture Documentation

This is a test resource for the MCP test server.

## Overview

This resource is used for testing resource reading functionality in the CLI.

## Sections

- Introduction
- Design
- Implementation
- Testing

## Notes

This is a static resource provided by the test MCP server.
`,
  };
}

/**
 * Create a "test-cwd" resource that exposes the current working directory (generally useful when testing with the stdio test server)
 */
export function createTestCwdResource(): ResourceDefinition {
  return {
    name: "test-cwd",
    uri: "test://cwd",
    description: "Current working directory of the test server",
    mimeType: "text/plain",
    text: process.cwd(),
  };
}

/**
 * Create a "test-env" resource that exposes environment variables (generally useful when testing with the stdio test server)
 */
export function createTestEnvResource(): ResourceDefinition {
  return {
    name: "test-env",
    uri: "test://env",
    description: "Environment variables available to the test server",
    mimeType: "application/json",
    text: JSON.stringify(process.env, null, 2),
  };
}

/**
 * Create a "test-argv" resource that exposes command-line arguments (generally useful when testing with the stdio test server)
 */
export function createTestArgvResource(): ResourceDefinition {
  return {
    name: "test-argv",
    uri: "test://argv",
    description: "Command-line arguments the test server was started with",
    mimeType: "application/json",
    text: JSON.stringify(process.argv, null, 2),
  };
}

/**
 * Create minimal server info for test servers
 */
export function createTestServerInfo(
  name: string = "test-server",
  version: string = "1.0.0",
): Implementation {
  return {
    name,
    version,
  };
}

/**
 * Create a "file" resource template that reads files by path
 */
export function createFileResourceTemplate(): ResourceTemplateDefinition {
  return {
    name: "file",
    uriTemplate: "file:///{path}",
    description: "Read a file by path",
    inputSchema: {
      path: z.string().describe("File path to read"),
    },
    handler: async (uri: URL, params: Record<string, any>) => {
      const path = params.path as string;
      // For testing, return a mock file content
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/plain",
            text: `Mock file content for: ${path}\nThis is a test resource template.`,
          },
        ],
      };
    },
  };
}

/**
 * Create a "user" resource template that returns user data by ID
 */
export function createUserResourceTemplate(): ResourceTemplateDefinition {
  return {
    name: "user",
    uriTemplate: "user://{userId}",
    description: "Get user data by ID",
    inputSchema: {
      userId: z.string().describe("User ID"),
    },
    handler: async (uri: URL, params: Record<string, any>) => {
      const userId = params.userId as string;
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(
              {
                id: userId,
                name: `User ${userId}`,
                email: `user${userId}@example.com`,
                role: "test-user",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
}

/**
 * Get default server config with common test tools, prompts, and resources
 */
export function getDefaultServerConfig(): ServerConfig {
  return {
    serverInfo: createTestServerInfo("test-mcp-server", "1.0.0"),
    tools: [
      createEchoTool(),
      createGetSumTool(),
      createGetAnnotatedMessageTool(),
      createSendNotificationTool(),
    ],
    prompts: [createSimplePrompt(), createArgsPrompt()],
    resources: [
      createArchitectureResource(),
      createTestCwdResource(),
      createTestEnvResource(),
      createTestArgvResource(),
    ],
    resourceTemplates: [
      createFileResourceTemplate(),
      createUserResourceTemplate(),
    ],
    logging: true, // Required for notifications/message
  };
}
