import { McpJamRequest, McpJamRequestCollection } from "@/lib/requestTypes";
import {
  exportRequestCollection,
  importRequestCollection,
} from "./requestUtils";

const STORAGE_KEY = "mcpjam_saved_requests";

/**
 * Storage interface for managing saved requests
 */
export class RequestStorage {
  /**
   * Loads all saved requests from localStorage
   */
  static loadRequests(): McpJamRequest[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];

      const data: McpJamRequestCollection = JSON.parse(stored);
      return importRequestCollection(data);
    } catch (error) {
      console.error("Failed to load saved requests:", error);
      return [];
    }
  }

  /**
   * Saves all requests to localStorage
   */
  static saveRequests(requests: McpJamRequest[]): void {
    try {
      const collection = exportRequestCollection(requests);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
    } catch (error) {
      console.error("Failed to save requests:", error);
      throw new Error("Failed to save requests to storage");
    }
  }

  /**
   * Adds a new request to storage
   */
  static addRequest(request: McpJamRequest): void {
    const existing = this.loadRequests();
    const updated = [...existing, request];
    this.saveRequests(updated);
  }

  /**
   * Updates an existing request in storage
   */
  static updateRequest(
    requestId: string,
    updates: Partial<McpJamRequest>,
  ): void {
    const existing = this.loadRequests();
    const index = existing.findIndex((r) => r.id === requestId);

    if (index === -1) {
      throw new Error(`Request with ID ${requestId} not found`);
    }

    existing[index] = { ...existing[index], ...updates, updatedAt: new Date() };
    this.saveRequests(existing);
  }

  /**
   * Removes a request from storage
   */
  static removeRequest(requestId: string): void {
    const existing = this.loadRequests();
    const filtered = existing.filter((r) => r.id !== requestId);
    this.saveRequests(filtered);
  }

  /**
   * Gets a specific request by ID
   */
  static getRequest(requestId: string): McpJamRequest | null {
    const requests = this.loadRequests();
    return requests.find((r) => r.id === requestId) || null;
  }

  /**
   * Checks if a request with the given ID exists
   */
  static hasRequest(requestId: string): boolean {
    return this.getRequest(requestId) !== null;
  }

  /**
   * Clears all saved requests
   */
  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Exports all requests as a JSON string for backup/sharing
   */
  static exportToJson(): string {
    const requests = this.loadRequests();
    const collection = exportRequestCollection(requests);
    return JSON.stringify(collection, null, 2);
  }

  /**
   * Imports requests from a JSON string (merges with existing)
   */
  static importFromJson(jsonString: string, merge: boolean = true): void {
    try {
      const data: McpJamRequestCollection = JSON.parse(jsonString);
      const importedRequests = importRequestCollection(data);

      if (merge) {
        const existing = this.loadRequests();
        // Filter out duplicates by ID
        const existingIds = new Set(existing.map((r) => r.id));
        const newRequests = importedRequests.filter(
          (r) => !existingIds.has(r.id),
        );
        const merged = [...existing, ...newRequests];
        this.saveRequests(merged);
      } else {
        this.saveRequests(importedRequests);
      }
    } catch (error) {
      console.error("Failed to import requests:", error);
      throw new Error("Invalid JSON format or corrupted data");
    }
  }

  /**
   * Gets storage statistics
   */
  static getStats(): {
    totalRequests: number;
    totalSize: number;
    favoriteCount: number;
    toolCounts: Record<string, number>;
  } {
    const requests = this.loadRequests();
    const stored = localStorage.getItem(STORAGE_KEY);

    const toolCounts: Record<string, number> = {};
    let favoriteCount = 0;

    for (const request of requests) {
      if (request.isFavorite) favoriteCount++;
      toolCounts[request.toolName] = (toolCounts[request.toolName] || 0) + 1;
    }

    return {
      totalRequests: requests.length,
      totalSize: stored ? new Blob([stored]).size : 0,
      favoriteCount,
      toolCounts,
    };
  }
}
