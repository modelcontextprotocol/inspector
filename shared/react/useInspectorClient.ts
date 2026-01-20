import { useState, useEffect, useCallback } from "react";
import { InspectorClient } from "../mcp/index.js";
import type {
  ConnectionStatus,
  StderrLogEntry,
  MessageEntry,
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
  tools: any[];
  resources: any[];
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
  const [tools, setTools] = useState<any[]>(inspectorClient?.getTools() ?? []);
  const [resources, setResources] = useState<any[]>(
    inspectorClient?.getResources() ?? [],
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
      setTools([]);
      setResources([]);
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
    setTools(inspectorClient.getTools());
    setResources(inspectorClient.getResources());
    setPrompts(inspectorClient.getPrompts());
    setCapabilities(inspectorClient.getCapabilities());
    setServerInfo(inspectorClient.getServerInfo());
    setInstructions(inspectorClient.getInstructions());

    // Event handlers
    // Note: We use event payloads when available for efficiency, with explicit type casting
    // since EventTarget doesn't provide compile-time type safety
    const onStatusChange = (event: Event) => {
      const customEvent = event as CustomEvent<ConnectionStatus>;
      setStatus(customEvent.detail);
    };

    const onMessagesChange = () => {
      // messagesChange doesn't include payload, so we fetch
      setMessages(inspectorClient.getMessages());
    };

    const onStderrLogsChange = () => {
      // stderrLogsChange doesn't include payload, so we fetch
      setStderrLogs(inspectorClient.getStderrLogs());
    };

    const onToolsChange = (event: Event) => {
      const customEvent = event as CustomEvent<Tool[]>;
      setTools(customEvent.detail);
    };

    const onResourcesChange = (event: Event) => {
      const customEvent = event as CustomEvent<ResourceReference[]>;
      setResources(customEvent.detail);
    };

    const onPromptsChange = (event: Event) => {
      const customEvent = event as CustomEvent<PromptReference[]>;
      setPrompts(customEvent.detail);
    };

    const onCapabilitiesChange = (event: Event) => {
      const customEvent = event as CustomEvent<ServerCapabilities | undefined>;
      setCapabilities(customEvent.detail);
    };

    const onServerInfoChange = (event: Event) => {
      const customEvent = event as CustomEvent<Implementation | undefined>;
      setServerInfo(customEvent.detail);
    };

    const onInstructionsChange = (event: Event) => {
      const customEvent = event as CustomEvent<string | undefined>;
      setInstructions(customEvent.detail);
    };

    // Subscribe to events
    inspectorClient.addEventListener("statusChange", onStatusChange);
    inspectorClient.addEventListener("messagesChange", onMessagesChange);
    inspectorClient.addEventListener("stderrLogsChange", onStderrLogsChange);
    inspectorClient.addEventListener("toolsChange", onToolsChange);
    inspectorClient.addEventListener("resourcesChange", onResourcesChange);
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
      inspectorClient.removeEventListener("toolsChange", onToolsChange);
      inspectorClient.removeEventListener("resourcesChange", onResourcesChange);
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
    tools,
    resources,
    prompts,
    capabilities,
    serverInfo,
    instructions,
    client: inspectorClient?.getClient() ?? null,
    connect,
    disconnect,
  };
}
