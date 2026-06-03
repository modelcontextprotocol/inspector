import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { MCP_PROXY_TRANSPORT_ERROR_CODE } from "./constants";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `McpError.data` from server `mcpProxy` `serializeProxyTransportError`. */
export function mcpProxyTransportErrorDataIndicatesUnauthorized(
  data: Record<string, unknown>,
): boolean {
  if ("upstream401" in data) {
    const snapshot = data.upstream401;
    if (snapshot != null) return true;
  }
  const status = data.httpStatus;
  return typeof status === "number" && status === 401;
}

/**
 * Whether `handleAuthError` / OAuth recovery should run for this failure.
 */
export function isConnectionAuthError(error: unknown): boolean {
  if (error instanceof SseError && error.code === 401) return true;
  if (error instanceof StreamableHTTPError && error.code === 401) return true;
  if (error instanceof UnauthorizedError) return true;

  if (
    error instanceof McpError &&
    error.code === MCP_PROXY_TRANSPORT_ERROR_CODE &&
    isPlainObject(error.data) &&
    mcpProxyTransportErrorDataIndicatesUnauthorized(error.data)
  ) {
    return true;
  }

  return false;
}
