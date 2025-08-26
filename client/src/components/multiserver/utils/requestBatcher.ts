/**
 * Request batching utility to combine multiple API requests
 * Reduces network overhead by batching requests together
 */

interface BatchRequest {
  id: string;
  endpoint: string;
  method: string;
  body?: any;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

class RequestBatcher {
  private pendingRequests: Map<string, BatchRequest> = new Map();
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly batchDelay: number;
  private readonly maxBatchSize: number;

  constructor(batchDelay: number = 50, maxBatchSize: number = 10) {
    this.batchDelay = batchDelay; // 50ms delay to collect requests
    this.maxBatchSize = maxBatchSize; // Maximum requests per batch
  }

  /**
   * Add a request to the batch
   */
  async batchRequest<T>(
    endpoint: string,
    method: string = "GET",
    body?: any,
  ): Promise<T> {
    const requestId = `${method}:${endpoint}:${Date.now()}:${Math.random()}`;

    return new Promise<T>((resolve, reject) => {
      const batchRequest: BatchRequest = {
        id: requestId,
        endpoint,
        method,
        body,
        resolve,
        reject,
      };

      this.pendingRequests.set(requestId, batchRequest);

      // If we've reached max batch size, flush immediately
      if (this.pendingRequests.size >= this.maxBatchSize) {
        this.flushBatch();
      } else {
        // Otherwise, schedule a batch flush
        this.scheduleBatchFlush();
      }
    });
  }

  /**
   * Schedule a batch flush after the delay
   */
  private scheduleBatchFlush(): void {
    if (this.batchTimeout) {
      return; // Already scheduled
    }

    this.batchTimeout = setTimeout(() => {
      this.flushBatch();
    }, this.batchDelay);
  }

  /**
   * Flush the current batch of requests
   */
  private async flushBatch(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.pendingRequests.size === 0) {
      return;
    }

    const requests = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();

    console.log(`Flushing batch of ${requests.length} requests`);

    try {
      // Check if we can batch these requests
      const batchableRequests = this.groupBatchableRequests(requests);

      // Process each group
      for (const [batchKey, groupRequests] of batchableRequests.entries()) {
        if (groupRequests.length === 1) {
          // Single request, execute normally
          await this.executeSingleRequest(groupRequests[0]);
        } else {
          // Multiple requests, try to batch them
          await this.executeBatchedRequests(batchKey, groupRequests);
        }
      }
    } catch (error) {
      console.error("Error flushing batch:", error);
      // Reject all pending requests
      requests.forEach((req) => {
        req.reject(error as Error);
      });
    }
  }

  /**
   * Group requests that can be batched together
   */
  private groupBatchableRequests(
    requests: BatchRequest[],
  ): Map<string, BatchRequest[]> {
    const groups = new Map<string, BatchRequest[]>();

    requests.forEach((request) => {
      // Group by method and base endpoint pattern
      const batchKey = this.getBatchKey(request);

      if (!groups.has(batchKey)) {
        groups.set(batchKey, []);
      }
      groups.get(batchKey)!.push(request);
    });

    return groups;
  }

  /**
   * Get a batch key for grouping similar requests
   */
  private getBatchKey(request: BatchRequest): string {
    // Group GET requests to similar endpoints
    if (request.method === "GET") {
      if (request.endpoint.includes("/connections/")) {
        return "GET:connections";
      }
      if (
        request.endpoint.includes("/servers/") &&
        request.endpoint.includes("/status")
      ) {
        return "GET:server-status";
      }
      if (request.endpoint === "/servers") {
        return "GET:servers";
      }
    }

    // Default: each request is its own batch
    return `${request.method}:${request.endpoint}:${request.id}`;
  }

  /**
   * Execute a single request
   */
  private async executeSingleRequest(request: BatchRequest): Promise<void> {
    try {
      const response = await fetch(request.endpoint, {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      request.resolve(data);
    } catch (error) {
      request.reject(error as Error);
    }
  }

  /**
   * Execute batched requests (for similar endpoints)
   */
  private async executeBatchedRequests(
    batchKey: string,
    requests: BatchRequest[],
  ): Promise<void> {
    console.log(`Executing batched requests for ${batchKey}:`, requests.length);

    if (batchKey === "GET:connections") {
      await this.executeBatchedConnections(requests);
    } else if (batchKey === "GET:server-status") {
      await this.executeBatchedServerStatus(requests);
    } else {
      // Fallback: execute individually
      for (const request of requests) {
        await this.executeSingleRequest(request);
      }
    }
  }

  /**
   * Execute batched connection requests
   */
  private async executeBatchedConnections(
    requests: BatchRequest[],
  ): Promise<void> {
    try {
      // Get all connections at once
      const response = await fetch("/api/connections", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const allConnections = await response.json();

      // Resolve individual requests based on server ID
      requests.forEach((request) => {
        try {
          const serverId = this.extractServerIdFromEndpoint(request.endpoint);
          const connection = allConnections.find(
            (conn: any) => conn.serverId === serverId,
          );

          if (connection) {
            request.resolve(connection);
          } else {
            request.reject(
              new Error(`Connection not found for server ${serverId}`),
            );
          }
        } catch (error) {
          request.reject(error as Error);
        }
      });
    } catch (error) {
      // If batch fails, reject all requests
      requests.forEach((req) => req.reject(error as Error));
    }
  }

  /**
   * Execute batched server status requests
   */
  private async executeBatchedServerStatus(
    requests: BatchRequest[],
  ): Promise<void> {
    try {
      // Extract server IDs
      const serverIds = requests.map((req) =>
        this.extractServerIdFromEndpoint(req.endpoint),
      );

      // Make a batch request for all server statuses
      const response = await fetch("/api/servers/batch/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ serverIds }),
      });

      if (!response.ok) {
        // If batch endpoint doesn't exist, fall back to individual requests
        if (response.status === 404) {
          for (const request of requests) {
            await this.executeSingleRequest(request);
          }
          return;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const batchResults = await response.json();

      // Resolve individual requests
      requests.forEach((request, index) => {
        const serverId = serverIds[index];
        const result = batchResults.find((r: any) => r.serverId === serverId);

        if (result && result.success) {
          request.resolve(result.data);
        } else {
          request.reject(
            new Error(
              result?.error || `Status not found for server ${serverId}`,
            ),
          );
        }
      });
    } catch (error) {
      // If batch fails, fall back to individual requests
      for (const request of requests) {
        await this.executeSingleRequest(request);
      }
    }
  }

  /**
   * Extract server ID from endpoint
   */
  private extractServerIdFromEndpoint(endpoint: string): string {
    const matches = endpoint.match(/\/(?:connections|servers)\/([^\/]+)/);
    return matches ? matches[1] : "";
  }

  /**
   * Get batching statistics
   */
  getStats(): { pendingRequests: number; hasPendingBatch: boolean } {
    return {
      pendingRequests: this.pendingRequests.size,
      hasPendingBatch: this.batchTimeout !== null,
    };
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    // Reject all pending requests
    this.pendingRequests.forEach((request) => {
      request.reject(new Error("Request batch cleared"));
    });

    this.pendingRequests.clear();
  }
}

// Global singleton instance
export const globalRequestBatcher = new RequestBatcher(50, 10); // 50ms delay, max 10 requests per batch
