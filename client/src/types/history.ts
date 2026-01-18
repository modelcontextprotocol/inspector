/**
 * History types for MCP request tracking
 *
 * These types support hierarchical request traces where tool calls
 * can trigger child requests (sampling, elicitation).
 */

/**
 * Request type discriminator for hierarchical display
 * - 'primary': Tool calls, resource reads, prompt gets
 * - 'client': Sampling/elicitation requests triggered by server
 */
export type RequestType = 'primary' | 'client';

/**
 * A single entry in the request history
 */
export interface HistoryEntry {
  /** Unique identifier */
  id: string;
  /** ISO timestamp of when the request was made */
  timestamp: string;
  /** MCP method (e.g., 'tools/call', 'resources/read', 'sampling/createMessage') */
  method: string;
  /** Target name (tool name, resource URI, prompt name) */
  target: string | null;
  /** Request parameters */
  params?: Record<string, unknown>;
  /** Response data */
  response?: Record<string, unknown>;
  /** Request duration in milliseconds */
  duration: number;
  /** Whether the request succeeded */
  success: boolean;
  /** Whether this entry is pinned (protected from cleanup) */
  pinned: boolean;
  /** Optional user-provided label */
  label?: string;
  /** SSE event ID (for SSE transport) */
  sseId?: string;
  /** Progress token for long-running operations */
  progressToken?: string;

  // Hierarchical request trace fields

  /** Request type: 'primary' for tool/resource/prompt calls, 'client' for sampling/elicitation */
  requestType?: RequestType;
  /** For client requests, links to parent tool call */
  parentRequestId?: string;
  /** For primary requests, links to triggered client requests */
  childRequestIds?: string[];
  /** Offset from parent request start (ms), for client requests */
  relativeTime?: number;
}

/**
 * Create a new history entry with defaults
 */
export function createHistoryEntry(
  partial: Omit<HistoryEntry, 'id' | 'timestamp' | 'pinned'> & { id?: string }
): HistoryEntry {
  return {
    id: partial.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    pinned: false,
    ...partial,
  };
}

/**
 * Maximum number of history entries to keep (excluding pinned)
 */
export const MAX_HISTORY_ENTRIES = 500;
