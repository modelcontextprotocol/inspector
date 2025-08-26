import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

/**
 * Enhanced logging level state tracking
 */
interface LoggingLevelState {
  expectedLevel: LoggingLevel;
  actualLevel?: LoggingLevel;
  timestamp: number;
  syncStatus: "pending" | "synced" | "failed";
  retryCount: number;
}

/**
 * Logging level synchronization metadata
 */
interface SyncOperation {
  serverId: string;
  level: LoggingLevel;
  timestamp: number;
  promise: Promise<boolean>;
  resolve: (success: boolean) => void;
  reject: (error: Error) => void;
}

/**
 * Centralized logging state synchronization manager.
 * Provides reliable server-side logging level synchronization with proper state tracking,
 * race condition prevention, and retry mechanisms.
 */
export class LoggingStateSynchronizer {
  private serverStates = new Map<string, LoggingLevelState>();
  private activeSyncOperations = new Map<string, SyncOperation>();
  private syncLocks = new Map<string, Promise<void>>();

  // Configuration
  private readonly SYNC_TIMEOUT_MS = 10000; // 10 seconds timeout for sync operations
  private readonly MAX_RETRY_COUNT = 3;
  private readonly RETRY_DELAY_BASE_MS = 1000; // Base delay for exponential backoff

  /**
   * Synchronize logging level for a server with proper state tracking
   */
  async syncServerLogLevel(
    serverId: string,
    level: LoggingLevel,
    syncCallback?: (serverId: string, level: LoggingLevel) => Promise<boolean>,
  ): Promise<boolean> {
    // Wait for any existing sync operation to complete
    await this.waitForSyncLock(serverId);

    // Create sync lock to prevent race conditions
    const syncPromise = this.performSyncWithLock(serverId, level, syncCallback);
    this.syncLocks.set(
      serverId,
      syncPromise.then(() => {}),
    );

    try {
      return await syncPromise;
    } finally {
      this.syncLocks.delete(serverId);
    }
  }

  /**
   * Perform the actual sync operation with proper locking
   */
  private async performSyncWithLock(
    serverId: string,
    level: LoggingLevel,
    syncCallback?: (serverId: string, level: LoggingLevel) => Promise<boolean>,
  ): Promise<boolean> {
    const currentState = this.serverStates.get(serverId);

    // Check if we're already syncing to this level
    if (
      currentState?.expectedLevel === level &&
      currentState.syncStatus === "pending"
    ) {
      // Wait for existing sync operation
      const existingOperation = this.activeSyncOperations.get(serverId);
      if (existingOperation) {
        return await existingOperation.promise;
      }
    }

    // Initialize or update server state
    const newState: LoggingLevelState = {
      expectedLevel: level,
      actualLevel: currentState?.actualLevel,
      timestamp: Date.now(),
      syncStatus: "pending",
      retryCount: 0,
    };
    this.serverStates.set(serverId, newState);

    // Create sync operation
    let resolveOperation: (success: boolean) => void;
    let rejectOperation: (error: Error) => void;

    const syncPromise = new Promise<boolean>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });

    const operation: SyncOperation = {
      serverId,
      level,
      timestamp: Date.now(),
      promise: syncPromise,
      resolve: resolveOperation!,
      reject: rejectOperation!,
    };

    this.activeSyncOperations.set(serverId, operation);

    try {
      const success = await this.executeSyncWithRetry(
        serverId,
        level,
        syncCallback,
      );

      // Update state based on result
      const finalState = this.serverStates.get(serverId);
      if (finalState) {
        finalState.syncStatus = success ? "synced" : "failed";
        finalState.actualLevel = success ? level : finalState.actualLevel;
        this.serverStates.set(serverId, finalState);
      }

      operation.resolve(success);
      return success;
    } catch (error) {
      const finalState = this.serverStates.get(serverId);
      if (finalState) {
        finalState.syncStatus = "failed";
        this.serverStates.set(serverId, finalState);
      }

      operation.reject(error as Error);
      throw error;
    } finally {
      this.activeSyncOperations.delete(serverId);
    }
  }

  /**
   * Execute sync operation with retry logic
   */
  private async executeSyncWithRetry(
    serverId: string,
    level: LoggingLevel,
    syncCallback?: (serverId: string, level: LoggingLevel) => Promise<boolean>,
  ): Promise<boolean> {
    const state = this.serverStates.get(serverId);
    if (!state) {
      throw new Error(`No state found for server ${serverId}`);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.MAX_RETRY_COUNT; attempt++) {
      try {
        // Update retry count
        state.retryCount = attempt;
        this.serverStates.set(serverId, state);

        // Execute sync callback if provided
        if (syncCallback) {
          const success = await Promise.race([
            syncCallback(serverId, level),
            this.createTimeoutPromise(this.SYNC_TIMEOUT_MS),
          ]);

          if (success) {
            return true;
          }
        } else {
          // If no callback provided, assume sync is successful
          return true;
        }

        // If we reach here, sync failed but didn't throw
        lastError = new Error(
          `Sync callback returned false for server ${serverId}`,
        );
      } catch (error) {
        lastError = error as Error;

        // Don't retry on timeout or if this is the last attempt
        if (error instanceof Error && error.message.includes("timeout")) {
          break;
        }

        if (attempt < this.MAX_RETRY_COUNT) {
          // Wait before retry with exponential backoff
          const delay = this.RETRY_DELAY_BASE_MS * Math.pow(2, attempt);
          await this.delay(delay);
        }
      }
    }

    throw (
      lastError ||
      new Error(`Failed to sync logging level for server ${serverId}`)
    );
  }

  /**
   * Validate logging level synchronization status
   */
  validateLogLevelSync(serverId: string): {
    isValid: boolean;
    expectedLevel?: LoggingLevel;
    actualLevel?: LoggingLevel;
    syncStatus?: "pending" | "synced" | "failed";
    lastSyncTime?: number;
  } {
    const state = this.serverStates.get(serverId);

    if (!state) {
      return { isValid: false };
    }

    const isValid =
      state.syncStatus === "synced" &&
      state.expectedLevel === state.actualLevel;

    return {
      isValid,
      expectedLevel: state.expectedLevel,
      actualLevel: state.actualLevel,
      syncStatus: state.syncStatus,
      lastSyncTime: state.timestamp,
    };
  }

  /**
   * Get current logging level state for a server
   */
  getServerState(serverId: string): LoggingLevelState | undefined {
    return this.serverStates.get(serverId);
  }

  /**
   * Update actual logging level (called when server confirms level change)
   */
  updateActualLevel(serverId: string, actualLevel: LoggingLevel): void {
    const state = this.serverStates.get(serverId);
    if (state) {
      state.actualLevel = actualLevel;

      // Update sync status based on whether levels match
      if (state.expectedLevel === actualLevel) {
        state.syncStatus = "synced";
      }

      this.serverStates.set(serverId, state);
    }
  }

  /**
   * Check if server is currently syncing
   */
  isSyncing(serverId: string): boolean {
    const state = this.serverStates.get(serverId);
    return (
      state?.syncStatus === "pending" || this.activeSyncOperations.has(serverId)
    );
  }

  /**
   * Wait for any active sync operation to complete
   */
  async waitForSync(
    serverId: string,
    timeoutMs: number = this.SYNC_TIMEOUT_MS,
  ): Promise<boolean> {
    const operation = this.activeSyncOperations.get(serverId);
    if (!operation) {
      return true; // No active sync operation
    }

    try {
      return await Promise.race([
        operation.promise,
        this.createTimeoutPromise(timeoutMs),
      ]);
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove server state (when server disconnects)
   */
  removeServer(serverId: string): void {
    this.serverStates.delete(serverId);

    // Cancel any active sync operation
    const operation = this.activeSyncOperations.get(serverId);
    if (operation) {
      operation.reject(new Error(`Server ${serverId} disconnected`));
      this.activeSyncOperations.delete(serverId);
    }

    this.syncLocks.delete(serverId);
  }

  /**
   * Get debug information about current synchronization state
   */
  getDebugInfo(): {
    serverStates: Record<string, LoggingLevelState>;
    activeSyncOperations: string[];
    syncLocks: string[];
  } {
    return {
      serverStates: Object.fromEntries(this.serverStates),
      activeSyncOperations: Array.from(this.activeSyncOperations.keys()),
      syncLocks: Array.from(this.syncLocks.keys()),
    };
  }

  /**
   * Clean up expired sync operations
   */
  cleanupExpiredOperations(): void {
    const now = Date.now();

    for (const [serverId, operation] of this.activeSyncOperations.entries()) {
      if (now - operation.timestamp > this.SYNC_TIMEOUT_MS) {
        operation.reject(
          new Error(`Sync operation timed out for server ${serverId}`),
        );
        this.activeSyncOperations.delete(serverId);
      }
    }

    // Clean up old server states
    for (const [serverId, state] of this.serverStates.entries()) {
      if (
        now - state.timestamp > this.SYNC_TIMEOUT_MS * 2 &&
        state.syncStatus !== "synced"
      ) {
        this.serverStates.delete(serverId);
      }
    }
  }

  /**
   * Wait for sync lock to be released
   */
  private async waitForSyncLock(serverId: string): Promise<void> {
    const existingLock = this.syncLocks.get(serverId);
    if (existingLock) {
      try {
        await existingLock;
      } catch (error) {
        // Ignore errors from previous sync operations
      }
    }
  }

  /**
   * Create a timeout promise that rejects after specified milliseconds
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Delay execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance for global use
export const loggingStateSynchronizer = new LoggingStateSynchronizer();

// Periodic cleanup of expired operations
setInterval(() => {
  loggingStateSynchronizer.cleanupExpiredOperations();
}, 30000); // Clean up every 30 seconds
