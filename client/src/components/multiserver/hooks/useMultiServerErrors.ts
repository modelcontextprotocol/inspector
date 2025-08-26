import { useState, useEffect, useCallback } from "react";
import { multiServerHistoryStore } from "../stores/multiServerHistoryStore.js";
import { StdErrNotification } from "../../../lib/notificationTypes.js";
import {
  ServerErrorSummary,
  MultiServerErrorState,
} from "../types/multiserver.js";

/**
 * Hook for managing multi-server error state and providing efficient error aggregation
 * Uses Map-based data structures for O(1) server error lookups and optimized updates
 */
export function useMultiServerErrors() {
  const [errorState, setErrorState] = useState<MultiServerErrorState>({
    serverErrors: new Map(),
    errorSummaries: [],
    totalErrorCount: 0,
    consoleErrorCount: 0,
    serverErrorCount: 0,
  });

  // Update error state from the history store
  const updateErrorState = useCallback(() => {
    const serverErrors = new Map<string, StdErrNotification[]>();
    const errorSummaries =
      multiServerHistoryStore.getStdErrNotificationSummaries();

    // Build server errors map for efficient lookups - following single-server pattern
    errorSummaries.forEach((summary) => {
      const notifications =
        multiServerHistoryStore.getServerStdErrNotifications(summary.serverId);
      serverErrors.set(
        summary.serverId,
        notifications.map((item) => item.notification),
      );
    });

    const totalErrorCount = multiServerHistoryStore.getTotalStdErrCount();

    // Calculate console vs server error counts
    let consoleErrorCount = 0;
    let serverErrorCount = 0;

    errorSummaries.forEach((summary) => {
      if (summary.source === "console") {
        consoleErrorCount += summary.errorCount;
      } else {
        serverErrorCount += summary.errorCount;
      }
    });

    setErrorState({
      serverErrors,
      errorSummaries,
      totalErrorCount,
      consoleErrorCount,
      serverErrorCount,
    });
  }, []);

  // Subscribe to history store changes
  useEffect(() => {
    // Initial load
    updateErrorState();

    // Subscribe to changes
    const unsubscribe = multiServerHistoryStore.subscribe(updateErrorState);

    return unsubscribe;
  }, [updateErrorState]);

  // Get errors for a specific server
  const getServerErrors = useCallback(
    (serverId: string): StdErrNotification[] => {
      return errorState.serverErrors.get(serverId) || [];
    },
    [errorState.serverErrors],
  );

  // Get error summary for a specific server
  const getServerErrorSummary = useCallback(
    (serverId: string): ServerErrorSummary | undefined => {
      return errorState.errorSummaries.find(
        (summary) => summary.serverId === serverId,
      );
    },
    [errorState.errorSummaries],
  );

  // Get error count for a specific server
  const getServerErrorCount = useCallback(
    (serverId: string): number => {
      return errorState.serverErrors.get(serverId)?.length || 0;
    },
    [errorState.serverErrors],
  );

  // Check if a server has errors
  const hasServerErrors = useCallback(
    (serverId: string): boolean => {
      return getServerErrorCount(serverId) > 0;
    },
    [getServerErrorCount],
  );

  // Clear errors for a specific server
  const clearServerErrors = useCallback((serverId: string) => {
    multiServerHistoryStore.clearServerStdErrNotifications(serverId);
  }, []);

  // Clear all errors
  const clearAllErrors = useCallback(() => {
    multiServerHistoryStore.clearAllStdErrNotifications();
  }, []);

  // Get servers with errors (for dashboard filtering)
  const getServersWithErrors = useCallback((): string[] => {
    return errorState.errorSummaries.map((summary) => summary.serverId);
  }, [errorState.errorSummaries]);

  // Get most recent error across all servers
  const getMostRecentError = useCallback((): {
    serverId: string;
    serverName: string;
    error: StdErrNotification;
    timestamp: Date;
  } | null => {
    if (errorState.errorSummaries.length === 0) {
      return null;
    }

    const mostRecentSummary = errorState.errorSummaries[0]; // Already sorted by most recent
    if (!mostRecentSummary.latestError || !mostRecentSummary.lastErrorTime) {
      return null;
    }

    return {
      serverId: mostRecentSummary.serverId,
      serverName: mostRecentSummary.serverName,
      error: mostRecentSummary.latestError,
      timestamp: mostRecentSummary.lastErrorTime,
    };
  }, [errorState.errorSummaries]);

  // Get error statistics for dashboard
  const getErrorStatistics = useCallback(() => {
    const serversWithErrors = errorState.errorSummaries.length;
    const totalErrors = errorState.totalErrorCount;
    const averageErrorsPerServer =
      serversWithErrors > 0 ? Math.round(totalErrors / serversWithErrors) : 0;

    return {
      serversWithErrors,
      totalErrors,
      averageErrorsPerServer,
    };
  }, [errorState.errorSummaries.length, errorState.totalErrorCount]);

  return {
    // State
    errorSummaries: errorState.errorSummaries,
    totalErrorCount: errorState.totalErrorCount,

    // Server-specific methods
    getServerErrors,
    getServerErrorSummary,
    getServerErrorCount,
    hasServerErrors,

    // Management methods
    clearServerErrors,
    clearAllErrors,

    // Utility methods
    getServersWithErrors,
    getMostRecentError,
    getErrorStatistics,
  };
}
