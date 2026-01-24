import { useState, useEffect, useCallback } from "react";
import { InspectorClient } from "../mcp/index.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";
import type {
  ConnectionStatus,
  StderrLogEntry,
  MessageEntry,
  FetchRequestEntry,
} from "../mcp/index.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  ServerCapabilities,
  Implementation,
  Tool,
  ResourceReference,
  PromptReference,
} from "@modelcontextprotocol/sdk/types.js";

export interface UseInspectorClientResult {
  status: ConnectionStatus;
  messages: MessageEntry[];
  stderrLogs: StderrLogEntry[];
  fetchRequests: FetchRequestEntry[];
  tools: any[];
  resources: any[];
  resourceTemplates: any[];
  prompts: any[];
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  client: Client | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * React hook that subscribes to InspectorClient events and provides reactive state
 */
export function useInspectorClient(
  inspectorClient: InspectorClient | null,
): UseInspectorClientResult {
  const [status, setStatus] = useState<ConnectionStatus>(
    inspectorClient?.getStatus() ?? "disconnected",
  );
  const [messages, setMessages] = useState<MessageEntry[]>(
    inspectorClient?.getMessages() ?? [],
  );
  const [stderrLogs, setStderrLogs] = useState<StderrLogEntry[]>(
    inspectorClient?.getStderrLogs() ?? [],
  );
  const [fetchRequests, setFetchRequests] = useState<FetchRequestEntry[]>(
    inspectorClient?.getFetchRequests() ?? [],
  );
  const [tools, setTools] = useState<any[]>(inspectorClient?.getTools() ?? []);
  const [resources, setResources] = useState<any[]>(
    inspectorClient?.getResources() ?? [],
  );
  const [resourceTemplates, setResourceTemplates] = useState<any[]>(
    inspectorClient?.getResourceTemplates() ?? [],
  );
  const [prompts, setPrompts] = useState<any[]>(
    inspectorClient?.getPrompts() ?? [],
  );
  const [capabilities, setCapabilities] = useState<
    ServerCapabilities | undefined
  >(inspectorClient?.getCapabilities());
  const [serverInfo, setServerInfo] = useState<Implementation | undefined>(
    inspectorClient?.getServerInfo(),
  );
  const [instructions, setInstructions] = useState<string | undefined>(
    inspectorClient?.getInstructions(),
  );

  // Subscribe to all InspectorClient events
  useEffect(() => {
    if (!inspectorClient) {
      setStatus("disconnected");
      setMessages([]);
      setStderrLogs([]);
      setFetchRequests([]);
      setTools([]);
      setResources([]);
      setResourceTemplates([]);
      setPrompts([]);
      setCapabilities(undefined);
      setServerInfo(undefined);
      setInstructions(undefined);
      return;
    }

    // Initial state
    setStatus(inspectorClient.getStatus());
    setMessages(inspectorClient.getMessages());
    setStderrLogs(inspectorClient.getStderrLogs());
    setFetchRequests(inspectorClient.getFetchRequests());
    setTools(inspectorClient.getTools());
    setResources(inspectorClient.getResources());
    setResourceTemplates(inspectorClient.getResourceTemplates());
    setPrompts(inspectorClient.getPrompts());
    setCapabilities(inspectorClient.getCapabilities());
    setServerInfo(inspectorClient.getServerInfo());
    setInstructions(inspectorClient.getInstructions());

    // Event handlers - using type-safe event listeners
    const onStatusChange = (event: TypedEvent<"statusChange">) => {
      setStatus(event.detail);
    };

    const onMessagesChange = () => {
      // messagesChange is a void event, so we fetch
      setMessages(inspectorClient.getMessages());
    };

    const onStderrLogsChange = () => {
      // stderrLogsChange is a void event, so we fetch
      setStderrLogs(inspectorClient.getStderrLogs());
    };

    const onFetchRequestsChange = () => {
      // fetchRequestsChange is a void event, so we fetch
      setFetchRequests(inspectorClient.getFetchRequests());
    };

    const onToolsChange = (event: TypedEvent<"toolsChange">) => {
      setTools(event.detail);
    };

    const onResourcesChange = (event: TypedEvent<"resourcesChange">) => {
      setResources(event.detail);
    };

    const onResourceTemplatesChange = (
      event: TypedEvent<"resourceTemplatesChange">,
    ) => {
      setResourceTemplates(event.detail);
    };

    const onPromptsChange = (event: TypedEvent<"promptsChange">) => {
      setPrompts(event.detail);
    };

    const onCapabilitiesChange = (event: TypedEvent<"capabilitiesChange">) => {
      setCapabilities(event.detail);
    };

    const onServerInfoChange = (event: TypedEvent<"serverInfoChange">) => {
      setServerInfo(event.detail);
    };

    const onInstructionsChange = (event: TypedEvent<"instructionsChange">) => {
      setInstructions(event.detail);
    };

    // Subscribe to events
    inspectorClient.addEventListener("statusChange", onStatusChange);
    inspectorClient.addEventListener("messagesChange", onMessagesChange);
    inspectorClient.addEventListener("stderrLogsChange", onStderrLogsChange);
    inspectorClient.addEventListener(
      "fetchRequestsChange",
      onFetchRequestsChange,
    );
    inspectorClient.addEventListener("toolsChange", onToolsChange);
    inspectorClient.addEventListener("resourcesChange", onResourcesChange);
    inspectorClient.addEventListener(
      "resourceTemplatesChange",
      onResourceTemplatesChange,
    );
    inspectorClient.addEventListener("promptsChange", onPromptsChange);
    inspectorClient.addEventListener(
      "capabilitiesChange",
      onCapabilitiesChange,
    );
    inspectorClient.addEventListener("serverInfoChange", onServerInfoChange);
    inspectorClient.addEventListener(
      "instructionsChange",
      onInstructionsChange,
    );

    // Cleanup
    return () => {
      inspectorClient.removeEventListener("statusChange", onStatusChange);
      inspectorClient.removeEventListener("messagesChange", onMessagesChange);
      inspectorClient.removeEventListener(
        "stderrLogsChange",
        onStderrLogsChange,
      );
      inspectorClient.removeEventListener(
        "fetchRequestsChange",
        onFetchRequestsChange,
      );
      inspectorClient.removeEventListener("toolsChange", onToolsChange);
      inspectorClient.removeEventListener("resourcesChange", onResourcesChange);
      inspectorClient.removeEventListener(
        "resourceTemplatesChange",
        onResourceTemplatesChange,
      );
      inspectorClient.removeEventListener("promptsChange", onPromptsChange);
      inspectorClient.removeEventListener(
        "capabilitiesChange",
        onCapabilitiesChange,
      );
      inspectorClient.removeEventListener(
        "serverInfoChange",
        onServerInfoChange,
      );
      inspectorClient.removeEventListener(
        "instructionsChange",
        onInstructionsChange,
      );
    };
  }, [inspectorClient]);

  const connect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.connect();
  }, [inspectorClient]);

  const disconnect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.disconnect();
  }, [inspectorClient]);

  return {
    status,
    messages,
    stderrLogs,
    fetchRequests,
    tools,
    resources,
    resourceTemplates,
    prompts,
    capabilities,
    serverInfo,
    instructions,
    client: inspectorClient?.getClient() ?? null,
    connect,
    disconnect,
  };
}
