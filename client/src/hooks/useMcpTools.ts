/**
 * useMcpTools - Hook for MCP tool operations
 *
 * Provides access to tools from a connected MCP server:
 * - List available tools
 * - Execute tools with arguments
 * - Handle tool list changes
 *
 * Usage:
 *   const { tools, isLoading, executeTool, refresh } = useMcpTools();
 *
 *   // List tools
 *   tools.forEach(tool => console.log(tool.name));
 *
 *   // Execute a tool
 *   const result = await executeTool('echo', { message: 'hello' });
 */

import { useState, useEffect, useCallback } from 'react';
import { useMcp } from '@/context';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Tool execution result type
export interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface UseMcpToolsResult {
  /** Available tools from the server */
  tools: Tool[];
  /** Whether tools are currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Whether the tool list has changed since last fetch */
  listChanged: boolean;
  /** Execute a tool by name with arguments */
  executeTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Refresh the tool list */
  refresh: () => Promise<void>;
  /** Clear the listChanged flag */
  clearListChanged: () => void;
}

/**
 * Hook to access and execute MCP tools.
 */
export function useMcpTools(): UseMcpToolsResult {
  const { client, isConnected } = useMcp();
  const [tools, setTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listChanged, setListChanged] = useState(false);

  /**
   * Fetch tools from the server.
   */
  const fetchTools = useCallback(async () => {
    if (!client || !isConnected) {
      setTools([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await client.listTools();
      setTools(result.tools);
      setListChanged(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tools';
      setError(message);
      console.error('[MCP Tools] Error fetching tools:', message);
    } finally {
      setIsLoading(false);
    }
  }, [client, isConnected]);

  /**
   * Execute a tool by name.
   */
  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
      if (!client || !isConnected) {
        throw new Error('Not connected to MCP server');
      }

      console.log(`[MCP Tools] Executing tool: ${name}`, args);

      const result = await client.callTool({
        name,
        arguments: args,
      });

      console.log(`[MCP Tools] Tool result:`, result);

      // Normalize the result to our ToolResult type
      return {
        ...result,
        content: result.content as ToolResult['content'],
        isError: result.isError as boolean | undefined,
      };
    },
    [client, isConnected]
  );

  /**
   * Refresh the tool list.
   */
  const refresh = useCallback(async () => {
    await fetchTools();
  }, [fetchTools]);

  /**
   * Clear the listChanged flag.
   */
  const clearListChanged = useCallback(() => {
    setListChanged(false);
  }, []);

  // Fetch tools when connected
  useEffect(() => {
    if (isConnected) {
      fetchTools();
    } else {
      setTools([]);
      setError(null);
    }
  }, [isConnected, fetchTools]);

  // Set up tool list change notification handler
  useEffect(() => {
    if (!client || !isConnected) return;

    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      () => {
        console.log('[MCP Tools] Tool list changed');
        setListChanged(true);
      }
    );

    return () => {
      // Note: SDK doesn't provide a way to remove notification handlers
    };
  }, [client, isConnected]);

  return {
    tools,
    isLoading,
    error,
    listChanged,
    executeTool,
    refresh,
    clearListChanged,
  };
}
