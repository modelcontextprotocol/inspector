import { useState, useCallback, useRef } from "react";
import {
  Resource,
  ResourceTemplate,
  Tool,
  CompatibilityCallToolResult,
  LoggingLevel,
  Root,
  ClientRequest,
  ResourceReference,
  PromptReference,
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Prompt } from "../components/PromptsTab";
import { StdErrNotification } from "../lib/notificationTypes";
import { MCPJamAgent } from "../mcpjamAgent";
import { z } from "zod";

export interface PendingRequest {
  id: number;
  request: CreateMessageRequest;
  resolve: (result: CreateMessageResult) => void;
  reject: (error: Error) => void;
}

export const useMCPOperations = () => {
  // Resource state
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTemplates, setResourceTemplates] = useState<
    ResourceTemplate[]
  >([]);
  const [resourceContent, setResourceContent] = useState<string>("");
  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [resourceSubscriptions, setResourceSubscriptions] = useState<
    Set<string>
  >(new Set<string>());
  const [nextResourceCursor, setNextResourceCursor] = useState<
    string | undefined
  >();
  const [nextResourceTemplateCursor, setNextResourceTemplateCursor] = useState<
    string | undefined
  >();

  // Prompt state
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [promptContent, setPromptContent] = useState<string>("");
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [nextPromptCursor, setNextPromptCursor] = useState<
    string | undefined
  >();

  // Tool state
  const [tools, setTools] = useState<Tool[]>([]);
  const [toolResult, setToolResult] =
    useState<CompatibilityCallToolResult | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [nextToolCursor, setNextToolCursor] = useState<string | undefined>();

  // General state
  const [errors, setErrors] = useState<Record<string, string | null>>({
    resources: null,
    prompts: null,
    tools: null,
  });
  const [logLevel, setLogLevel] = useState<LoggingLevel>("debug");
  const [stdErrNotifications, setStdErrNotifications] = useState<
    StdErrNotification[]
  >([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [pendingSampleRequests, setPendingSampleRequests] = useState<
    PendingRequest[]
  >([]);
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);

  const progressTokenRef = useRef(0);

  // Helper functions
  const clearError = useCallback((tabKey: keyof typeof errors) => {
    setErrors((prev) => ({ ...prev, [tabKey]: null }));
  }, []);

  const addRequestHistory = useCallback(
    (request: object, response?: object) => {
      const requestEntry = {
        request: JSON.stringify(request, null, 2),
        response: response ? JSON.stringify(response, null, 2) : undefined,
      };
      setRequestHistory((prev) => [...prev, requestEntry]);
    },
    [],
  );

  // Resource operations
  const listResources = useCallback(
    async (mcpAgent: MCPJamAgent | null, selectedServerName: string) => {
      if (!mcpAgent) return;

      if (selectedServerName === "all") {
        const allServerResources = await mcpAgent.getAllResources();
        const flatResources = allServerResources.flatMap(
          ({ resources }) => resources,
        );
        addRequestHistory(
          { method: "resources/list/all" },
          { resources: flatResources },
        );
        setResources(flatResources);
      } else {
        const client = mcpAgent.getClient(selectedServerName);
        if (client) {
          const resourcesResponse = await client.listResources();
          addRequestHistory(
            { method: "resources/list", server: selectedServerName },
            { resources: resourcesResponse.resources },
          );
          setResources(resourcesResponse.resources);
        }
      }
    },
    [addRequestHistory],
  );

  const listResourceTemplates = useCallback(
    async (mcpAgent: MCPJamAgent | null, selectedServerName: string) => {
      if (!mcpAgent) return;

      if (selectedServerName === "all") {
        const allServerResources = await mcpAgent.getAllResources();
        if (allServerResources.length > 0) {
          const client = mcpAgent.getClient(allServerResources[0].serverName);
          if (client) {
            const templatesResponse = await client.listResourceTemplates();
            addRequestHistory(
              { method: "resourceTemplates/list/all" },
              { resourceTemplates: templatesResponse.resourceTemplates },
            );
            setResourceTemplates(templatesResponse.resourceTemplates);
          }
        }
      } else {
        const client = mcpAgent.getClient(selectedServerName);
        if (client) {
          const templatesResponse = await client.listResourceTemplates();
          addRequestHistory(
            { method: "resourceTemplates/list", server: selectedServerName },
            { resourceTemplates: templatesResponse.resourceTemplates },
          );
          setResourceTemplates(templatesResponse.resourceTemplates);
        }
      }
    },
    [addRequestHistory],
  );

  const readResource = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      uri: string,
    ) => {
      if (!mcpAgent) return;

      if (selectedServerName !== "all") {
        const result = await mcpAgent.readResourceFromServer(
          selectedServerName,
          uri,
        );
        addRequestHistory(
          { method: "resources/read", server: selectedServerName, uri },
          result,
        );
        return result;
      } else {
        const allResources = await mcpAgent.getAllResources();
        for (const { serverName, resources } of allResources) {
          if (resources.some((resource) => resource.uri === uri)) {
            const result = await mcpAgent.readResourceFromServer(
              serverName,
              uri,
            );
            addRequestHistory(
              { method: "resources/read", server: serverName, uri },
              result,
            );
            return result;
          }
        }
        throw new Error(`Resource ${uri} not found on any server`);
      }
    },
    [addRequestHistory],
  );

  const subscribeToResource = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      uri: string,
    ) => {
      if (!mcpAgent || selectedServerName === "all") return;

      const client = mcpAgent.getClient(selectedServerName);
      if (client) {
        const result = await client.subscribeResource({ uri });
        addRequestHistory(
          { method: "resources/subscribe", server: selectedServerName, uri },
          result,
        );
        return result;
      }
    },
    [addRequestHistory],
  );

  const unsubscribeFromResource = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      uri: string,
    ) => {
      if (!mcpAgent || selectedServerName === "all") return;

      const client = mcpAgent.getClient(selectedServerName);
      if (client) {
        const result = await client.unsubscribeResource({ uri });
        addRequestHistory(
          { method: "resources/unsubscribe", server: selectedServerName, uri },
          result,
        );
        return result;
      }
    },
    [addRequestHistory],
  );

  // Prompt operations
  const listPrompts = useCallback(
    async (mcpAgent: MCPJamAgent | null, selectedServerName: string) => {
      if (!mcpAgent) return;

      if (selectedServerName === "all") {
        const allServerPrompts = await mcpAgent.getAllPrompts();
        const flatPrompts = allServerPrompts.flatMap(({ prompts }) => prompts);
        addRequestHistory(
          { method: "prompts/list/all" },
          { prompts: flatPrompts },
        );
        setPrompts(flatPrompts);
      } else {
        const client = mcpAgent.getClient(selectedServerName);
        if (client) {
          const promptsResponse = await client.listPrompts();
          addRequestHistory(
            { method: "prompts/list", server: selectedServerName },
            { prompts: promptsResponse.prompts },
          );
          setPrompts(promptsResponse.prompts);
        }
      }
    },
    [addRequestHistory],
  );

  const getPrompt = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      name: string,
      args: Record<string, string> = {},
    ) => {
      if (!mcpAgent) return;

      if (selectedServerName !== "all") {
        const result = await mcpAgent.getPromptFromServer(
          selectedServerName,
          name,
          args,
        );
        addRequestHistory(
          { method: "prompts/get", server: selectedServerName, name, args },
          result,
        );
        return result;
      } else {
        const allPrompts = await mcpAgent.getAllPrompts();
        for (const { serverName, prompts } of allPrompts) {
          if (prompts.some((prompt) => prompt.name === name)) {
            const result = await mcpAgent.getPromptFromServer(
              serverName,
              name,
              args,
            );
            addRequestHistory(
              { method: "prompts/get", server: serverName, name, args },
              result,
            );
            return result;
          }
        }
        throw new Error(`Prompt ${name} not found on any server`);
      }
    },
    [addRequestHistory],
  );

  // Tool operations
  const listTools = useCallback(
    async (mcpAgent: MCPJamAgent | null, selectedServerName: string) => {
      if (!mcpAgent) return;

      if (selectedServerName === "all") {
        const allServerTools = await mcpAgent.getAllTools();
        const flatTools = allServerTools.flatMap(({ tools }) => tools);
        addRequestHistory({ method: "tools/list/all" }, { tools: flatTools });
        setTools(flatTools);
      } else {
        const client = mcpAgent.getClient(selectedServerName);
        if (client) {
          const toolsResponse = await client.tools();
          addRequestHistory(
            { method: "tools/list", server: selectedServerName },
            { tools: toolsResponse.tools },
          );
          setTools(toolsResponse.tools);
        }
      }
    },
    [addRequestHistory],
  );

  const callTool = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      name: string,
      params: Record<string, unknown>,
    ) => {
      if (!mcpAgent) return;

      try {
        if (selectedServerName !== "all") {
          const result = await mcpAgent.callToolOnServer(
            selectedServerName,
            name,
            params,
          );
          addRequestHistory(
            { method: "tools/call", server: selectedServerName, name, params },
            result,
          );
          setToolResult(result);
        } else {
          const allTools = await mcpAgent.getAllTools();
          for (const { serverName, tools } of allTools) {
            if (tools.some((tool) => tool.name === name)) {
              const result = await mcpAgent.callToolOnServer(
                serverName,
                name,
                params,
              );
              addRequestHistory(
                { method: "tools/call", server: serverName, name, params },
                result,
              );
              setToolResult(result);
              return;
            }
          }
          throw new Error(`Tool ${name} not found on any server`);
        }
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
        addRequestHistory(
          { method: "tools/call", server: selectedServerName, name, params },
          { error: (e as Error).message ?? String(e) },
        );
        setToolResult(toolResult);
      }
    },
    [addRequestHistory],
  );

  // Request operations
  const makeRequest = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      request: ClientRequest,
    ) => {
      if (!mcpAgent) {
        throw new Error("Agent not connected");
      }

      if (selectedServerName === "all") {
        throw new Error(
          "Cannot make requests when 'all' servers are selected. Please select a specific server.",
        );
      }

      const client = mcpAgent.getClient(selectedServerName);
      if (!client) {
        throw new Error(`Client for server ${selectedServerName} not found`);
      }

      const result = await client.makeRequest(request, z.any());
      return result;
    },
    [],
  );

  const handleCompletion = useCallback(
    async (
      mcpAgent: MCPJamAgent | null,
      selectedServerName: string,
      ref: ResourceReference | PromptReference,
      argName: string,
      value: string,
      signal?: AbortSignal,
    ) => {
      if (!mcpAgent || selectedServerName === "all") {
        return [];
      }

      const client = mcpAgent.getClient(selectedServerName);
      if (!client) {
        return [];
      }

      const result = await client.handleCompletion(ref, argName, value, signal);
      addRequestHistory(
        {
          method: "completion",
          server: selectedServerName,
          ref,
          argName,
          value,
        },
        { completions: result },
      );
      return result;
    },
    [addRequestHistory],
  );

  // Sampling operations
  const handleApproveSampling = useCallback(
    (id: number, result: CreateMessageResult) => {
      setPendingSampleRequests((prev) => {
        const updatedRequests = prev.filter((req) => {
          if (req.id === id) {
            req.resolve(result);
            return false;
          }
          return true;
        });
        return updatedRequests;
      });
    },
    [],
  );

  const handleRejectSampling = useCallback((id: number) => {
    setPendingSampleRequests((prev) => {
      const updatedRequests = prev.filter((req) => {
        if (req.id === id) {
          req.reject(new Error("Request rejected by user"));
          return false;
        }
        return true;
      });
      return updatedRequests;
    });
  }, []);

  const getRequestHistory = useCallback(() => {
    return requestHistory;
  }, [requestHistory]);

  const clearRequestHistory = useCallback(() => {
    setRequestHistory([]);
  }, []);

  return {
    // State
    resources,
    setResources,
    resourceTemplates,
    setResourceTemplates,
    resourceContent,
    setResourceContent,
    selectedResource,
    setSelectedResource,
    resourceSubscriptions,
    setResourceSubscriptions,
    nextResourceCursor,
    setNextResourceCursor,
    nextResourceTemplateCursor,
    setNextResourceTemplateCursor,
    prompts,
    setPrompts,
    promptContent,
    setPromptContent,
    selectedPrompt,
    setSelectedPrompt,
    nextPromptCursor,
    setNextPromptCursor,
    tools,
    setTools,
    toolResult,
    setToolResult,
    selectedTool,
    setSelectedTool,
    nextToolCursor,
    setNextToolCursor,
    errors,
    setErrors,
    logLevel,
    setLogLevel,
    stdErrNotifications,
    setStdErrNotifications,
    roots,
    setRoots,
    pendingSampleRequests,
    setPendingSampleRequests,
    progressTokenRef,

    // Operations
    clearError,
    listResources,
    listResourceTemplates,
    readResource,
    subscribeToResource,
    unsubscribeFromResource,
    listPrompts,
    getPrompt,
    listTools,
    callTool,
    makeRequest,
    handleCompletion,
    handleApproveSampling,
    handleRejectSampling,
    addRequestHistory,
    getRequestHistory,
    clearRequestHistory,
  };
};
