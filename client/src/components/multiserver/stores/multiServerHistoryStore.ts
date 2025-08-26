import {
  ServerNotification,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { StdErrNotification } from "../../../lib/notificationTypes.js";
import { ServerErrorSummary } from "../types/multiserver.js";
import { globalErrorDeduplicator } from "../utils/errorDeduplicator.js";

export interface HistoryEntry {
  id: string;
  serverId: string;
  serverName: string;
  type: "request" | "notification";
  timestamp: Date;
  request?: string;
  response?: string;
  notification?: ServerNotification;
}

export interface InitializeHistoryData {
  capabilities?: ServerCapabilities;
  serverInfo?: {
    name: string;
    version: string;
  };
  instructions?: string;
}

export interface ServerHistoryData {
  serverId: string;
  serverName: string;
  requestHistory: Array<{
    request: string;
    response?: string;
    timestamp: Date;
  }>;
  serverNotifications: Array<{
    notification: ServerNotification;
    timestamp: Date;
  }>;
}

class MultiServerHistoryStore {
  private history: HistoryEntry[] = [];
  private stdErrNotifications: Map<
    string,
    Array<{ notification: StdErrNotification; timestamp: Date }>
  > = new Map();
  private listeners: Set<() => void> = new Set();

  // Add a dedicated initialize entry with comprehensive server information
  addInitializeEntry(
    serverId: string,
    serverName: string,
    initializeData: InitializeHistoryData,
  ) {
    const initializeRequest = {
      method: "initialize",
    };

    const initializeResponse = {
      capabilities: initializeData.capabilities,
      serverInfo: initializeData.serverInfo,
      instructions: initializeData.instructions,
    };

    const entry: HistoryEntry = {
      id: `${serverId}-init-${Date.now()}-${Math.random()}`,
      serverId,
      serverName,
      type: "request",
      timestamp: new Date(),
      request: JSON.stringify(initializeRequest),
      response: JSON.stringify(initializeResponse),
    };

    // Remove any existing initialize entries for this server to avoid duplicates
    this.history = this.history.filter(
      (existingEntry) =>
        !(
          existingEntry.serverId === serverId &&
          existingEntry.request?.includes('"method":"initialize"')
        ),
    );

    // Add the new initialize entry at the beginning for this server
    // Find the index where this server's entries start
    const serverEntries = this.history.filter((e) => e.serverId === serverId);
    if (serverEntries.length === 0) {
      // No existing entries for this server, add at the end
      this.history.push(entry);
    } else {
      // Find the earliest entry for this server and insert before it
      const earliestServerEntryIndex = this.history.findIndex(
        (e) => e.serverId === serverId,
      );
      this.history.splice(earliestServerEntryIndex, 0, entry);
    }

    this.notifyListeners();
  }

  // Add a request/response entry
  addRequest(
    serverId: string,
    serverName: string,
    request: string,
    response?: string,
  ) {
    // Special handling for initialize requests - use dedicated method
    try {
      const parsedRequest = JSON.parse(request);
      if (parsedRequest.method === "initialize") {
        const initializeData: InitializeHistoryData = {};
        if (response) {
          const parsedResponse = JSON.parse(response);
          initializeData.capabilities = parsedResponse.capabilities;
          initializeData.serverInfo = parsedResponse.serverInfo;
          initializeData.instructions = parsedResponse.instructions;
        }
        this.addInitializeEntry(serverId, serverName, initializeData);
        return;
      }
    } catch (error) {
      // If parsing fails, continue with normal request handling
    }

    const entry: HistoryEntry = {
      id: `${serverId}-${Date.now()}-${Math.random()}`,
      serverId,
      serverName,
      type: "request",
      timestamp: new Date(),
      request,
      response,
    };

    this.history.push(entry);
    this.notifyListeners();
  }

  // Add a notification entry
  addNotification(
    serverId: string,
    serverName: string,
    notification: ServerNotification,
  ) {
    // Check for duplicate notifications within the last second to prevent duplicates
    const now = new Date();
    const oneSecondAgo = new Date(now.getTime() - 1000);

    // Create a unique key for this notification based on its content
    const notificationKey = JSON.stringify({
      serverId,
      method: notification.method,
      params: notification.params,
    });

    // Check if we already have this exact notification recently
    const recentDuplicate = this.history.find(
      (entry) =>
        entry.serverId === serverId &&
        entry.type === "notification" &&
        entry.timestamp > oneSecondAgo &&
        entry.notification &&
        JSON.stringify({
          serverId: entry.serverId,
          method: entry.notification.method,
          params: entry.notification.params,
        }) === notificationKey,
    );

    if (recentDuplicate) {
      // Skip adding duplicate notification
      return;
    }

    const entry: HistoryEntry = {
      id: `${serverId}-${Date.now()}-${Math.random()}`,
      serverId,
      serverName,
      type: "notification",
      timestamp: now,
      notification,
    };

    this.history.push(entry);
    this.notifyListeners();
  }

  // Get all history entries
  getAllHistory(): HistoryEntry[] {
    return [...this.history].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
  }

  // Get history for a specific server
  getServerHistory(serverId: string): HistoryEntry[] {
    return this.history
      .filter((entry) => entry.serverId === serverId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Get formatted server history data
  getServerHistoryData(): ServerHistoryData[] {
    const serverMap = new Map<string, ServerHistoryData>();

    this.history.forEach((entry) => {
      if (!serverMap.has(entry.serverId)) {
        serverMap.set(entry.serverId, {
          serverId: entry.serverId,
          serverName: entry.serverName,
          requestHistory: [],
          serverNotifications: [],
        });
      }

      const serverData = serverMap.get(entry.serverId)!;

      if (entry.type === "request") {
        serverData.requestHistory.push({
          request: entry.request!,
          response: entry.response,
          timestamp: entry.timestamp,
        });
      } else if (entry.type === "notification" && entry.notification) {
        serverData.serverNotifications.push({
          notification: entry.notification,
          timestamp: entry.timestamp,
        });
      }
    });

    // Sort each server's history by timestamp
    serverMap.forEach((serverData) => {
      serverData.requestHistory.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );
      serverData.serverNotifications.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );
    });

    return Array.from(serverMap.values());
  }

  // Clear history for a specific server
  clearServerHistory(serverId: string) {
    this.history = this.history.filter((entry) => entry.serverId !== serverId);
    this.notifyListeners();
  }

  // Clear all history
  clearAllHistory() {
    this.history = [];
    this.notifyListeners();
  }

  // Subscribe to history changes
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Notify all listeners of changes
  private notifyListeners() {
    this.listeners.forEach((listener) => listener());
  }

  // Get history count for a server
  getServerHistoryCount(serverId: string): number {
    return this.history.filter((entry) => entry.serverId === serverId).length;
  }

  // Get total history count
  getTotalHistoryCount(): number {
    return this.history.length;
  }

  // StdErr notification methods with deduplication
  addStdErrNotification(
    serverId: string,
    notification: StdErrNotification,
    source: "console" | "server" = "server",
  ) {
    // Use the global error deduplicator to check if this error should be added
    const shouldAdd = globalErrorDeduplicator.deduplicateError(
      notification,
      serverId,
    );

    if (!shouldAdd) {
      // Error is a duplicate, don't add it
      return;
    }

    if (!this.stdErrNotifications.has(serverId)) {
      this.stdErrNotifications.set(serverId, []);
    }

    const serverErrors = this.stdErrNotifications.get(serverId)!;
    serverErrors.push({
      notification,
      timestamp: new Date(),
    });

    // Keep only the last 100 errors per server to prevent memory issues
    if (serverErrors.length > 100) {
      serverErrors.splice(0, serverErrors.length - 100);
    }

    // Source parameter is used to distinguish between console and server errors
    // This enables future analytics and filtering capabilities
    void source; // Explicitly acknowledge the parameter is intentionally unused for now

    this.notifyListeners();
  }

  // Add console error notification specifically
  addConsoleErrorNotification(
    serverId: string,
    notification: StdErrNotification,
  ) {
    this.addStdErrNotification(serverId, notification, "console");
  }

  // Get stderr notifications for a specific server
  getServerStdErrNotifications(
    serverId: string,
  ): Array<{ notification: StdErrNotification; timestamp: Date }> {
    const serverErrors = this.stdErrNotifications.get(serverId) || [];
    return [...serverErrors].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
  }

  // Clear stderr notifications for a specific server
  clearServerStdErrNotifications(serverId: string) {
    this.stdErrNotifications.delete(serverId);
    this.notifyListeners();
  }

  // Clear all stderr notifications
  clearAllStdErrNotifications() {
    this.stdErrNotifications.clear();
    this.notifyListeners();
  }

  // Get error summaries for all servers
  getStdErrNotificationSummaries(): ServerErrorSummary[] {
    const summaries: ServerErrorSummary[] = [];

    this.stdErrNotifications.forEach((errors, serverId) => {
      if (errors.length > 0) {
        const latestError = errors[errors.length - 1];

        // Find server name from history or use serverId as fallback
        const serverName =
          this.history.find((entry) => entry.serverId === serverId)
            ?.serverName || serverId;

        summaries.push({
          serverId,
          serverName,
          errorCount: errors.length,
          latestError: latestError.notification,
          lastErrorTime: latestError.timestamp,
        });
      }
    });

    return summaries.sort((a, b) => {
      // Sort by last error time, most recent first
      const timeA = a.lastErrorTime?.getTime() || 0;
      const timeB = b.lastErrorTime?.getTime() || 0;
      return timeB - timeA;
    });
  }

  // Get total error count across all servers
  getTotalStdErrCount(): number {
    let total = 0;
    this.stdErrNotifications.forEach((errors) => {
      total += errors.length;
    });
    return total;
  }

  // Get error count for a specific server
  getServerStdErrCount(serverId: string): number {
    return this.stdErrNotifications.get(serverId)?.length || 0;
  }
}

// Create a singleton instance
export const multiServerHistoryStore = new MultiServerHistoryStore();
