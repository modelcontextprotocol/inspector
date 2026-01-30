# Remote Transport Design: Unified Inspector Architecture

## Executive Summary

This document describes a redesign of the MCP Inspector architecture to:

1. **Unify all clients** (web, CLI, TUI) to use the same `InspectorClient` code
2. **Eliminate the separate proxy server** by integrating transport bridging into the Vite dev server
3. **Solve CORS and stdio limitations** for the web client without code duplication
4. **Preserve all existing functionality** (message tracking, events, OAuth, etc.)

## Current Architecture Problems

### 1. Code Duplication

**Web Client** (`client/src/lib/hooks/useConnection.ts`):

- Uses SDK `Client` directly
- Reimplements state management (tools, resources, prompts)
- Custom OAuth handling
- Custom event dispatching
- ~880 lines of connection logic

**CLI/TUI** (`cli/src/index.ts`, `tui/src/App.tsx`):

- Uses `InspectorClient` (shared package)
- All state management, OAuth, events built-in
- ~50 lines to connect and use

**Result**: Web client behaves differently from CLI/TUI because it's entirely different code.

### 2. Separate Proxy Server

**Current Setup**:

```
npm run dev        # Starts Vite dev server (port 5173)
npm run dev-server # Starts proxy server (port 6277)
```

Two separate Node.js processes that must be coordinated.

**Proxy Responsibilities** (`server/src/index.ts`, ~700 lines):

- Creates SDK `Client` and `Transport` for each connection
- Manages sessions (Map of sessionId → {client, transport})
- Forwards messages bidirectionally via `mcpProxy.ts`
- Handles authentication (session token)
- Forwards custom headers
- Manages CORS headers
- Provides `/config` endpoint for defaults

### 3. Duplicate SDK Clients

```
Browser                    Proxy Server              MCP Server
  │                             │                         │
  ├─SDK Client─────────────────▶│                         │
  │  (manages state)            │                         │
  │                             ├─SDK Client──────────────▶│
  │                             │  (manages state)        │
  │◀────messages────────────────┤◀────messages────────────┤
```

Both browser and proxy have full SDK `Client` instances that mirror each other's state. This creates:

- Synchronization complexity
- Duplicate state management
- Potential for state divergence
- More memory usage

### 4. OAuth Issues

**Current Flow**:

1. Browser initiates OAuth (has tokens in sessionStorage)
2. Browser needs to do discovery (fetch `/.well-known/oauth-authorization-server`)
3. Discovery fails due to CORS (browser → remote MCP server)
4. Workaround: Use proxy, but proxy's `/config` can overwrite `sseUrl` with proxy URL
5. Result: OAuth redirects to `http://localhost:6277/authorize` → 404

**Real-World Example: GitHub MCP Server**

When attempting to authenticate to the GitHub MCP server (`https://api.githubcopilot.com/mcp/`, see [github/github-mcp-server](https://github.com/github/github-mcp-server)):

```
Failed to start OAuth flow: Failed to discover OAuth metadata
```

This appears related to [issue #995](https://github.com/modelcontextprotocol/inspector/issues/995).

**Root Cause**: The SDK's `auth()` function calls `discoverOAuthProtectedResourceMetadata()` and `discoverAuthorizationServerMetadata()`, which make HTTP requests to the MCP server's well-known endpoints. In the browser, these requests are blocked by CORS because GitHub's servers don't include `Access-Control-Allow-Origin` headers for browser requests.

**Solution**: The SDK's `auth()` function accepts a `fetchFn` parameter specifically for this purpose. By providing a fetch function that routes through Node.js (via the bridge's `/api/mcp/fetch` endpoint), CORS is bypassed entirely.

### 5. Direct Connection Session ID Issues

**Real-World Example: Hosted "Everything" Server**

When connecting directly (no proxy) to `https://example-server.modelcontextprotocol.io/mcp`:

1. `initialize` POST succeeds with 200 OK
2. Server returns `mcp-session-id` header in response
3. Browser's `response.headers.get('mcp-session-id')` returns `null`
4. SDK never captures session ID
5. Subsequent `notifications/initialized` POST fails with 400 (missing session ID)

**Root Cause**: CORS security. Even though the response header is present, the browser hides it from JavaScript unless the server explicitly sends:

```
Access-Control-Expose-Headers: mcp-session-id
```

Many MCP servers don't include this header, making direct browser connections impossible.

**Workaround**: Use proxy mode, where the proxy (running in Node.js) can see all response headers.

**Solution with New Architecture**: The bridge runs in Node.js, so it sees all headers. Session management happens server-side, and the browser only communicates with the bridge.

### 6. Message Tracking Limitations

`MessageTrackingTransport` wraps the SDK transport to capture requests/responses for the History tab. Currently only works in CLI/TUI (where `InspectorClient` is used). Web client has separate tracking logic in `useConnection`.

## Proposed Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                    Vite Dev Server (Node.js)                     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Vite Plugin: MCP Transport Bridge                         │ │
│  │  /api/mcp/connect    - Create session + transport         │ │
│  │  /api/mcp/send       - Forward JSON-RPC message           │ │
│  │  /api/mcp/events     - Stream responses (SSE)             │ │
│  │  /api/mcp/disconnect - Cleanup                            │ │
│  │  /api/mcp/fetch      - Proxy HTTP for OAuth (CORS fix)    │ │
│  └────────────────┬───────────────────────────────────────────┘ │
│                   │ Creates SDK Transport (stdio/SSE/http)       │
│                   │ Forwards JSON-RPC messages only              │
│  ┌────────────────▼───────────────────────────────────────────┐ │
│  │  Static Assets (React App)                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  InspectorClient (shared with CLI/TUI)               │ │ │
│  │  │  - All protocol logic                                │ │ │
│  │  │  - State management                                  │ │ │
│  │  │  - OAuth coordination                                │ │ │
│  │  │  - Event dispatching                                 │ │ │
│  │  │  - Uses RemoteTransport (browser) or                │ │ │
│  │  │    LocalTransport (Node)                            │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────┼───────────────────────────────────────────┘
                      │ SDK Transport (stdio/SSE/streamable-http)
              ┌───────▼────────┐
              │   MCP Server   │
              └────────────────┘
```

### Key Principles

1. **Single source of truth**: `InspectorClient` runs in browser (web) or Node (CLI/TUI) with all logic
2. **Thin bridge**: Vite server only forwards JSON-RPC messages, no SDK `Client`, no state
3. **Transport abstraction**: `RemoteTransport` (browser) vs `LocalTransport` (Node) implement same interface
4. **One process**: Vite dev server handles both static assets and transport bridging

## Detailed Design

### 1. Transport Interface

The SDK's `Transport` interface is simple:

```typescript
interface Transport {
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;

  // Callbacks
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}
```

### 2. RemoteTransport (Browser)

```typescript
// shared/mcp/remoteTransport.ts
export class RemoteTransport implements Transport {
  private eventSource: EventSource | null = null;
  private sessionId: string | null = null;
  private apiBase: string; // e.g., '/api/mcp' or 'http://localhost:5173/api/mcp'
  private authToken: string; // Required for security - see Security Considerations

  constructor(
    private serverConfig: MCPServerConfig,
    options?: { apiBase?: string; authToken?: string },
  ) {
    this.apiBase = options?.apiBase || "/api/mcp";
    // Token injected by Vite in dev, or provided explicitly
    this.authToken = options?.authToken || __MCP_BRIDGE_TOKEN__;
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-mcp-bridge-auth": `Bearer ${this.authToken}`,
    };
  }

  async start(): Promise<void> {
    // Create session on Node side (creates real SDK transport there)
    const response = await fetch(`${this.apiBase}/connect`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(this.serverConfig),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized: Invalid or missing bridge auth token");
      }
      throw new Error(`Failed to connect: ${response.statusText}`);
    }

    const { sessionId } = await response.json();
    this.sessionId = sessionId;

    // Listen for messages from MCP server via SSE
    // Note: EventSource doesn't support custom headers, so we use URL param for session
    // The session itself is protected - you can't create one without auth
    this.eventSource = new EventSource(
      `${this.apiBase}/events?sessionId=${sessionId}`,
    );

    this.eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.onmessage?.(message);
    };

    this.eventSource.onerror = () => {
      this.onerror?.(new Error("SSE connection failed"));
    };
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const response = await fetch(`${this.apiBase}/send`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        sessionId: this.sessionId,
        message,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Unauthorized: Invalid or missing bridge auth token");
      }
      throw new Error(`Failed to send: ${response.statusText}`);
    }

    // Response comes via SSE, not HTTP response
  }

  async close(): Promise<void> {
    if (this.sessionId) {
      await fetch(`${this.apiBase}/disconnect`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ sessionId: this.sessionId }),
      });
    }

    this.eventSource?.close();
    this.onclose?.();
  }

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}

// Type declaration for Vite-injected token
declare const __MCP_BRIDGE_TOKEN__: string;
```

### 3. LocalTransport (Node - CLI/TUI)

```typescript
// shared/mcp/localTransport.ts
export class LocalTransport implements Transport {
  private transport: Transport;

  constructor(private serverConfig: MCPServerConfig) {
    // Create real SDK transport (stdio, SSE, streamable-http)
    this.transport = createTransport(serverConfig);
  }

  async start(): Promise<void> {
    return this.transport.start();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return this.transport.send(message);
  }

  async close(): Promise<void> {
    return this.transport.close();
  }

  // Delegate callbacks
  get onmessage() {
    return this.transport.onmessage;
  }
  set onmessage(handler) {
    this.transport.onmessage = handler;
  }

  get onerror() {
    return this.transport.onerror;
  }
  set onerror(handler) {
    this.transport.onerror = handler;
  }

  get onclose() {
    return this.transport.onclose;
  }
  set onclose(handler) {
    this.transport.onclose = handler;
  }
}
```

### 4. InspectorClient Integration

```typescript
// shared/mcp/inspectorClient.ts
export class InspectorClient {
  async connect() {
    let transport: Transport;

    if (typeof window !== "undefined") {
      // Browser: use RemoteTransport
      transport = new RemoteTransport(this.serverConfig);
    } else {
      // Node (CLI/TUI): use LocalTransport (wraps real SDK transport)
      transport = new LocalTransport(this.serverConfig);
    }

    // Optionally wrap with MessageTrackingTransport for history
    if (this.options.trackMessages) {
      transport = new MessageTrackingTransport(transport, {
        onRequest: (req) =>
          this.dispatchTypedEvent("inspectorFetchRequest", req),
        onResponse: (res) =>
          this.dispatchTypedEvent("inspectorFetchResponse", res),
      });
    }

    await this.client.connect(transport);
    // All existing InspectorClient logic continues unchanged
  }
}
```

### 5. Vite Plugin (Transport Bridge)

```typescript
// client/vite-mcp-bridge.ts
import { Plugin } from "vite";
import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createTransport } from "../shared/mcp/transport.js";

// Generate auth token (see Security Considerations section)
const bridgeToken =
  process.env.MCP_BRIDGE_TOKEN || randomBytes(32).toString("hex");

export function getBridgeToken(): string {
  return bridgeToken;
}

export function createMcpBridgePlugin(): Plugin {
  const sessions = new Map(); // sessionId → { transport }

  // Auth middleware - see Security Considerations for full implementation
  const authMiddleware = (req: any, res: any, next: () => void) => {
    if (process.env.DANGEROUSLY_OMIT_AUTH) return next();

    const authHeader = req.headers["x-mcp-bridge-auth"];
    if (!authHeader?.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const provided = Buffer.from(authHeader.substring(7));
    const expected = Buffer.from(bridgeToken);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    next();
  };

  return {
    name: "mcp-bridge",

    configureServer(server) {
      // Print token for manual use (external clients)
      console.log(`🔑 MCP Bridge token: ${bridgeToken}`);

      // Parse JSON bodies
      server.middlewares.use(express.json());

      // Apply auth to all MCP routes
      server.middlewares.use("/api/mcp", authMiddleware);

      // 1. Connect: create real SDK transport
      server.middlewares.use("/api/mcp/connect", async (req, res) => {
        try {
          const serverConfig = req.body;
          const sessionId = generateId();

          // Create the REAL transport (stdio, SSE, streamable-http)
          const transport = await createTransport(serverConfig);
          await transport.start();

          sessions.set(sessionId, { transport });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ sessionId }));
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });

      // 2. Send: forward JSON-RPC message to real transport
      server.middlewares.use("/api/mcp/send", async (req, res) => {
        const { sessionId, message } = req.body;
        const session = sessions.get(sessionId);

        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        try {
          // Forward message - response comes via transport.onmessage
          await session.transport.send(message);
          res.writeHead(200);
          res.end();
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });

      // 3. Events: stream messages from real transport to browser
      server.middlewares.use("/api/mcp/events", (req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const sessionId = url.searchParams.get("sessionId");
        const session = sessions.get(sessionId!);

        if (!session) {
          res.writeHead(404);
          res.end();
          return;
        }

        // SSE headers
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        // Forward ALL messages from transport to browser
        session.transport.onmessage = (message) => {
          res.write(`data: ${JSON.stringify(message)}\n\n`);
        };

        session.transport.onerror = (error) => {
          res.write(`event: error\n`);
          res.write(
            `data: ${JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            })}\n\n`,
          );
        };

        session.transport.onclose = () => {
          res.write(`event: close\ndata: {}\n\n`);
          res.end();
        };

        req.on("close", () => {
          // Client disconnected - cleanup
          session.transport.close();
          sessions.delete(sessionId!);
        });
      });

      // 4. Disconnect
      server.middlewares.use("/api/mcp/disconnect", async (req, res) => {
        const { sessionId } = req.body;
        const session = sessions.get(sessionId);

        if (session) {
          await session.transport.close();
          sessions.delete(sessionId);
        }

        res.writeHead(200);
        res.end();
      });

      // 5. Fetch proxy (for OAuth CORS workaround)
      server.middlewares.use("/api/mcp/fetch", async (req, res) => {
        const { url, init } = req.body;

        try {
          // Make request from Node.js (no CORS)
          const response = await fetch(url, init);
          const body = await response.text();

          res.writeHead(response.status, {
            "Content-Type":
              response.headers.get("content-type") || "text/plain",
          });
          res.end(body);
        } catch (error) {
          res.writeHead(500);
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    },
  };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}
```

### 6. OAuth Integration

OAuth coordination stays in browser (`InspectorClient`), but HTTP requests go through the bridge:

```typescript
// In InspectorClient (browser)
async authenticate() {
  const provider = new InspectorOAuthClientProvider(this.serverUrl);

  // Override fetch to use Node.js proxy (avoids CORS)
  const remoteFetch = async (url: string, init?: RequestInit) => {
    const response = await fetch('/api/mcp/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, init }),
    });
    return response;
  };

  // auth() makes HTTP requests via remoteFetch
  const result = await auth(provider, {
    serverUrl: this.serverUrl,
    scope: this.scope,
    fetchFn: remoteFetch, // Use Node.js for actual HTTP
  });

  return result;
}
```

## Feature Preservation

### 1. Message Tracking (History Tab)

**Current**: Web client tracks in `useConnection`, CLI/TUI use `MessageTrackingTransport`

**New**: All clients use `MessageTrackingTransport` wrapping their transport:

```typescript
// In InspectorClient.connect()
let transport =
  typeof window !== "undefined"
    ? new RemoteTransport(config)
    : new LocalTransport(config);

// Wrap with tracking (works for both Remote and Local)
if (this.options.trackMessages) {
  transport = new MessageTrackingTransport(transport, {
    onRequest: (req) => this.dispatchTypedEvent("inspectorFetchRequest", req),
    onResponse: (res) => this.dispatchTypedEvent("inspectorFetchResponse", res),
  });
}
```

### 2. Events and Notifications

All events continue to work because `InspectorClient` handles them:

- `progressNotification`
- `toolListChanged`
- `resourceListChanged`
- `promptListChanged`
- `loggingMessage`
- `inspectorFetchRequest` / `inspectorFetchResponse`

### 3. OAuth

- **Coordination**: Stays in browser (`InspectorClient`)
- **Discovery**: HTTP requests proxied through Node (no CORS)
- **Token storage**: Browser sessionStorage (unchanged)
- **Token usage**: Added to requests by `InspectorClient` (unchanged)

### 4. Custom Headers

Handled by `RemoteTransport` - passes serverConfig (including custom headers) to bridge, which forwards them when creating the real transport.

### 5. Progress Tracking

Works automatically - progress notifications are JSON-RPC messages that flow through the transport like any other message.

### 6. Stdio Transport

Now works in web client! The bridge creates the stdio transport in Node.js and forwards messages.

## Comparison: Current vs. Proposed

| Aspect                 | Current Proxy                                 | Proposed (Vite Bridge)             |
| ---------------------- | --------------------------------------------- | ---------------------------------- |
| **Processes**          | 2 (Vite + Proxy)                              | 1 (Vite with plugin)               |
| **Browser code**       | SDK `Client` directly (~880 lines)            | `InspectorClient` (shared)         |
| **Server code**        | Full SDK `Client` + session mgmt (~700 lines) | Message forwarder (~150 lines)     |
| **State management**   | Duplicated (browser + proxy)                  | Single (browser only)              |
| **Code sharing**       | Web separate from CLI/TUI                     | All use `InspectorClient`          |
| **OAuth**              | Browser (CORS issues)                         | Browser coord + Node HTTP          |
| **Message tracking**   | Separate logic for web                        | Unified `MessageTrackingTransport` |
| **Stdio support**      | No (web client)                               | Yes (via bridge)                   |
| **Session management** | Complex (Maps, cleanup)                       | Simple (sessionId → transport)     |
| **Authentication**     | Session token                                 | Same (can keep or simplify)        |
| **CORS headers**       | Managed by proxy                              | Managed by Vite                    |
| **Custom headers**     | Complex forwarding logic                      | Passed in config                   |

## Migration Plan

### Phase 1: Implement Transport Abstraction (Week 1-2)

**Goal**: Add `RemoteTransport` and `LocalTransport` without changing existing behavior.

**Tasks**:

1. Create `shared/mcp/remoteTransport.ts`
   - Implement `Transport` interface
   - HTTP client for `/api/mcp/*` endpoints
   - SSE listener for responses
   - Tests with mock API

2. Create `shared/mcp/localTransport.ts`
   - Thin wrapper around `createTransport()`
   - Delegates to real SDK transport
   - Tests with test servers

3. Update `InspectorClient.connect()`
   - Detect environment (`typeof window !== 'undefined'`)
   - Use `RemoteTransport` (browser) or `LocalTransport` (Node)
   - Keep all existing logic unchanged

4. Add Vite plugin: `client/vite-mcp-bridge.ts`
   - Implement `/api/mcp/connect`, `/send`, `/events`, `/disconnect`
   - Use existing `createTransport()` from shared
   - Add to `vite.config.ts`

5. Test with CLI/TUI
   - Verify `LocalTransport` works identically to current
   - Run existing test suites
   - No behavior changes expected

**Success Criteria**:

- CLI and TUI work unchanged (use `LocalTransport`)
- Vite bridge responds to API requests
- `RemoteTransport` can connect and send messages
- All existing tests pass

### Phase 2: Port Web Client to InspectorClient (Week 3-4)

**Goal**: Replace `useConnection` with `InspectorClient` in web client.

**Tasks**:

1. Update `App.tsx`
   - Replace SDK `Client` with `InspectorClient`
   - Remove manual state management (tools, resources, prompts)
   - Subscribe to `InspectorClient` events

2. Update components to use `InspectorClient`
   - `ToolsTab`: Use `client.listTools()`, `client.callTool()`
   - `ResourcesTab`: Use `client.listResources()`, `client.readResource()`
   - `PromptsTab`: Use `client.listPrompts()`, `client.getPrompt()`
   - `HistoryTab`: Subscribe to `inspectorFetchRequest`/`Response` events

3. Remove `useConnection` hook
   - Delete `client/src/lib/hooks/useConnection.ts` (~880 lines)
   - Update imports throughout web client

4. Test OAuth flows
   - Direct connection (should fail with CORS - expected)
   - Bridge connection with OAuth
   - Verify discovery works via `/api/mcp/fetch`

5. Add `/api/mcp/fetch` endpoint
   - Proxy HTTP requests from browser to avoid CORS
   - Used by OAuth discovery and token exchange

**Success Criteria**:

- Web client uses `InspectorClient` (same as CLI/TUI)
- All features work (tools, resources, prompts, OAuth, history)
- Message tracking works via `MessageTrackingTransport`
- OAuth discovery works (no CORS errors)
- Stdio servers work in web client

### Phase 3: Remove Separate Proxy (Week 5)

**Goal**: Delete `server/` directory, update documentation and scripts.

**Tasks**:

1. Remove proxy server code
   - Delete `server/src/index.ts` (~700 lines)
   - Delete `server/src/mcpProxy.ts` (~80 lines)
   - Delete `server/package.json`

2. Update npm scripts
   - Remove `dev-server` script
   - Update `dev` to just run Vite
   - Update README with new single-command startup

3. Update documentation
   - Remove proxy setup instructions
   - Document Vite bridge architecture
   - Update OAuth troubleshooting (no more proxy URL confusion)

4. Migrate any remaining proxy features
   - `/config` endpoint: Move defaults to Vite plugin or remove
   - Session token auth: **MUST maintain** - see Security Considerations
   - Origin validation: Move to Vite middleware

5. Update tests
   - Remove proxy-specific tests
   - Add bridge endpoint tests
   - Update E2E tests to use single server

**Success Criteria**:

- `npm run dev` starts everything (one command)
- No `server/` directory
- All clients (web, CLI, TUI) work
- Documentation updated
- All tests pass

### Phase 4: Polish and Optimize (Week 6)

**Goal**: Improve error handling, add features, optimize performance.

**Tasks**:

1. Error handling
   - Better error messages from bridge
   - Reconnection logic for SSE
   - Timeout handling

2. Security
   - Review auth requirements (dev vs. prod)
   - CSRF protection if needed
   - Rate limiting for API endpoints

3. Performance
   - Connection pooling for multiple MCP servers
   - Caching for discovery metadata
   - Compression for large messages

4. Developer experience
   - Better logging (bridge activity)
   - DevTools integration
   - Hot reload for bridge code

5. Production build
   - Ensure bridge works in production
   - Document deployment (single server)
   - Add production server example (Express/Fastify)

**Success Criteria**:

- Robust error handling
- Good performance (no noticeable overhead)
- Production-ready
- Excellent developer experience

## Testing Strategy

### Unit Tests

1. **RemoteTransport**
   - Mock fetch and EventSource
   - Test connect, send, close
   - Test error handling
   - Test SSE reconnection

2. **LocalTransport**
   - Test delegation to real transport
   - Test callback forwarding
   - Test with stdio, SSE, streamable-http

3. **Vite Bridge Plugin**
   - Mock Express middleware
   - Test session management
   - Test message forwarding
   - Test error responses

### Integration Tests

1. **InspectorClient with RemoteTransport**
   - Connect to test bridge
   - Call tools, list resources
   - Verify events
   - Test OAuth flow

2. **InspectorClient with LocalTransport**
   - Connect to test MCP server
   - Verify identical behavior to current
   - Test all transports (stdio, SSE, http)

3. **End-to-End**
   - Start Vite with bridge
   - Web client connects via bridge
   - Verify all features work
   - Compare to CLI/TUI behavior

### Manual Testing

1. **Web Client**
   - Connect to various MCP servers
   - Test OAuth (DCR, static client)
   - Test stdio servers
   - Verify history tab
   - Test all tabs (tools, resources, prompts)

2. **CLI/TUI**
   - Verify no regressions
   - Test all existing functionality
   - Compare output to previous version

## Risks and Mitigations

### Risk 1: Breaking Changes

**Risk**: Refactoring `InspectorClient` breaks CLI/TUI.

**Mitigation**:

- Phase 1 adds new code without changing existing
- Extensive testing before removing old code
- Keep `LocalTransport` as thin wrapper (minimal changes)

### Risk 2: Performance Overhead

**Risk**: HTTP + SSE adds latency vs. direct transport.

**Mitigation**:

- Only affects web client (CLI/TUI use direct transport)
- HTTP/2 reduces overhead
- SSE is efficient for streaming
- Measure and optimize if needed

### Risk 3: OAuth Complexity

**Risk**: OAuth via fetch proxy is more complex.

**Mitigation**:

- OAuth coordination stays in browser (unchanged)
- Only HTTP requests proxied (simple)
- Better than current (no CORS, no proxy URL confusion)

### Risk 4: Production Deployment

**Risk**: Vite plugin only works in dev.

**Mitigation**:

- Document production setup (Express/Fastify with same routes)
- Provide example production server
- Or use frameworks with built-in API routes (Next.js, SvelteKit)

## Future Enhancements

### 1. Multiple Connections

Support multiple MCP servers simultaneously:

```typescript
const client1 = new InspectorClient(config1);
const client2 = new InspectorClient(config2);
```

Each gets its own session in the bridge.

### 2. Connection Pooling

Reuse transports for same server config:

```typescript
// Bridge maintains pool of transports by config hash
const transport = pool.get(configHash) || createTransport(config);
```

### 3. Offline Support

Cache responses for offline use:

```typescript
// Service worker caches /api/mcp/send responses
// Replays when back online
```

### 4. WebSocket Alternative

For low-latency use cases:

```typescript
// Optional WebSocket transport instead of HTTP + SSE
const transport = new WebSocketTransport(config);
```

### 5. Worker Thread Bridge

Run bridge in worker thread instead of main thread:

```typescript
// Vite spawns worker for bridge
// Main thread stays responsive
```

## Security Considerations

### Critical: Transport API Protection

The `/api/mcp/*` endpoints provide access to local machine resources:

- **Stdio transport**: Can spawn arbitrary processes with environment variables
- **HTTP transports**: Can make network requests from the local machine
- **OAuth tokens**: Stored credentials could be exposed

**These endpoints MUST be protected** - without authentication, any website could use a user's browser to spawn processes or make authenticated requests.

### Current Proxy Security Model

The existing proxy (`server/src/index.ts`) implements:

1. **Session Token Authentication**

   ```typescript
   // Server generates token on startup
   const sessionToken =
     process.env.MCP_PROXY_AUTH_TOKEN || randomBytes(32).toString("hex");

   // Token printed to console for user to copy
   console.log(`🔑 Session token: ${sessionToken}`);

   // All endpoints require token via header
   const authHeader = req.headers["x-mcp-proxy-auth"]; // "Bearer <token>"
   ```

2. **Origin Validation** (DNS rebinding protection)

   ```typescript
   const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
     `http://localhost:${clientPort}`,
   ];
   if (origin && !allowedOrigins.includes(origin)) {
     res.status(403).json({ error: "Forbidden - invalid origin" });
   }
   ```

3. **Timing-Safe Token Comparison** (prevents timing attacks)

   ```typescript
   if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
     sendUnauthorized();
   }
   ```

4. **Dev Mode Escape Hatch**
   ```typescript
   const authDisabled = !!process.env.DANGEROUSLY_OMIT_AUTH;
   ```

### New Architecture Security

The Vite bridge must maintain equivalent security:

#### 1. Token Generation and Transmission

```typescript
// vite-mcp-bridge.ts
import { randomBytes, timingSafeEqual } from "node:crypto";

const bridgeToken =
  process.env.MCP_BRIDGE_TOKEN || randomBytes(32).toString("hex");

// Print token for user (same as current proxy)
console.log(`🔑 MCP Bridge token: ${bridgeToken}`);

// In dev, Vite can inject token into client bundle
export function getBridgeToken(): string {
  return bridgeToken;
}
```

#### 2. Authentication Middleware

```typescript
function authMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  if (process.env.DANGEROUSLY_OMIT_AUTH) {
    return next();
  }

  const authHeader = req.headers["x-mcp-bridge-auth"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const providedToken = authHeader.substring(7);
  const providedBuffer = Buffer.from(providedToken);
  const expectedBuffer = Buffer.from(bridgeToken);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  next();
}
```

#### 3. Origin Validation

```typescript
function originMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const origin = req.headers.origin;
  const clientPort = process.env.CLIENT_PORT || "5173";
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    `http://localhost:${clientPort}`,
    `http://127.0.0.1:${clientPort}`,
  ];

  if (origin && !allowedOrigins.includes(origin)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Forbidden - invalid origin" }));
    return;
  }

  next();
}
```

#### 4. Apply to All MCP Endpoints

```typescript
// In Vite plugin configureServer()
const protectedRoutes = [
  "/api/mcp/connect",
  "/api/mcp/send",
  "/api/mcp/events",
  "/api/mcp/disconnect",
  "/api/mcp/fetch",
];

for (const route of protectedRoutes) {
  server.middlewares.use(route, originMiddleware);
  server.middlewares.use(route, authMiddleware);
}
```

### Token Injection for Browser Client

In development, Vite can inject the token so the user doesn't need to copy/paste:

```typescript
// vite.config.ts
export default defineConfig({
  define: {
    __MCP_BRIDGE_TOKEN__: JSON.stringify(getBridgeToken()),
  },
});

// In browser code
const token = __MCP_BRIDGE_TOKEN__;
fetch("/api/mcp/connect", {
  headers: { "x-mcp-bridge-auth": `Bearer ${token}` },
  // ...
});
```

For production builds or external clients, the token must be provided out-of-band (console output, environment variable, etc.).

### Security Comparison

| Aspect              | Current Proxy              | New Bridge          |
| ------------------- | -------------------------- | ------------------- |
| Token generation    | ✅ `randomBytes(32)`       | ✅ Same             |
| Token header        | `x-mcp-proxy-auth`         | `x-mcp-bridge-auth` |
| Timing-safe compare | ✅ `timingSafeEqual`       | ✅ Same             |
| Origin validation   | ✅ `ALLOWED_ORIGINS`       | ✅ Same             |
| Dev escape hatch    | ✅ `DANGEROUSLY_OMIT_AUTH` | ✅ Same             |
| Token injection     | ❌ Manual copy             | ✅ Vite `define`    |

### Additional Considerations

1. **Stdio Command Validation**: Consider validating/allowlisting commands that can be spawned via stdio transport.

2. **Rate Limiting**: Protect against resource exhaustion (too many connections, too many spawned processes).

3. **Session Cleanup**: Ensure stdio processes and connections are cleaned up on disconnect/timeout.

4. **HTTPS in Production**: Token transmitted in header should be over HTTPS in production to prevent interception.

5. **Token Rotation**: Consider token rotation for long-running development sessions.

## Conclusion

This design:

- ✅ Unifies all clients to use `InspectorClient`
- ✅ Eliminates separate proxy server (one process)
- ✅ Solves CORS and stdio limitations
- ✅ Preserves all existing functionality
- ✅ Reduces code duplication (~1500 lines removed)
- ✅ Improves maintainability (single code path)
- ✅ Better OAuth (no proxy URL confusion)
- ✅ Enables stdio in web client

The migration is incremental and low-risk, with clear phases and success criteria.
