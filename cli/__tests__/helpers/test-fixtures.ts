/**
 * Shared types and test fixtures for composable MCP test servers
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

type ToolInputSchema = ZodRawShapeCompat;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  handler: (params: Record<string, any>) => Promise<any>;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  text?: string;
}

type PromptArgsSchema = ZodRawShapeCompat;

export interface PromptDefinition {
  name: string;
  description?: string;
  argsSchema?: PromptArgsSchema;
}

// This allows us to compose tests servers using the metadata and features we want in a given scenario
export interface ServerConfig {
  serverInfo: Implementation; // Server metadata (name, version, etc.) - required
  tools?: ToolDefinition[]; // Tools to register (optional, empty array means no tools, but tools capability is still advertised)
  resources?: ResourceDefinition[]; // Resources to register (optional, empty array means no resources, but resources capability is still advertised)
  prompts?: PromptDefinition[]; // Prompts to register (optional, empty array means no prompts, but prompts capability is still advertised)
  logging?: boolean; // Whether to advertise logging capability (default: false)
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
    handler: async (params: Record<string, any>) => {
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
    handler: async (params: Record<string, any>) => {
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
    handler: async (params: Record<string, any>) => {
      const a = params.a as number;
      const b = params.b as number;
      return { result: a + b };
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
    handler: async (params: Record<string, any>) => {
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
  };
}

/**
 * Create an "args-prompt" prompt that accepts arguments
 */
export function createArgsPrompt(): PromptDefinition {
  return {
    name: "args-prompt",
    description: "A prompt that accepts arguments for testing",
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
 * Get default server config with common test tools, prompts, and resources
 */
export function getDefaultServerConfig(): ServerConfig {
  return {
    serverInfo: createTestServerInfo("test-mcp-server", "1.0.0"),
    tools: [
      createEchoTool(),
      createGetSumTool(),
      createGetAnnotatedMessageTool(),
    ],
    prompts: [createSimplePrompt(), createArgsPrompt()],
    resources: [
      createArchitectureResource(),
      createTestCwdResource(),
      createTestEnvResource(),
      createTestArgvResource(),
    ],
  };
}
