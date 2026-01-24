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
import type {
  Implementation,
  ListResourcesResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  RegisteredTool,
  RegisteredResource,
  RegisteredPrompt,
  RegisteredResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";

type ToolInputSchema = ZodRawShapeCompat;
type PromptArgsSchema = ZodRawShapeCompat;

interface ServerState {
  registeredTools: Map<string, RegisteredTool>; // Keyed by name
  registeredResources: Map<string, RegisteredResource>; // Keyed by URI
  registeredPrompts: Map<string, RegisteredPrompt>; // Keyed by name
  registeredResourceTemplates: Map<string, RegisteredResourceTemplate>; // Keyed by uriTemplate
  listChangedConfig: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  resourceSubscriptions: Set<string>; // Set of subscribed resource URIs
}

/**
 * Context object passed to tool handlers containing both server and state
 */
export interface TestServerContext {
  server: McpServer;
  state: ServerState;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  handler: (
    params: Record<string, any>,
    context?: TestServerContext,
  ) => Promise<any>;
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
  argsSchema?: PromptArgsSchema; // Can include completable() schemas
  // Optional completion callbacks keyed by argument name
  // This is a convenience - users can also use completable() directly in argsSchema
  completions?: Record<
    string,
    (
      argumentValue: string,
      context?: Record<string, string>,
    ) => Promise<string[]> | string[]
  >;
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
  // Optional callbacks for resource template operations
  // list: Can return either:
  //   - string[] (convenience - will be converted to ListResourcesResult with uri and name)
  //   - ListResourcesResult (full control - includes uri, name, description, mimeType, etc.)
  list?:
    | (() => Promise<string[]> | string[])
    | (() => Promise<ListResourcesResult> | ListResourcesResult);
  // complete: Map of variable names to completion callbacks
  // OR a single callback function that will be used for all variables
  complete?:
    | Record<
        string,
        (
          value: string,
          context?: Record<string, string>,
        ) => Promise<string[]> | string[]
      >
    | ((
        argumentName: string,
        argumentValue: string,
        context?: Record<string, string>,
      ) => Promise<string[]> | string[]);
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
  onRegisterResource?: (resource: ResourceDefinition) =>
    | (() => Promise<{
        contents: Array<{ uri: string; mimeType?: string; text: string }>;
      }>)
    | undefined; // Optional callback to customize resource handler during registration
  serverType?: "sse" | "streamable-http"; // Transport type (default: "streamable-http")
  port?: number; // Port to use (optional, will find available port if not specified)
  /**
   * Whether to advertise listChanged capability for each list type
   * If enabled, modification tools will send list_changed notifications
   */
  listChanged?: {
    tools?: boolean; // default: false
    resources?: boolean; // default: false
    prompts?: boolean; // default: false
  };
  /**
   * Whether to advertise resource subscriptions capability
   * If enabled, server will advertise resources.subscribe capability
   */
  subscriptions?: boolean; // default: false
}

/**
 * Create and configure an McpServer instance from ServerConfig
 * This centralizes the setup logic shared between HTTP and stdio test servers
 */
export function createMcpServer(config: ServerConfig): McpServer {
  // Build capabilities based on config
  const capabilities: {
    tools?: {};
    resources?: { subscribe?: boolean };
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
    // Add subscribe capability if subscriptions are enabled
    if (config.subscriptions === true) {
      capabilities.resources.subscribe = true;
    }
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

  // Create state (this is really session state, which is what we'll call it if we implement sessions at some point)
  const state: ServerState = {
    registeredTools: new Map(), // Keyed by name
    registeredResources: new Map(), // Keyed by URI
    registeredPrompts: new Map(), // Keyed by name
    registeredResourceTemplates: new Map(), // Keyed by uriTemplate
    listChangedConfig: config.listChanged || {},
    resourceSubscriptions: new Set<string>(), // Track subscribed resource URIs
  };

  // Create context object
  const context: TestServerContext = {
    server: mcpServer,
    state,
  };

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

  // Set up resource subscription handlers if subscriptions are enabled
  if (config.subscriptions === true) {
    mcpServer.server.setRequestHandler(
      SubscribeRequestSchema,
      async (request) => {
        // Track subscription in state (accessible via closure)
        const uri = request.params.uri;
        state.resourceSubscriptions.add(uri);
        return {};
      },
    );

    mcpServer.server.setRequestHandler(
      UnsubscribeRequestSchema,
      async (request) => {
        // Remove subscription from state (accessible via closure)
        const uri = request.params.uri;
        state.resourceSubscriptions.delete(uri);
        return {};
      },
    );
  }

  // Set up tools
  if (config.tools && config.tools.length > 0) {
    for (const tool of config.tools) {
      const registered = mcpServer.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args) => {
          const result = await tool.handler(
            args as Record<string, any>,
            context, // Pass context instead of mcpServer
          );
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
      state.registeredTools.set(tool.name, registered);
    }
  }

  // Set up resources
  if (config.resources && config.resources.length > 0) {
    for (const resource of config.resources) {
      // Check if there's a custom handler from the callback
      const customHandler = config.onRegisterResource
        ? config.onRegisterResource(resource)
        : undefined;

      const registered = mcpServer.registerResource(
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
      state.registeredResources.set(resource.uri, registered);
    }
  }

  // Set up resource templates
  if (config.resourceTemplates && config.resourceTemplates.length > 0) {
    for (const template of config.resourceTemplates) {
      // ResourceTemplate is a class - create an instance with the URI template string and callbacks
      // Convert list callback: SDK expects ListResourcesResult
      // We support both string[] (convenience) and ListResourcesResult (full control)
      const listCallback = template.list
        ? async () => {
            const result = template.list!();
            const resolved = await result;
            // Check if it's already a ListResourcesResult (has resources array)
            if (
              resolved &&
              typeof resolved === "object" &&
              "resources" in resolved
            ) {
              return resolved as ListResourcesResult;
            }
            // Otherwise, it's string[] - convert to ListResourcesResult
            const uriArray = resolved as string[];
            return {
              resources: uriArray.map((uri) => ({
                uri,
                name: uri, // Use URI as name if not provided
              })),
            };
          }
        : undefined;

      // Convert complete callback: SDK expects {[variable: string]: callback}
      // We support either a map or a single function
      let completeCallbacks:
        | {
            [variable: string]: (
              value: string,
              context?: { arguments?: Record<string, string> },
            ) => Promise<string[]> | string[];
          }
        | undefined = undefined;

      if (template.complete) {
        if (typeof template.complete === "function") {
          // Single function - extract variable names from URI template and use for all
          // Parse URI template to find variables (e.g., {file} from "file://{file}")
          const variableMatches = template.uriTemplate.match(/\{([^}]+)\}/g);
          if (variableMatches) {
            completeCallbacks = {};
            const completeFn = template.complete;
            for (const match of variableMatches) {
              const variableName = match.slice(1, -1); // Remove { and }
              completeCallbacks[variableName] = async (
                value: string,
                context?: { arguments?: Record<string, string> },
              ) => {
                const result = completeFn(
                  variableName,
                  value,
                  context?.arguments,
                );
                return Array.isArray(result) ? result : await result;
              };
            }
          }
        } else {
          // Map of variable names to callbacks
          completeCallbacks = {};
          for (const [variableName, callback] of Object.entries(
            template.complete,
          )) {
            completeCallbacks[variableName] = async (
              value: string,
              context?: { arguments?: Record<string, string> },
            ) => {
              const result = callback(value, context?.arguments);
              return Array.isArray(result) ? result : await result;
            };
          }
        }
      }

      const resourceTemplate = new ResourceTemplate(template.uriTemplate, {
        list: listCallback,
        complete: completeCallbacks,
      });

      const registered = mcpServer.registerResource(
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
      state.registeredResourceTemplates.set(template.uriTemplate, registered);
    }
  }

  // Set up prompts
  if (config.prompts && config.prompts.length > 0) {
    for (const prompt of config.prompts) {
      // Build argsSchema with completion support if provided
      let argsSchema = prompt.argsSchema;

      // If completions callbacks are provided, wrap the corresponding schemas
      if (prompt.completions && argsSchema) {
        const enhancedSchema: Record<string, any> = { ...argsSchema };
        for (const [argName, completeCallback] of Object.entries(
          prompt.completions,
        )) {
          if (enhancedSchema[argName]) {
            // Wrap the existing schema with completable
            enhancedSchema[argName] = completable(
              enhancedSchema[argName],
              async (
                value: any,
                context?: { arguments?: Record<string, string> },
              ) => {
                const result = completeCallback(
                  String(value),
                  context?.arguments,
                );
                return Array.isArray(result) ? result : await result;
              },
            );
          }
        }
        argsSchema = enhancedSchema;
      }

      const registered = mcpServer.registerPrompt(
        prompt.name,
        {
          description: prompt.description,
          argsSchema: argsSchema,
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
      state.registeredPrompts.set(prompt.name, registered);
    }
  }

  return mcpServer;
}
