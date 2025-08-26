/**
 * Global event stream manager for multi-server mode
 * Ensures only one event stream per session, persisting across mode switches
 * Enhanced with improved deduplication and correction logic
 */

import { MultiServerApi } from "../services/multiServerApi";
import { MultiServerEvent } from "../types/multiserver";
import { clientLoggingSync } from "./loggingLevelSync.js";

// Client-side logging level tracking for fallback correction
interface LoggingLevelState {
  expectedLevel: string;
  timestamp: number;
}

// Event correction metadata
interface EventCorrectionMeta {
  originalLevel: string;
  correctedLevel: string;
  correctionSource: "client" | "server" | "event-stream";
  serverId: string;
  timestamp: number;
}

class EventStreamManager {
  private eventSource: EventSource | null = null;
  private isSetupInProgress = false;
  private hasBeenSetup = false;
  private listeners: Set<(event: MultiServerEvent) => void> = new Set();
  private recentEvents: Map<string, number> = new Map(); // For deduplication
  private readonly DEDUPLICATION_WINDOW = 1000; // 1 second window

  // Client-side logging level tracking for fallback correction
  private serverLoggingLevels: Map<string, LoggingLevelState> = new Map();
  private readonly LOGGING_LEVEL_TIMEOUT = 30000; // 30 seconds timeout for level corrections (increased from 5s)

  /**
   * Add a listener for multi-server events
   */
  addListener(listener: (event: MultiServerEvent) => void): () => void {
    this.listeners.add(listener);

    // If we don't have an event stream yet, set it up
    if (!this.eventSource && !this.isSetupInProgress && !this.hasBeenSetup) {
      this.setupEventStream();
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Setup the global event stream (only once per session)
   */
  private async setupEventStream(): Promise<void> {
    if (this.isSetupInProgress || this.hasBeenSetup) {
      return;
    }

    this.isSetupInProgress = true;

    try {
      const newEventSource = await MultiServerApi.createEventStream(
        (event) => {
          try {
            let data: MultiServerEvent = JSON.parse(event.data);

            // Apply client-side logging level correction as fallback
            data = this.correctLoggingNotificationLevel(data);

            // Implement event deduplication to prevent triple notifications
            if (this.shouldDeduplicateEvent(data)) {
              return;
            }

            // Only notify listeners - let them handle the notifications to avoid duplicates
            this.listeners.forEach((listener) => {
              try {
                listener(data);
              } catch (error) {
                console.error("Error in event stream listener:", error);
              }
            });
          } catch (error) {
            console.error("Failed to parse server event:", error);
          }
        },
        (error) => {
          console.error("Global event stream error:", error);
          this.cleanup();
        },
      );

      this.eventSource = newEventSource;
      this.hasBeenSetup = true;
    } catch (error) {
      console.error("Failed to create global event stream:", error);
    } finally {
      this.isSetupInProgress = false;
    }
  }

  /**
   * Check if an event should be deduplicated based on recent events with enhanced logic
   */
  private shouldDeduplicateEvent(event: MultiServerEvent): boolean {
    const now = Date.now();

    // For notification events, create a more specific key to better handle duplicates
    let eventKey: string;
    if (event.type === "notification" && event.notification) {
      // Create key based on notification method and content for better deduplication
      const method = event.notification.method as string;
      const params = event.notification.params as any;

      // For logging messages, use the actual level from data for better deduplication
      if (method === "notifications/message" && params) {
        // Extract actual level from data for consistent deduplication
        const actualLevel = params.data
          ? this.extractActualLevelFromData(params.data)
          : null;
        const level = actualLevel || params.level || "info";
        const content = params.data || params.content || "";
        const logger = params.logger || "";

        // Include correction metadata if present to avoid deduplicating corrected events
        const correctionMeta = params._meta ? JSON.stringify(params._meta) : "";

        // Use actual level for deduplication key to prevent duplicate processing of same level changes
        eventKey = `${event.type}-${event.serverId}-${method}-${level}-${logger}-${content}-${correctionMeta}`;
      } else {
        eventKey = `${event.type}-${event.serverId}-${method}-${JSON.stringify(params)}`;
      }
    } else if (event.type === "stderr_notification" && event.notification) {
      // Handle stderr notifications with source information for console error deduplication
      const content = event.notification.params.content;
      const source = (event as any).source || "server";
      eventKey = `${event.type}-${event.serverId}-${source}-${content}`;
    } else {
      // For other event types, use the full event as before
      eventKey = `${event.type}-${event.serverId}-${JSON.stringify(event)}`;
    }

    // Clean up old events outside the deduplication window
    for (const [key, timestamp] of this.recentEvents.entries()) {
      if (now - timestamp > this.DEDUPLICATION_WINDOW) {
        this.recentEvents.delete(key);
      }
    }

    // Check if we've seen this event recently
    const lastSeen = this.recentEvents.get(eventKey);
    if (lastSeen && now - lastSeen < this.DEDUPLICATION_WINDOW) {
      console.log(
        `[EventStreamManager] DEBUG - Deduplicating event: ${eventKey}`,
      );
      return true; // Deduplicate
    }

    // Record this event
    this.recentEvents.set(eventKey, now);
    return false; // Don't deduplicate
  }

  /**
   * Check if event stream is active
   */
  isActive(): boolean {
    return (
      this.eventSource !== null &&
      this.eventSource.readyState === EventSource.OPEN
    );
  }

  /**
   * Get connection stats
   */
  getStats(): {
    isActive: boolean;
    listenerCount: number;
    hasBeenSetup: boolean;
  } {
    return {
      isActive: this.isActive(),
      listenerCount: this.listeners.size,
      hasBeenSetup: this.hasBeenSetup,
    };
  }

  /**
   * Cleanup the event stream (only when truly needed, like app shutdown)
   */
  cleanup(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isSetupInProgress = false;
    // Don't reset hasBeenSetup - we want to maintain session state
  }

  /**
   * Force reset (for testing or when switching sessions)
   */
  reset(): void {
    this.cleanup();
    this.hasBeenSetup = false;
    this.listeners.clear();
    this.recentEvents.clear();
    this.serverLoggingLevels.clear();

    // Also reset client logging sync
    clientLoggingSync.cleanupExpiredOperations();
  }

  /**
   * Track expected logging level for a server (called when user changes level)
   */
  trackServerLoggingLevel(serverId: string, expectedLevel: string): void {
    this.serverLoggingLevels.set(serverId, {
      expectedLevel,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear expected logging level tracking for a server (called when sync completes)
   */
  clearServerLoggingLevel(serverId: string): void {
    console.log(
      `[EventStreamManager] Clearing legacy logging level tracking for server ${serverId}`,
    );
    this.serverLoggingLevels.delete(serverId);
  }

  /**
   * Extract actual logging level from notification data (server-side bug workaround)
   */
  private extractActualLevelFromData(data: string): string | null {
    // Parse "Logging level set to: <level>" format
    const match = data.match(/Logging level set to:\s*(\w+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Correct logging notification level with enhanced logic using client sync state
   */
  correctLoggingNotificationLevel(event: MultiServerEvent): MultiServerEvent {
    // Only correct notification events with logging/message method
    if (
      event.type !== "notification" ||
      !event.notification ||
      event.notification.method !== "notifications/message"
    ) {
      return event;
    }

    const params = event.notification.params as any;
    if (!params) {
      return event;
    }

    const notificationLevel = params.level;
    const serverId = event.serverId;

    // Extract actual level from notification data (workaround for server bug)
    const actualLevelFromData = params.data
      ? this.extractActualLevelFromData(params.data)
      : null;
    const currentLevel = actualLevelFromData || notificationLevel;

    // Check with the enhanced client logging sync first (primary correction mechanism)
    const syncState = clientLoggingSync.getServerState(serverId);
    if (syncState) {
      const expectedLevel = syncState.expectedLevel;

      console.log(
        `[EventStreamManager] DEBUG - Server ${serverId}: notificationLevel=${notificationLevel}, actualLevel=${currentLevel}, expectedLevel=${expectedLevel}, syncStatus=${syncState.syncStatus}, data="${params.data}"`,
      );

      if (
        syncState.syncStatus === "pending" &&
        currentLevel !== expectedLevel
      ) {
        console.log(
          `[EventStreamManager] Correcting logging level for server ${serverId}: ${currentLevel} -> ${expectedLevel}`,
        );

        // Update actual level in client sync
        clientLoggingSync.updateActualLevel(serverId, currentLevel);

        // Create corrected event with the expected level
        const correctedEvent: MultiServerEvent = {
          ...event,
          notification: {
            ...event.notification,
            params: {
              ...params,
              level: expectedLevel,
              _meta: {
                originalLevel: currentLevel,
                correctedLevel: expectedLevel,
                correctionSource: "client",
                serverId: serverId,
                timestamp: Date.now(),
              } as EventCorrectionMeta,
            },
          },
        };

        return correctedEvent;
      } else if (
        syncState.syncStatus === "pending" &&
        currentLevel === expectedLevel
      ) {
        // Levels match, mark sync as complete
        clientLoggingSync.updateActualLevel(serverId, currentLevel);
        console.log(
          `[EventStreamManager] Logging level sync completed for server ${serverId}: ${currentLevel}`,
        );

        // Fix the notification level to match the actual level
        if (notificationLevel !== currentLevel) {
          const correctedEvent: MultiServerEvent = {
            ...event,
            notification: {
              ...event.notification,
              params: {
                ...params,
                level: currentLevel,
              },
            },
          };
          return correctedEvent;
        }
      }
      // If syncStatus is 'synced' or 'failed', don't do any correction
    } else {
      // No sync state - fix notification level if it doesn't match actual level
      if (actualLevelFromData && notificationLevel !== actualLevelFromData) {
        console.log(
          `[EventStreamManager] DEBUG - Fixing notification level for server ${serverId}: ${notificationLevel} -> ${actualLevelFromData}, data="${params.data}"`,
        );
        const correctedEvent: MultiServerEvent = {
          ...event,
          notification: {
            ...event.notification,
            params: {
              ...params,
              level: actualLevelFromData,
            },
          },
        };
        return correctedEvent;
      } else {
        console.log(
          `[EventStreamManager] DEBUG - No sync state found for server ${serverId}, notificationLevel=${notificationLevel}, actualLevel=${currentLevel}, data="${params.data}"`,
        );
      }
    }

    // No correction needed - return original event
    return event;
  }

  /**
   * Check if a notification level should be corrected with enhanced logic
   */
  shouldCorrectLevel(serverId: string, notificationLevel: string): boolean {
    // First check with the enhanced client logging sync
    const syncState = clientLoggingSync.getServerState(serverId);
    if (syncState && syncState.syncStatus === "pending") {
      return syncState.expectedLevel !== notificationLevel;
    }

    // Fallback to legacy logic
    const levelState = this.serverLoggingLevels.get(serverId);
    if (!levelState) {
      return false;
    }

    const now = Date.now();
    const isRecent = now - levelState.timestamp < this.LOGGING_LEVEL_TIMEOUT;

    return isRecent && levelState.expectedLevel !== notificationLevel;
  }

  /**
   * Clean up expired logging level states
   */
  private cleanupExpiredLoggingLevels(): void {
    const now = Date.now();

    for (const [serverId, levelState] of this.serverLoggingLevels.entries()) {
      if (now - levelState.timestamp > this.LOGGING_LEVEL_TIMEOUT) {
        this.serverLoggingLevels.delete(serverId);
      }
    }
  }

  /**
   * Get debug information about client-side logging level tracking
   */
  getLoggingDebugInfo(): {
    serverLoggingLevels: Record<string, LoggingLevelState>;
    activeCorrections: number;
    clientSyncState: ReturnType<typeof clientLoggingSync.getDebugInfo>;
  } {
    this.cleanupExpiredLoggingLevels();

    return {
      serverLoggingLevels: Object.fromEntries(this.serverLoggingLevels),
      activeCorrections: this.serverLoggingLevels.size,
      clientSyncState: clientLoggingSync.getDebugInfo(),
    };
  }
}

// Global singleton instance
export const globalEventStreamManager = new EventStreamManager();
