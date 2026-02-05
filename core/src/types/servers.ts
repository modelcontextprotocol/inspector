/**
 * Server configuration types for MCP Inspector
 *
 * ServerConfig represents the persisted configuration for an MCP server.
 * This is separate from runtime state (connection status, capabilities).
 */

/**
 * Transport type for MCP servers
 */
export type TransportType = 'http' | 'stdio';

/**
 * Connection mode for servers
 * - 'direct': Connect directly from browser (HTTP only)
 * - 'proxy': Connect via proxy server (required for STDIO)
 */
export type ConnectionMode = 'direct' | 'proxy';

/**
 * Server configuration (persisted)
 */
export interface ServerConfig {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Transport type */
  transport: TransportType;
  /** URL for HTTP transport */
  url?: string;
  /** Command for STDIO transport (future, requires proxy) */
  command?: string;
  /** Arguments for STDIO command */
  args?: string[];
  /** Environment variables for STDIO */
  env?: Record<string, string>;
  /** Custom headers for HTTP requests */
  headers?: Record<string, string>;
  /** Connection mode */
  connectionMode?: ConnectionMode;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * Runtime server state (not persisted)
 */
export interface ServerRuntimeState {
  /** Connection status */
  status: 'disconnected' | 'connecting' | 'connected' | 'failed';
  /** Capabilities once connected */
  capabilities?: {
    tools?: number;
    resources?: number;
    prompts?: number;
  };
  /** Error message if failed */
  error?: string;
  /** Retry count for failed connections */
  retryCount?: number;
}

/**
 * Combined server info (config + runtime state)
 */
export interface ServerInfo extends ServerConfig {
  /** Runtime state */
  runtime: ServerRuntimeState;
}

/**
 * Create a new server config with defaults
 */
export function createServerConfig(
  partial: Omit<ServerConfig, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): ServerConfig {
  const now = new Date().toISOString();
  return {
    id: partial.id || `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: now,
    updatedAt: now,
    connectionMode: partial.transport === 'http' ? 'direct' : 'proxy',
    ...partial,
  };
}

/**
 * Server display model for UI components (ServerCard)
 * Combines config with runtime state for display purposes
 */
export interface ServerDisplayModel {
  id: string;
  name: string;
  version: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  status: 'connected' | 'disconnected' | 'failed';
  capabilities: { tools: number; resources: number; prompts: number } | null;
  retryCount?: number;
  error?: string;
  connectionMode?: ConnectionMode;
}

/** @deprecated Use ServerDisplayModel instead */
export type MockServer = ServerDisplayModel;
