/**
 * Error deduplication utility to prevent duplicate error messages
 * Manages error message deduplication based on content hashing and timestamps
 */

import { StdErrNotification } from "../../../lib/notificationTypes";

interface ErrorDeduplicationEntry {
  content: string;
  timestamp: number;
  count: number;
  serverId: string;
  lastSeen: number;
}

interface ErrorDeduplicationCache {
  [key: string]: ErrorDeduplicationEntry;
}

export class ErrorDeduplicator {
  private cache: ErrorDeduplicationCache = {};
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly deduplicationWindow: number;
  private readonly maxAge: number;

  constructor(deduplicationWindow: number = 5000, maxAge: number = 30000) {
    this.deduplicationWindow = deduplicationWindow; // 5 seconds window for deduplication
    this.maxAge = maxAge; // 30 seconds max age for cache entries
    this.startCleanupInterval();
  }

  /**
   * Generate a hash key for error content
   */
  private generateErrorKey(
    error: StdErrNotification,
    serverId: string,
  ): string {
    // Create a hash based on error content and server ID
    const content = error.params.content;
    const normalizedContent = content.trim().toLowerCase();

    // Simple hash function for content
    let hash = 0;
    for (let i = 0; i < normalizedContent.length; i++) {
      const char = normalizedContent.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return `${serverId}_${hash}`;
  }

  /**
   * Check if an error should be added (not a duplicate)
   * Returns true if the error should be added, false if it's a duplicate
   */
  deduplicateError(error: StdErrNotification, serverId: string): boolean {
    const key = this.generateErrorKey(error, serverId);
    const now = Date.now();
    const existing = this.cache[key];

    if (existing) {
      // Check if the error is within the deduplication window
      if (now - existing.lastSeen < this.deduplicationWindow) {
        // Update the existing entry
        existing.count++;
        existing.lastSeen = now;
        return false; // Don't add duplicate
      } else {
        // Outside deduplication window, treat as new error
        existing.count = 1;
        existing.lastSeen = now;
        existing.timestamp = now;
        return true;
      }
    } else {
      // New error, add to cache
      const content = error.params.content;
      this.cache[key] = {
        content,
        timestamp: now,
        count: 1,
        serverId,
        lastSeen: now,
      };
      return true;
    }
  }

  /**
   * Get duplicate count for an error
   */
  getDuplicateCount(error: StdErrNotification, serverId: string): number {
    const key = this.generateErrorKey(error, serverId);
    const entry = this.cache[key];
    return entry ? entry.count : 0;
  }

  /**
   * Clear expired error entries from cache
   */
  clearExpiredErrors(): void {
    const now = Date.now();
    Object.keys(this.cache).forEach((key) => {
      const entry = this.cache[key];
      if (now - entry.timestamp > this.maxAge) {
        delete this.cache[key];
      }
    });
  }

  /**
   * Clear all cached errors
   */
  clearAllErrors(): void {
    this.cache = {};
  }

  /**
   * Clear errors for a specific server
   */
  clearServerErrors(serverId: string): void {
    Object.keys(this.cache).forEach((key) => {
      if (this.cache[key].serverId === serverId) {
        delete this.cache[key];
      }
    });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    expired: number;
    byServer: Record<string, number>;
  } {
    const now = Date.now();
    const byServer: Record<string, number> = {};
    let expired = 0;

    Object.values(this.cache).forEach((entry) => {
      if (now - entry.timestamp > this.maxAge) {
        expired++;
      }
      byServer[entry.serverId] = (byServer[entry.serverId] || 0) + 1;
    });

    return {
      size: Object.keys(this.cache).length,
      expired,
      byServer,
    };
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.clearExpiredErrors();
    }, 10000); // Clean up every 10 seconds
  }

  /**
   * Stop automatic cleanup and clear all cache
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearAllErrors();
  }
}

/**
 * Create a new error deduplicator instance
 */
export function createErrorDeduplicator(
  deduplicationWindow?: number,
  maxAge?: number,
): ErrorDeduplicator {
  return new ErrorDeduplicator(deduplicationWindow, maxAge);
}

// Global instance for multi-server error deduplication
export const globalErrorDeduplicator = createErrorDeduplicator(5000, 30000);
