/**
 * Split one fetch chain into MCP traffic and OAuth work (#2749).
 *
 * A transport's fetch carries both: the MCP endpoint's own requests, and the
 * OAuth discovery, token and registration requests the SDK runs from inside
 * the transport on a 401 or a refresh. The two need different bases — OAuth
 * goes through the destination guard (`core/mcp/node/fetchGuard.ts`), while
 * the MCP endpoint is the server the user configured and is never second-
 * guessed — so this sends each request to one or the other.
 *
 * A request is MCP traffic only when it passes **both** of two tests:
 *
 *  - **Where it goes** — `exemptMcpEndpoint`'s classification, the same
 *    predicate that keeps the MCP endpoint out of the OAuth deadline.
 *  - **What it looks like** ({@link isMcpShapedRequest}) — a JSON-RPC POST, an
 *    event-stream GET, or a session DELETE.
 *
 * The second test exists because the first cannot be exact for legacy SSE.
 * Its message endpoint is negotiated inside the stream, so the predicate
 * widens to the server's whole origin, and every same-origin OAuth request —
 * protected-resource metadata at a custom `resource_metadata` path, discovery
 * at a well-known one, dynamic client registration — would otherwise go out
 * unguarded and could be redirected to the metadata service (Copilot). OAuth
 * never sends any of the three MCP shapes, so the shape test settles what the
 * origin cannot.
 *
 * Anything else goes to the guard. That is the cheap direction to be wrong in:
 * the guard refuses only link-local and metadata addresses, so an MCP request
 * it receives by mistake still reaches an ordinary server.
 *
 * Isomorphic — it only picks between two fetches it is handed — so
 * `InspectorClient` can use it in the browser as well as in Node.
 */

import { requestHeadersOf, requestUrlOf } from "./requestTimeout.js";

/** Whether `value` is one JSON-RPC 2.0 message. */
function isJsonRpcMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === "2.0"
  );
}

/** Whether `body` is a JSON-RPC 2.0 message or a non-empty batch of them. */
function isJsonRpcBody(body: unknown): boolean {
  if (typeof body !== "string") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  return Array.isArray(parsed)
    ? parsed.length > 0 && parsed.every(isJsonRpcMessage)
    : isJsonRpcMessage(parsed);
}

/**
 * Whether a request has one of the shapes MCP traffic takes on the wire, none
 * of which OAuth ever sends:
 *
 *  - a POST whose body is a JSON-RPC 2.0 message or batch (every transport's
 *    client-to-server messages);
 *  - a GET that accepts `text/event-stream` (the legacy SSE stream, and
 *    streamable HTTP's standalone stream);
 *  - a DELETE (streamable HTTP's session termination).
 *
 * The body is read only when it is a string, which is how the SDK sends every
 * message; a `Request` input's body cannot be read synchronously and so does
 * not qualify, which routes it to the guard.
 */
export function isMcpShapedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): boolean {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  if (method === "DELETE") return true;
  if (method === "POST") return isJsonRpcBody(init?.body);
  if (method === "GET") {
    return (requestHeadersOf(input, init).get("accept") ?? "")
      .toLowerCase()
      .includes("text/event-stream");
  }
  return false;
}

/**
 * A fetch that sends MCP traffic to `mcpFetch` and everything else to
 * `oauthFetch`.
 *
 * @param isMcpEndpoint - `exemptMcpEndpoint(...)`, or any predicate of the
 *   same shape; `true` means the request is addressed to the MCP endpoint.
 */
export function routeOAuthRequests(
  mcpFetch: typeof fetch,
  oauthFetch: typeof fetch,
  isMcpEndpoint: (url: string, headers: Headers) => boolean,
): typeof fetch {
  return (input, init) =>
    isMcpShapedRequest(input, init) &&
    isMcpEndpoint(requestUrlOf(input), requestHeadersOf(input, init))
      ? mcpFetch(input, init)
      : oauthFetch(input, init);
}
