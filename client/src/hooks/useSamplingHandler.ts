/**
 * useSamplingHandler - Hook to wire MCP sampling requests to ExecutionContext
 *
 * This hook connects the MCP client's sampling handler to the ExecutionContext
 * so that sampling requests from the server appear in the UI and responses
 * are sent back.
 *
 * Usage:
 *   const { setupHandler, handleResponse, handleReject } = useSamplingHandler();
 *
 *   // Call setupHandler when starting a tool execution
 *   setupHandler(parentRequestId);
 *
 *   // When user responds in UI, call handleResponse or handleReject
 *   handleResponse(requestId, samplingResponse);
 */

import { useCallback, useRef, useEffect } from 'react';
import { useMcp } from '@/context/McpContext';
import { useExecution, generateClientRequestId } from '@/context/ExecutionContext';
import {
  setupSamplingHandler,
  resolveSamplingRequest,
  rejectSamplingRequest,
  clearAllPendingRequests,
} from '@modelcontextprotocol/inspector-core';
import type { SamplingRequest, SamplingResponse } from '@modelcontextprotocol/inspector-core';

// Track which request IDs map to which sampling request IDs
// This is needed because ExecutionContext uses its own IDs
const requestIdMap = new Map<string, string>();

export interface UseSamplingHandlerResult {
  /**
   * Set up the sampling handler for the current tool execution.
   * Call this before executing a tool that might trigger sampling.
   */
  setupHandler: (parentRequestId: string) => void;

  /**
   * Handle a user response to a sampling request.
   * @param executionRequestId - The ID from ExecutionContext (PendingClientRequest.id)
   * @param response - The user's sampling response
   */
  handleResponse: (executionRequestId: string, response: SamplingResponse) => void;

  /**
   * Handle user rejection of a sampling request.
   * @param executionRequestId - The ID from ExecutionContext
   */
  handleReject: (executionRequestId: string) => void;

  /**
   * Clean up when tool execution is complete or cancelled.
   */
  cleanup: () => void;
}

export function useSamplingHandler(): UseSamplingHandlerResult {
  const { client, isConnected } = useMcp();
  const { dispatch } = useExecution();
  const handlerSetupRef = useRef(false);
  const samplingCountRef = useRef(0);

  /**
   * Set up the sampling handler for the current execution.
   */
  const setupHandler = useCallback(
    (parentRequestId: string) => {
      if (!client || !isConnected) {
        console.warn('[Sampling Handler] Cannot setup handler: not connected');
        return;
      }

      // Reset sampling count for this execution
      samplingCountRef.current = 0;

      // Set up the handler
      setupSamplingHandler(
        client,
        {
          onSamplingRequest: (samplingRequestId, request, parentId) => {
            // Generate an execution context request ID
            const executionRequestId = generateClientRequestId(
              parentId,
              'sampling',
              samplingCountRef.current++
            );

            // Store the mapping so we can resolve later
            requestIdMap.set(executionRequestId, samplingRequestId);

            console.log(
              '[Sampling Handler] Adding request to ExecutionContext:',
              executionRequestId,
              '->',
              samplingRequestId
            );

            // Dispatch to ExecutionContext to show in UI
            dispatch({
              type: 'ADD_CLIENT_REQUEST',
              request: {
                id: executionRequestId,
                type: 'sampling',
                parentRequestId: parentId,
                request: request as SamplingRequest,
                status: 'pending',
                createdAt: new Date().toISOString(),
              },
            });
          },
        },
        parentRequestId
      );

      handlerSetupRef.current = true;
      console.log('[Sampling Handler] Handler set up for execution:', parentRequestId);
    },
    [client, isConnected, dispatch]
  );

  /**
   * Handle user response to a sampling request.
   */
  const handleResponse = useCallback(
    (executionRequestId: string, response: SamplingResponse) => {
      const samplingRequestId = requestIdMap.get(executionRequestId);
      if (!samplingRequestId) {
        console.warn(
          '[Sampling Handler] No mapping found for execution request:',
          executionRequestId
        );
        return;
      }

      console.log(
        '[Sampling Handler] Resolving sampling request:',
        samplingRequestId,
        response
      );

      // Resolve the promise in the handler
      resolveSamplingRequest(samplingRequestId, response);

      // Update ExecutionContext
      dispatch({
        type: 'UPDATE_CLIENT_REQUEST',
        id: executionRequestId,
        status: 'completed',
        response,
      });

      // Clean up the mapping
      requestIdMap.delete(executionRequestId);
    },
    [dispatch]
  );

  /**
   * Handle user rejection of a sampling request.
   */
  const handleReject = useCallback(
    (executionRequestId: string) => {
      const samplingRequestId = requestIdMap.get(executionRequestId);
      if (!samplingRequestId) {
        console.warn(
          '[Sampling Handler] No mapping found for execution request:',
          executionRequestId
        );
        return;
      }

      console.log('[Sampling Handler] Rejecting sampling request:', samplingRequestId);

      // Reject the promise in the handler
      rejectSamplingRequest(samplingRequestId, 'User rejected sampling request');

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
    samplingCountRef.current = 0;

    console.log('[Sampling Handler] Cleaned up');
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
