/**
 * useElicitationHandler - Hook to wire MCP elicitation requests to ExecutionContext
 *
 * This hook connects the MCP client's elicitation handler to the ExecutionContext
 * so that elicitation requests from the server appear in the UI and responses
 * are sent back.
 *
 * Usage:
 *   const { setupHandler, handleResponse, handleReject } = useElicitationHandler();
 *
 *   // Call setupHandler when starting a tool execution
 *   setupHandler(parentRequestId);
 *
 *   // When user responds in UI, call handleResponse or handleReject
 *   handleResponse(requestId, data);
 */

import { useCallback, useRef, useEffect } from 'react';
import { useMcp } from '@/context/McpContext';
import { useExecution, generateClientRequestId } from '@/context/ExecutionContext';
import {
  setupElicitationHandler,
  resolveElicitationRequest,
  rejectElicitationRequest,
  clearAllPendingRequests,
} from '@modelcontextprotocol/inspector-core';
import type { ElicitationRequest } from '@modelcontextprotocol/inspector-core';

// Track which request IDs map to which elicitation request IDs
const requestIdMap = new Map<string, string>();

export interface UseElicitationHandlerResult {
  /**
   * Set up the elicitation handler for the current tool execution.
   * Call this before executing a tool that might trigger elicitation.
   */
  setupHandler: (parentRequestId: string) => void;

  /**
   * Handle a user response to an elicitation request.
   * @param executionRequestId - The ID from ExecutionContext (PendingClientRequest.id)
   * @param data - The user's elicitation response data
   */
  handleResponse: (executionRequestId: string, data: Record<string, unknown>) => void;

  /**
   * Handle user rejection of an elicitation request.
   * @param executionRequestId - The ID from ExecutionContext
   */
  handleReject: (executionRequestId: string) => void;

  /**
   * Clean up when tool execution is complete or cancelled.
   */
  cleanup: () => void;
}

export function useElicitationHandler(): UseElicitationHandlerResult {
  const { client, isConnected } = useMcp();
  const { dispatch } = useExecution();
  const handlerSetupRef = useRef(false);
  const elicitationCountRef = useRef(0);

  /**
   * Set up the elicitation handler for the current execution.
   */
  const setupHandler = useCallback(
    (parentRequestId: string) => {
      if (!client || !isConnected) {
        console.warn('[Elicitation Handler] Cannot setup handler: not connected');
        return;
      }

      // Reset elicitation count for this execution
      elicitationCountRef.current = 0;

      // Set up the handler
      setupElicitationHandler(
        client,
        {
          onElicitationRequest: (elicitationRequestId, request, parentId) => {
            // Generate an execution context request ID
            const executionRequestId = generateClientRequestId(
              parentId,
              'elicitation',
              elicitationCountRef.current++
            );

            // Store the mapping so we can resolve later
            requestIdMap.set(executionRequestId, elicitationRequestId);

            console.log(
              '[Elicitation Handler] Adding request to ExecutionContext:',
              executionRequestId,
              '->',
              elicitationRequestId
            );

            // Dispatch to ExecutionContext to show in UI
            dispatch({
              type: 'ADD_CLIENT_REQUEST',
              request: {
                id: executionRequestId,
                type: 'elicitation',
                parentRequestId: parentId,
                request: request as ElicitationRequest,
                status: 'pending',
                createdAt: new Date().toISOString(),
              },
            });
          },
        },
        parentRequestId
      );

      handlerSetupRef.current = true;
      console.log('[Elicitation Handler] Handler set up for execution:', parentRequestId);
    },
    [client, isConnected, dispatch]
  );

  /**
   * Handle user response to an elicitation request.
   */
  const handleResponse = useCallback(
    (executionRequestId: string, data: Record<string, unknown>) => {
      const elicitationRequestId = requestIdMap.get(executionRequestId);
      if (!elicitationRequestId) {
        console.warn(
          '[Elicitation Handler] No mapping found for execution request:',
          executionRequestId
        );
        return;
      }

      console.log(
        '[Elicitation Handler] Resolving elicitation request:',
        elicitationRequestId,
        data
      );

      // Resolve the promise in the handler
      resolveElicitationRequest(elicitationRequestId, data);

      // Update ExecutionContext
      dispatch({
        type: 'UPDATE_CLIENT_REQUEST',
        id: executionRequestId,
        status: 'completed',
        response: data,
      });

      // Clean up the mapping
      requestIdMap.delete(executionRequestId);
    },
    [dispatch]
  );

  /**
   * Handle user rejection of an elicitation request.
   */
  const handleReject = useCallback(
    (executionRequestId: string) => {
      const elicitationRequestId = requestIdMap.get(executionRequestId);
      if (!elicitationRequestId) {
        console.warn(
          '[Elicitation Handler] No mapping found for execution request:',
          executionRequestId
        );
        return;
      }

      console.log('[Elicitation Handler] Rejecting elicitation request:', elicitationRequestId);

      // Reject the promise in the handler
      rejectElicitationRequest(elicitationRequestId, 'User rejected elicitation request');

      // Update ExecutionContext
      dispatch({
        type: 'UPDATE_CLIENT_REQUEST',
        id: executionRequestId,
        status: 'rejected',
      });

      // Clean up the mapping
      requestIdMap.delete(executionRequestId);
    },
    [dispatch]
  );

  /**
   * Clean up handler state.
   */
  const cleanup = useCallback(() => {
    // Clear all pending requests
    clearAllPendingRequests();

    // Clear the mapping
    requestIdMap.clear();

    // Reset refs
    handlerSetupRef.current = false;
    elicitationCountRef.current = 0;

    console.log('[Elicitation Handler] Cleaned up');
  }, []);

  // Clean up on unmount or disconnect
  useEffect(() => {
    return () => {
      if (handlerSetupRef.current) {
        cleanup();
      }
    };
  }, [cleanup]);

  // Clean up when disconnected
  useEffect(() => {
    if (!isConnected && handlerSetupRef.current) {
      cleanup();
    }
  }, [isConnected, cleanup]);

  return {
    setupHandler,
    handleResponse,
    handleReject,
    cleanup,
  };
}
