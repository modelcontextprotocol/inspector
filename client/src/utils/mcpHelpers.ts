import {
  ClientRequest,
  ClientNotification,
  CompatibilityCallToolResult,
  CompatibilityCallToolResultSchema,
  CreateMessageResult,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  Resource,
  ResourceTemplate,
  Tool,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Prompt } from "../components/PromptsTab";
import { PendingRequest } from "../components/SamplingTab";
import { StdErrNotification } from "../lib/notificationTypes";

// Types for function dependencies
export interface MCPHelperDependencies {
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
  ) => Promise<z.infer<T>>;
  sendNotification: (notification: ClientNotification) => Promise<void>;
  setErrors: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
  setResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  setResourceTemplates: React.Dispatch<
    React.SetStateAction<ResourceTemplate[]>
  >;
  setResourceContent: React.Dispatch<React.SetStateAction<string>>;
  setResourceSubscriptions: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPrompts: React.Dispatch<React.SetStateAction<Prompt[]>>;
  setPromptContent: React.Dispatch<React.SetStateAction<string>>;
  setTools: React.Dispatch<React.SetStateAction<Tool[]>>;
  setToolResult: React.Dispatch<
    React.SetStateAction<CompatibilityCallToolResult | null>
  >;
  setNextResourceCursor: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  setNextResourceTemplateCursor: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  setNextPromptCursor: React.Dispatch<React.SetStateAction<string | undefined>>;
  setNextToolCursor: React.Dispatch<React.SetStateAction<string | undefined>>;
  setLogLevel: React.Dispatch<React.SetStateAction<LoggingLevel>>;
  setStdErrNotifications: React.Dispatch<
    React.SetStateAction<StdErrNotification[]>
  >;
  setPendingSampleRequests: React.Dispatch<
    React.SetStateAction<
      Array<
        PendingRequest & {
          resolve: (result: CreateMessageResult) => void;
          reject: (error: Error) => void;
        }
      >
    >
  >;
  progressTokenRef: React.MutableRefObject<number>;
}

export interface MCPHelperState {
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  resourceSubscriptions: Set<string>;
  nextResourceCursor?: string;
  nextResourceTemplateCursor?: string;
  nextPromptCursor?: string;
  nextToolCursor?: string;
}

// Helper function to clear errors for a specific tab
export const clearError = (
  tabKey: keyof Record<string, string | null>,
  setErrors: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >,
) => {
  setErrors((prev) => ({ ...prev, [tabKey]: null }));
};

// Generic MCP request handler with error management
export const sendMCPRequest = async <T extends z.ZodType>(
  request: ClientRequest,
  schema: T,
  dependencies: Pick<MCPHelperDependencies, "makeRequest" | "setErrors">,
  tabKey?: keyof Record<string, string | null>,
) => {
  try {
    const response = await dependencies.makeRequest(request, schema);
    if (tabKey !== undefined) {
      clearError(tabKey, dependencies.setErrors);
    }
    return response;
  } catch (e) {
    const errorString = (e as Error).message ?? String(e);
    if (tabKey !== undefined) {
      dependencies.setErrors((prev) => ({
        ...prev,
        [tabKey]: errorString,
      }));
    }
    throw e;
  }
};

// Sampling helpers
export const handleApproveSampling = (
  id: number,
  result: CreateMessageResult,
  setPendingSampleRequests: React.Dispatch<
    React.SetStateAction<
      Array<
        PendingRequest & {
          resolve: (result: CreateMessageResult) => void;
          reject: (error: Error) => void;
        }
      >
    >
  >,
) => {
  setPendingSampleRequests((prev) => {
    const request = prev.find((r) => r.id === id);
    request?.resolve(result);
    return prev.filter((r) => r.id !== id);
  });
};

export const handleRejectSampling = (
  id: number,
  setPendingSampleRequests: React.Dispatch<
    React.SetStateAction<
      Array<
        PendingRequest & {
          resolve: (result: CreateMessageResult) => void;
          reject: (error: Error) => void;
        }
      >
    >
  >,
) => {
  setPendingSampleRequests((prev) => {
    const request = prev.find((r) => r.id === id);
    request?.reject(new Error("Sampling request rejected"));
    return prev.filter((r) => r.id !== id);
  });
};

// Resource helpers
export const listResources = async (
  state: Pick<MCPHelperState, "resources" | "nextResourceCursor">,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setResources" | "setNextResourceCursor"
  >,
) => {
  const response = await sendMCPRequest(
    {
      method: "resources/list" as const,
      params: state.nextResourceCursor
        ? { cursor: state.nextResourceCursor }
        : {},
    },
    ListResourcesResultSchema,
    dependencies,
    "resources",
  );
  dependencies.setResources(state.resources.concat(response.resources ?? []));
  dependencies.setNextResourceCursor(response.nextCursor);
};

export const listResourceTemplates = async (
  state: Pick<
    MCPHelperState,
    "resourceTemplates" | "nextResourceTemplateCursor"
  >,
  dependencies: Pick<
    MCPHelperDependencies,
    | "makeRequest"
    | "setErrors"
    | "setResourceTemplates"
    | "setNextResourceTemplateCursor"
  >,
) => {
  const response = await sendMCPRequest(
    {
      method: "resources/templates/list" as const,
      params: state.nextResourceTemplateCursor
        ? { cursor: state.nextResourceTemplateCursor }
        : {},
    },
    ListResourceTemplatesResultSchema,
    dependencies,
    "resources",
  );
  dependencies.setResourceTemplates(
    state.resourceTemplates.concat(response.resourceTemplates ?? []),
  );
  dependencies.setNextResourceTemplateCursor(response.nextCursor);
};

export const readResource = async (
  uri: string,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setResourceContent"
  >,
) => {
  const response = await sendMCPRequest(
    {
      method: "resources/read" as const,
      params: { uri },
    },
    ReadResourceResultSchema,
    dependencies,
    "resources",
  );
  dependencies.setResourceContent(JSON.stringify(response, null, 2));
};

export const subscribeToResource = async (
  uri: string,
  state: Pick<MCPHelperState, "resourceSubscriptions">,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setResourceSubscriptions"
  >,
) => {
  if (!state.resourceSubscriptions.has(uri)) {
    await sendMCPRequest(
      {
        method: "resources/subscribe" as const,
        params: { uri },
      },
      z.object({}),
      dependencies,
      "resources",
    );
    const clone = new Set(state.resourceSubscriptions);
    clone.add(uri);
    dependencies.setResourceSubscriptions(clone);
  }
};

export const unsubscribeFromResource = async (
  uri: string,
  state: Pick<MCPHelperState, "resourceSubscriptions">,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setResourceSubscriptions"
  >,
) => {
  if (state.resourceSubscriptions.has(uri)) {
    await sendMCPRequest(
      {
        method: "resources/unsubscribe" as const,
        params: { uri },
      },
      z.object({}),
      dependencies,
      "resources",
    );
    const clone = new Set(state.resourceSubscriptions);
    clone.delete(uri);
    dependencies.setResourceSubscriptions(clone);
  }
};

// Prompt helpers
export const listPrompts = async (
  state: Pick<MCPHelperState, "nextPromptCursor">,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setPrompts" | "setNextPromptCursor"
  >,
) => {
  const response = await sendMCPRequest(
    {
      method: "prompts/list" as const,
      params: state.nextPromptCursor ? { cursor: state.nextPromptCursor } : {},
    },
    ListPromptsResultSchema,
    dependencies,
    "prompts",
  );
  dependencies.setPrompts(response.prompts);
  dependencies.setNextPromptCursor(response.nextCursor);
};

export const getPrompt = async (
  name: string,
  args: Record<string, string> = {},
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setPromptContent"
  >,
) => {
  const response = await sendMCPRequest(
    {
      method: "prompts/get" as const,
      params: { name, arguments: args },
    },
    GetPromptResultSchema,
    dependencies,
    "prompts",
  );
  dependencies.setPromptContent(JSON.stringify(response, null, 2));
};

// Tool helpers
export const listTools = async (
  state: Pick<MCPHelperState, "nextToolCursor">,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setTools" | "setNextToolCursor"
  >,
) => {
  const response = await sendMCPRequest(
    {
      method: "tools/list" as const,
      params: state.nextToolCursor ? { cursor: state.nextToolCursor } : {},
    },
    ListToolsResultSchema,
    dependencies,
    "tools",
  );
  dependencies.setTools(response.tools);
  dependencies.setNextToolCursor(response.nextCursor);
};

export const callTool = async (
  name: string,
  params: Record<string, unknown>,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setToolResult" | "progressTokenRef"
  >,
) => {
  try {
    const response = await sendMCPRequest(
      {
        method: "tools/call" as const,
        params: {
          name,
          arguments: params,
          _meta: {
            progressToken: dependencies.progressTokenRef.current++,
          },
        },
      },
      CompatibilityCallToolResultSchema,
      dependencies,
      "tools",
    );
    dependencies.setToolResult(response);
  } catch (e) {
    const toolResult: CompatibilityCallToolResult = {
      content: [
        {
          type: "text",
          text: (e as Error).message ?? String(e),
        },
      ],
      isError: true,
    };
    dependencies.setToolResult(toolResult);
  }
};

// Other helpers
export const handleRootsChange = async (
  dependencies: Pick<MCPHelperDependencies, "sendNotification">,
) => {
  await dependencies.sendNotification({
    method: "notifications/roots/list_changed",
  });
};

export const sendLogLevelRequest = async (
  level: LoggingLevel,
  dependencies: Pick<
    MCPHelperDependencies,
    "makeRequest" | "setErrors" | "setLogLevel"
  >,
) => {
  await sendMCPRequest(
    {
      method: "logging/setLevel" as const,
      params: { level },
    },
    z.object({}),
    dependencies,
  );
  dependencies.setLogLevel(level);
};

export const clearStdErrNotifications = (
  setStdErrNotifications: React.Dispatch<
    React.SetStateAction<StdErrNotification[]>
  >,
) => {
  setStdErrNotifications([]);
};
