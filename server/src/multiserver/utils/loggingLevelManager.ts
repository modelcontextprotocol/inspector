import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { loggingStateSynchronizer } from "./loggingStateSynchronizer.js";

/**
 * Centralized logging level state management for MCP servers.
 * Handles tracking of expected logging levels, pending updates, and cleanup.
 * Enhanced with proper state tracking and race condition prevention.
 */
export class LoggingLevelManager {
  private serverLevels = new Map<string, LoggingLevel>();
  private updateTimestamps = new Map<string, number>();
  private updateQueues = new Map<string, LoggingLevel[]>();

  // Configuration
  private readonly UPDATE_TIMEOUT_MS = 5000; // 5 seconds timeout for pending updates
  private readonly MAX_QUEUE_SIZE = 10; // Maximum pending updates per server

  /**
   * Set the expected logging level for a server with enhanced state tracking
   */
  setServerLogLevel(serverId: string, level: LoggingLevel): void {
    // Check if we're already syncing to this level to prevent unnecessary operations
    const syncState = loggingStateSynchronizer.getServerState(serverId);
    if (
      syncState?.expectedLevel === level &&
      syncState.syncStatus === "pending"
    ) {
      return; // Already syncing to this level
    }

    this.serverLevels.set(serverId, level);
    this.updateTimestamps.set(serverId, Date.now());

    // Add to update queue for handling multiple rapid changes
    const queue = this.updateQueues.get(serverId) || [];

    // Only add to queue if it's a different level than the last one
    const lastLevel = queue.length > 0 ? queue[queue.length - 1] : undefined;
    if (lastLevel !== level) {
      queue.push(level);
    }

    // Limit queue size to prevent memory issues
    if (queue.length > this.MAX_QUEUE_SIZE) {
      queue.shift(); // Remove oldest entry
    }

    this.updateQueues.set(serverId, queue);
  }

  /**
   * Get the expected logging level for a server
   */
  getExpectedLevel(serverId: string): LoggingLevel | undefined {
    // Clean up expired updates first
    this.cleanupExpiredUpdates(serverId);
    return this.serverLevels.get(serverId);
  }

  /**
   * Get the most recent pending level from the update queue
   */
  getPendingLevel(serverId: string): LoggingLevel | undefined {
    const queue = this.updateQueues.get(serverId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    // Return the most recent level from the queue
    return queue[queue.length - 1];
  }

  /**
   * Track a logging level update with timestamp and sync state
   */
  trackLevelUpdate(serverId: string, level: LoggingLevel): void {
    this.setServerLogLevel(serverId, level);

    // Update the synchronizer's actual level when we receive confirmation
    loggingStateSynchronizer.updateActualLevel(serverId, level);
  }

  /**
   * Check if a server has recent logging level updates
   */
  hasRecentUpdate(serverId: string): boolean {
    const timestamp = this.updateTimestamps.get(serverId);
    if (!timestamp) {
      return false;
    }

    return Date.now() - timestamp < this.UPDATE_TIMEOUT_MS;
  }

  /**
   * Consume a pending level update (removes from queue)
   */
  consumePendingLevel(serverId: string): LoggingLevel | undefined {
    const queue = this.updateQueues.get(serverId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const level = queue.shift();
    this.updateQueues.set(serverId, queue);

    return level;
  }

  /**
   * Clear all pending updates for a server
   */
  clearPendingUpdates(serverId: string): void {
    this.updateQueues.delete(serverId);
    this.updateTimestamps.delete(serverId);
  }

  /**
   * Clean up expired updates for a specific server
   */
  private cleanupExpiredUpdates(serverId: string): void {
    const timestamp = this.updateTimestamps.get(serverId);
    if (timestamp && Date.now() - timestamp > this.UPDATE_TIMEOUT_MS) {
      this.clearPendingUpdates(serverId);
      // Keep the server level but clear pending updates
    }
  }

  /**
   * Clean up all expired updates across all servers
   */
  cleanupAllExpiredUpdates(): void {
    const now = Date.now();

    for (const [serverId, timestamp] of this.updateTimestamps.entries()) {
      if (now - timestamp > this.UPDATE_TIMEOUT_MS) {
        this.clearPendingUpdates(serverId);
      }
    }
  }

  /**
   * Get debug information about current state including synchronizer state
   */
  getDebugInfo(): {
    serverLevels: Record<string, LoggingLevel>;
    updateTimestamps: Record<string, number>;
    updateQueues: Record<string, LoggingLevel[]>;
    synchronizerState: {
      serverStates: Record<string, any>;
      activeSyncOperations: string[];
      syncLocks: string[];
    };
  } {
    return {
      serverLevels: Object.fromEntries(this.serverLevels),
      updateTimestamps: Object.fromEntries(this.updateTimestamps),
      updateQueues: Object.fromEntries(this.updateQueues),
      synchronizerState: loggingStateSynchronizer.getDebugInfo(),
    };
  }

  /**
   * Check if a notification level should be corrected with enhanced logic
   */
  shouldCorrectNotificationLevel(
    serverId: string,
    notificationLevel: LoggingLevel,
  ): boolean {
    const expectedLevel = this.getExpectedLevel(serverId);
    const syncState = loggingStateSynchronizer.getServerState(serverId);

    // Don't correct if we don't have an expected level
    if (expectedLevel === undefined) {
      return false;
    }

    // Don't correct if levels match
    if (expectedLevel === notificationLevel) {
      return false;
    }

    // Only correct if we have a recent update or active sync operation
    const hasRecentUpdate = this.hasRecentUpdate(serverId);
    const isActivelySyncing = loggingStateSynchronizer.isSyncing(serverId);

    return hasRecentUpdate || isActivelySyncing;
  }

  /**
   * Get the correction level for a notification
   */
  getCorrectionLevel(serverId: string): LoggingLevel | undefined {
    // First try pending level, then expected level
    return this.getPendingLevel(serverId) || this.getExpectedLevel(serverId);
  }

  /**
   * Remove all data for a server (when server is disconnected)
   */
  removeServer(serverId: string): void {
    this.serverLevels.delete(serverId);
    this.updateTimestamps.delete(serverId);
    this.updateQueues.delete(serverId);

    // Also remove from synchronizer
    loggingStateSynchronizer.removeServer(serverId);
  }
}

// Singleton instance for global use
export const loggingLevelManager = new LoggingLevelManager();

// Periodic cleanup of expired updates
setInterval(() => {
  loggingLevelManager.cleanupAllExpiredUpdates();
}, 30000); // Clean up every 30 seconds
