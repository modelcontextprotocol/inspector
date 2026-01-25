/**
 * Shared test fixtures for composable MCP test servers
 *
 * This module provides helper functions for creating test tools, prompts, and resources.
 * For the core composable server types and createMcpServer function, see composable-test-server.ts
 */

import * as z from "zod/v4";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import {
  CreateMessageResultSchema,
  ElicitResultSchema,
  ListRootsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ToolDefinition,
  TaskToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
  TestServerContext,
} from "./composable-test-server.js";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ToolTaskHandler,
  TaskRequestHandlerExtra,
  CreateTaskRequestHandlerExtra,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type {
  GetTaskResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

// Re-export types and functions from composable-test-server for backward compatibility
export type {
  ToolDefinition,
  TaskToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
} from "./composable-test-server.js";
export { createMcpServer } from "./composable-test-server.js";

/**
 * Create multiple numbered tools for pagination testing
 * @param count Number of tools to create
 * @returns Array of tool definitions
 */
export function createNumberedTools(count: number): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (let i = 1; i <= count; i++) {
    tools.push({
      name: `tool-${i}`,
      description: `Test tool number ${i}`,
      inputSchema: {
        message: z.string().describe(`Message for tool ${i}`),
      },
      handler: async (params: Record<string, any>) => {
        return { message: `Tool ${i}: ${params.message as string}` };
      },
    });
  }
  return tools;
}

/**
 * Create multiple numbered resources for pagination testing
 * @param count Number of resources to create
 * @returns Array of resource definitions
 */
export function createNumberedResources(count: number): ResourceDefinition[] {
  const resources: ResourceDefinition[] = [];
  for (let i = 1; i <= count; i++) {
    resources.push({
      name: `resource-${i}`,
      uri: `test://resource-${i}`,
      description: `Test resource number ${i}`,
      mimeType: "text/plain",
      text: `Content for resource ${i}`,
    });
  }
  return resources;
}

/**
 * Create multiple numbered resource templates for pagination testing
 * @param count Number of resource templates to create
 * @returns Array of resource template definitions
 */
export function createNumberedResourceTemplates(
  count: number,
): ResourceTemplateDefinition[] {
  const templates: ResourceTemplateDefinition[] = [];
  for (let i = 1; i <= count; i++) {
    templates.push({
      name: `template-${i}`,
      uriTemplate: `test://template-${i}/{param}`,
      description: `Test resource template number ${i}`,
      handler: async (uri: URL, variables: Record<string, any>) => {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: `Content for template ${i} with param ${variables.param}`,
            },
          ],
        };
      },
    });
  }
  return templates;
}

/**
 * Create multiple numbered prompts for pagination testing
 * @param count Number of prompts to create
 * @returns Array of prompt definitions
 */
export function createNumberedPrompts(count: number): PromptDefinition[] {
  const prompts: PromptDefinition[] = [];
  for (let i = 1; i <= count; i++) {
    prompts.push({
      name: `prompt-${i}`,
      description: `Test prompt number ${i}`,
      promptString: `This is prompt ${i}`,
    });
  }
  return prompts;
}

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
      context?: TestServerContext,
    ): Promise<any> => {
      if (!context) {
        throw new Error("Server context not available");
      }
      const server = context.server;

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
 * Create a "listRoots" tool that calls roots/list and returns the roots
 */
export function createListRootsTool(): ToolDefinition {
  return {
    name: "listRoots",
    description: "List the current roots configured on the client",
    inputSchema: {},
    handler: async (
      _params: Record<string, any>,
      context?: TestServerContext,
    ): Promise<any> => {
      if (!context) {
        throw new Error("Server context not available");
      }
      const server = context.server;

      try {
        // Call roots/list on the client
        const result = await server.server.request(
          {
            method: "roots/list",
          },
          ListRootsResultSchema,
        );

        return {
          message: `Roots: ${JSON.stringify(result.roots, null, 2)}`,
          roots: result.roots,
        };
      } catch (error) {
        return {
          message: `Error listing roots: ${error instanceof Error ? error.message : String(error)}`,
          error: true,
        };
      }
    },
  };
}

/**
 * Create a "collectElicitation" tool that sends an elicitation request and returns the response
 */
export function createCollectElicitationTool(): ToolDefinition {
  return {
    name: "collectElicitation",
    description:
      "Send an elicitation request with the given message and schema and return the response",
    inputSchema: {
      message: z
        .string()
        .describe("Message to send in the elicitation request"),
      schema: z.any().describe("JSON schema for the elicitation request"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ): Promise<any> => {
      if (!context) {
        throw new Error("Server context not available");
      }
      const server = context.server;

      // TODO: The fact that param attributes are "any" is not ideal
      const message = params.message as string;
      const schema = params.schema as any; // TODO: This is also not ideal

      // Send an elicitation/create request to the client
      // The server.request() method takes a request object (with method) and result schema
      try {
        const result = await server.server.request(
          {
            method: "elicitation/create",
            params: {
              message,
              requestedSchema: schema,
            },
          },
          ElicitResultSchema,
        );

        // Validate and return the result
        const validatedResult = ElicitResultSchema.parse(result);

        return {
          message: `Elicitation response: ${JSON.stringify(validatedResult)}`,
        };
      } catch (error) {
        console.error(
          "[collectElicitation] Error sending/receiving elicitation request:",
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
      context?: TestServerContext,
    ): Promise<any> => {
      if (!context) {
        throw new Error("Server context not available");
      }
      const server = context.server;

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
export function createArgsPrompt(
  completions?: Record<
    string,
    (
      argumentValue: string,
      context?: Record<string, string>,
    ) => Promise<string[]> | string[]
  >,
): PromptDefinition {
  return {
    name: "args-prompt",
    description: "A prompt that accepts arguments for testing",
    promptString: "This is a prompt with arguments: city={city}, state={state}",
    argsSchema: {
      city: z.string().describe("City name"),
      state: z.string().describe("State name"),
    },
    completions,
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
export function createFileResourceTemplate(
  completionCallback?: (
    argumentName: string,
    value: string,
    context?: Record<string, string>,
  ) => Promise<string[]> | string[],
  listCallback?: () => Promise<string[]> | string[],
): ResourceTemplateDefinition {
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
    complete: completionCallback,
    list: listCallback,
  };
}

/**
 * Create a "user" resource template that returns user data by ID
 */
export function createUserResourceTemplate(
  completionCallback?: (
    argumentName: string,
    value: string,
    context?: Record<string, string>,
  ) => Promise<string[]> | string[],
  listCallback?: () => Promise<string[]> | string[],
): ResourceTemplateDefinition {
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
    complete: completionCallback,
    list: listCallback,
  };
}

/**
 * Create a tool that adds a resource to the server and sends list_changed notification
 */
export function createAddResourceTool(): ToolDefinition {
  return {
    name: "addResource",
    description:
      "Add a resource to the server and send list_changed notification",
    inputSchema: {
      uri: z.string().describe("Resource URI"),
      name: z.string().describe("Resource name"),
      description: z.string().optional().describe("Resource description"),
      mimeType: z.string().optional().describe("Resource MIME type"),
      text: z.string().optional().describe("Resource text content"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Register with SDK (returns RegisteredResource)
      const registered = server.registerResource(
        params.name as string,
        params.uri as string,
        {
          description: params.description as string | undefined,
          mimeType: params.mimeType as string | undefined,
        },
        async () => {
          return {
            contents: params.text
              ? [
                  {
                    uri: params.uri as string,
                    mimeType: params.mimeType as string | undefined,
                    text: params.text as string,
                  },
                ]
              : [],
          };
        },
      );

      // Track in state (keyed by URI)
      state.registeredResources.set(params.uri as string, registered);

      // Send notification if capability enabled
      if (state.listChangedConfig.resources) {
        server.sendResourceListChanged();
      }

      return {
        message: `Resource ${params.uri} added`,
        uri: params.uri,
      };
    },
  };
}

/**
 * Create a tool that removes a resource from the server by URI and sends list_changed notification
 */
export function createRemoveResourceTool(): ToolDefinition {
  return {
    name: "removeResource",
    description:
      "Remove a resource from the server by URI and send list_changed notification",
    inputSchema: {
      uri: z.string().describe("Resource URI to remove"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Find registered resource by URI
      const resource = state.registeredResources.get(params.uri as string);
      if (!resource) {
        throw new Error(`Resource with URI ${params.uri} not found`);
      }

      // Remove from SDK registry
      resource.remove();

      // Remove from tracking
      state.registeredResources.delete(params.uri as string);

      // Send notification if capability enabled
      if (state.listChangedConfig.resources) {
        server.sendResourceListChanged();
      }

      return {
        message: `Resource ${params.uri} removed`,
        uri: params.uri,
      };
    },
  };
}

/**
 * Create a tool that adds a tool to the server and sends list_changed notification
 */
export function createAddToolTool(): ToolDefinition {
  return {
    name: "addTool",
    description: "Add a tool to the server and send list_changed notification",
    inputSchema: {
      name: z.string().describe("Tool name"),
      description: z.string().describe("Tool description"),
      inputSchema: z.any().optional().describe("Tool input schema"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Register with SDK (returns RegisteredTool)
      const registered = server.registerTool(
        params.name as string,
        {
          description: params.description as string,
          inputSchema: params.inputSchema,
        },
        async () => {
          return {
            content: [
              {
                type: "text" as const,
                text: `Tool ${params.name} executed`,
              },
            ],
          };
        },
      );

      // Track in state (keyed by name)
      state.registeredTools.set(params.name as string, registered);

      // Send notification if capability enabled
      // Note: sendToolListChanged() is synchronous on McpServer but internally calls async Server method
      // We don't await it, but the tool should be registered before sending the notification
      if (state.listChangedConfig.tools) {
        // Small delay to ensure tool is fully registered in SDK's internal state
        await new Promise((resolve) => setTimeout(resolve, 10));
        server.sendToolListChanged();
      }

      return {
        message: `Tool ${params.name} added`,
        name: params.name,
      };
    },
  };
}

/**
 * Create a tool that removes a tool from the server by name and sends list_changed notification
 */
export function createRemoveToolTool(): ToolDefinition {
  return {
    name: "removeTool",
    description:
      "Remove a tool from the server by name and send list_changed notification",
    inputSchema: {
      name: z.string().describe("Tool name to remove"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Find registered tool by name
      const tool = state.registeredTools.get(params.name as string);
      if (!tool) {
        throw new Error(`Tool ${params.name} not found`);
      }

      // Remove from SDK registry
      tool.remove();

      // Remove from tracking
      state.registeredTools.delete(params.name as string);

      // Send notification if capability enabled
      if (state.listChangedConfig.tools) {
        server.sendToolListChanged();
      }

      return {
        message: `Tool ${params.name} removed`,
        name: params.name,
      };
    },
  };
}

/**
 * Create a tool that adds a prompt to the server and sends list_changed notification
 */
export function createAddPromptTool(): ToolDefinition {
  return {
    name: "addPrompt",
    description:
      "Add a prompt to the server and send list_changed notification",
    inputSchema: {
      name: z.string().describe("Prompt name"),
      description: z.string().optional().describe("Prompt description"),
      promptString: z.string().describe("Prompt text"),
      argsSchema: z.any().optional().describe("Prompt arguments schema"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Register with SDK (returns RegisteredPrompt)
      const registered = server.registerPrompt(
        params.name as string,
        {
          description: params.description as string | undefined,
          argsSchema: params.argsSchema,
        },
        async () => {
          return {
            messages: [
              {
                role: "user" as const,
                content: {
                  type: "text" as const,
                  text: params.promptString as string,
                },
              },
            ],
          };
        },
      );

      // Track in state (keyed by name)
      state.registeredPrompts.set(params.name as string, registered);

      // Send notification if capability enabled
      if (state.listChangedConfig.prompts) {
        server.sendPromptListChanged();
      }

      return {
        message: `Prompt ${params.name} added`,
        name: params.name,
      };
    },
  };
}

/**
 * Create a tool that updates an existing resource's content and sends resource updated notification
 */
export function createUpdateResourceTool(): ToolDefinition {
  return {
    name: "updateResource",
    description:
      "Update an existing resource's content and send resource updated notification",
    inputSchema: {
      uri: z.string().describe("Resource URI to update"),
      text: z.string().describe("New resource text content"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Find registered resource by URI
      const resource = state.registeredResources.get(params.uri as string);
      if (!resource) {
        throw new Error(`Resource with URI ${params.uri} not found`);
      }

      // Get the current resource metadata to preserve mimeType
      const currentResource = state.registeredResources.get(
        params.uri as string,
      );
      const mimeType = currentResource?.metadata?.mimeType || "text/plain";

      // Update the resource's callback to return new content
      resource.update({
        callback: async () => {
          return {
            contents: [
              {
                uri: params.uri as string,
                mimeType,
                text: params.text as string,
              },
            ],
          };
        },
      });

      // Send resource updated notification only if subscribed
      const uri = params.uri as string;
      if (state.resourceSubscriptions.has(uri)) {
        await server.server.sendResourceUpdated({
          uri,
        });
      }

      return {
        message: `Resource ${params.uri} updated`,
        uri: params.uri,
      };
    },
  };
}

/**
 * Create a tool that sends progress notifications during execution
 * @param name Tool name (default: "sendProgress")
 * @returns Tool definition
 */
export function createSendProgressTool(
  name: string = "sendProgress",
): ToolDefinition {
  return {
    name,
    description:
      "Send progress notifications during tool execution, then return a result",
    inputSchema: {
      units: z
        .number()
        .int()
        .positive()
        .describe("Number of progress units to send"),
      delayMs: z
        .number()
        .int()
        .nonnegative()
        .default(100)
        .describe("Delay in milliseconds between progress notifications"),
      total: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Total number of units (for percentage calculation)"),
      message: z
        .string()
        .optional()
        .describe("Progress message to include in notifications"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
      extra?: any,
    ): Promise<any> => {
      if (!context) {
        throw new Error("Server context not available");
      }
      const server = context.server;

      const units = params.units as number;
      const delayMs = (params.delayMs as number) || 100;
      const total = params.total as number | undefined;
      const message = (params.message as string) || "Processing...";

      // Extract progressToken from metadata
      const progressToken = extra?._meta?.progressToken;

      // Send progress notifications
      for (let i = 1; i <= units; i++) {
        // Wait before sending notification (except for the first one)
        if (i > 1 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        if (progressToken !== undefined) {
          const progressParams: {
            progress: number;
            total?: number;
            message?: string;
            progressToken: string | number;
          } = {
            progress: i,
            message: `${message} (${i}/${units})`,
            progressToken,
          };
          if (total !== undefined) {
            progressParams.total = total;
          }

          try {
            await server.server.notification(
              {
                method: "notifications/progress",
                params: progressParams,
              },
              { relatedRequestId: extra?.requestId },
            );
          } catch (error) {
            console.error(
              "[sendProgress] Error sending progress notification:",
              error,
            );
          }
        }
      }

      return {
        message: `Completed ${units} progress notifications`,
        units,
        total: total || units,
      };
    },
  };
}

export function createRemovePromptTool(): ToolDefinition {
  return {
    name: "removePrompt",
    description:
      "Remove a prompt from the server by name and send list_changed notification",
    inputSchema: {
      name: z.string().describe("Prompt name to remove"),
    },
    handler: async (
      params: Record<string, any>,
      context?: TestServerContext,
    ) => {
      if (!context) {
        throw new Error("Server context not available");
      }

      const { server, state } = context;

      // Find registered prompt by name
      const prompt = state.registeredPrompts.get(params.name as string);
      if (!prompt) {
        throw new Error(`Prompt ${params.name} not found`);
      }

      // Remove from SDK registry
      prompt.remove();

      // Remove from tracking
      state.registeredPrompts.delete(params.name as string);

      // Send notification if capability enabled
      if (state.listChangedConfig.prompts) {
        server.sendPromptListChanged();
      }

      return {
        message: `Prompt ${params.name} removed`,
        name: params.name,
      };
    },
  };
}

/**
 * Options for creating a flexible task tool fixture
 */
export interface FlexibleTaskToolOptions {
  name?: string; // default: "flexibleTask"
  taskSupport?: "required" | "optional" | "forbidden"; // default: "required"
  immediateReturn?: boolean; // If true, tool returns immediately, no task created
  delayMs?: number; // default: 1000 (time before task completes)
  progressUnits?: number; // If provided, send progress notifications (default: 5 if progress enabled)
  elicitationSchema?: z.ZodTypeAny; // If provided, require elicitation with this schema
  samplingText?: string; // If provided, require sampling with this text
  failAfterDelay?: number; // If set, task fails after this delay (ms)
  cancelAfterDelay?: number; // If set, task cancels itself after this delay (ms)
}

/**
 * Create a flexible task tool that can be configured for various task scenarios
 * Returns ToolDefinition if taskSupport is "forbidden" or immediateReturn is true
 * Returns TaskToolDefinition otherwise
 */
export function createFlexibleTaskTool(
  options: FlexibleTaskToolOptions = {},
): ToolDefinition | TaskToolDefinition {
  const {
    name = "flexibleTask",
    taskSupport = "required",
    immediateReturn = false,
    delayMs = 1000,
    progressUnits,
    elicitationSchema,
    samplingText,
    failAfterDelay,
    cancelAfterDelay,
  } = options;

  // If taskSupport is "forbidden" or immediateReturn is true, return a regular tool
  if (taskSupport === "forbidden" || immediateReturn) {
    return {
      name,
      description: `A flexible task tool (${taskSupport === "forbidden" ? "forbidden" : "immediate return"} mode)`,
      inputSchema: {
        message: z.string().optional().describe("Optional message parameter"),
      },
      handler: async (
        params: Record<string, any>,
        context?: TestServerContext,
      ): Promise<any> => {
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return {
          message: `Task completed immediately: ${params.message || "no message"}`,
        };
      },
    };
  }

  // Otherwise, return a task tool
  // Note: inputSchema is for createTask handler only - getTask and getTaskResult don't use it
  const taskTool: TaskToolDefinition = {
    name,
    description: `A flexible task tool supporting progress, elicitation, and sampling`,
    inputSchema: {
      message: z.string().optional().describe("Optional message parameter"),
    },
    execution: {
      taskSupport: taskSupport as "required" | "optional",
    },
    handler: {
      createTask: async (args, extra) => {
        const message = (args as Record<string, any>)?.message as
          | string
          | undefined;
        const progressToken = extra._meta?.progressToken;

        // Create the task
        const task = await extra.taskStore.createTask({});

        // Start async task execution
        (async () => {
          try {
            // Handle elicitation if schema provided
            if (elicitationSchema) {
              // Update task status to input_required
              await extra.taskStore.updateTaskStatus(
                task.taskId,
                "input_required",
              );

              // Send elicitation request with related-task metadata
              try {
                // Convert Zod schema to JSON schema
                const jsonSchema = toJsonSchemaCompat(
                  elicitationSchema,
                ) as ElicitRequestFormParams["requestedSchema"];
                await extra.sendRequest(
                  {
                    method: "elicitation/create",
                    params: {
                      message: `Please provide input for task ${task.taskId}`,
                      requestedSchema: jsonSchema,
                      _meta: {
                        [RELATED_TASK_META_KEY]: {
                          taskId: task.taskId,
                        },
                      },
                    },
                  },
                  ElicitResultSchema,
                );
                // Once response received, continue task
                await extra.taskStore.updateTaskStatus(task.taskId, "working");
              } catch (error) {
                console.error("[flexibleTask] Elicitation error:", error);
                await extra.taskStore.updateTaskStatus(
                  task.taskId,
                  "failed",
                  error instanceof Error ? error.message : String(error),
                );
                return;
              }
            }

            // Handle sampling if text provided
            if (samplingText) {
              // Update task status to input_required
              await extra.taskStore.updateTaskStatus(
                task.taskId,
                "input_required",
              );

              // Send sampling request with related-task metadata
              try {
                await extra.sendRequest(
                  {
                    method: "sampling/createMessage",
                    params: {
                      messages: [
                        {
                          role: "user",
                          content: {
                            type: "text",
                            text: samplingText,
                          },
                        },
                      ],
                      maxTokens: 100,
                      _meta: {
                        [RELATED_TASK_META_KEY]: {
                          taskId: task.taskId,
                        },
                      },
                    },
                  },
                  CreateMessageResultSchema,
                );
                // Once response received, continue task
                await extra.taskStore.updateTaskStatus(task.taskId, "working");
              } catch (error) {
                console.error("[flexibleTask] Sampling error:", error);
                await extra.taskStore.updateTaskStatus(
                  task.taskId,
                  "failed",
                  error instanceof Error ? error.message : String(error),
                );
                return;
              }
            }

            // Send progress notifications if enabled
            if (progressUnits !== undefined && progressUnits > 0) {
              const units = progressUnits;
              if (progressToken !== undefined) {
                for (let i = 1; i <= units; i++) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, delayMs / units),
                  );
                  try {
                    await extra.sendNotification({
                      method: "notifications/progress",
                      params: {
                        progress: i,
                        total: units,
                        message: `Processing... ${i}/${units}`,
                        progressToken,
                        _meta: {
                          [RELATED_TASK_META_KEY]: {
                            taskId: task.taskId,
                          },
                        },
                      },
                    });
                  } catch (error) {
                    console.error(
                      "[flexibleTask] Progress notification error:",
                      error,
                    );
                  }
                }
              }
            } else {
              // Wait for delay if no progress
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }

            // Check for failure
            if (failAfterDelay !== undefined) {
              await new Promise((resolve) =>
                setTimeout(resolve, failAfterDelay),
              );
              await extra.taskStore.updateTaskStatus(
                task.taskId,
                "failed",
                "Task failed as configured",
              );
              return;
            }

            // Check for cancellation
            if (cancelAfterDelay !== undefined) {
              await new Promise((resolve) =>
                setTimeout(resolve, cancelAfterDelay),
              );
              await extra.taskStore.updateTaskStatus(task.taskId, "cancelled");
              return;
            }

            // Complete the task
            // Store result BEFORE updating status to ensure it's available when SDK fetches it
            const result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    message: `Task completed: ${message || "no message"}`,
                    taskId: task.taskId,
                  }),
                },
              ],
            };
            await extra.taskStore.storeTaskResult(
              task.taskId,
              "completed",
              result,
            );
            await extra.taskStore.updateTaskStatus(task.taskId, "completed");
          } catch (error) {
            // Only update status if task is not already in a terminal state
            try {
              const currentTask = await extra.taskStore.getTask(task.taskId);
              if (
                currentTask &&
                currentTask.status !== "completed" &&
                currentTask.status !== "failed" &&
                currentTask.status !== "cancelled"
              ) {
                await extra.taskStore.updateTaskStatus(
                  task.taskId,
                  "failed",
                  error instanceof Error ? error.message : String(error),
                );
              }
            } catch (statusError) {
              // Ignore errors when checking/updating status
              console.error(
                "[flexibleTask] Error checking/updating task status:",
                statusError,
              );
            }
          }
        })();

        return {
          task,
        };
      },
      getTask: async (
        _args: ShapeOutput<{ message?: z.ZodString }>,
        extra: TaskRequestHandlerExtra,
      ): Promise<GetTaskResult> => {
        // taskId is already in extra for TaskRequestHandlerExtra
        // SDK extracts taskId from request and provides it in extra.taskId
        // args parameter is present due to inputSchema but not used here
        // GetTaskResult is the task object itself, not a wrapper
        const task = await extra.taskStore.getTask(extra.taskId);
        return task as GetTaskResult;
      },
      getTaskResult: async (
        _args: ShapeOutput<{ message?: z.ZodString }>,
        extra: TaskRequestHandlerExtra,
      ): Promise<CallToolResult> => {
        // taskId is already in extra for TaskRequestHandlerExtra
        // SDK extracts taskId from request and provides it in extra.taskId
        // args parameter is present due to inputSchema but not used here
        // getTaskResult returns Result, but handler must return CallToolResult
        const result = await extra.taskStore.getTaskResult(extra.taskId);
        // Ensure result has content field (CallToolResult requirement)
        if (!result.content) {
          throw new Error("Task result does not have content field");
        }
        return result as CallToolResult;
      },
    },
  };

  return taskTool;
}

/**
 * Create a simple task tool that completes after a delay
 */
export function createSimpleTaskTool(
  name: string = "simpleTask",
  delayMs: number = 1000,
): TaskToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "required",
    delayMs,
  }) as TaskToolDefinition;
}

/**
 * Create a task tool that sends progress notifications
 */
export function createProgressTaskTool(
  name: string = "progressTask",
  delayMs: number = 2000,
  progressUnits: number = 5,
): TaskToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "required",
    delayMs,
    progressUnits,
  }) as TaskToolDefinition;
}

/**
 * Create a task tool that requires elicitation input
 */
export function createElicitationTaskTool(
  name: string = "elicitationTask",
  elicitationSchema?: z.ZodTypeAny,
): TaskToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "required",
    elicitationSchema:
      elicitationSchema ||
      z.object({
        input: z.string().describe("User input required for task"),
      }),
  }) as TaskToolDefinition;
}

/**
 * Create a task tool that requires sampling input
 */
export function createSamplingTaskTool(
  name: string = "samplingTask",
  samplingText?: string,
): TaskToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "required",
    samplingText: samplingText || "Please provide a response for this task",
  }) as TaskToolDefinition;
}

/**
 * Create a task tool with optional task support
 */
export function createOptionalTaskTool(
  name: string = "optionalTask",
  delayMs: number = 500,
): TaskToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "optional",
    delayMs,
  }) as TaskToolDefinition;
}

/**
 * Create a task tool that is forbidden from using tasks (returns immediately)
 */
export function createForbiddenTaskTool(
  name: string = "forbiddenTask",
  delayMs: number = 100,
): ToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "forbidden",
    delayMs,
  }) as ToolDefinition;
}

/**
 * Create a task tool that returns immediately even if taskSupport is required
 * (for testing callTool() with task-supporting tools)
 */
export function createImmediateReturnTaskTool(
  name: string = "immediateReturnTask",
  delayMs: number = 100,
): ToolDefinition {
  return createFlexibleTaskTool({
    name,
    taskSupport: "required",
    immediateReturn: true,
    delayMs,
  }) as ToolDefinition;
}

/**
 * Get a server config with task support and task tools for testing
 */
export function getTaskServerConfig(): ServerConfig {
  return {
    serverInfo: createTestServerInfo("test-task-server", "1.0.0"),
    tasks: {
      list: true,
      cancel: true,
    },
    tools: [
      createSimpleTaskTool(),
      createProgressTaskTool(),
      createElicitationTaskTool(),
      createSamplingTaskTool(),
      createOptionalTaskTool(),
      createForbiddenTaskTool(),
      createImmediateReturnTaskTool(),
    ],
    logging: true, // Required for notifications/message and progress
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
