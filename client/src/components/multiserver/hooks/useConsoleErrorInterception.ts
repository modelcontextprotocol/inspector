import { useCallback, useEffect, useRef } from "react";
import { StdErrNotification } from "../../../lib/notificationTypes";
import { consoleErrorInterceptor } from "../utils/consoleErrorInterceptor";
import { multiServerHistoryStore } from "../stores/multiServerHistoryStore";

export interface UseConsoleErrorInterceptionOptions {
  enabled?: boolean;
  currentServerId?: string | null;
  serverName?: string | null;
}

export function useConsoleErrorInterception(
  options: UseConsoleErrorInterceptionOptions = {},
) {
  const { enabled = true, currentServerId, serverName } = options;
  const isSetupRef = useRef(false);
  const currentServerIdRef = useRef<string | null>(null);
  const currentServerNameRef = useRef<string | null>(null);

  const handleConsoleError = useCallback((notification: StdErrNotification) => {
    const serverId = currentServerIdRef.current;
    if (serverId) {
      multiServerHistoryStore.addConsoleErrorNotification(
        serverId,
        notification,
      );
    }
  }, []);

  const setupInterception = useCallback(
    (serverId: string, serverName: string) => {
      if (!enabled) return;

      try {
        consoleErrorInterceptor.setup(serverName, handleConsoleError);
        currentServerIdRef.current = serverId;
        currentServerNameRef.current = serverName;
        isSetupRef.current = true;
      } catch (error) {
        console.warn("Failed to setup console error interception:", error);
      }
    },
    [enabled, handleConsoleError],
  );

  const cleanupInterception = useCallback(() => {
    if (isSetupRef.current) {
      try {
        consoleErrorInterceptor.cleanup();
        currentServerIdRef.current = null;
        currentServerNameRef.current = null;
        isSetupRef.current = false;
      } catch (error) {
        console.warn("Failed to cleanup console error interception:", error);
      }
    }
  }, []);

  const updateCurrentServer = useCallback(
    (serverId: string | null, serverName: string | null) => {
      if (!enabled) return;

      if (
        serverId &&
        serverName &&
        (serverId !== currentServerIdRef.current ||
          serverName !== currentServerNameRef.current)
      ) {
        // Setup interception for new server
        setupInterception(serverId, serverName);
      } else if (!serverId && isSetupRef.current) {
        // Cleanup when no server is selected
        cleanupInterception();
      } else if (isSetupRef.current && serverName) {
        // Update the current server context
        consoleErrorInterceptor.setCurrentServer(serverName || null);
        currentServerIdRef.current = serverId;
        currentServerNameRef.current = serverName;
      }
    },
    [enabled, setupInterception, cleanupInterception],
  );

  // Effect to handle server changes
  useEffect(() => {
    updateCurrentServer(currentServerId || null, serverName || null);
  }, [currentServerId, serverName, updateCurrentServer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupInterception();
    };
  }, [cleanupInterception]);

  // Manual control methods
  const startInterception = useCallback(
    (serverId: string, serverName: string) => {
      setupInterception(serverId, serverName);
    },
    [setupInterception],
  );

  const stopInterception = useCallback(() => {
    cleanupInterception();
  }, [cleanupInterception]);

  const setCurrentServer = useCallback(
    (serverId: string | null, serverName: string | null) => {
      updateCurrentServer(serverId, serverName);
    },
    [updateCurrentServer],
  );

  return {
    // State
    isActive: isSetupRef.current,
    currentServerId: currentServerIdRef.current,
    currentServerName: currentServerNameRef.current,

    // Control methods
    startInterception,
    stopInterception,
    setCurrentServer,
  };
}
