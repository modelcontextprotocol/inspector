import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { loggingStateSynchronizer } from "../utils/loggingStateSynchronizer.js";

/**
 * Enhanced server connection interface with reliability tracking
 */
export interface EnhancedServerConnection {
  id: string;
  logLevel: LoggingLevel;
  loggingSupported: boolean;
  connectionAttempts: number;
  lastSuccessfulConnection?: Date;
  firstConnectionErrors: string[];
  isFirstConnection: boolean;
}

/**
 * Connection retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Connection reliability middleware for ensuring proper error visibility
 * and connection stability in multi-server environments.
 */
export class ConnectionReliabilityMiddleware {
  private connectionStates = new Map<string, EnhancedServerConnection>();
  private retryOperations = new Map<string, Promise<any>>();

  // Default retry configuration
  private readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
  };

  /**
   * Ensure server errors are visible on first connection
   */
  async ensureErrorVisibility(
    serverId: string,
    connectionOperation: () => Promise<any>,
  ): Promise<any> {
    const connectionState = this.getOrCreateConnectionState(serverId);

    try {
      // Track connection attempt
      connectionState.connectionAttempts++;

      // Execute connection operation
      const result = await connectionOperation();

      // Mark successful connection
      connectionState.lastSuccessfulConnection = new Date();
      connectionState.isFirstConnection = false;
      connectionState.firstConnectionErrors = []; // Clear errors on success

      this.connectionStates.set(serverId, connectionState);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Track first connection errors for visibility
      if (connectionState.isFirstConnection) {
        connectionState.firstConnectionErrors.push(errorMessage);

        // Ensure first connection errors are immediately visible
        this.exposeFirstConnectionError(serverId, errorMessage);
      }

      this.connectionStates.set(serverId, connectionState);

      throw error;
    }
  }

  /**
   * Retry operations with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
  ): Promise<T> {
    const retryConfig = { ...this.DEFAULT_RETRY_CONFIG, ...config };
    let lastError: Error;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on the last attempt
        if (attempt === retryConfig.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          retryConfig.baseDelayMs *
            Math.pow(retryConfig.backoffMultiplier, attempt),
          retryConfig.maxDelayMs,
        );

        // Wait before retry
        await this.delay(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Enhanced logging level synchronization with reliability
   */
  async syncLoggingLevelReliably(
    serverId: string,
    level: LoggingLevel,
    syncCallback: (serverId: string, level: LoggingLevel) => Promise<boolean>,
  ): Promise<boolean> {
    // Prevent concurrent sync operations for the same server
    const existingOperation = this.retryOperations.get(serverId);
    if (existingOperation) {
      try {
        await existingOperation;
      } catch (error) {
        // Ignore errors from previous operations
      }
    }

    // Create new sync operation with retry logic
    const syncOperation = this.retryWithBackoff(
      async () => {
        const success = await loggingStateSynchronizer.syncServerLogLevel(
          serverId,
          level,
          syncCallback,
        );

        if (!success) {
          throw new Error(
            `Failed to sync logging level to ${level} for server ${serverId}`,
          );
        }

        return success;
      },
      {
        maxRetries: 2, // Fewer retries for logging level sync
        baseDelayMs: 500,
        maxDelayMs: 2000,
      },
    );

    this.retryOperations.set(serverId, syncOperation);

    try {
      const result = await syncOperation;

      // Update connection state
      const connectionState = this.getOrCreateConnectionState(serverId);
      connectionState.logLevel = level;
      this.connectionStates.set(serverId, connectionState);

      return result;
    } finally {
      this.retryOperations.delete(serverId);
    }
  }

  /**
   * Validate connection health and retry if needed
   */
  async validateConnectionHealth(
    serverId: string,
    healthCheck: () => Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await this.retryWithBackoff(
        async () => {
          const isHealthy = await healthCheck();
          if (!isHealthy) {
            throw new Error(`Health check failed for server ${serverId}`);
          }
          return isHealthy;
        },
        {
          maxRetries: 2,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
        },
      );
    } catch (error) {
      console.error(
        `Connection health validation failed for server ${serverId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get connection reliability metrics
   */
  getConnectionMetrics(serverId: string): {
    connectionAttempts: number;
    lastSuccessfulConnection?: Date;
    firstConnectionErrors: string[];
    isFirstConnection: boolean;
    hasRecentErrors: boolean;
  } {
    const connectionState = this.connectionStates.get(serverId);

    if (!connectionState) {
      return {
        connectionAttempts: 0,
        firstConnectionErrors: [],
        isFirstConnection: true,
        hasRecentErrors: false,
      };
    }

    return {
      connectionAttempts: connectionState.connectionAttempts,
      lastSuccessfulConnection: connectionState.lastSuccessfulConnection,
      firstConnectionErrors: connectionState.firstConnectionErrors,
      isFirstConnection: connectionState.isFirstConnection,
      hasRecentErrors: connectionState.firstConnectionErrors.length > 0,
    };
  }

  /**
   * Reset connection state (when server is removed or reconnected)
   */
  resetConnectionState(serverId: string): void {
    this.connectionStates.delete(serverId);

    // Cancel any pending retry operations
    const operation = this.retryOperations.get(serverId);
    if (operation) {
      this.retryOperations.delete(serverId);
    }
  }

  /**
   * Get all connection states for debugging
   */
  getDebugInfo(): {
    connectionStates: Record<string, EnhancedServerConnection>;
    activeRetryOperations: string[];
  } {
    return {
      connectionStates: Object.fromEntries(this.connectionStates),
      activeRetryOperations: Array.from(this.retryOperations.keys()),
    };
  }

  /**
   * Check if server is currently retrying operations
   */
  isRetrying(serverId: string): boolean {
    return this.retryOperations.has(serverId);
  }

  /**
   * Wait for any pending retry operations to complete
   */
  async waitForRetryCompletion(
    serverId: string,
    timeoutMs: number = 10000,
  ): Promise<void> {
    const operation = this.retryOperations.get(serverId);
    if (!operation) {
      return;
    }

    try {
      await Promise.race([operation, this.createTimeoutPromise(timeoutMs)]);
    } catch (error) {
      // Ignore errors, we just want to wait for completion
    }
  }

  /**
   * Get or create connection state for a server
   */
  private getOrCreateConnectionState(
    serverId: string,
  ): EnhancedServerConnection {
    let connectionState = this.connectionStates.get(serverId);

    if (!connectionState) {
      connectionState = {
        id: serverId,
        logLevel: "info", // Default log level
        loggingSupported: false,
        connectionAttempts: 0,
        firstConnectionErrors: [],
        isFirstConnection: true,
      };
    }

    return connectionState;
  }

  /**
   * Expose first connection errors to ensure visibility
   */
  private exposeFirstConnectionError(
    serverId: string,
    errorMessage: string,
  ): void {
    // Log error immediately to ensure visibility
    console.error(
      `First connection error for server ${serverId}:`,
      errorMessage,
    );

    // Could also emit events or use other mechanisms to ensure error visibility
    // This ensures that first connection errors are not hidden due to timing issues
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
export const connectionReliabilityMiddleware =
  new ConnectionReliabilityMiddleware();
