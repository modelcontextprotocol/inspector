import { SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * JSON-RPC error code for failed proxy → upstream transport sends.
 *
 * JSON-RPC 2.0 reserves **-32000 .. -32099** for implementation-defined *server* errors.
 * MCP uses that band for protocol/SDK errors (see `@modelcontextprotocol/sdk` `ErrorCode`, e.g.
 * `-32000` connection closed, `-32001` request timeout, `-32042` URL elicitation; other codes in
 * the band are assigned over time — e.g. **-32002** is used for **ResourceNotFound** in parts of
 * the MCP ecosystem). We use **-32099** so this inspector-only bridge error stays clear of those
 * registered meanings; the client still keys off `error.data` shape, not the number alone.
 *
 * Keep in sync with `client/src/lib/constants.ts`; drift is caught by
 * `client/src/lib/__tests__/mcpProxyTransportErrorCode.test.ts`.
 */
export const MCP_PROXY_TRANSPORT_ERROR_CODE = -32099;

/** Session header bag used with `createCustomFetch`; may hold last upstream 401 snapshot. */
export type ProxyHeaderHolder = {
  headers: HeadersInit;
  lastUpstream401?: {
    wwwAuthenticate?: string;
    body: string;
    contentType: string;
  };
};

function onClientError(error: Error) {
  console.error("Error from inspector client:", error);
}

function onServerError(error: Error) {
  if (error?.cause && JSON.stringify(error.cause).includes("ECONNREFUSED")) {
    console.error("Connection refused. Is the MCP server running?");
  } else if (error.message && error.message.includes("404")) {
    console.error("Error accessing endpoint (HTTP 404)");
  } else {
    console.error("Error from MCP server:", error);
  }
}

/** Exported for unit tests; used by the proxy when forwarding transport failures. */
export function serializeProxyTransportError(
  error: Error,
  headerHolder?: ProxyHeaderHolder,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    message: error.message,
    name: error.name,
  };
  if (error.cause !== undefined) {
    data.cause =
      error.cause instanceof Error ? error.cause.message : String(error.cause);
  }
  const attachHttpStatusIfValid = (code: number) => {
    if (Number.isInteger(code) && code >= 100 && code <= 599) {
      data.httpStatus = code;
    }
  };
  if (error instanceof StreamableHTTPError) {
    if (error.code !== undefined) attachHttpStatusIfValid(error.code);
  } else if (error instanceof SseError) {
    if (error.code !== undefined) attachHttpStatusIfValid(error.code);
  }
  if (headerHolder?.lastUpstream401) {
    const u = headerHolder.lastUpstream401;
    data.upstream401 = {
      wwwAuthenticate: u.wwwAuthenticate,
      body: u.body,
      contentType: u.contentType,
    };
    delete headerHolder.lastUpstream401;
  }
  return data;
}

export default function mcpProxy({
  transportToClient,
  transportToServer,
  headerHolder,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
  headerHolder?: ProxyHeaderHolder;
}) {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  let reportedServerSession = false;

  transportToClient.onmessage = (message) => {
    transportToServer.send(message).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      // Send error response back to client if it was a request (has id) and connection is still open
      if (isJSONRPCRequest(message) && !transportToClientClosed) {
        const causeStr =
          error.cause !== undefined
            ? error.cause instanceof Error
              ? error.cause.message
              : String(error.cause)
            : null;
        const errorResponse = {
          jsonrpc: "2.0" as const,
          id: message.id,
          error: {
            code: MCP_PROXY_TRANSPORT_ERROR_CODE,
            message: causeStr
              ? `${error.message} (cause: ${causeStr})`
              : error.message,
            data: serializeProxyTransportError(error, headerHolder),
          },
        };
        transportToClient.send(errorResponse).catch(onClientError);
      }
    });
  };

  transportToServer.onmessage = (message) => {
    if (!reportedServerSession) {
      if (transportToServer.sessionId) {
        // Can only report for StreamableHttp
        console.error(
          "Proxy  <-> Server sessionId: " + transportToServer.sessionId,
        );
      }
      reportedServerSession = true;
    }
    transportToClient.send(message).catch(onClientError);
  };

  transportToClient.onclose = () => {
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    transportToServer.close().catch(onServerError);
  };

  transportToServer.onclose = () => {
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;
    transportToClient.close().catch(onClientError);
  };

  transportToClient.onerror = onClientError;
  transportToServer.onerror = onServerError;
}
