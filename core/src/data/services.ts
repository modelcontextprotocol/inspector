/**
 * Service Interfaces for Inspector Business Logic
 *
 * These interfaces define stateful services for connection and execution management.
 * They wrap core MCP client functions with state tracking and event subscription.
 */

import type { ServerInfo } from '../client.js';
import type { SamplingRequest, ElicitationRequest } from '../types/clientRequests.js';

/**
 * Connection service - manages MCP client connections.
 *
 * Wraps core client functions with state tracking and event subscription.
 * Implementations can use different storage for connection state.
 */
export interface ConnectionService {
  /**
   * Get current connection state.
   */
  getState(): ConnectionState;

  /**
   * Connect to an MCP server.
   * @param url Server URL
   * @param options Connection options (headers, token, etc.)
   */
  connect(url: string, options?: ConnectionOptions): Promise<ServerInfo>;

  /**
   * Disconnect from the current server.
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to state changes.
   * Returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * Connection state
 */
export interface ConnectionState {
  /** Connection status */
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  /** Currently connected server URL */
  serverUrl: string | null;
  /** Server info from successful connection */
  serverInfo: ServerInfo | null;
  /** Error details if status is 'error' */
  error: ConnectionError | null;
}

/**
 * Connection error details
 */
export interface ConnectionError {
  message: string;
  code?: string;
  timestamp: string;
}

/**
 * Connection options
 */
export interface ConnectionOptions {
  /** Custom headers for HTTP requests */
  headers?: Record<string, string>;
  /** Bearer token for authentication */
  token?: string;
}

/**
 * Execution service - tracks tool/resource/prompt execution.
 *
 * Manages pending client requests (sampling, elicitation) during execution.
 * Provides state subscription for UI updates.
 */
export interface ExecutionService {
  /**
   * Get current execution state.
   */
  getState(): ExecutionState;

  /**
   * Start a new execution.
   * @param requestId Unique request ID for tracking
   */
  startExecution(requestId: string): void;

  /**
   * End the current execution.
   */
  endExecution(): void;

  /**
   * Cancel the current execution.
   */
  cancelExecution(): void;

  /**
   * Add a pending client request (sampling or elicitation).
   */
  addPendingRequest(request: PendingClientRequest): void;

  /**
   * Resolve a pending client request.
   */
  resolvePendingRequest(id: string): void;

  /**
   * Reject a pending client request.
   */
  rejectPendingRequest(id: string): void;

  /**
   * Clear all pending requests.
   */
  clearPendingRequests(): void;

  /**
   * Subscribe to state changes.
   * Returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * Execution state
 */
export interface ExecutionState {
  /** Current executing request ID */
  currentRequestId: string | null;
  /** Whether execution is in progress */
  isExecuting: boolean;
  /** Pending client requests (sampling, elicitation) */
  pendingClientRequests: PendingClientRequest[];
}

/**
 * Pending client request (sampling or elicitation)
 */
export interface PendingClientRequest {
  /** Unique request ID */
  id: string;
  /** Request type */
  type: 'sampling' | 'elicitation';
  /** The actual request data */
  request: SamplingRequest | ElicitationRequest;
  /** Parent request ID (the tool call that triggered this) */
  parentRequestId: string;
  /** Request status */
  status: 'pending' | 'resolved' | 'rejected';
  /** Timestamp when request was received */
  timestamp: string;
}

/**
 * Initial connection state
 */
export const initialConnectionState: ConnectionState = {
  status: 'disconnected',
  serverUrl: null,
  serverInfo: null,
  error: null,
};

/**
 * Initial execution state
 */
export const initialExecutionState: ExecutionState = {
  currentRequestId: null,
  isExecuting: false,
  pendingClientRequests: [],
};
