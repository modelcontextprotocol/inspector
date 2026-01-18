/**
 * MCP Client Wrapper - Manage MCP client lifecycle and capabilities
 *
 * This module wraps the MCP SDK Client for React usage, handling:
 * - Client creation with proper capabilities
 * - Connection lifecycle (connect/disconnect)
 * - Server info extraction
 *
 * Usage:
 *   import { createMcpClient, connectClient } from '@/lib/mcp/client';
 *
 *   const client = createMcpClient();
 *   const transport = createHttpTransport(url);
 *   await connectClient(client, transport);
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Implementation, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

/**
 * Client configuration options.
 */
export interface McpClientOptions {
  /** Client name shown to servers */
  name?: string;
  /** Client version */
  version?: string;
  /** Enable sampling capability (receive LLM requests from server) */
  enableSampling?: boolean;
  /** Enable roots capability (expose filesystem paths to server) */
  enableRoots?: boolean;
}

/**
 * Information about a connected MCP server.
 */
export interface ServerInfo {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Server capabilities */
  capabilities: ServerCapabilities;
  /** Server instructions (if provided) */
  instructions?: string;
}

const DEFAULT_CLIENT_NAME = 'MCP Inspector';
const DEFAULT_CLIENT_VERSION = '2.0.0';

/**
 * Create a new MCP client with Inspector capabilities.
 *
 * @param options - Client configuration options
 * @returns Configured MCP Client instance
 */
export function createMcpClient(options: McpClientOptions = {}): Client {
  const {
    name = DEFAULT_CLIENT_NAME,
    version = DEFAULT_CLIENT_VERSION,
    enableSampling = true,
    enableRoots = true,
  } = options;

  const clientInfo: Implementation = {
    name,
    version,
  };

  // Build capabilities based on options
  const capabilities: Record<string, unknown> = {};

  if (enableSampling) {
    // Declare sampling capability with tool support (per MCP 2025-11-25 spec)
    capabilities.sampling = { tools: {} };
  }

  if (enableRoots) {
    // Declare roots capability
    capabilities.roots = { listChanged: true };
  }

  return new Client(clientInfo, { capabilities });
}

/**
 * Connect an MCP client to a server via transport.
 *
 * @param client - MCP Client instance
 * @param transport - Transport to connect through
 * @returns Server information on successful connection
 * @throws Error if connection fails
 */
export async function connectClient(
  client: Client,
  transport: Transport
): Promise<ServerInfo> {
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  const serverCapabilities = client.getServerCapabilities();
  const instructions = client.getInstructions();

  if (!serverVersion) {
    throw new Error('Failed to get server version after connection');
  }

  return {
    name: serverVersion.name,
    version: serverVersion.version,
    capabilities: serverCapabilities ?? {},
    instructions: instructions ?? undefined,
  };
}

/**
 * Disconnect an MCP client and clean up resources.
 *
 * @param client - MCP Client instance to disconnect
 */
export async function disconnectClient(client: Client): Promise<void> {
  await client.close();
}

/**
 * Check if a client is currently connected.
 *
 * @param client - MCP Client instance
 * @returns true if connected
 */
export function isClientConnected(client: Client): boolean {
  // The SDK client doesn't expose connection state directly,
  // but we can check if server version is available
  try {
    return client.getServerVersion() !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if server supports a specific capability.
 *
 * @param serverInfo - Server info from connection
 * @param capability - Capability name to check
 * @returns true if capability is supported
 */
export function serverSupports(
  serverInfo: ServerInfo,
  capability: keyof ServerCapabilities
): boolean {
  return serverInfo.capabilities[capability] !== undefined;
}
