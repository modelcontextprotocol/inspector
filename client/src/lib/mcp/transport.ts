/**
 * HTTP Transport Factory - Create transports for remote MCP servers
 *
 * This module provides factory functions for creating HTTP transports
 * that work in the browser using the MCP SDK's StreamableHTTPClientTransport.
 *
 * Usage:
 *   import { createHttpTransport } from '@/lib/mcp/transport';
 *
 *   const transport = createHttpTransport('http://localhost:3000/mcp');
 *   await client.connect(transport);
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Create an HTTP transport for a remote MCP server.
 *
 * @param url - The MCP server endpoint URL
 * @param headers - Optional custom headers (e.g., for API keys)
 * @returns StreamableHTTPClientTransport instance
 */
export function createHttpTransport(
  url: string,
  headers?: Record<string, string>
): StreamableHTTPClientTransport {
  const options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {};

  if (headers) {
    options.requestInit = { headers };
  }

  return new StreamableHTTPClientTransport(new URL(url), options);
}

/**
 * Create an HTTP transport with Bearer token authentication.
 *
 * @param url - The MCP server endpoint URL
 * @param token - Bearer token (with or without 'Bearer ' prefix)
 * @returns StreamableHTTPClientTransport instance
 */
export function createAuthenticatedTransport(
  url: string,
  token: string
): StreamableHTTPClientTransport {
  return createHttpTransport(url, {
    Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
  });
}

/**
 * Validate that a URL is suitable for HTTP transport.
 *
 * @param url - URL to validate
 * @returns true if valid HTTP/HTTPS URL
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
