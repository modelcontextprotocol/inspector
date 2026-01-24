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
  ResourceDefinition,
  PromptDefinition,
  ResourceTemplateDefinition,
  ServerConfig,
  TestServerContext,
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

      const message = params.message as string;
      const schema = params.schema as any;

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
 * Create a tool that removes a prompt from the server by name and sends list_changed notification
 */
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
