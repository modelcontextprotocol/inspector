import { useState, useCallback, useRef } from "react";
export function useMessageTracking() {
  const [history, setHistory] = useState({});
  const pendingRequestsRef = useRef(new Map());
  const trackRequest = useCallback((serverName, message) => {
    const entry = {
      id: `${serverName}-${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      direction: "request",
      message,
    };
    if ("id" in message && message.id !== null && message.id !== undefined) {
      pendingRequestsRef.current.set(message.id, {
        timestamp: entry.timestamp,
        serverName,
      });
    }
    setHistory((prev) => ({
      ...prev,
      [serverName]: [...(prev[serverName] || []), entry],
    }));
    return entry.id;
  }, []);
  const trackResponse = useCallback((serverName, message) => {
    if (!("id" in message) || message.id === undefined) {
      // Response without an ID (shouldn't happen, but handle it)
      return;
    }
    const entryId = message.id;
    const pending = pendingRequestsRef.current.get(entryId);
    if (pending && pending.serverName === serverName) {
      pendingRequestsRef.current.delete(entryId);
      const duration = Date.now() - pending.timestamp.getTime();
      setHistory((prev) => {
        const serverHistory = prev[serverName] || [];
        // Find the matching request by message ID
        const requestIndex = serverHistory.findIndex(
          (e) =>
            e.direction === "request" &&
            "id" in e.message &&
            e.message.id === entryId,
        );
        if (requestIndex !== -1) {
          // Update the request entry with the response
          const updatedHistory = [...serverHistory];
          updatedHistory[requestIndex] = {
            ...updatedHistory[requestIndex],
            response: message,
            duration,
          };
          return { ...prev, [serverName]: updatedHistory };
        }
        // If no matching request found, create a new entry
        const newEntry = {
          id: `${serverName}-${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "response",
          message,
          duration: 0,
        };
        return {
          ...prev,
          [serverName]: [...serverHistory, newEntry],
        };
      });
    } else {
      // Response without a matching request (might be from a different server or orphaned)
      setHistory((prev) => {
        const serverHistory = prev[serverName] || [];
        // Check if there's a matching request in the history
        const requestIndex = serverHistory.findIndex(
          (e) =>
            e.direction === "request" &&
            "id" in e.message &&
            e.message.id === entryId,
        );
        if (requestIndex !== -1) {
          // Update the request entry with the response
          const updatedHistory = [...serverHistory];
          updatedHistory[requestIndex] = {
            ...updatedHistory[requestIndex],
            response: message,
          };
          return { ...prev, [serverName]: updatedHistory };
        }
        // Create a new entry for orphaned response
        const newEntry = {
          id: `${serverName}-${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
          direction: "response",
          message,
        };
        return {
          ...prev,
          [serverName]: [...serverHistory, newEntry],
        };
      });
    }
  }, []);
  const trackNotification = useCallback((serverName, message) => {
    const entry = {
      id: `${serverName}-${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      direction: "notification",
      message,
    };
    setHistory((prev) => ({
      ...prev,
      [serverName]: [...(prev[serverName] || []), entry],
    }));
  }, []);
  const clearHistory = useCallback((serverName) => {
    if (serverName) {
      setHistory((prev) => {
        const updated = { ...prev };
        delete updated[serverName];
        return updated;
      });
    } else {
      setHistory({});
      pendingRequestsRef.current.clear();
    }
  }, []);
  return {
    history,
    trackRequest,
    trackResponse,
    trackNotification,
    clearHistory,
  };
}
