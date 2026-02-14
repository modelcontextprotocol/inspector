import { useState, useEffect, useCallback, useRef } from "react";
/**
 * React hook that subscribes to InspectorClient events and provides reactive state
 */
export function useInspectorClient(inspectorClient) {
    const [status, setStatus] = useState(inspectorClient?.getStatus() ?? "disconnected");
    const [messages, setMessages] = useState(inspectorClient?.getMessages() ?? []);
    const [stderrLogs, setStderrLogs] = useState(inspectorClient?.getStderrLogs() ?? []);
    const [fetchRequests, setFetchRequests] = useState(inspectorClient?.getFetchRequests() ?? []);
    const [tools, setTools] = useState(inspectorClient?.getTools() ?? []);
    const [resources, setResources] = useState(inspectorClient?.getResources() ?? []);
    const [resourceTemplates, setResourceTemplates] = useState(inspectorClient?.getResourceTemplates() ?? []);
    const [prompts, setPrompts] = useState(inspectorClient?.getPrompts() ?? []);
    const [capabilities, setCapabilities] = useState(inspectorClient?.getCapabilities());
    const [serverInfo, setServerInfo] = useState(inspectorClient?.getServerInfo());
    const [instructions, setInstructions] = useState(inspectorClient?.getInstructions());
    // Use refs to track previous serialized values to prevent infinite loops
    // InspectorClient.getMessages()/getStderrLogs()/getFetchRequests() return new arrays
    // each time, so we need to compare content, not references
    const previousMessagesRef = useRef("[]");
    const previousStderrLogsRef = useRef("[]");
    const previousFetchRequestsRef = useRef("[]");
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
            previousMessagesRef.current = "[]";
            previousStderrLogsRef.current = "[]";
            previousFetchRequestsRef.current = "[]";
            return;
        }
        // Initial state
        setStatus(inspectorClient.getStatus());
        const initialMessages = inspectorClient.getMessages();
        const initialStderrLogs = inspectorClient.getStderrLogs();
        const initialFetchRequests = inspectorClient.getFetchRequests();
        setMessages(initialMessages);
        setStderrLogs(initialStderrLogs);
        setFetchRequests(initialFetchRequests);
        previousMessagesRef.current = JSON.stringify(initialMessages);
        previousStderrLogsRef.current = JSON.stringify(initialStderrLogs);
        previousFetchRequestsRef.current = JSON.stringify(initialFetchRequests);
        setTools(inspectorClient.getTools());
        setResources(inspectorClient.getResources());
        setResourceTemplates(inspectorClient.getResourceTemplates());
        setPrompts(inspectorClient.getPrompts());
        setCapabilities(inspectorClient.getCapabilities());
        setServerInfo(inspectorClient.getServerInfo());
        setInstructions(inspectorClient.getInstructions());
        // Event handlers - using type-safe event listeners
        const onStatusChange = (event) => {
            setStatus(event.detail);
        };
        const onMessagesChange = () => {
            // messagesChange is a void event, so we fetch
            // Compare by serializing to avoid infinite loops from reference changes
            const newMessages = inspectorClient.getMessages();
            const serialized = JSON.stringify(newMessages);
            if (serialized !== previousMessagesRef.current) {
                setMessages(newMessages);
                previousMessagesRef.current = serialized;
            }
        };
        const onStderrLogsChange = () => {
            // stderrLogsChange is a void event, so we fetch
            // Compare by serializing to avoid infinite loops from reference changes
            const newStderrLogs = inspectorClient.getStderrLogs();
            const serialized = JSON.stringify(newStderrLogs);
            if (serialized !== previousStderrLogsRef.current) {
                setStderrLogs(newStderrLogs);
                previousStderrLogsRef.current = serialized;
            }
        };
        const onFetchRequestsChange = () => {
            // fetchRequestsChange is a void event, so we fetch
            // Compare by serializing to avoid infinite loops from reference changes
            const newFetchRequests = inspectorClient.getFetchRequests();
            const serialized = JSON.stringify(newFetchRequests);
            if (serialized !== previousFetchRequestsRef.current) {
                setFetchRequests(newFetchRequests);
                previousFetchRequestsRef.current = serialized;
            }
        };
        const onToolsChange = (event) => {
            setTools(event.detail);
        };
        const onResourcesChange = (event) => {
            setResources(event.detail);
        };
        const onResourceTemplatesChange = (event) => {
            setResourceTemplates(event.detail);
        };
        const onPromptsChange = (event) => {
            setPrompts(event.detail);
        };
        const onCapabilitiesChange = (event) => {
            setCapabilities(event.detail);
        };
        const onServerInfoChange = (event) => {
            setServerInfo(event.detail);
        };
        const onInstructionsChange = (event) => {
            setInstructions(event.detail);
        };
        // Subscribe to events
        inspectorClient.addEventListener("statusChange", onStatusChange);
        inspectorClient.addEventListener("messagesChange", onMessagesChange);
        inspectorClient.addEventListener("stderrLogsChange", onStderrLogsChange);
        inspectorClient.addEventListener("fetchRequestsChange", onFetchRequestsChange);
        inspectorClient.addEventListener("toolsChange", onToolsChange);
        inspectorClient.addEventListener("resourcesChange", onResourcesChange);
        inspectorClient.addEventListener("resourceTemplatesChange", onResourceTemplatesChange);
        inspectorClient.addEventListener("promptsChange", onPromptsChange);
        inspectorClient.addEventListener("capabilitiesChange", onCapabilitiesChange);
        inspectorClient.addEventListener("serverInfoChange", onServerInfoChange);
        inspectorClient.addEventListener("instructionsChange", onInstructionsChange);
        // Cleanup
        return () => {
            inspectorClient.removeEventListener("statusChange", onStatusChange);
            inspectorClient.removeEventListener("messagesChange", onMessagesChange);
            inspectorClient.removeEventListener("stderrLogsChange", onStderrLogsChange);
            inspectorClient.removeEventListener("fetchRequestsChange", onFetchRequestsChange);
            inspectorClient.removeEventListener("toolsChange", onToolsChange);
            inspectorClient.removeEventListener("resourcesChange", onResourcesChange);
            inspectorClient.removeEventListener("resourceTemplatesChange", onResourceTemplatesChange);
            inspectorClient.removeEventListener("promptsChange", onPromptsChange);
            inspectorClient.removeEventListener("capabilitiesChange", onCapabilitiesChange);
            inspectorClient.removeEventListener("serverInfoChange", onServerInfoChange);
            inspectorClient.removeEventListener("instructionsChange", onInstructionsChange);
        };
    }, [inspectorClient]);
    const connect = useCallback(async () => {
        if (!inspectorClient)
            return;
        await inspectorClient.connect();
    }, [inspectorClient]);
    const disconnect = useCallback(async () => {
        if (!inspectorClient)
            return;
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
//# sourceMappingURL=useInspectorClient.js.map