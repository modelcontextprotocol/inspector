/**
 * Request deduplication utility to prevent duplicate API calls
 * Manages request caching with TTL and cleanup mechanisms
 */

interface RequestCacheEntry<T> {
  promise: Promise<T>;
  timestamp: number;
  expiresAt: number;
}

interface RequestCache {
  [key: string]: RequestCacheEntry<any>;
}

interface Deduplicated<T> {
  data: T;
  fromCache: boolean;
  cacheAge: number;
}

export class RequestDeduplicator {
  private cache: RequestCache = {};
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly defaultTTL: number;

  constructor(defaultTTL: number = 2000) {
    this.defaultTTL = defaultTTL;
    this.startCleanupInterval();
  }

  /**
   * Deduplicate a request by key. If a request with the same key is already in progress,
   * return the existing promise. Otherwise, execute the request function and cache the result.
   */
  async deduplicateRequest<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttl: number = this.defaultTTL,
  ): Promise<Deduplicated<T>> {
    const now = Date.now();
    const existing = this.cache[key];

    // Check if we have a valid cached request
    if (existing && existing.expiresAt > now) {
      try {
        const data = await existing.promise;
        const cacheAge = now - existing.timestamp;
        return {
          data,
          fromCache: true,
          cacheAge,
        };
      } catch (error) {
        // If cached request failed, remove it and proceed with new request
        delete this.cache[key];
      }
    }

    // Create new request
    const promise = requestFn();
    const expiresAt = now + ttl;

    this.cache[key] = {
      promise,
      timestamp: now,
      expiresAt,
    };

    try {
      const data = await promise;
      return {
        data,
        fromCache: false,
        cacheAge: 0,
      };
    } catch (error) {
      // Remove failed request from cache
      delete this.cache[key];
      throw error;
    }
  }

  /**
   * Clear expired requests from cache
   */
  clearExpiredRequests(): void {
    const now = Date.now();
    Object.keys(this.cache).forEach((key) => {
      if (this.cache[key].expiresAt <= now) {
        delete this.cache[key];
      }
    });
  }

  /**
   * Clear all cached requests
   */
  clearAllRequests(): void {
    this.cache = {};
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; expired: number } {
    const now = Date.now();
    const expired = Object.values(this.cache).filter(
      (entry) => entry.expiresAt <= now,
    ).length;
    return {
      size: Object.keys(this.cache).length,
      expired,
    };
  }

  /**
   * Check if a request is currently cached
   */
  isCached(key: string): boolean {
    const entry = this.cache[key];
    return entry ? entry.expiresAt > Date.now() : false;
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.clearExpiredRequests();
    }, 5000); // Clean up every 5 seconds
  }

  /**
   * Stop automatic cleanup and clear all cache
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearAllRequests();
  }
}

/**
 * Create a new request deduplicator instance
 */
export function createRequestDeduplicator(
  defaultTTL?: number,
): RequestDeduplicator {
  return new RequestDeduplicator(defaultTTL);
}

// Global instance for multi-server API requests
export const globalRequestDeduplicator = createRequestDeduplicator(2000);
