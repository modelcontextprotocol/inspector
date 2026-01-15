#!/usr/bin/env node

/**
 * Simple test MCP server for stdio transport testing
 * Provides basic tools, resources, and prompts for CLI validation
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const server = new McpServer(
  {
    name: "test-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      logging: {},
    },
  },
);

// Register echo tool
server.registerTool(
  "echo",
  {
    description: "Echo back the input message",
    inputSchema: {
      message: z.string().describe("Message to echo back"),
    },
  },
  async ({ message }) => {
    return {
      content: [
        {
          type: "text",
          text: `Echo: ${message}`,
        },
      ],
    };
  },
);

// Register get-sum tool (used by tests)
server.registerTool(
  "get-sum",
  {
    description: "Get the sum of two numbers",
    inputSchema: {
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    },
  },
  async ({ a, b }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ result: a + b }),
        },
      ],
    };
  },
);

// Register get-annotated-message tool (used by tests)
server.registerTool(
  "get-annotated-message",
  {
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
  },
  async ({ messageType, includeImage }) => {
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
);

// Register simple-prompt
server.registerPrompt(
  "simple-prompt",
  {
    description: "A simple prompt for testing",
  },
  async () => {
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
  },
);

// Register args-prompt (accepts arguments)
server.registerPrompt(
  "args-prompt",
  {
    description: "A prompt that accepts arguments for testing",
    argsSchema: {
      city: z.string().describe("City name"),
      state: z.string().describe("State name"),
    },
  },
  async ({ city, state }) => {
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
  },
);

// Register demo resource
server.registerResource(
  "architecture",
  "demo://resource/static/document/architecture.md",
  {
    description: "Architecture documentation",
    mimeType: "text/markdown",
  },
  async () => {
    return {
      contents: [
        {
          uri: "demo://resource/static/document/architecture.md",
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
        },
      ],
    };
  },
);

// Register test resources for verifying server startup state
// CWD resource - exposes current working directory
server.registerResource(
  "test-cwd",
  "test://cwd",
  {
    description: "Current working directory of the test server",
    mimeType: "text/plain",
  },
  async () => {
    return {
      contents: [
        {
          uri: "test://cwd",
          mimeType: "text/plain",
          text: process.cwd(),
        },
      ],
    };
  },
);

// Environment variables resource - exposes all env vars as JSON
server.registerResource(
  "test-env",
  "test://env",
  {
    description: "Environment variables available to the test server",
    mimeType: "application/json",
  },
  async () => {
    return {
      contents: [
        {
          uri: "test://env",
          mimeType: "application/json",
          text: JSON.stringify(process.env, null, 2),
        },
      ],
    };
  },
);

// Command-line arguments resource - exposes process.argv
server.registerResource(
  "test-argv",
  "test://argv",
  {
    description: "Command-line arguments the test server was started with",
    mimeType: "application/json",
  },
  async () => {
    return {
      contents: [
        {
          uri: "test://argv",
          mimeType: "application/json",
          text: JSON.stringify(process.argv, null, 2),
        },
      ],
    };
  },
);

// Connect to stdio transport and start
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => {
    // Server is now running and listening on stdio
    // Keep the process alive
  })
  .catch((error) => {
    console.error("Failed to start test MCP server:", error);
    process.exit(1);
  });
