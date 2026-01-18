/**
 * useMcpResources - Hook for MCP resource operations
 *
 * Provides access to resources from a connected MCP server:
 * - List available resources
 * - List resource templates
 * - Read resource content
 * - Subscribe/unsubscribe to resource changes
 *
 * Usage:
 *   const { resources, templates, readResource, subscribe } = useMcpResources();
 *
 *   // List resources
 *   resources.forEach(r => console.log(r.uri));
 *
 *   // Read a resource
 *   const content = await readResource('file:///config.json');
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMcp } from '@/context';
import {
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  Resource,
  ResourceTemplate,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';

// Subscription state
export interface Subscription {
  uri: string;
  lastUpdated: string;
}

export interface UseMcpResourcesResult {
  /** Available resources from the server */
  resources: Resource[];
  /** Resource templates from the server */
  templates: ResourceTemplate[];
  /** Active subscriptions */
  subscriptions: Subscription[];
  /** Whether resources are currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Whether the resource list has changed since last fetch */
  listChanged: boolean;
  /** Read a resource by URI */
  readResource: (uri: string) => Promise<ReadResourceResult>;
  /** Subscribe to resource changes */
  subscribe: (uri: string) => Promise<void>;
  /** Unsubscribe from resource changes */
  unsubscribe: (uri: string) => Promise<void>;
  /** Refresh the resource list */
  refresh: () => Promise<void>;
  /** Clear the listChanged flag */
  clearListChanged: () => void;
}

/**
 * Hook to access and read MCP resources.
 */
export function useMcpResources(): UseMcpResourcesResult {
  const { client, isConnected, serverInfo } = useMcp();
  const [resources, setResources] = useState<Resource[]>([]);
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listChanged, setListChanged] = useState(false);

  // Track active subscriptions by URI for cleanup
  const activeSubscriptions = useRef<Set<string>>(new Set());

  /**
   * Fetch resources and templates from the server.
   */
  const fetchResources = useCallback(async () => {
    if (!client || !isConnected) {
      setResources([]);
      setTemplates([]);
      return;
    }

    // Check if server supports resources
    if (!serverInfo?.capabilities?.resources) {
      setResources([]);
      setTemplates([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await client.listResources();
      setResources(result.resources || []);
      setListChanged(false);

      // Fetch templates if server supports them
      try {
        const templateResult = await client.listResourceTemplates();
        setTemplates(templateResult.resourceTemplates || []);
      } catch {
        // Templates are optional, ignore errors
        setTemplates([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch resources';
      setError(message);
      console.error('[MCP Resources] Error fetching resources:', message);
    } finally {
      setIsLoading(false);
    }
  }, [client, isConnected, serverInfo]);

  /**
   * Read a resource by URI.
   */
  const readResource = useCallback(
    async (uri: string): Promise<ReadResourceResult> => {
      if (!client || !isConnected) {
        throw new Error('Not connected to MCP server');
      }

      console.log(`[MCP Resources] Reading resource: ${uri}`);

      const result = await client.readResource({ uri });

      console.log(`[MCP Resources] Resource content:`, result);

      return result;
    },
    [client, isConnected]
  );

  /**
   * Subscribe to resource changes.
   */
  const subscribe = useCallback(
    async (uri: string): Promise<void> => {
      if (!client || !isConnected) {
        throw new Error('Not connected to MCP server');
      }

      // Check if server supports subscriptions
      if (!serverInfo?.capabilities?.resources?.subscribe) {
        console.warn('[MCP Resources] Server does not support resource subscriptions');
        // Still add to local subscriptions for UI state
        setSubscriptions((prev) => {
          if (prev.find((s) => s.uri === uri)) return prev;
          return [...prev, { uri, lastUpdated: new Date().toISOString() }];
        });
        return;
      }

      console.log(`[MCP Resources] Subscribing to: ${uri}`);

      try {
        await client.subscribeResource({ uri });
        activeSubscriptions.current.add(uri);
        setSubscriptions((prev) => {
          if (prev.find((s) => s.uri === uri)) return prev;
          return [...prev, { uri, lastUpdated: new Date().toISOString() }];
        });
      } catch (err) {
        console.error(`[MCP Resources] Error subscribing to ${uri}:`, err);
        throw err;
      }
    },
    [client, isConnected, serverInfo]
  );

  /**
   * Unsubscribe from resource changes.
   */
  const unsubscribe = useCallback(
    async (uri: string): Promise<void> => {
      if (!client || !isConnected) {
        throw new Error('Not connected to MCP server');
      }

      // Check if server supports subscriptions
      if (!serverInfo?.capabilities?.resources?.subscribe) {
        // Remove from local subscriptions
        setSubscriptions((prev) => prev.filter((s) => s.uri !== uri));
        return;
      }

      console.log(`[MCP Resources] Unsubscribing from: ${uri}`);

      try {
        await client.unsubscribeResource({ uri });
        activeSubscriptions.current.delete(uri);
        setSubscriptions((prev) => prev.filter((s) => s.uri !== uri));
      } catch (err) {
        console.error(`[MCP Resources] Error unsubscribing from ${uri}:`, err);
        throw err;
      }
    },
    [client, isConnected, serverInfo]
  );

  /**
   * Refresh the resource list.
   */
  const refresh = useCallback(async () => {
    await fetchResources();
  }, [fetchResources]);

  /**
   * Clear the listChanged flag.
   */
  const clearListChanged = useCallback(() => {
    setListChanged(false);
  }, []);

  // Fetch resources when connected
  useEffect(() => {
    if (isConnected) {
      fetchResources();
    } else {
      setResources([]);
      setTemplates([]);
      setSubscriptions([]);
      setError(null);
      activeSubscriptions.current.clear();
    }
  }, [isConnected, fetchResources]);

  // Set up resource update notification handler
  useEffect(() => {
    if (!client || !isConnected) return;

    // Handle resource list changes
    client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      () => {
        console.log('[MCP Resources] Resource list changed');
        setListChanged(true);
      }
    );

    // Handle resource updates (for subscriptions)
    client.setNotificationHandler(
      ResourceUpdatedNotificationSchema,
      (notification) => {
        const uri = notification.params?.uri;
        if (uri) {
          console.log('[MCP Resources] Resource updated:', uri);
          setSubscriptions((prev) =>
            prev.map((s) =>
              s.uri === uri ? { ...s, lastUpdated: new Date().toISOString() } : s
            )
          );
        }
      }
    );

    return () => {
      // Note: SDK doesn't provide a way to remove notification handlers
      // They will be replaced on next setup
    };
  }, [client, isConnected]);

  return {
    resources,
    templates,
    subscriptions,
    isLoading,
    error,
    listChanged,
    readResource,
    subscribe,
    unsubscribe,
    refresh,
    clearListChanged,
  };
}
