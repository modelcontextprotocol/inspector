/**
 * useMcpPrompts - Hook for MCP prompt operations
 *
 * Provides access to prompts from a connected MCP server:
 * - List available prompts
 * - Get prompt content with arguments
 *
 * Usage:
 *   const { prompts, getPrompt, isLoading } = useMcpPrompts();
 *
 *   // List prompts
 *   prompts.forEach(p => console.log(p.name, p.description));
 *
 *   // Get a prompt with arguments
 *   const result = await getPrompt('greeting_prompt', { name: 'John' });
 */

import { useState, useEffect, useCallback } from 'react';
import { useMcp } from '@/context';
import { PromptListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  Prompt,
  GetPromptResult,
} from '@modelcontextprotocol/sdk/types.js';

export interface UseMcpPromptsResult {
  /** Available prompts from the server */
  prompts: Prompt[];
  /** Whether prompts are currently loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Whether the prompt list has changed since last fetch */
  listChanged: boolean;
  /** Get a prompt by name with optional arguments */
  getPrompt: (
    name: string,
    args?: Record<string, string>
  ) => Promise<GetPromptResult>;
  /** Refresh the prompt list */
  refresh: () => Promise<void>;
  /** Clear the listChanged flag */
  clearListChanged: () => void;
}

/**
 * Hook to access and get MCP prompts.
 */
export function useMcpPrompts(): UseMcpPromptsResult {
  const { client, isConnected, serverInfo } = useMcp();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listChanged, setListChanged] = useState(false);

  /**
   * Fetch prompts from the server.
   */
  const fetchPrompts = useCallback(async () => {
    if (!client || !isConnected) {
      setPrompts([]);
      return;
    }

    // Check if server supports prompts
    if (!serverInfo?.capabilities?.prompts) {
      setPrompts([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await client.listPrompts();
      setPrompts(result.prompts || []);
      setListChanged(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch prompts';
      setError(message);
      console.error('[MCP Prompts] Error fetching prompts:', message);
    } finally {
      setIsLoading(false);
    }
  }, [client, isConnected, serverInfo]);

  /**
   * Get a prompt by name with optional arguments.
   */
  const getPrompt = useCallback(
    async (name: string, args?: Record<string, string>): Promise<GetPromptResult> => {
      if (!client || !isConnected) {
        throw new Error('Not connected to MCP server');
      }

      console.log(`[MCP Prompts] Getting prompt: ${name}`, args);

      const result = await client.getPrompt({
        name,
        arguments: args,
      });

      console.log(`[MCP Prompts] Prompt result:`, result);

      return result;
    },
    [client, isConnected]
  );

  /**
   * Refresh the prompt list.
   */
  const refresh = useCallback(async () => {
    await fetchPrompts();
  }, [fetchPrompts]);

  /**
   * Clear the listChanged flag.
   */
  const clearListChanged = useCallback(() => {
    setListChanged(false);
  }, []);

  // Fetch prompts when connected
  useEffect(() => {
    if (isConnected) {
      fetchPrompts();
    } else {
      setPrompts([]);
      setError(null);
    }
  }, [isConnected, fetchPrompts]);

  // Set up prompt list change notification handler
  useEffect(() => {
    if (!client || !isConnected) return;

    client.setNotificationHandler(
      PromptListChangedNotificationSchema,
      () => {
        console.log('[MCP Prompts] Prompt list changed');
        setListChanged(true);
      }
    );

    return () => {
      // Note: SDK doesn't provide a way to remove notification handlers
    };
  }, [client, isConnected]);

  return {
    prompts,
    isLoading,
    error,
    listChanged,
    getPrompt,
    refresh,
    clearListChanged,
  };
}
