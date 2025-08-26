import { useState, useEffect, useCallback } from "react";
import {
  multiServerHistoryStore,
  ServerHistoryData,
  HistoryEntry,
} from "../stores/multiServerHistoryStore";

export interface MultiServerHistoryState {
  allHistory: ServerHistoryData[];
  isLoading: boolean;
  error: string | null;
}

export function useMultiServerHistory() {
  const [state, setState] = useState<MultiServerHistoryState>({
    allHistory: [],
    isLoading: false,
    error: null,
  });

  // Update state when history store changes
  const updateHistoryFromStore = useCallback(() => {
    const serverHistoryData = multiServerHistoryStore.getServerHistoryData();
    setState((prev) => ({
      ...prev,
      allHistory: serverHistoryData,
    }));
  }, []);

  // Subscribe to history store changes
  useEffect(() => {
    // Initial load - use setTimeout to avoid setState during render
    const loadInitialData = () => {
      const serverHistoryData = multiServerHistoryStore.getServerHistoryData();
      setState((prev) => ({
        ...prev,
        allHistory: serverHistoryData,
      }));
    };

    // Load initial data asynchronously
    setTimeout(loadInitialData, 0);

    // Subscribe to changes
    const unsubscribe = multiServerHistoryStore.subscribe(
      updateHistoryFromStore,
    );

    return unsubscribe;
  }, [updateHistoryFromStore]);

  // Get history for a specific server
  const getServerHistory = useCallback(
    (serverId: string): ServerHistoryData | undefined => {
      return state.allHistory.find((data) => data.serverId === serverId);
    },
    [state.allHistory],
  );

  // Get combined history from all servers
  const getCombinedHistory = useCallback((): HistoryEntry[] => {
    return multiServerHistoryStore.getAllHistory();
  }, []);

  // Clear history for a specific server
  const clearServerHistory = useCallback((serverId: string) => {
    multiServerHistoryStore.clearServerHistory(serverId);
  }, []);

  // Clear all history
  const clearAllHistory = useCallback(() => {
    multiServerHistoryStore.clearAllHistory();
  }, []);

  // Refresh history data
  const refreshHistory = useCallback(() => {
    updateHistoryFromStore();
  }, [updateHistoryFromStore]);

  return {
    // State
    allHistory: state.allHistory,
    isLoading: state.isLoading,
    error: state.error,

    // Data access
    getServerHistory,
    getCombinedHistory,

    // Actions
    clearServerHistory,
    clearAllHistory,
    refreshHistory,
  };
}
