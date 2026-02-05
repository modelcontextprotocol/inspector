# Environment Isolation

## Overview

**Environment isolation** is the design principle of separating pure, portable JavaScript from environment-specific code (Node.js, browser). The shared `InspectorClient` and auth logic must run in Node (CLI, TUI) and in the web UX—a combination of JavaScript in the browser and Node (API endpoints on the UX server or a separate proxy). Environment-specific APIs (e.g. `fs`, `child_process`, `sessionStorage`) are isolated behind abstractions or in separate modules.

We use the term **seams** for the individual integration points where environment-specific behavior plugs in. Each seam has an abstraction (interface or injection point) and one or more implementations per environment.

**Dependency consolidation (future):** Instead of injecting many separate dependencies (storage, navigation, redirectUrlProvider, fetchFn, logger, etc.), consider a single `InspectorClientEnvironment` interface that defines all seams. Callers would pass one object; each environment (Node, browser, tests) provides its implementation bundle. Simplifies wiring, clarifies the contract, and keeps optional properties optional.

## Implemented Seams

These seams are already implemented in InspectorClient:

| Seam                   | Abstraction                  | Node Implementation                                           | Browser Implementation                                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **OAuth storage**      | `OAuthStorage`               | `NodeOAuthStorage` (file-based)                               | `BrowserOAuthStorage` (sessionStorage)                                      |
| **OAuth navigation**   | `OAuthNavigation`            | `CallbackNavigation` (e.g. opens URL via `open`)              | `BrowserNavigation` (redirects)                                             |
| **OAuth redirect URL** | `RedirectUrlProvider`        | `MutableRedirectUrlProvider` (populated from callback server) | Object literal using `window.location.origin`                               |
| **OAuth auth fetch**   | Optional top-level `fetchFn` | N/A (Node has no CORS)                                        | Caller provides fetch that POSTs to proxy when in browser                   |
| **Transport creation** | `CreateTransport` (required) | `createTransportNode` (creates stdio, SSE, streamable-http)   | `createRemoteTransport` (creates `RemoteClientTransport` talking to remote) |

The caller provides storage, navigation, and redirect URL provider when configuring OAuth. InspectorClient accepts an optional top-level `fetchFn` used for both OAuth (discovery, registration, token exchange) and MCP transport HTTP requests. Fetches are tracked with `category: 'auth'` or `category: 'transport'` for the Requests tab. The web client must still implement the proxy endpoint and a fetch wrapper that routes requests through it.

InspectorClient **requires** a `transportClientFactory` of type `CreateTransport`. Node environments (TUI, CLI) pass `createTransportNode` from `inspector-shared/mcp/node`. Web environments will pass `createRemoteTransport` from `inspector-shared/mcp/remote` (creates `RemoteClientTransport` instances connecting to the remote server).

### How fetch is used

We allow a supplied fetch for two reasons: (1) **run remotely to avoid CORS** (browser auth and, in theory, browser local transports to external MCP servers), and (2) **capture/record fetch requests** for the Requests tab.

- **Auth:** InspectorClient builds `effectiveAuthFetch` = createFetchTracker(baseFetch, trackRequest) with baseFetch = options.fetchFn ?? fetch. Auth uses this for discovery, registration, token exchange, etc. Responses are not streaming (JSON). So a remoted fetch (e.g. `createRemoteFetch`) is fine for auth.

- **Transports:** Transports (SSE, streamable-http) use fetch for HTTP and **must support streaming responses** (SSE stream, NDJSON stream). Recording is the **transport creator’s responsibility**: wrap the base fetch with createFetchTracker and pass onFetchRequest. The tracking wrapper **does support streaming** (it detects stream content-types and returns the original response without reading the body). So recording does not break streaming.

- **Node (createTransportNode):** Receives options.fetchFn from InspectorClient; uses (fetchFn ?? globalThis.fetch) wrapped with createFetchTracker for SSE/streamable-http. So if a non-streaming fetch were passed, transport would break; today callers use default or real fetch.

- **Remote:** The **server** creates the real transport with createTransportNode; it does not receive InspectorClient’s fetchFn (that’s on the client). So the server uses Node’s fetch for the transport. Recording is applied on the server (onFetchRequest → session → fetch_request events to client). The **client**’s RemoteClientTransport uses fetch only for its own HTTP (connect, GET events, send, disconnect). GET /api/mcp/events is SSE, so that fetch must support streaming. **Workaround:** createRemoteTransport does **not** pass InspectorClient’s fetchFn to RemoteClientTransport; it uses only the factory’s fetchFn (or undefined → globalThis.fetch). So the transport’s HTTP always uses a streaming-capable fetch. Auth can still use a remoted fetch via InspectorClient’s fetchFn (effectiveAuthFetch).

- **createRemoteFetch:** Intended for auth (and other non-streaming HTTP) only. It buffers the response body and cannot stream. Do not use as a general-purpose or transport-level fetchFn where the response might be streaming.

---

## Implemented Remote Infrastructure

These remote seams are implemented. They fall into two groups: browser integration (new functionality for InspectorClient in the web UX) and code structure (refactoring so the shared package can run in the browser without pulling in Node-only code).

### Proxy Fetch (OAuth Auth Seam)

**Status:** Implemented. InspectorClient accepts optional top-level `fetchFn` and uses it for both OAuth and transport HTTP requests. The web client must still implement the proxy endpoint (`POST /fetch`) and a client-side fetch wrapper that serializes requests and POSTs them to the proxy.

**Problem**

CORS blocks many auth-related HTTP requests in the browser: discovery, client registration, token exchange, scope discovery, and others. All auth functions must use a fetch that is not subject to CORS. For example, OAuth discovery requires requests to `/.well-known/oauth-authorization-server`; servers like GitHub MCP (`https://api.githubcopilot.com/mcp/`) do not include `Access-Control-Allow-Origin`, so discovery fails with:

```
Failed to start OAuth flow: Failed to discover OAuth metadata
```

**Solution:** Pass `fetchFn` to all SDK auth calls. The fetch function routes requests through the proxy server (Node.js), which has no CORS restrictions.

**Implementation**

**InspectorClient** (done): Accepts optional `fetchFn` and passes it to all auth calls.

**`createRemoteFetch`** (in `shared/mcp/remote/`): Returns a fetch that POSTs to `/api/fetch`.

**`POST /api/fetch`** (in `createRemoteApp`): Accepts `{ url, method?, headers?, body? }`, performs the fetch in Node, returns `{ ok, status, statusText, headers, body }`. Protected by `x-mcp-remote-auth` when `authToken` is set.

**Client usage:** Pass `createRemoteFetch({ baseUrl, authToken?, fetchFn? })` as InspectorClient's `fetchFn` when in browser.

**Limitations:** Requires proxy mode; direct connections still hit CORS. Proxy must be running; token must be set in config.

---

### Remote Transports (Transport Seam)

**Status:** Implemented.

**Problem**

The web client cannot use stdio transports (no `child_process` in browser) and faces CORS/header limitations with direct HTTP connections (e.g. `mcp-session-id` hidden, many servers don't send `Access-Control-Expose-Headers`). The current web client proxy server runs as a separate process with duplicate SDK clients and state.

**Solution:** A **remote server** creates real SDK transports in Node and forwards JSON-RPC messages to/from the browser. The browser uses a `RemoteClientTransport` that talks to the remote; it implements the same `Transport` interface as local transports. The design is similar to the current web client proxy model. We will attempt to run it on the same server as the UX server (Vite dev server or equivalent), though with the option to run as a separate proxy if needed.

**Implementation:** `createRemoteTransport` and `RemoteClientTransport` (in `shared/mcp/remote/`); `createRemoteApp` (in `shared/mcp/remote/node/`). Tests in `shared/__tests__/remote-transport.test.ts` cover stdio, SSE, streamable-http.

**Endpoints (all implemented)**

- `POST /api/mcp/connect` — Create session and transport (stdio, SSE, or streamable HTTP)
- `POST /api/mcp/send` — Forward JSON-RPC message to MCP server
- `GET /api/mcp/events` — Stream responses (SSE)
- `POST /api/mcp/disconnect` — Cleanup session
- `POST /api/fetch` — Proxy HTTP for OAuth (CORS fix)
- `POST /api/log` — Receive log events from browser; forward to file logger when `logger` option is set

**Design**

The remote server forwards messages only; it holds no SDK `Client` and no protocol state. `InspectorClient` runs in the browser (or Node for CLI/TUI) and remains the single source of truth. For stdio servers, the browser always uses a remote transport; the remote server creates the real stdio transport in Node, so the browser never loads `StdioClientTransport` or `child_process`. When the underlying transport returns 401, the remote must return HTTP 401 (not 500) and `RemoteClientTransport` must throw `SseError(401)` or `StreamableHTTPError(401)` so OAuth triggers correctly. All remote endpoints require session token (`x-mcp-remote-auth`), origin validation, and timing-safe token comparison.

**Event stream and message handlers**

The remote server multiplexes multiple event types on the SSE stream (`/api/mcp/events`). The browser’s `RemoteClientTransport` subscribes to this stream and routes each event to the appropriate handler on the JavaScript side:

- `event: message` + JSON-RPC data → pass to `transport.onmessage` (protocol messages)
- `event: fetch_request` + `FetchRequestEntry` → call `onFetchRequest` (HTTP request/response tracking for the Requests tab)
- `event: stdio_log` (or `notifications/message`) + stderr payload → call `onStderr` (console output from stdio transports)

The remote server uses `createFetchTracker` when creating HTTP transports and emits `fetch_request` events when requests complete. For stdio transports, the remote server listens to the child process stderr and emits `stdio_log` (or equivalent) events. The `RemoteClientTransport` implements the same handler interface as local transports, so `InspectorClient` does not need to know whether it is using a local or remote transport.

---

## Module Organization (Implemented)

Environment-specific code is under `node` or `browser` subdirectories so the core `auth` and `mcp` modules stay portable.

### Auth

- **`shared/auth/`** — Types, interfaces, base providers, utilities (no `fs`, `window`, or `sessionStorage`). Exports storage interface, `CallbackNavigation`, `ConsoleNavigation`, `BaseOAuthClientProvider`, etc.
- **`shared/auth/node/`** — Node-only: `NodeOAuthStorage`, `createOAuthCallbackServer`, `clearAllOAuthClientState` (moved from `storage-node.ts`, `oauth-callback-server.ts`). Package export: `"./auth/node"`.
- **`shared/auth/browser/`** — Browser-only: `BrowserOAuthStorage` (sessionStorage), `BrowserNavigation`, `BrowserOAuthClientProvider` (moved from `storage-browser.ts` and `providers.ts`). Package export: `"./auth/browser"`.

Node consumers (TUI, CLI, tests) import from `inspector-shared/auth/node`. Browser consumers import from `inspector-shared/auth/browser`. Core auth is imported from `inspector-shared/auth` only.

### MCP

Remote transport code follows the same pattern: portable client in the module root, Node-specific server under `node/`.

- **`shared/mcp/`** — Portable: `InspectorClient`, types, `getServerType`, `createFetchTracker`, message tracking, etc. No Node-only APIs.
- **`shared/mcp/node/`** — Node-only: `loadMcpServersConfig`, `argsToMcpServerConfig`, `createTransportNode` (moved from `config.ts` and `transport.ts`). Package export: `"./mcp/node"`.
- **`shared/mcp/remote/`** — Portable: `createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`, `RemoteClientTransport`. Pure TypeScript; runs in browser, Deno, or Node. Package export: `"./mcp/remote"`.
- **`shared/mcp/remote/node/`** — Node-only: remote server (Hono, spawn, etc.). The server that hosts `/api/mcp/*`, `/api/fetch`, `/api/log`. Package export: `"./mcp/remote/node"`.

Node consumers (TUI, CLI) import from `inspector-shared/mcp/node` for config loading and transport creation. Web consumers import `createRemoteTransport` from `inspector-shared/mcp/remote`; the UX server or proxy runs the remote server from `inspector-shared/mcp/remote/node`.

### Summary

| Area   | Portable (no env APIs)                                          | Node (`./auth/node`, `./mcp/node`, `./mcp/remote/node`) | Browser (`./auth/browser`)                                         |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Auth   | storage types, base providers, utils                            | NodeOAuthStorage, callback server                       | BrowserOAuthStorage, BrowserNavigation, BrowserOAuthClientProvider |
| MCP    | InspectorClient, types, getServerType                           | loadMcpServersConfig, createTransportNode               | —                                                                  |
| Remote | createRemoteTransport, createRemoteFetch, RemoteClientTransport | remote server (Hono, stdio spawn, fetch proxy, log)     | —                                                                  |

---

### Logging

**Status:** Implemented. InspectorClient accepts optional `logger` (pino `Logger`); TUI uses a file-based logger.

## **Implementation:** `createRemoteLogger` (in `shared/mcp/remote/`) returns a pino logger that POSTs to `/api/log` via `pino/browser` transmit. `POST /api/log` (in `createRemoteApp`) forwards to a file logger when `createRemoteApp({ logger })` is passed. Tests in `shared/__tests__/remote-transport.test.ts` validate the flow.

## API Implementation (Web App)

For the web app, we would launch a **Hono server** that hosts all the Node-backed endpoints required by the browser-based InspectorClient. This server runs alongside (or as) the UX server and exposes the seams as HTTP APIs. The browser calls these endpoints via fetch wrappers and the `RemoteClientTransport`; InspectorClient remains unaware of whether it is talking to local or remote services.

**Endpoints**

| Endpoint                     | Purpose                                                           | Seam               |
| ---------------------------- | ----------------------------------------------------------------- | ------------------ |
| `POST /api/mcp/connect`      | Create session and client transport (stdio, SSE, streamable HTTP) | Remote transports  |
| `POST /api/mcp/send`         | Forward JSON-RPC message to MCP server                            | Remote transports  |
| `GET /api/mcp/events`        | Stream responses and side-channel events (SSE)                    | Remote transports  |
| `POST /api/mcp/disconnect`   | Cleanup session                                                   | Remote transports  |
| `POST /api/fetch`            | Proxy HTTP requests for OAuth and transport (CORS bypass)         | Proxy fetch        |
| `POST /api/log`              | Receive log events from browser for server-side logging           | Logging            |
| `GET /api/storage/:storeId`  | Read entire store (generic, e.g. oauth, preferences)              | Storage (optional) |
| `POST /api/storage/:storeId` | Write entire store (generic)                                      | Storage (optional) |

All endpoints require a session token (e.g. `x-mcp-remote-auth` header), origin validation, and timing-safe token comparison.

**Rationale for Hono**

Hono is lightweight, framework-agnostic, and supports Node. Using Hono keeps the API surface simple and consistent with the goal of a single server hosting transport, fetch, and logging. The existing proxy/express setup could be migrated to Hono if desired, or the Hono server could run as a separate process. The critical point is that one server hosts all endpoints the web client needs; the exact framework is an implementation detail.

**Out of scope for the API**

- **OAuth callback** — The web app implements its own `oauth/callback` route. OAuth redirects hit the web app directly; the callback is not part of the remote API.

**Generic storage (for shared on-disk state)**

If the web app should share on-disk state with the Node apps (TUI, CLI)—e.g. OAuth tokens, preferences—the browser cannot read/write the filesystem directly. A **generic storage endpoint** favors simplicity over fine-grained control, similar to Zustand's remote persistence:

- **`GET /api/storage/:storeId`** — returns the entire store as JSON (empty object or 404 if none)
- **`POST /api/storage/:storeId`** — body is the entire store JSON; overwrites

## The server treats stores as opaque blobs; it does not parse or validate schema. Store IDs are arbitrary (e.g. `oauth`, `inspector-settings`). A `RemoteOAuthStorage` adapter would: fetch the `oauth` store on first use, implement the `OAuthStorage` interface against the in-memory structure (keyed by serverUrl), and POST the whole store back on any mutation. The same pattern works for other stores (Zustand, preferences). This makes sense when the web app runs alongside the same Node process that hosts the remote API (e.g. Vite dev server with Hono backend). Alternative: use `BrowserOAuthStorage` (sessionStorage) and keep OAuth state in the browser—no storage API, but no shared state with TUI/CLI.

## Summary

| Seam                      | Status      | Notes                                                                                                   |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| OAuth storage             | Implemented | Injected `OAuthStorage`. Optional generic `/api/storage/:storeId` for shared on-disk state (see above). |
| OAuth navigation          | Implemented | Injected `OAuthNavigation`                                                                              |
| OAuth redirect URL        | Implemented | Injected `RedirectUrlProvider`                                                                          |
| OAuth auth fetch          | Implemented | `createRemoteFetch`, `POST /api/fetch`                                                                  |
| Logging                   | Implemented | `createRemoteLogger`, `POST /api/log`, file logger option in `createRemoteApp`                          |
| Transports                | Implemented | `createRemoteTransport`, `RemoteClientTransport`, `createRemoteApp` with `/api/mcp/*`                   |
| Node code organization    | Implemented | `shared/auth/node/`, `shared/mcp/node/`, `shared/mcp/remote/node/`                                      |
| Browser code organization | Implemented | `shared/auth/browser/`                                                                                  |
| Config loading            | Implemented | In `shared/mcp/node/`                                                                                   |

**Not yet wired:** The web client (`client/`) and server (`server/`) do not use the remote infrastructure. The web client still uses `useConnection` with direct SDK transports and the express proxy. Migrating to InspectorClient + `createRemoteTransport` + Hono remote server is pending.
