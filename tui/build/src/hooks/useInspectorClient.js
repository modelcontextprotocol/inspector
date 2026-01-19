import { useState, useEffect, useCallback } from "react";
/**
 * React hook that subscribes to InspectorClient events and provides reactive state
 */
export function useInspectorClient(inspectorClient) {
  const [status, setStatus] = useState(
    inspectorClient?.getStatus() ?? "disconnected",
  );
  const [messages, setMessages] = useState(
    inspectorClient?.getMessages() ?? [],
  );
  const [stderrLogs, setStderrLogs] = useState(
    inspectorClient?.getStderrLogs() ?? [],
  );
  const [tools, setTools] = useState(inspectorClient?.getTools() ?? []);
  const [resources, setResources] = useState(
    inspectorClient?.getResources() ?? [],
  );
  const [prompts, setPrompts] = useState(inspectorClient?.getPrompts() ?? []);
  const [capabilities, setCapabilities] = useState(
    inspectorClient?.getCapabilities(),
  );
  const [serverInfo, setServerInfo] = useState(
    inspectorClient?.getServerInfo(),
  );
  const [instructions, setInstructions] = useState(
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
    const onStatusChange = (newStatus) => {
      setStatus(newStatus);
    };
    const onMessagesChange = () => {
      setMessages(inspectorClient.getMessages());
    };
    const onStderrLogsChange = () => {
      setStderrLogs(inspectorClient.getStderrLogs());
    };
    const onToolsChange = (newTools) => {
      setTools(newTools);
    };
    const onResourcesChange = (newResources) => {
      setResources(newResources);
    };
    const onPromptsChange = (newPrompts) => {
      setPrompts(newPrompts);
    };
    const onCapabilitiesChange = (newCapabilities) => {
      setCapabilities(newCapabilities);
    };
    const onServerInfoChange = (newServerInfo) => {
      setServerInfo(newServerInfo);
    };
    const onInstructionsChange = (newInstructions) => {
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
  const clearMessages = useCallback(() => {
    if (!inspectorClient) return;
    inspectorClient.clearMessages();
  }, [inspectorClient]);
  const clearStderrLogs = useCallback(() => {
    if (!inspectorClient) return;
    inspectorClient.clearStderrLogs();
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
    clearMessages,
    clearStderrLogs,
  };
}
