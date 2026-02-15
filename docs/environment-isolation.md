# Environment Isolation

## Overview

**Environment isolation** is the design principle of separating pure, portable JavaScript from environment-specific code (Node.js, browser). The shared `InspectorClient` (including OAuth support) runs in Node (CLI, TUI) and in the web UX—a combination of JavaScript in the browser and Node (API endpoints on the UX server or a separate remote server). Environment-specific APIs are isolated behind abstractions or in separate modules (e.g., Node.js's `fs` and `child_process`, or the browser's `sessionStorage`).

We use the term **seams** for the individual integration points where environment-specific behavior plugs in. Each seam has an abstraction (interface or injection point) and one or more implementations per environment.

**Dependency consolidation:** All environment-specific dependencies are consolidated into a single `InspectorClientEnvironment` interface. Callers pass one `environment` object; each environment (Node, browser, tests) provides its implementation bundle. This simplifies wiring, clarifies the contract, and keeps optional properties optional.

## Seams

These seams provide environment-specific functionality to InspectorClient:

| Seam                   | Abstraction                  | Node Implementation                                           | Browser Implementation (Web App)                                                                                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport creation** | `CreateTransport` (required) | `createTransportNode` (creates stdio, SSE, streamable-http)   | `createRemoteTransport` (creates `RemoteClientTransport` talking to remote API)                                                       |
| **OAuth storage**      | `OAuthStorage`               | `NodeOAuthStorage` (file-based / Zustand)                     | `BrowserOAuthStorage` (sessionStorage via Zustand)<br>`RemoteOAuthStorage` (HTTP API → file-based / Zustand via `/api/storage/oauth`) |
| **OAuth navigation**   | `OAuthNavigation`            | `CallbackNavigation` (e.g. opens URL via `open`)              | `BrowserNavigation` (redirects)                                                                                                       |
| **OAuth redirect URL** | `RedirectUrlProvider`        | `MutableRedirectUrlProvider` (populated from callback server) | `() => \`${window.location.origin}/oauth/callback\`` (single redirect URL with state parameter)                                       |
| **OAuth HTTP fetch**   | Optional `fetchFn`           | N/A (Node has no CORS)                                        | `createRemoteFetch` (POSTs to `/api/fetch` for OAuth CORS bypass)                                                                     |
| **Logging**            | Optional `logger`            | File-based pino logger                                        | `createRemoteLogger` (POSTs to `/api/log`)                                                                                            |

**InspectorClientEnvironment structure:**

All environment-specific dependencies are consolidated into a single `environment` object passed to `InspectorClient`:

```typescript
interface InspectorClientEnvironment {
  transport: CreateTransport; // Required
  fetch?: typeof fetch; // Optional, for OAuth and transport HTTP
  logger?: pino.Logger; // Optional, for InspectorClient events
  oauth?: {
    storage?: OAuthStorage;
    navigation?: OAuthNavigation;
    redirectUrlProvider?: RedirectUrlProvider;
  };
}
```

**Node usage example:**

```typescript
const client = new InspectorClient(config, {
  environment: {
    transport: createTransportNode,
    logger: createFileLogger({ logPath: "/path/to/logs" }),
    oauth: {
      storage: new NodeOAuthStorage({ dataDir: "/path/to/data" }),
      navigation: new ConsoleNavigation(),
      redirectUrlProvider: createCallbackServerRedirectUrlProvider(),
    },
  },
  oauth: {
    clientId: "my-client-id",
    clientSecret: "my-secret",
  },
});
```

**Browser usage example (Web App):**

```typescript
// web/src/lib/adapters/environmentFactory.ts
export function createWebEnvironment(
  authToken: string | undefined,
  redirectUrlProvider: RedirectUrlProvider,
): InspectorClientEnvironment {
  const baseUrl = `${window.location.protocol}//${window.location.host}`;
  const fetchFn: typeof fetch = (...args) => globalThis.fetch(...args);

  return {
    transport: createRemoteTransport({
      baseUrl,
      authToken,
      fetchFn,
    }),
    fetch: createRemoteFetch({
      baseUrl,
      authToken,
      fetchFn,
    }),
    logger: createRemoteLogger({
      baseUrl,
      authToken,
      fetchFn,
    }),
    oauth: {
      storage: new BrowserOAuthStorage(),
      navigation: new BrowserNavigation(),
      redirectUrlProvider,
    },
  };
}

// Usage in web app:
const client = new InspectorClient(config, {
  environment: createWebEnvironment(
    authToken,
    () => `${window.location.origin}/oauth/callback`,
  ),
  oauth: {
    clientId: "my-client-id",
    clientSecret: "my-secret", // optional
  },
});
```

**Note:** OAuth configuration (clientId, clientSecret, clientMetadataUrl, scope) is separate from environment components and goes in the top-level `oauth` property. The web app uses `BrowserOAuthStorage` (sessionStorage) for browser-only OAuth state. For shared state with Node apps (TUI/CLI), use `RemoteOAuthStorage` instead.

---

## Remote API Server

The remote API server (`createRemoteApp` in `core/mcp/remote/node/`) is a Hono-based server that hosts all Node-backed endpoints required by browser-based InspectorClient. The server is integrated directly into the Vite dev server (same origin as the web client) and exposes environment-specific functionality as HTTP APIs. The browser uses pure JavaScript wrappers that call these APIs where the Node-specific logic is implemented; InspectorClient remains unaware of whether it is talking to local or remote services.

**Rationale for Hono**

Hono is lightweight, framework-agnostic, and supports Node. Using Hono keeps the API surface simple and consistent with the goal of a single server hosting transport, fetch, logging, and storage. The Hono server is integrated into the Vite dev server as middleware, eliminating the need for a separate Express server. This provides same-origin requests (no CORS issues) and simplifies deployment.

**Integration in Web App**

- **Dev Mode:** Hono middleware plugin (`honoMiddlewarePlugin`) in `web/vite.config.ts` mounts the Hono app at the root and handles `/api/*` routes
- **Prod Mode:** Standalone Hono server (`web/bin/server.js`) serves both static files and API endpoints
- **Same Origin:** Both dev and prod modes serve from the same origin, eliminating CORS issues
- **Auth Token:** Passed via `MCP_INSPECTOR_API_TOKEN` environment variable (read-only, set by start script)

**Security**

All endpoints require authentication via `x-mcp-remote-auth` header (Bearer token format), origin validation, and timing-safe token comparison. The auth token is generated from options, environment variable (`MCP_INSPECTOR_API_TOKEN`), or randomly generated.

**Endpoints**

| Endpoint                       | Purpose                                                           | Seam              |
| ------------------------------ | ----------------------------------------------------------------- | ----------------- |
| `GET /api/config`              | Return initial server config (command, args, transport, URL, env) | Config            |
| `POST /api/mcp/connect`        | Create session and client transport (stdio, SSE, streamable HTTP) | Remote transports |
| `POST /api/mcp/send`           | Forward JSON-RPC message to MCP server                            | Remote transports |
| `GET /api/mcp/events`          | Stream responses and side-channel events (SSE)                    | Remote transports |
| `POST /api/mcp/disconnect`     | Cleanup session                                                   | Remote transports |
| `POST /api/fetch`              | Remote HTTP requests for OAuth (CORS bypass)                      | Remote fetch      |
| `POST /api/log`                | Receive log events from browser for server-side logging           | Remote logging    |
| `GET /api/storage/:storeId`    | Read entire store (generic, e.g. oauth, preferences)              | Remote storage    |
| `POST /api/storage/:storeId`   | Write entire store (generic)                                      | Remote storage    |
| `DELETE /api/storage/:storeId` | Delete store (generic)                                            | Remote storage    |

**Out of scope for the API**

- **OAuth callback** — The web app implements its own `/oauth/callback` route. OAuth redirects hit the web app directly; the callback is not part of the remote API. The web app handles both normal and guided OAuth flows via a single callback endpoint, with mode distinguished by the `state` parameter (`"guided:{random}"` or `"normal:{random}"`).

---

## Remote Infrastructure Details

These remote seams enable InspectorClient to run in the browser. They fall into two groups: browser integration (new functionality for InspectorClient in the web UX) and code structure (refactoring so the shared package can run in the browser without pulling in Node-only code).

### Remote Transports (Transport Seam)

The browser cannot use stdio transports (no `child_process` in browser) and faces CORS/header limitations with direct HTTP connections (e.g. `mcp-session-id` hidden, many servers don't send `Access-Control-Expose-Headers`).

**Design:** The browser always uses remote transports for all transport types (stdio, SSE, streamable-http). A **remote server** creates real SDK transports in Node and forwards JSON-RPC messages to/from the browser. The browser uses a `RemoteClientTransport` that talks to the remote; it implements the same `Transport` interface as local transports.

Unlike a proxy that maintains duplicate SDK clients and protocol state, the remote server is **stateless**—it only creates transports and forwards messages. `InspectorClient` runs in the browser and remains the single source of truth for protocol state, message tracking, and server data. This allows the same `InspectorClient` code to work identically in Node (CLI, TUI) and browser, with only the transport factory differing. The remote server runs on the same server as the UX server (Vite dev server or equivalent), though it can run as a separate remote server if needed.

**Implementation:** `createRemoteTransport` and `RemoteClientTransport` (in `core/mcp/remote/`); `createRemoteApp` (in `core/mcp/remote/node/`). Tests in `core/__tests__/remote-transport.test.ts` cover stdio, SSE, streamable-http.

**Relevant endpoints:**

- `POST /api/mcp/connect` — Create session and transport (stdio, SSE, or streamable HTTP). Accepts `{ config: MCPServerConfig, oauthTokens?: {...} }`, creates Node transport, returns `{ sessionId }`.
- `POST /api/mcp/send` — Forward JSON-RPC message to MCP server. Accepts `{ message: JSONRPCMessage, relatedRequestId?: string }`, forwards to transport, returns response.
- `GET /api/mcp/events` — Stream responses (SSE). Multiplexes `message`, `fetch_request`, and `stdio_log` events.
- `POST /api/mcp/disconnect` — Cleanup session. Closes transport and removes session.

**Design Details**

The remote server forwards messages only; it holds no SDK `Client` and no protocol state. `InspectorClient` runs in the browser (or Node for CLI/TUI) and remains the single source of truth. The browser always uses remote transports for all transport types; the remote server creates the real transports (stdio, SSE, streamable-http) in Node, so the browser never loads Node-specific transport code or `child_process`.

When the underlying transport returns 401 (e.g., OAuth required), the remote server preserves the status code and returns HTTP 401 (not 500). `RemoteClientTransport` receives the 401 response and throws an error with the status code preserved, allowing callers to detect authentication failures and trigger OAuth flow manually (consistent with the "authenticate first, then connect" pattern).

**Event stream and message handlers**

The remote server multiplexes multiple event types on the SSE stream (`/api/mcp/events`). The browser's `RemoteClientTransport` subscribes to this stream and routes each event to the appropriate handler on the JavaScript side:

- `event: message` + JSON-RPC data → pass to `transport.onmessage` (protocol messages)
- `event: fetch_request` + `FetchRequestEntry` → call `onFetchRequest` (HTTP request/response tracking for the Requests tab)
- `event: stdio_log` (or `notifications/message`) + stderr payload → call `onStderr` (console output from stdio transports)

The remote server uses `createFetchTracker` when creating HTTP transports and emits `fetch_request` events when requests complete. For stdio transports, the remote server listens to the child process stderr and emits `stdio_log` (or equivalent) events. The `RemoteClientTransport` implements the same handler interface as local transports, so `InspectorClient` does not need to know whether it is using a local or remote transport.

**Fetch usage in transports**

Transports (SSE, streamable-http) use fetch for HTTP and **must support streaming responses** (SSE stream, NDJSON stream). Recording is the **transport creator's responsibility**: wrap the base fetch with createFetchTracker and pass onFetchRequest. The tracking wrapper **does support streaming** (it detects stream content-types and returns the original response without reading the body), so recording does not break streaming.

- **Node (createTransportNode):** Receives `environment.fetch` from InspectorClient; uses (`environment.fetch ?? globalThis.fetch`) wrapped with createFetchTracker for SSE/streamable-http. If a non-streaming fetch were passed, transport would break; today callers use default or real fetch.

- **Remote:** The **server** creates the real transport with createTransportNode; it does not receive InspectorClient's `environment.fetch` (that's on the client). So the server uses Node's fetch for the transport. Recording is applied on the server (onFetchRequest → session → fetch_request events to client). The **client**'s RemoteClientTransport uses fetch only for its own HTTP (connect, GET events, send, disconnect). GET /api/mcp/events is SSE, so that fetch must support streaming. **Design decision:** createRemoteTransport does **not** pass InspectorClient's `environment.fetch` to RemoteClientTransport; it uses only the factory's fetchFn (or undefined → globalThis.fetch). So the transport's HTTP always uses a streaming-capable fetch. OAuth can still use a remoted fetch via InspectorClient's `environment.fetch` (effectiveAuthFetch).

---

### Remote Fetch (OAuth CORS Bypass)

CORS blocks OAuth-related HTTP requests in the browser: discovery, client registration, token exchange, scope discovery, and others. Many authorization servers (e.g., GitHub MCP at `https://api.githubcopilot.com/mcp/`) do not include `Access-Control-Allow-Origin`, causing OAuth flows to fail with:

```
Failed to start OAuth flow: Failed to discover OAuth metadata
```

**Design:** Pass `fetchFn` in `environment.fetch` to route OAuth-related HTTP requests through the remote server (Node.js), which has no CORS restrictions. InspectorClient uses this fetch for all OAuth operations (discovery, registration, token exchange, etc.).

**Implementation**

**InspectorClient:** Accepts optional `environment.fetch` and builds `effectiveAuthFetch` = createFetchTracker(baseFetch, trackRequest) with baseFetch = `environment.fetch ?? fetch`. All OAuth HTTP requests use this effective fetch.

**`createRemoteFetch`** (in `core/mcp/remote/`): Returns a fetch function that POSTs to `/api/fetch`. The remote server performs the actual HTTP request in Node and returns the response. OAuth responses are JSON (not streaming), so the buffered response from `createRemoteFetch` is sufficient.

**Relevant endpoint:**

- `POST /api/fetch` — Accepts `{ url, method?, headers?, body? }`, performs the fetch in Node, returns `{ ok, status, statusText, headers, body }`. Protected by `x-mcp-remote-auth` when `authToken` is set.

**Client usage:** Pass `createRemoteFetch({ baseUrl, authToken?, fetchFn? })` as `environment.fetch` when in browser.

**Limitations:** `createRemoteFetch` buffers the response body and cannot stream. It is intended for OAuth (and other non-streaming HTTP) only. Do not use as a general-purpose or transport-level fetchFn where the response might be streaming.

---

### Remote Logging

InspectorClient accepts optional `environment.logger` (pino `Logger`) for customizable logging.

The CLI and TUI use a file-based logger.

Browser clients are unable to write to the server console or the file system, so an optional remote logger may be provided by a browser client user of InspectorClient. The browser client uses a remote logger to forward log events to the server (Node endpoints) where configured loggers may write to the system console, a file-based log, or any other supported Pino log target.

**Implementation:** `createRemoteLogger` (in `core/mcp/remote/`) returns a pino logger that POSTs to `/api/log` via `pino/browser` transmit.

**Relevant endpoint:**

- `POST /api/log` — Receives log events from browser, forwards to file logger when `createRemoteApp({ logger })` is passed. Protected by `x-mcp-remote-auth` when `authToken` is set.

Tests in `core/__tests__/remote-transport.test.ts` validate the flow.

---

### Remote Storage

The browser cannot read/write the filesystem directly, so a generic storage API enables shared on-disk state between web app and Node apps (TUI, CLI).

OAuth tokens and other state need to persist across sessions. In Node (TUI, CLI), we use file-based storage. In the browser, we need a way to share this state with Node apps when the web app runs alongside the Node process hosting the remote API.

**Design:** A generic storage API that treats stores as opaque JSON blobs (Zustand's persist format). The server stores entire stores as files; clients read/write entire stores via HTTP.

**Implementation:**

- **Storage adapters** (`core/storage/adapters/`): Reusable Zustand storage adapters:
  - `FileStorageAdapter` — file-based storage for Node (uses `fs/promises`)
  - `RemoteStorageAdapter` — HTTP-based storage for browser (uses `/api/storage/:storeId`)
- **OAuth storage implementations**:
  - `NodeOAuthStorage` — uses `FileStorageAdapter` with Zustand persist middleware
  - `BrowserOAuthStorage` — uses Zustand with `sessionStorage` adapter (browser-only)
  - `RemoteOAuthStorage` — uses `RemoteStorageAdapter` for shared state with Node apps

**Relevant endpoints:**

- `GET /api/storage/:storeId` — Returns entire store as JSON (empty object `{}` if not found). Protected by `x-mcp-remote-auth` when `authToken` is set.
- `POST /api/storage/:storeId` — Overwrites entire store with provided JSON. Protected by `x-mcp-remote-auth` when `authToken` is set.
- `DELETE /api/storage/:storeId` — Deletes store (idempotent). Protected by `x-mcp-remote-auth` when `authToken` is set.

**Design Details:** The server treats stores as opaque JSON blobs (Zustand's persist format: `{ state: {...}, version: 0 }`). Store IDs are arbitrary (e.g. `oauth`, `inspector-settings`). All OAuth storage implementations use the same Zustand-backed pattern for consistency. `RemoteOAuthStorage` fetches the store on initialization, implements `OAuthStorage` against the in-memory structure, and persists changes via POST. This enables shared OAuth state when the web app runs alongside the Node process hosting the remote API (e.g. Vite dev server with Hono backend).

**Web App Usage:** The web app uses `BrowserOAuthStorage` (sessionStorage) for browser-only OAuth state. This provides isolation between browser sessions but does not share state with TUI/CLI. To enable shared OAuth state with Node apps, switch to `RemoteOAuthStorage` in `createWebEnvironment()`.

**Session persistence across OAuth:** InspectorClient can optionally persist session state (e.g. fetch history) across the OAuth redirect. This is an InspectorClient feature that reuses the same remote storage seam: the web app passes optional `sessionStorage` (e.g. `RemoteInspectorClientStorage`) and `sessionId` (from the OAuth `state` parameter). InspectorClient saves session before navigating to the auth provider and restores it when the client is recreated after the callback. Store IDs follow the pattern `inspector-session-{sessionId}` and use the existing `GET/POST /api/storage/:storeId` endpoints.

---

## Module Organization

Environment-specific code is under `node` or `browser` subdirectories so the core `auth` and `mcp` modules stay portable.

### Auth

| Module               | Environment  | Contents                                                                                                                                                                                     | Package Export     |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `core/auth/`         | Portable     | Types, interfaces, base providers, utilities (no `fs`, `window`, or `sessionStorage`). Exports storage interface, `CallbackNavigation`, `ConsoleNavigation`, `BaseOAuthClientProvider`, etc. | `"./auth"`         |
| `core/auth/node/`    | Node-only    | `NodeOAuthStorage`, `createOAuthCallbackServer`, `clearAllOAuthClientState`                                                                                                                  | `"./auth/node"`    |
| `core/auth/browser/` | Browser-only | `BrowserOAuthStorage` (sessionStorage), `BrowserNavigation`, `BrowserOAuthClientProvider`                                                                                                    | `"./auth/browser"` |

**Usage:** Node consumers (TUI, CLI, tests) import from `inspector-core/auth/node`. Browser consumers import from `inspector-core/auth/browser`. Core auth is imported from `inspector-core/auth` only.

### MCP

Remote transport code follows the same pattern: portable client in the module root, Node-specific server under `node/`.

| Module                  | Environment | Contents                                                                                                                                      | Package Export        |
| ----------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `core/mcp/`             | Portable    | `InspectorClient`, types, `getServerType`, `createFetchTracker`, message tracking, etc. No Node-only APIs.                                    | `"./mcp"`             |
| `core/mcp/node/`        | Node-only   | `loadMcpServersConfig`, `argsToMcpServerConfig`, `createTransportNode`                                                                        | `"./mcp/node"`        |
| `core/mcp/remote/`      | Portable    | `createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`, `RemoteClientTransport`. Pure TypeScript; runs in browser, Deno, or Node. | `"./mcp/remote"`      |
| `core/mcp/remote/node/` | Node-only   | Remote server (Hono, spawn, etc.). The server that hosts `/api/mcp/*`, `/api/fetch`, `/api/log`, `/api/storage/*`.                            | `"./mcp/remote/node"` |

**Usage:** Node consumers (TUI, CLI) import from `inspector-core/mcp/node` for config loading and transport creation. Web consumers import `createRemoteTransport` from `inspector-core/mcp/remote`; the UX server or a separate remote server runs the remote API from `inspector-core/mcp/remote/node`.

---

## Web App Integration

The current web client and server functionality has been ported to a new web app (`web/`) that uses `InspectorClient` with remote infrastructure, implementing all functionality previously supported. The separate proxy server/endpoint has been removed. Security via token is retained by implementation of an "API Token" that the local client app uses to access local API endpoints. The `useConnection` hook, auth logic and state machine, etc, have been removed. The new web app is a fairly thin UX wrapper of `InspectorClient`

**Architecture:**

- **Environment Factory:** `web/src/lib/adapters/environmentFactory.ts` provides `createWebEnvironment()` that configures:
  - `createRemoteTransport()` for all transport types (stdio, SSE, streamable-http)
  - `createRemoteFetch()` for OAuth HTTP requests (CORS bypass)
  - `createRemoteLogger()` for persistent logging
  - `BrowserOAuthStorage` and `BrowserNavigation` for OAuth flows
- **Lazy Client Creation:** Uses `ensureInspectorClient()` helper that validates API token before creating client
- **OAuth Integration:** Single redirect URL (`/oauth/callback`) with mode encoded in state parameter; supports both normal and guided flows
- **Initial Config:** Web app fetches `GET /api/config` (with `x-mcp-remote-auth`) on load; response sets command, args, transport, server URL, and env. Same in dev and prod.

**Hono Integration:**

- **Dev Mode:** Hono middleware plugin (`honoMiddlewarePlugin`) in `web/vite.config.ts` mounts the Hono app at the root and handles `/api/*` routes
- **Prod Mode:** Standalone Hono server (`web/bin/server.js`) serves both static files and API endpoints
- **Same Origin:** Both dev and prod modes serve from the same origin, eliminating CORS issues

**Legacy Client:**

The legacy web client (`client/`) still exists but is deprecated. It uses `useConnection` with direct SDK transports and a separate Express server. New development should use the `web/` app with `InspectorClient`.
