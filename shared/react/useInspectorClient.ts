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
    const onStatusChange = (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
    };

    const onMessagesChange = () => {
      setMessages(inspectorClient.getMessages());
    };

    const onStderrLogsChange = () => {
      setStderrLogs(inspectorClient.getStderrLogs());
    };

    const onToolsChange = (newTools: any[]) => {
      setTools(newTools);
    };

    const onResourcesChange = (newResources: any[]) => {
      setResources(newResources);
    };

    const onPromptsChange = (newPrompts: any[]) => {
      setPrompts(newPrompts);
    };

    const onCapabilitiesChange = (newCapabilities?: ServerCapabilities) => {
      setCapabilities(newCapabilities);
    };

    const onServerInfoChange = (newServerInfo?: Implementation) => {
      setServerInfo(newServerInfo);
    };

    const onInstructionsChange = (newInstructions?: string) => {
      setInstructions(newInstructions);
    };

    // Subscribe to events
    inspectorClient.on("statusChange", onStatusChange);
    inspectorClient.on("messagesChange", onMessagesChange);
    inspectorClient.on("stderrLogsChange", onStderrLogsChange);
    inspectorClient.on("toolsChange", onToolsChange);
    inspectorClient.on("resourcesChange", onResourcesChange);
    inspectorClient.on("promptsChange", onPromptsChange);
    inspectorClient.on("capabilitiesChange", onCapabilitiesChange);
    inspectorClient.on("serverInfoChange", onServerInfoChange);
    inspectorClient.on("instructionsChange", onInstructionsChange);

    // Cleanup
    return () => {
      inspectorClient.off("statusChange", onStatusChange);
      inspectorClient.off("messagesChange", onMessagesChange);
      inspectorClient.off("stderrLogsChange", onStderrLogsChange);
      inspectorClient.off("toolsChange", onToolsChange);
      inspectorClient.off("resourcesChange", onResourcesChange);
      inspectorClient.off("promptsChange", onPromptsChange);
      inspectorClient.off("capabilitiesChange", onCapabilitiesChange);
      inspectorClient.off("serverInfoChange", onServerInfoChange);
      inspectorClient.off("instructionsChange", onInstructionsChange);
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
