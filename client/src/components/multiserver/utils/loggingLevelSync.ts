import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { globalEventStreamManager } from "./eventStreamManager.js";

/**
 * Client-side logging level state tracking
 */
interface ClientLoggingLevelState {
  expectedLevel: LoggingLevel;
  actualLevel?: LoggingLevel;
  timestamp: number;
  syncStatus: "pending" | "synced" | "failed";
  retryCount: number;
  optimisticUpdate: boolean;
}

/**
 * Logging level change tracking metadata
 */
interface LoggingLevelChange {
  serverId: string;
  level: LoggingLevel;
  timestamp: number;
  promise: Promise<boolean>;
  resolve: (success: boolean) => void;
  reject: (error: Error) => void;
}

/**
 * Client-side logging level synchronization utilities.
 * Provides reliable client-side logging level synchronization with proper state tracking,
 * optimistic updates, and error handling.
 */
export class ClientLoggingSync {
  private serverStates = new Map<string, ClientLoggingLevelState>();
  private activeChanges = new Map<string, LoggingLevelChange>();
  private changeLocks = new Map<string, Promise<void>>();
  private completionCallbacks = new Map<
    string,
    (actualLevel: LoggingLevel) => void
  >();

  // Configuration
  private readonly SYNC_TIMEOUT_MS = 15000; // 15 seconds timeout for sync operations
  private readonly MAX_RETRY_COUNT = 2;
  private readonly RETRY_DELAY_BASE_MS = 1000; // Base delay for exponential backoff

  /**
   * Track a logging level change with optimistic update
   */
  trackLogLevelChange(
    serverId: string,
    level: LoggingLevel,
    optimistic: boolean = true,
  ): void {
    const currentState = this.serverStates.get(serverId);

    const newState: ClientLoggingLevelState = {
      expectedLevel: level,
      actualLevel: optimistic ? level : currentState?.actualLevel,
      timestamp: Date.now(),
      syncStatus: "pending",
      retryCount: 0,
      optimisticUpdate: optimistic,
    };

    this.serverStates.set(serverId, newState);
  }

  /**
   * Wait for logging level synchronization to complete
   */
  async waitForLogLevelSync(
    serverId: string,
    timeoutMs: number = this.SYNC_TIMEOUT_MS,
  ): Promise<boolean> {
    const activeChange = this.activeChanges.get(serverId);
    if (!activeChange) {
      // Check if already synced
      const state = this.serverStates.get(serverId);
      return state?.syncStatus === "synced" || false;
    }

    try {
      return await Promise.race([
        activeChange.promise,
        this.createTimeoutPromise(timeoutMs),
      ]);
    } catch (error) {
      return false;
    }
  }

  /**
   * Perform reliable logging level change with retry logic
   */
  async performLogLevelChange(
    serverId: string,
    level: LoggingLevel,
    changeCallback: (serverId: string, level: LoggingLevel) => Promise<boolean>,
  ): Promise<boolean> {
    // Wait for any existing change operation to complete
    await this.waitForChangeLock(serverId);

    // Create change lock to prevent race conditions
    const changePromise = this.performChangeWithLock(
      serverId,
      level,
      changeCallback,
    );
    this.changeLocks.set(
      serverId,
      changePromise.then(() => {}),
    );

    try {
      return await changePromise;
    } finally {
      this.changeLocks.delete(serverId);
    }
  }

  /**
   * Perform the actual change operation with proper locking
   */
  private async performChangeWithLock(
    serverId: string,
    level: LoggingLevel,
    changeCallback: (serverId: string, level: LoggingLevel) => Promise<boolean>,
  ): Promise<boolean> {
    const currentState = this.serverStates.get(serverId);

    // Check if we're already changing to this level
    if (
      currentState?.expectedLevel === level &&
      currentState.syncStatus === "pending"
    ) {
      // Wait for existing change operation
      const existingChange = this.activeChanges.get(serverId);
      if (existingChange) {
        return await existingChange.promise;
      }
    }

    // Track the change with optimistic update
    this.trackLogLevelChange(serverId, level, true);

    // Create change operation
    let resolveChange: (success: boolean) => void;
    let rejectChange: (error: Error) => void;

    const changePromise = new Promise<boolean>((resolve, reject) => {
      resolveChange = resolve;
      rejectChange = reject;
    });

    const change: LoggingLevelChange = {
      serverId,
      level,
      timestamp: Date.now(),
      promise: changePromise,
      resolve: resolveChange!,
      reject: rejectChange!,
    };

    this.activeChanges.set(serverId, change);

    try {
      const success = await this.executeChangeWithRetry(
        serverId,
        level,
        changeCallback,
      );

      // Update state based on result
      const finalState = this.serverStates.get(serverId);
      if (finalState) {
        finalState.syncStatus = success ? "synced" : "failed";
        if (!success && finalState.optimisticUpdate) {
          // Revert optimistic update on failure
          finalState.actualLevel = undefined;
        }
        this.serverStates.set(serverId, finalState);
      }

      change.resolve(success);
      return success;
    } catch (error) {
      const finalState = this.serverStates.get(serverId);
      if (finalState) {
        finalState.syncStatus = "failed";
        if (finalState.optimisticUpdate) {
          // Revert optimistic update on error
          finalState.actualLevel = undefined;
        }
        this.serverStates.set(serverId, finalState);
      }

      change.reject(error as Error);
      throw error;
    } finally {
      this.activeChanges.delete(serverId);
    }
  }

  /**
   * Execute change operation with retry logic
   */
  private async executeChangeWithRetry(
    serverId: string,
    level: LoggingLevel,
    changeCallback: (serverId: string, level: LoggingLevel) => Promise<boolean>,
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

        // Execute change callback
        const success = await Promise.race([
          changeCallback(serverId, level),
          this.createTimeoutPromise(this.SYNC_TIMEOUT_MS),
        ]);

        if (success) {
          return true;
        }

        // If we reach here, change failed but didn't throw
        lastError = new Error(
          `Change callback returned false for server ${serverId}`,
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
      new Error(`Failed to change logging level for server ${serverId}`)
    );
  }

  /**
   * Update actual logging level (called when server confirms level change)
   */
  updateActualLevel(serverId: string, actualLevel: LoggingLevel): void {
    const state = this.serverStates.get(serverId);
    if (state) {
      // const previousActualLevel = state.actualLevel; // Commented out as it's not used
      state.actualLevel = actualLevel;

      // Update sync status based on whether levels match
      if (state.expectedLevel === actualLevel) {
        state.syncStatus = "synced";

        // Always notify completion callback if provided, even if level hasn't changed
        // This ensures UI updates are reliable and consistent
        const callback = this.completionCallbacks.get(serverId);
        if (callback) {
          try {
            callback(actualLevel);
          } catch (error) {
            console.error(
              `[ClientLoggingSync] Error in completion callback for server ${serverId}:`,
              error,
            );
          }
          this.completionCallbacks.delete(serverId);
        }

        // Clear the state after a short delay to prevent further corrections
        // This ensures the sync is complete and no more corrections are needed
        setTimeout(() => {
          const currentState = this.serverStates.get(serverId);
          if (
            currentState &&
            currentState.syncStatus === "synced" &&
            currentState.expectedLevel === actualLevel
          ) {
            this.serverStates.delete(serverId);

            // Also clear the legacy tracking in event stream manager
            globalEventStreamManager.clearServerLoggingLevel(serverId);
          }
        }, 2000); // Clear after 2 seconds to allow for any remaining notifications
      } else {
        // Levels don't match - keep trying to sync
        console.log(
          `[ClientLoggingSync] Level mismatch for server ${serverId}: expected=${state.expectedLevel}, actual=${actualLevel}`,
        );
      }

      this.serverStates.set(serverId, state);
    }

    // Also notify callback even if no state exists - this handles edge cases
    // where the server confirms a level change but we don't have tracked state
    else {
      const callback = this.completionCallbacks.get(serverId);
      if (callback) {
        try {
          callback(actualLevel);
        } catch (error) {
          console.error(
            `[ClientLoggingSync] Error in completion callback for server ${serverId}:`,
            error,
          );
        }
        this.completionCallbacks.delete(serverId);
      }
    }
  }

  /**
   * Get current logging level state for a server
   */
  getServerState(serverId: string): ClientLoggingLevelState | undefined {
    return this.serverStates.get(serverId);
  }

  /**
   * Check if server is currently changing logging level
   */
  isChanging(serverId: string): boolean {
    const state = this.serverStates.get(serverId);
    return state?.syncStatus === "pending" || this.activeChanges.has(serverId);
  }

  /**
   * Get the expected logging level for a server
   */
  getExpectedLevel(serverId: string): LoggingLevel | undefined {
    const state = this.serverStates.get(serverId);
    return state?.expectedLevel;
  }

  /**
   * Get the actual logging level for a server
   */
  getActualLevel(serverId: string): LoggingLevel | undefined {
    const state = this.serverStates.get(serverId);
    return state?.actualLevel;
  }

  /**
   * Check if logging level is synchronized
   */
  isSynchronized(serverId: string): boolean {
    const state = this.serverStates.get(serverId);
    return (
      state?.syncStatus === "synced" &&
      state.expectedLevel === state.actualLevel
    );
  }

  /**
   * Validate logging level synchronization status
   */
  validateSync(serverId: string): {
    isValid: boolean;
    expectedLevel?: LoggingLevel;
    actualLevel?: LoggingLevel;
    syncStatus?: "pending" | "synced" | "failed";
    lastSyncTime?: number;
    hasOptimisticUpdate?: boolean;
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
      hasOptimisticUpdate: state.optimisticUpdate,
    };
  }

  /**
   * Register a callback to be called when sync completes
   */
  onSyncComplete(
    serverId: string,
    callback: (actualLevel: LoggingLevel) => void,
  ): void {
    this.completionCallbacks.set(serverId, callback);
  }

  /**
   * Remove server state (when server disconnects)
   */
  removeServer(serverId: string): void {
    this.serverStates.delete(serverId);
    this.completionCallbacks.delete(serverId);

    // Cancel any active change operation
    const change = this.activeChanges.get(serverId);
    if (change) {
      change.reject(new Error(`Server ${serverId} disconnected`));
      this.activeChanges.delete(serverId);
    }

    this.changeLocks.delete(serverId);
  }

  /**
   * Get debug information about current synchronization state
   */
  getDebugInfo(): {
    serverStates: Record<string, ClientLoggingLevelState>;
    activeChanges: string[];
    changeLocks: string[];
  } {
    return {
      serverStates: Object.fromEntries(this.serverStates),
      activeChanges: Array.from(this.activeChanges.keys()),
      changeLocks: Array.from(this.changeLocks.keys()),
    };
  }

  /**
   * Clean up expired sync operations
   */
  cleanupExpiredOperations(): void {
    const now = Date.now();

    for (const [serverId, change] of this.activeChanges.entries()) {
      if (now - change.timestamp > this.SYNC_TIMEOUT_MS) {
        change.reject(
          new Error(`Change operation timed out for server ${serverId}`),
        );
        this.activeChanges.delete(serverId);
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
   * Wait for change lock to be released
   */
  private async waitForChangeLock(serverId: string): Promise<void> {
    const existingLock = this.changeLocks.get(serverId);
    if (existingLock) {
      try {
        await existingLock;
      } catch (error) {
        // Ignore errors from previous change operations
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
export const clientLoggingSync = new ClientLoggingSync();

// Periodic cleanup of expired operations
setInterval(() => {
  clientLoggingSync.cleanupExpiredOperations();
}, 30000); // Clean up every 30 seconds
