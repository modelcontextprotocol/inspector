# Environment Isolation

## Overview

**Environment isolation** is the design principle of separating pure, portable JavaScript from environment-specific code (Node.js, browser). The shared `InspectorClient` and auth logic must run in Node (CLI, TUI) and in the web UX—a combination of JavaScript in the browser and Node (API endpoints on the UX server or a separate proxy). Environment-specific APIs (e.g. `fs`, `child_process`, `sessionStorage`) are isolated behind abstractions or in separate modules.

We use the term **seams** for the individual integration points where environment-specific behavior plugs in. Each seam has an abstraction (interface or injection point) and one or more implementations per environment.

**Dependency consolidation (future):** Instead of injecting many separate dependencies (storage, navigation, redirectUrlProvider, fetchFn, logger, etc.), consider a single `InspectorClientEnvironment` interface that defines all seams. Callers would pass one object; each environment (Node, browser, tests) provides its implementation bundle. Simplifies wiring, clarifies the contract, and keeps optional properties optional.

## Implemented Seams

These seams are already implemented in InspectorClient:

| Seam                   | Abstraction                  | Node Implementation                                           | Browser Implementation                                                                |
| ---------------------- | ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **OAuth storage**      | `OAuthStorage`               | `NodeOAuthStorage` (file-based)                               | `BrowserOAuthStorage` (sessionStorage)                                                |
| **OAuth navigation**   | `OAuthNavigation`            | `CallbackNavigation` (e.g. opens URL via `open`)              | `BrowserNavigation` (redirects)                                                       |
| **OAuth redirect URL** | `RedirectUrlProvider`        | `MutableRedirectUrlProvider` (populated from callback server) | Object literal using `window.location.origin`                                         |
| **OAuth auth fetch**   | Optional top-level `fetchFn` | N/A (Node has no CORS)                                        | Caller provides fetch that POSTs to proxy when in browser                             |
| **Transport creation** | `CreateTransport` (required) | `createTransportNode` (creates stdio, SSE, streamable-http)   | `createTransportRemote` (proposed; creates `RemoteClientTransport` talking to bridge) |

The caller provides storage, navigation, and redirect URL provider when configuring OAuth. InspectorClient accepts an optional top-level `fetchFn` used for both OAuth (discovery, registration, token exchange) and MCP transport HTTP requests. Fetches are tracked with `category: 'auth'` or `category: 'transport'` for the Requests tab. The web client must still implement the proxy endpoint and a fetch wrapper that routes requests through it.

InspectorClient **requires** a `transportClientFactory` of type `CreateTransport`. Node environments (TUI, CLI) pass `createTransportNode` from `shared/mcp/transport`. Web environments will pass `createTransportRemote` (or a factory that creates `RemoteClientTransport` instances connecting to the bridge).

---

## Pending Seams

These seams are not yet implemented. They fall into two groups: browser integration (new functionality for InspectorClient in the web UX) and code structure (refactoring so the shared package can run in the browser without pulling in Node-only code).

### Proxy Fetch (OAuth Auth Seam)

**Status:** Partially implemented. InspectorClient accepts optional top-level `fetchFn` and uses it for both OAuth and transport HTTP requests. The web client must still implement the proxy endpoint (`POST /fetch`) and a client-side fetch wrapper that serializes requests and POSTs them to the proxy.

**Problem**

CORS blocks many auth-related HTTP requests in the browser: discovery, client registration, token exchange, scope discovery, and others. All auth functions must use a fetch that is not subject to CORS. For example, OAuth discovery requires requests to `/.well-known/oauth-authorization-server`; servers like GitHub MCP (`https://api.githubcopilot.com/mcp/`) do not include `Access-Control-Allow-Origin`, so discovery fails with:

```
Failed to start OAuth flow: Failed to discover OAuth metadata
```

**Solution:** Pass `fetchFn` to all SDK auth calls. The fetch function routes requests through the proxy server (Node.js), which has no CORS restrictions.

**Implementation**

**InspectorClient** (done): Accepts optional `fetchFn` in OAuth config; passes it to `auth()`, `discoverAuthorizationServerMetadata`, `registerClient`, `exchangeAuthorization`, and `discoverScopes`.

**Bridge or proxy** (pending): Add `POST /fetch` endpoint that accepts `{ url, init }`, performs the fetch in Node, and returns `{ ok, status, statusText, headers, body }`. Protected by auth middleware.

**Client fetch wrapper** (pending): Caller provides a fetch that POSTs to the bridge/proxy when in browser. Body serialization must handle `URLSearchParams` (e.g. token exchange form data) by calling `.toString()` before `JSON.stringify`.

**Limitations:** Requires proxy mode; direct connections still hit CORS. Proxy must be running; token must be set in config.

---

### Remote Transports (Transport Seam)

**Status:** Not implemented. Design only.

**Problem**

The web client cannot use stdio transports (no `child_process` in browser) and faces CORS/header limitations with direct HTTP connections (e.g. `mcp-session-id` hidden, many servers don't send `Access-Control-Expose-Headers`). The current web client proxy server runs as a separate process with duplicate SDK clients and state.

**Solution:** A **transport bridge** creates real SDK transports in Node and forwards JSON-RPC messages to/from the browser. The browser uses a `RemoteClientTransport` that talks to the bridge; it implements the same `Transport` interface as local transports. The design is similar to the current web client proxy model. We will attempt to run it on the same server as the UX server (Vite dev server or equivalent), though with the option to run as a separate proxy if needed.

**Implementation status:** InspectorClient now **requires** a `CreateTransport` (transport factory). Node callers (TUI, CLI) pass `createTransportNode`. Web callers will pass `createTransportRemote`, which creates `RemoteClientTransport` instances. The transport bridge, `createTransportRemote`, and `RemoteClientTransport` are not yet implemented.

**Bridge endpoints**

- `POST /api/mcp/connect` — Create session and transport (stdio, SSE, or streamable HTTP)
- `POST /api/mcp/send` — Forward JSON-RPC message to MCP server
- `GET /api/mcp/events` — Stream responses (SSE)
- `POST /api/mcp/disconnect` — Cleanup session
- `POST /api/mcp/fetch` — Proxy HTTP for OAuth (CORS fix)

**Design**

The bridge forwards messages only; it holds no SDK `Client` and no protocol state. `InspectorClient` runs in the browser (or Node for CLI/TUI) and remains the single source of truth. For stdio servers, the browser always uses a remote transport; the bridge creates the real stdio transport in Node, so the browser never loads `StdioClientTransport` or `child_process`. When the underlying transport returns 401, the bridge must return HTTP 401 (not 500) and `RemoteClientTransport` must throw `SseError(401)` or `StreamableHTTPError(401)` so OAuth triggers correctly. All bridge endpoints require session token (`x-mcp-bridge-auth`), origin validation, and timing-safe token comparison.

**Event stream and message handlers**

The bridge multiplexes multiple event types on the SSE stream (`/api/mcp/events`). The browser’s `RemoteClientTransport` subscribes to this stream and routes each event to the appropriate handler on the JavaScript side:

- `event: message` + JSON-RPC data → pass to `transport.onmessage` (protocol messages)
- `event: fetch_request` + `FetchRequestEntry` → call `onFetchRequest` (HTTP request/response tracking for the Requests tab)
- `event: stdio_log` (or `notifications/message`) + stderr payload → call `onStderr` (console output from stdio transports)

The bridge uses `createFetchTracker` when creating HTTP transports and emits `fetch_request` events when requests complete. For stdio transports, the bridge listens to the child process stderr and emits `stdio_log` (or equivalent) events. The `RemoteClientTransport` implements the same handler interface as local transports, so `InspectorClient` does not need to know whether it is using a local or remote transport.

---

### Node Code Organization

**Problem**: `shared/auth/index.ts` re-exports `NodeOAuthStorage` and `createOAuthCallbackServer`, which import `fs`, `path`, and `node:http`. Importing from `inspector-shared/auth` loads those modules and fails in the browser.

**Solution**: Move Node-only code to `shared/node/`:

- `shared/node/auth/` – `NodeOAuthStorage`, `oauth-callback-server`, `clearAllOAuthClientState`
- `shared/node/mcp/` – `loadMcpServersConfig`, `argsToMcpServerConfig` (uses `fs`, `path`, `process.cwd`)

Package exports: `"./node/auth"`, `"./node/mcp"`. Browser consumers import from `inspector-shared` and `inspector-shared/auth` only; Node consumers (TUI, CLI, tests) additionally import from `inspector-shared/node/auth` and `inspector-shared/node/mcp`.

### Config File Loading

**Problem**: `loadMcpServersConfig` uses `fs`, `path`, `process.cwd()`. It is exported from the main mcp index, so importing `InspectorClient` can pull it in.

**Solution**: Move to `shared/node/mcp/` (see above). TUI and CLI import from `inspector-shared/node/mcp` for config loading. The main mcp index does not export config.

---

### Logging

**Status:** Partially implemented. InspectorClient accepts optional `logger` (pino `Logger`); TUI creates a file-based logger. Web client integration is not implemented.

**Problem**

InspectorClient can log (auth fetch, events, etc.). In Node (TUI, CLI), the caller creates a pino logger that writes to a file. In the web client, InspectorClient runs in the browser, which cannot write to the filesystem. Logs need to reach a destination the browser can reach.

**Solution (web client)**

A web client using InspectorClient would create a logger in its Node launcher process (bridge/proxy). That logger uses a transport that sends log events to a logging API endpoint—for example, `POST /api/log`—which performs the actual logging (file, aggregator, etc.). The browser’s InspectorClient would receive a logger implementation that POSTs log events to that endpoint instead of writing locally.

**Open questions**

- **Config sharing:** How does the browser learn the logging endpoint URL, log level, and other options? Options: server injects config into the initial page, config fetched from an API at startup, or config passed as part of bridge session setup.
- **Transport design:** Does the browser hold a “remote logger” that batches and POSTs events? Or does the bridge expose a logger that the browser uses via a different mechanism?
- **Backpressure and buffering:** How to handle logging when the logging endpoint is slow or unavailable.

---

## Summary

| Seam                   | Status                | Notes                                                                                                   |
| ---------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| OAuth storage          | Implemented           | Injected `OAuthStorage`                                                                                 |
| OAuth navigation       | Implemented           | Injected `OAuthNavigation`                                                                              |
| OAuth redirect URL     | Implemented           | Injected `RedirectUrlProvider`                                                                          |
| OAuth auth fetch       | Partially implemented | InspectorClient accepts and passes `fetchFn`; client needs proxy endpoint and fetch wrapper             |
| Logging                | Partially implemented | InspectorClient accepts `logger`; TUI uses file logger. Web client needs remote logger → API            |
| Transports             | Partially implemented | `CreateTransport` required; Node uses `createTransportNode`. `createTransportRemote` and bridge pending |
| Node code organization | Not implemented       | Move to `shared/node/`                                                                                  |
| Config loading         | Not implemented       | Move to `shared/node/mcp/`                                                                              |
