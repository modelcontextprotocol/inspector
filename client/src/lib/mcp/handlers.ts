/**
 * MCP Request Handlers
 *
 * Handles client-side requests from MCP servers:
 * - Sampling: Server requests LLM completion from client
 * - Elicitation: Server requests user input (form or URL)
 *
 * These handlers integrate with ExecutionContext to show UI
 * and return user responses to the server.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  type CreateMessageRequest,
  type CreateMessageResult,
  type ElicitRequest,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { SamplingRequest, ElicitationRequest } from '@/types';
import type { SamplingResponse } from '@/types/responses';

// Response resolvers - keyed by request ID
const samplingResolvers = new Map<
  string,
  {
    resolve: (response: SamplingResponse) => void;
    reject: (reason?: unknown) => void;
  }
>();

const elicitationResolvers = new Map<
  string,
  {
    resolve: (data: Record<string, unknown>) => void;
    reject: (reason?: unknown) => void;
  }
>();

// Request ID counter for generating unique IDs
let requestIdCounter = 0;

/**
 * Generate a unique request ID for pending requests.
 */
export function generateSamplingRequestId(): string {
  return `sampling-${Date.now()}-${++requestIdCounter}`;
}

/**
 * Generate a unique request ID for elicitation requests.
 */
export function generateElicitationRequestId(): string {
  return `elicitation-${Date.now()}-${++requestIdCounter}`;
}

/**
 * Convert a single SDK content item to our internal format.
 */
function convertContentItem(
  content: unknown
): { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } {
  // Handle content object with type field
  const contentObj = content as { type?: string; text?: string; data?: string; mimeType?: string };

  if (contentObj.type === 'text' && typeof contentObj.text === 'string') {
    return { type: 'text' as const, text: contentObj.text };
  }

  if (contentObj.type === 'image' && typeof contentObj.data === 'string' && typeof contentObj.mimeType === 'string') {
    return { type: 'image' as const, data: contentObj.data, mimeType: contentObj.mimeType };
  }

  // Fallback for unsupported types
  return { type: 'text' as const, text: '[Unsupported content type]' };
}

/**
 * Convert MCP SDK CreateMessageRequest to our internal SamplingRequest format.
 */
function convertToSamplingRequest(
  sdkRequest: CreateMessageRequest['params']
): SamplingRequest {
  return {
    messages: sdkRequest.messages.map((msg) => {
      // Content can be a single item or an array
      const contentItem = Array.isArray(msg.content)
        ? msg.content[0]  // Take first item if array
        : msg.content;

      return {
        role: msg.role as 'user' | 'assistant',
        content: convertContentItem(contentItem),
      };
    }),
    modelPreferences: sdkRequest.modelPreferences
      ? {
          hints: sdkRequest.modelPreferences.hints
            ?.map((h) => h.name)
            .filter((name): name is string => name !== undefined),
          costPriority: sdkRequest.modelPreferences.costPriority,
          speedPriority: sdkRequest.modelPreferences.speedPriority,
          intelligencePriority: sdkRequest.modelPreferences.intelligencePriority,
        }
      : undefined,
    maxTokens: sdkRequest.maxTokens,
    stopSequences: sdkRequest.stopSequences,
    temperature: sdkRequest.temperature,
    includeContext: sdkRequest.includeContext as
      | 'none'
      | 'thisServer'
      | 'allServers'
      | undefined,
  };
}

/**
 * Convert our SamplingResponse to MCP SDK CreateMessageResult format.
 */
function convertToSdkResult(response: SamplingResponse): CreateMessageResult {
  // Handle discriminated union - SDK expects text content
  const textContent = response.content.type === 'text'
    ? response.content.text
    : '[Image response - not supported in text format]';

  return {
    role: 'assistant',
    content: {
      type: 'text',
      text: textContent,
    },
    model: response.model,
    stopReason: response.stopReason,
  };
}

/**
 * Callbacks for when sampling/elicitation requests are received.
 */
export interface SamplingHandlerCallbacks {
  /**
   * Called when a sampling request is received from the server.
   * The implementation should show UI and eventually call resolveSamplingRequest.
   */
  onSamplingRequest: (
    requestId: string,
    request: SamplingRequest,
    parentRequestId: string
  ) => void;

  /**
   * Called when a sampling request is cancelled by the server.
   */
  onSamplingCancelled?: (requestId: string) => void;
}

export interface ElicitationHandlerCallbacks {
  /**
   * Called when an elicitation request is received from the server.
   * The implementation should show UI and eventually call resolveElicitationRequest.
   */
  onElicitationRequest: (
    requestId: string,
    request: ElicitationRequest,
    parentRequestId: string
  ) => void;

  /**
   * Called when an elicitation request is cancelled by the server.
   */
  onElicitationCancelled?: (requestId: string) => void;
}

/**
 * Set up the sampling request handler on the MCP client.
 *
 * @param client - The MCP client instance
 * @param callbacks - Callbacks for handling requests
 * @param parentRequestId - The ID of the parent tool execution request
 */
export function setupSamplingHandler(
  client: Client,
  callbacks: SamplingHandlerCallbacks,
  parentRequestId: string
): void {
  client.setRequestHandler(
    CreateMessageRequestSchema,
    async (request: CreateMessageRequest) => {
      const requestId = generateSamplingRequestId();
      const samplingRequest = convertToSamplingRequest(request.params);

      console.log('[MCP Handlers] Sampling request received:', requestId, samplingRequest);

      // Create a promise that will be resolved by the UI
      const responsePromise = new Promise<SamplingResponse>((resolve, reject) => {
        samplingResolvers.set(requestId, { resolve, reject });
      });

      // Notify the UI about the new request
      callbacks.onSamplingRequest(requestId, samplingRequest, parentRequestId);

      try {
        // Wait for the UI to respond
        const response = await responsePromise;
        console.log('[MCP Handlers] Sampling response:', requestId, response);

        // Convert to SDK format and return
        return convertToSdkResult(response);
      } finally {
        // Clean up the resolver
        samplingResolvers.delete(requestId);
      }
    }
  );
}

/**
 * Convert MCP SDK ElicitRequest to our internal ElicitationRequest format.
 */
function convertToElicitationRequest(
  sdkRequest: ElicitRequest['params']
): ElicitationRequest {
  // Check if it's a form-based or URL-based elicitation
  if ('requestedSchema' in sdkRequest) {
    // Form-based elicitation
    return {
      mode: 'form',
      message: sdkRequest.message,
      schema: {
        properties: Object.fromEntries(
          Object.entries(sdkRequest.requestedSchema.properties || {}).map(([key, value]) => {
            const prop = value as { type?: string; description?: string; enum?: string[]; default?: unknown };
            return [
              key,
              {
                name: key,
                type: (prop.type || 'string') as 'string' | 'number' | 'boolean',
                description: prop.description,
                enum: prop.enum,
                default: prop.default as string | number | boolean | undefined,
              },
            ];
          })
        ),
        required: sdkRequest.requestedSchema.required,
      },
      serverName: 'MCP Server',
    };
  } else {
    // URL-based elicitation
    const urlParams = sdkRequest as { message: string; url: string; elicitationId: string };
    return {
      mode: 'url',
      message: urlParams.message,
      url: urlParams.url,
      elicitationId: urlParams.elicitationId,
      serverName: 'MCP Server',
    };
  }
}

/**
 * Convert user response to MCP SDK ElicitResult format.
 */
function convertToElicitResult(
  data: Record<string, unknown>,
  action: 'accept' | 'decline' | 'cancel' = 'accept'
): ElicitResult {
  // Convert data to the expected type for ElicitResult.content
  const content: Record<string, string | number | boolean | string[]> | undefined =
    action === 'accept'
      ? Object.fromEntries(
          Object.entries(data).map(([key, value]) => {
            // Ensure values match expected types
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              return [key, value];
            }
            if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
              return [key, value as string[]];
            }
            // Convert other types to string
            return [key, String(value)];
          })
        )
      : undefined;

  return {
    action,
    content,
  };
}

/**
 * Set up the elicitation request handler on the MCP client.
 *
 * @param client - The MCP client instance
 * @param callbacks - Callbacks for handling requests
 * @param parentRequestId - The ID of the parent tool execution request
 */
export function setupElicitationHandler(
  client: Client,
  callbacks: ElicitationHandlerCallbacks,
  parentRequestId: string
): void {
  client.setRequestHandler(
    ElicitRequestSchema,
    async (request: ElicitRequest) => {
      const requestId = generateElicitationRequestId();
      const elicitationRequest = convertToElicitationRequest(request.params);

      console.log('[MCP Handlers] Elicitation request received:', requestId, elicitationRequest);

      // Create a promise that will be resolved by the UI
      const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        elicitationResolvers.set(requestId, { resolve, reject });
      });

      // Notify the UI about the new request
      callbacks.onElicitationRequest(requestId, elicitationRequest, parentRequestId);

      try {
        // Wait for the UI to respond
        const response = await responsePromise;
        console.log('[MCP Handlers] Elicitation response:', requestId, response);

        // Convert to SDK format and return
        return convertToElicitResult(response);
      } catch (err) {
        // User declined or cancelled
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message.includes('rejected') || message.includes('declined')) {
          return convertToElicitResult({}, 'decline');
        }
        return convertToElicitResult({}, 'cancel');
      } finally {
        // Clean up the resolver
        elicitationResolvers.delete(requestId);
      }
    }
  );
}

/**
 * Resolve a pending sampling request with a response.
 * This should be called by the UI when the user provides a response.
 *
 * @param requestId - The ID of the sampling request
 * @param response - The sampling response from the user
 */
export function resolveSamplingRequest(
  requestId: string,
  response: SamplingResponse
): void {
  const resolver = samplingResolvers.get(requestId);
  if (resolver) {
    resolver.resolve(response);
    samplingResolvers.delete(requestId);
  } else {
    console.warn('[MCP Handlers] No resolver found for sampling request:', requestId);
  }
}

/**
 * Reject a pending sampling request.
 * This should be called by the UI when the user rejects the request.
 *
 * @param requestId - The ID of the sampling request
 * @param reason - Optional reason for rejection
 */
export function rejectSamplingRequest(requestId: string, reason?: string): void {
  const resolver = samplingResolvers.get(requestId);
  if (resolver) {
    resolver.reject(new Error(reason || 'Sampling request rejected by user'));
    samplingResolvers.delete(requestId);
  } else {
    console.warn('[MCP Handlers] No resolver found for sampling request:', requestId);
  }
}

/**
 * Resolve a pending elicitation request with user input.
 *
 * @param requestId - The ID of the elicitation request
 * @param data - The user input data
 */
export function resolveElicitationRequest(
  requestId: string,
  data: Record<string, unknown>
): void {
  const resolver = elicitationResolvers.get(requestId);
  if (resolver) {
    resolver.resolve(data);
    elicitationResolvers.delete(requestId);
  } else {
    console.warn('[MCP Handlers] No resolver found for elicitation request:', requestId);
  }
}

/**
 * Reject a pending elicitation request.
 *
 * @param requestId - The ID of the elicitation request
 * @param reason - Optional reason for rejection
 */
export function rejectElicitationRequest(requestId: string, reason?: string): void {
  const resolver = elicitationResolvers.get(requestId);
  if (resolver) {
    resolver.reject(new Error(reason || 'Elicitation request rejected by user'));
    elicitationResolvers.delete(requestId);
  } else {
    console.warn('[MCP Handlers] No resolver found for elicitation request:', requestId);
  }
}

/**
 * Clear all pending resolvers (e.g., when disconnecting).
 */
export function clearAllPendingRequests(): void {
  // Reject all pending sampling requests
  for (const [requestId, resolver] of samplingResolvers) {
    resolver.reject(new Error('Connection closed'));
    samplingResolvers.delete(requestId);
  }

  // Reject all pending elicitation requests
  for (const [requestId, resolver] of elicitationResolvers) {
    resolver.reject(new Error('Connection closed'));
    elicitationResolvers.delete(requestId);
  }
}

/**
 * Check if there are any pending sampling requests.
 */
export function hasPendingSamplingRequests(): boolean {
  return samplingResolvers.size > 0;
}

/**
 * Check if there are any pending elicitation requests.
 */
export function hasPendingElicitationRequests(): boolean {
  return elicitationResolvers.size > 0;
}
