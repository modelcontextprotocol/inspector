/**
 * Composable Test Server
 *
 * Provides types and functions for creating MCP test servers from configuration.
 * This allows composing MCP test servers with different capabilities, tools, resources, and prompts.
 */

import {
  McpServer,
  ResourceTemplate as SdkResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  Implementation,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import {
  InMemoryTaskStore,
  InMemoryTaskMessageQueue,
} from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import type {
  TaskStore,
  TaskMessageQueue,
  ToolTaskHandler,
} from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type {
  RegisteredTool,
  RegisteredResource,
  RegisteredPrompt,
  RegisteredResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerRequest,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import {
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  type ListToolsResult,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  type ListPromptsResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ZodRawShapeCompat,
  getObjectShape,
  getSchemaDescription,
  isSchemaOptional,
  normalizeObjectSchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { PromptArgument } from "@modelcontextprotocol/sdk/types.js";

// Empty object JSON schema constant (from SDK's mcp.js)
const EMPTY_OBJECT_JSON_SCHEMA = {
  type: "object",
  properties: {},
} as const;

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
    extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => Promise<any>;
}

export interface TaskToolDefinition {
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  execution?: { taskSupport: "required" | "optional" };
  handler: ToolTaskHandler<ToolInputSchema | undefined>;
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
    context?: TestServerContext,
    extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
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
  tools?: (ToolDefinition | TaskToolDefinition)[]; // Tools to register (optional, empty array means no tools, but tools capability is still advertised)
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
  /**
   * Maximum page size for pagination (optional, undefined means no pagination)
   * When set, custom list handlers will paginate results using this page size
   */
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  /**
   * Whether to advertise tasks capability
   * If enabled, server will advertise tasks capability with list and cancel support
   */
  tasks?: {
    list?: boolean; // default: true
    cancel?: boolean; // default: true
  };
  /**
   * Task store implementation (optional, defaults to InMemoryTaskStore)
   * Only used if tasks capability is enabled
   */
  taskStore?: TaskStore;
  /**
   * Task message queue implementation (optional, defaults to InMemoryTaskMessageQueue)
   * Only used if tasks capability is enabled
   */
  taskMessageQueue?: TaskMessageQueue;
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
    tasks?: {
      list?: {};
      cancel?: {};
      requests?: { tools?: { call?: {} } };
    };
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
  if (config.tasks !== undefined) {
    capabilities.tasks = {
      list: config.tasks.list !== false ? {} : undefined,
      cancel: config.tasks.cancel !== false ? {} : undefined,
      requests: { tools: { call: {} } },
    };
    // Remove undefined values
    if (capabilities.tasks.list === undefined) {
      delete capabilities.tasks.list;
    }
    if (capabilities.tasks.cancel === undefined) {
      delete capabilities.tasks.cancel;
    }
  }

  // Create task store and message queue if tasks are enabled
  const taskStore =
    config.tasks !== undefined
      ? config.taskStore || new InMemoryTaskStore()
      : undefined;
  const taskMessageQueue =
    config.tasks !== undefined
      ? config.taskMessageQueue || new InMemoryTaskMessageQueue()
      : undefined;

  // Create the server with capabilities and task stores
  const mcpServer = new McpServer(config.serverInfo, {
    capabilities,
    taskStore,
    taskMessageQueue,
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

  // Type guard to check if a tool is a task tool
  function isTaskTool(
    tool: ToolDefinition | TaskToolDefinition,
  ): tool is TaskToolDefinition {
    return (
      "handler" in tool &&
      typeof tool.handler === "object" &&
      tool.handler !== null &&
      "createTask" in tool.handler
    );
  }

  // Set up tools
  if (config.tools && config.tools.length > 0) {
    for (const tool of config.tools) {
      if (isTaskTool(tool)) {
        // Register task-based tool
        // registerToolTask has two overloads: one with inputSchema (required) and one without
        const registered = tool.inputSchema
          ? mcpServer.experimental.tasks.registerToolTask(
              tool.name,
              {
                description: tool.description,
                inputSchema: tool.inputSchema,
                execution: tool.execution,
              },
              tool.handler,
            )
          : mcpServer.experimental.tasks.registerToolTask(
              tool.name,
              {
                description: tool.description,
                execution: tool.execution,
              },
              tool.handler,
            );
        state.registeredTools.set(tool.name, registered);
      } else {
        // Register regular tool
        const registered = mcpServer.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.inputSchema,
          },
          async (args, extra) => {
            const result = await tool.handler(
              args as Record<string, any>,
              context,
              extra,
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

      const resourceTemplate = new SdkResourceTemplate(template.uriTemplate, {
        list: listCallback,
        complete: completeCallbacks,
      });

      const registered = mcpServer.registerResource(
        template.name,
        resourceTemplate,
        {
          description: template.description,
        },
        async (uri: URL, variables: Record<string, any>, extra) => {
          const result = await template.handler(uri, variables, context, extra);
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

  // Set up pagination handlers if maxPageSize is configured
  const maxPageSize = config.maxPageSize || {};

  // Tools pagination
  if (capabilities.tools && maxPageSize.tools !== undefined) {
    mcpServer.server.setRequestHandler(
      ListToolsRequestSchema,
      async (request) => {
        const cursor = request.params?.cursor;
        const pageSize = maxPageSize.tools!;

        // Convert registered tools to Tool format using the same logic as the SDK (mcp.js lines 67-95)
        const allTools: Tool[] = [];
        for (const [name, registered] of state.registeredTools.entries()) {
          if (registered.enabled) {
            // Match SDK's approach exactly (mcp.js lines 71-95)
            const toolDefinition: any = {
              name,
              title: registered.title,
              description: registered.description,
              inputSchema: (() => {
                const obj = normalizeObjectSchema(registered.inputSchema);
                return obj
                  ? toJsonSchemaCompat(obj, {
                      strictUnions: true,
                      pipeStrategy: "input",
                    })
                  : EMPTY_OBJECT_JSON_SCHEMA;
              })(),
              annotations: registered.annotations,
              execution: registered.execution,
              _meta: registered._meta,
            };

            if (registered.outputSchema) {
              const obj = normalizeObjectSchema(registered.outputSchema);
              if (obj) {
                toolDefinition.outputSchema = toJsonSchemaCompat(obj, {
                  strictUnions: true,
                  pipeStrategy: "output",
                });
              }
            }

            allTools.push(toolDefinition as Tool);
          }
        }

        const startIndex = cursor ? parseInt(cursor, 10) : 0;
        const endIndex = startIndex + pageSize;
        const page = allTools.slice(startIndex, endIndex);
        const nextCursor =
          endIndex < allTools.length ? endIndex.toString() : undefined;

        return {
          tools: page,
          nextCursor,
        } as ListToolsResult;
      },
    );
  }

  // Resources pagination
  if (capabilities.resources && maxPageSize.resources !== undefined) {
    mcpServer.server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request, extra) => {
        const cursor = request.params?.cursor;
        const pageSize = maxPageSize.resources!;

        // Collect all resources (static + from templates)
        const allResources: Resource[] = [];

        // Add static resources from registered resources
        for (const [uri, registered] of state.registeredResources.entries()) {
          if (registered.enabled) {
            allResources.push({
              uri,
              name: registered.name,
              title: registered.title,
              description: registered.metadata?.description,
              mimeType: registered.metadata?.mimeType,
              icons: registered.metadata?.icons,
            } as Resource);
          }
        }

        // Add resources from templates (if list callback exists)
        for (const template of state.registeredResourceTemplates.values()) {
          if (template.enabled && template.resourceTemplate.listCallback) {
            try {
              const result =
                await template.resourceTemplate.listCallback(extra);
              for (const resource of result.resources) {
                allResources.push({
                  ...resource,
                  // Merge template metadata if resource doesn't have it
                  name: resource.name,
                  description:
                    resource.description || template.metadata?.description,
                  mimeType: resource.mimeType || template.metadata?.mimeType,
                  icons: resource.icons || template.metadata?.icons,
                } as Resource);
              }
            } catch (error) {
              // Ignore errors from list callbacks
            }
          }
        }

        const startIndex = cursor ? parseInt(cursor, 10) : 0;
        const endIndex = startIndex + pageSize;
        const page = allResources.slice(startIndex, endIndex);
        const nextCursor =
          endIndex < allResources.length ? endIndex.toString() : undefined;

        return {
          resources: page,
          nextCursor,
        } as ListResourcesResult;
      },
    );
  }

  // Resource templates pagination
  if (capabilities.resources && maxPageSize.resourceTemplates !== undefined) {
    mcpServer.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (request) => {
        const cursor = request.params?.cursor;
        const pageSize = maxPageSize.resourceTemplates!;

        // Convert registered resource templates to ResourceTemplate format
        const allTemplates: Array<{
          uriTemplate: string;
          name: string;
          description?: string;
          mimeType?: string;
          icons?: Array<{
            src: string;
            mimeType?: string;
            sizes?: string[];
            theme?: "light" | "dark";
          }>;
          title?: string;
        }> = [];
        for (const [
          uriTemplate,
          registered,
        ] of state.registeredResourceTemplates.entries()) {
          if (registered.enabled) {
            // Find the name from config by matching uriTemplate
            const templateDef = config.resourceTemplates?.find(
              (t) => t.uriTemplate === uriTemplate,
            );
            allTemplates.push({
              uriTemplate: registered.resourceTemplate.uriTemplate.toString(),
              name: templateDef?.name || uriTemplate, // Fallback to uriTemplate if name not found
              title: registered.title,
              description:
                registered.metadata?.description || templateDef?.description,
              mimeType: registered.metadata?.mimeType,
              icons: registered.metadata?.icons,
            });
          }
        }

        const startIndex = cursor ? parseInt(cursor, 10) : 0;
        const endIndex = startIndex + pageSize;
        const page = allTemplates.slice(startIndex, endIndex);
        const nextCursor =
          endIndex < allTemplates.length ? endIndex.toString() : undefined;

        return {
          resourceTemplates: page as ResourceTemplate[],
          nextCursor,
        } as ListResourceTemplatesResult;
      },
    );
  }

  // Prompts pagination
  if (capabilities.prompts && maxPageSize.prompts !== undefined) {
    mcpServer.server.setRequestHandler(
      ListPromptsRequestSchema,
      async (request) => {
        const cursor = request.params?.cursor;
        const pageSize = maxPageSize.prompts!;

        // Convert registered prompts to Prompt format using the same logic as the SDK
        const allPrompts: Prompt[] = [];
        for (const [name, prompt] of state.registeredPrompts.entries()) {
          if (prompt.enabled) {
            // Use the same conversion logic the SDK uses (from mcp.js line 408-419)
            const shape = prompt.argsSchema
              ? getObjectShape(prompt.argsSchema)
              : undefined;
            const arguments_ = shape
              ? Object.entries(shape).map(([argName, field]) => {
                  const description = getSchemaDescription(field);
                  const isOptional = isSchemaOptional(field);
                  return {
                    name: argName,
                    description,
                    required: !isOptional,
                  } as PromptArgument;
                })
              : undefined;

            allPrompts.push({
              name,
              title: prompt.title,
              description: prompt.description,
              arguments: arguments_,
            } as Prompt);
          }
        }

        const startIndex = cursor ? parseInt(cursor, 10) : 0;
        const endIndex = startIndex + pageSize;
        const page = allPrompts.slice(startIndex, endIndex);
        const nextCursor =
          endIndex < allPrompts.length ? endIndex.toString() : undefined;

        return {
          prompts: page,
          nextCursor,
        } as ListPromptsResult;
      },
    );
  }

  return mcpServer;
}
