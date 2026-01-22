/**
 * Composable Test Server
 *
 * Provides types and functions for creating MCP test servers from configuration.
 * This allows composing MCP test servers with different capabilities, tools, resources, and prompts.
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

type ToolInputSchema = ZodRawShapeCompat;
type PromptArgsSchema = ZodRawShapeCompat;

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

export interface PromptDefinition {
  name: string;
  description?: string;
  promptString: string; // The prompt text with optional {argName} placeholders
  argsSchema?: PromptArgsSchema;
}

export interface ResourceTemplateDefinition {
  name: string;
  uriTemplate: string; // URI template with {variable} placeholders (RFC 6570)
  description?: string;
  inputSchema?: ZodRawShapeCompat; // Schema for template variables
  handler: (
    uri: URL,
    params: Record<string, any>,
  ) => Promise<{
    contents: Array<{ uri: string; mimeType?: string; text: string }>;
  }>;
}

/**
 * Configuration for composing an MCP server
 */
export interface ServerConfig {
  serverInfo: Implementation; // Server metadata (name, version, etc.) - required
  tools?: ToolDefinition[]; // Tools to register (optional, empty array means no tools, but tools capability is still advertised)
  resources?: ResourceDefinition[]; // Resources to register (optional, empty array means no resources, but resources capability is still advertised)
  resourceTemplates?: ResourceTemplateDefinition[]; // Resource templates to register (optional, empty array means no templates, but resources capability is still advertised)
  prompts?: PromptDefinition[]; // Prompts to register (optional, empty array means no prompts, but prompts capability is still advertised)
  logging?: boolean; // Whether to advertise logging capability (default: false)
  onLogLevelSet?: (level: string) => void; // Optional callback when log level is set (for testing)
  onRegisterResource?: (
    resource: ResourceDefinition,
  ) =>
    | (() => Promise<{
        contents: Array<{ uri: string; mimeType?: string; text: string }>;
      }>)
    | undefined; // Optional callback to customize resource handler during registration
  serverType?: "sse" | "streamable-http"; // Transport type (default: "streamable-http")
  port?: number; // Port to use (optional, will find available port if not specified)
}

/**
 * Create and configure an McpServer instance from ServerConfig
 * This centralizes the setup logic shared between HTTP and stdio test servers
 */
export function createMcpServer(config: ServerConfig): McpServer {
  // Build capabilities based on config
  const capabilities: {
    tools?: {};
    resources?: {};
    prompts?: {};
    logging?: {};
  } = {};

  if (config.tools !== undefined) {
    capabilities.tools = {};
  }
  if (
    config.resources !== undefined ||
    config.resourceTemplates !== undefined
  ) {
    capabilities.resources = {};
  }
  if (config.prompts !== undefined) {
    capabilities.prompts = {};
  }
  if (config.logging === true) {
    capabilities.logging = {};
  }

  // Create the server with capabilities
  const mcpServer = new McpServer(config.serverInfo, {
    capabilities,
  });

  // Set up logging handler if logging is enabled
  if (config.logging === true) {
    mcpServer.server.setRequestHandler(
      SetLevelRequestSchema,
      async (request) => {
        // Call optional callback if provided (for testing)
        if (config.onLogLevelSet) {
          config.onLogLevelSet(request.params.level);
        }
        // Return empty result as per MCP spec
        return {};
      },
    );
  }

  // Set up tools
  if (config.tools && config.tools.length > 0) {
    for (const tool of config.tools) {
      mcpServer.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args) => {
          const result = await tool.handler(args as Record<string, any>);
          // Handle different return types from tool handlers
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
  if (config.resources && config.resources.length > 0) {
    for (const resource of config.resources) {
      // Check if there's a custom handler from the callback
      const customHandler = config.onRegisterResource
        ? config.onRegisterResource(resource)
        : undefined;

      mcpServer.registerResource(
        resource.name,
        resource.uri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        customHandler ||
          (async () => {
            return {
              contents: [
                {
                  uri: resource.uri,
                  mimeType: resource.mimeType || "text/plain",
                  text: resource.text ?? "",
                },
              ],
            };
          }),
      );
    }
  }

  // Set up resource templates
  if (config.resourceTemplates && config.resourceTemplates.length > 0) {
    for (const template of config.resourceTemplates) {
      // ResourceTemplate is a class - create an instance with the URI template string and callbacks
      const resourceTemplate = new ResourceTemplate(template.uriTemplate, {
        list: undefined, // We don't support listing resources from templates
        complete: undefined, // We don't support completion for template variables
      });

      mcpServer.registerResource(
        template.name,
        resourceTemplate,
        {
          description: template.description,
        },
        async (uri: URL, variables: Record<string, any>, extra?: any) => {
          const result = await template.handler(uri, variables);
          return result;
        },
      );
    }
  }

  // Set up prompts
  if (config.prompts && config.prompts.length > 0) {
    for (const prompt of config.prompts) {
      mcpServer.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
          argsSchema: prompt.argsSchema,
        },
        async (args) => {
          let text = prompt.promptString;

          // If args are provided, substitute them into the prompt string
          // Replace {argName} with the actual value
          if (args && typeof args === "object") {
            for (const [key, value] of Object.entries(args)) {
              const placeholder = `{${key}}`;
              text = text.replace(
                new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "g"),
                String(value),
              );
            }
          }

          return {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text,
                },
              },
            ],
          };
        },
      );
    }
  }

  return mcpServer;
}
