# Web Client Port to InspectorClient - Step-by-Step Plan

## Overview

This document provides a step-by-step plan for porting the `web/` application to use `InspectorClient` instead of `useConnection`, integrating the Hono remote API server directly into Vite (eliminating the separate Express server), and ensuring functional parity with the existing `client/` application.

**Goal:** The `web/` app should function identically to `client/` but use `InspectorClient` and the integrated Hono server instead of `useConnection` and the separate Express proxy.

## Progress Summary

- ✅ **Phase 1:** Integrate Hono Server into Vite - **COMPLETE**
- ✅ **Phase 2:** Create Web Client Adapter - **COMPLETE**
- ✅ **Phase 3:** Replace useConnection with InspectorClient - **COMPLETE** (All steps complete)
- ⏸️ **Phase 4:** OAuth Integration - **NOT STARTED**
- ⏸️ **Phase 5:** Remove Express Server Dependency - **PARTIALLY COMPLETE** (Step 5.3 done: `/config` endpoint replaced with HTML injection)
- ⏸️ **Phase 6:** Testing and Validation - **NOT STARTED**
- ⏸️ **Phase 7:** Cleanup - **NOT STARTED**

**Current Status:** Core InspectorClient integration complete. All Phase 3 steps finished. Remaining work: OAuth integration (Phase 4), Express proxy removal (Phase 5), testing and cleanup.

**Reference Documents:**

- [Environment Isolation](./environment-isolation.md) - Details on remote infrastructure and seams
- [Shared Code Architecture](./shared-code-architecture.md) - High-level architecture and integration strategy
- [TUI Web Client Feature Gaps](./tui-web-client-feature-gaps.md) - Feature comparison

---

## Phase 1: Integrate Hono Server into Vite ✅ COMPLETE

**Goal:** Integrate the Hono remote API server into Vite (dev) and create a production server, making `/api/*` endpoints available. The web app will continue using the existing proxy/useConnection during this phase, allowing us to validate that the new API endpoints are working before migrating the app to use them.

**Status:** ✅ Complete - Hono server integrated into Vite dev mode and production server created. Both Express proxy and Hono server run simultaneously.

**Validation:** After Phase 1, you should be able to:

- Start the dev server: Vite serves static files + Hono middleware handles `/api/*` routes, Express proxy runs separately
- Start the production server: Hono server (`bin/server.js`) serves static files + `/api/*` routes, Express proxy runs separately
- The existing web app continues to work normally in both dev and prod (still uses Express proxy for API calls)
- Hono endpoints (`/api/*`) are available and can be tested, but web app doesn't use them yet

---

### Step 1.1: Create Vite Plugin for Hono Middleware ✅ COMPLETE

**File:** `web/vite.config.ts`

**Status:** ✅ Complete

Create a Vite plugin that adds Hono middleware to handle `/api/*` routes. This runs alongside the existing Express proxy server (which the web app still uses).

**As-Built:**

- Implemented `honoMiddlewarePlugin` that mounts Hono middleware at root and checks for `/api` prefix
- Fixed Connect middleware path stripping issue by mounting at root and checking path manually
- Auth token passed via `process.env.MCP_REMOTE_AUTH_TOKEN` (read-only, set by start script)

```typescript
import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRemoteApp } from "@modelcontextprotocol/inspector-shared/mcp/remote/node";
import { randomBytes } from "node:crypto";
import type { ConnectMiddleware } from "vite";

function honoMiddlewarePlugin(authToken: string): Plugin {
  return {
    name: "hono-api-middleware",
    configureServer(server) {
      // createRemoteApp returns { app, authToken } - we pass authToken explicitly
      // If not provided, it will read from env or generate one
      const { app: honoApp, authToken: resolvedAuthToken } = createRemoteApp({
        authToken, // Pass token explicitly (from start script)
        storageDir: process.env.MCP_STORAGE_DIR,
        allowedOrigins: [
          `http://localhost:${process.env.CLIENT_PORT || "6274"}`,
          `http://127.0.0.1:${process.env.CLIENT_PORT || "6274"}`,
        ],
        logger: process.env.MCP_LOG_FILE
          ? createFileLogger({ logPath: process.env.MCP_LOG_FILE })
          : undefined,
      });

      // Store resolved token for potential use (though we already have it)
      // This ensures we use the same token that createRemoteApp is using
      const finalAuthToken = authToken || resolvedAuthToken;

      // Convert Connect middleware to handle Hono app
      const honoMiddleware: ConnectMiddleware = async (req, res, next) => {
        try {
          // Convert Node req/res to Web Standard Request
          const url = `http://${req.headers.host}${req.url}`;
          const headers = new Headers();
          Object.entries(req.headers).forEach(([key, value]) => {
            if (value) {
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            }
          });

          const init: RequestInit = {
            method: req.method,
            headers,
          };

          // Handle body for non-GET requests
          if (req.method !== "GET" && req.method !== "HEAD") {
            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(chunk));
            await new Promise<void>((resolve) => {
              req.on("end", () => resolve());
            });
            if (chunks.length > 0) {
              init.body = Buffer.concat(chunks);
            }
          }

          const request = new Request(url, init);
          const response = await honoApp.fetch(request);

          // Convert Web Standard Response back to Node res
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          if (response.body) {
            const reader = response.body.getReader();
            const pump = async () => {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
              } else {
                res.write(Buffer.from(value));
                await pump();
              }
            };
            await pump();
          } else {
            res.end();
          }
        } catch (error) {
          next(error);
        }
      };

      server.middlewares.use("/api", honoMiddleware);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    // Auth token is passed via env var (read-only, set by start script)
    // Vite plugin reads it and passes explicitly to createRemoteApp
    honoMiddlewarePlugin(process.env.MCP_REMOTE_AUTH_TOKEN || ""),
  ],
  // ... rest of config
});
```

**Dependencies needed:**

- `@modelcontextprotocol/inspector-shared` (already in workspace)
- `node:crypto` for `randomBytes`

**Auth Token Handling:**

The auth token flow:

1. **Start script (`bin/start.js`)**: Reads `process.env.MCP_REMOTE_AUTH_TOKEN` or generates one
2. **Vite plugin**: Receives token via env var (read-only, passed to spawned process). Plugin reads it and passes explicitly to `createRemoteApp()`
3. **Client browser**: Receives token via URL params (`?MCP_REMOTE_AUTH_TOKEN=...`)

**Key principle:** We never write to `process.env` to pass values between our own code. The token is:

- Generated/read once in the start script
- Passed explicitly to Vite via env var (read-only, for the spawned process)
- Passed explicitly to `createRemoteApp()` via function parameter
- Passed to client via URL params

**Testing:**

- Start dev server: `npm run dev` (this will start both Vite with Hono middleware AND the Express proxy)
- Verify `/api/mcp/connect` endpoint responds (should return 401 without auth token)
  - Test: `curl http://localhost:6274/api/mcp/connect` (should return 401)
- Verify `/api/fetch` endpoint exists: `curl http://localhost:6274/api/fetch`
- Verify `/api/log` endpoint exists: `curl http://localhost:6274/api/log`
- Check browser console for errors (should be none - web app still uses Express proxy)
- Verify auth token is passed to client via URL params (for future use)
- **Important:** The web app should still work normally using the Express proxy - we're just validating the new endpoints exist

---

### Step 1.2: Create Production Server ✅ COMPLETE

**File:** `web/bin/server.js` (new file)

**Status:** ✅ Complete

Create a production server that serves static files and API routes:

**As-Built:**

- Created `web/bin/server.js` that serves static files and routes `/api/*` to `apiApp`
- Static files served without authentication, API routes require auth token
- Auth token read from `process.env.MCP_REMOTE_AUTH_TOKEN`

```typescript
#!/usr/bin/env node

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createRemoteApp } from "@modelcontextprotocol/inspector-shared/mcp/remote/node";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "node:crypto";
import { createFileLogger } from "@modelcontextprotocol/inspector-shared/mcp/node/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "../dist");

const app = new Hono();

// Read auth token from env (provided by start script via spawn env)
// createRemoteApp will use this, or generate one if not provided
// The token is passed explicitly from start script, not written to process.env
const authToken =
  process.env.MCP_REMOTE_AUTH_TOKEN || randomBytes(32).toString("hex");

// Note: createRemoteApp returns the authToken it uses, so we could also
// let it generate one and return it, but for consistency we generate/read it here

// Add API routes first (more specific)
const port = parseInt(process.env.CLIENT_PORT || "6274", 10);
const host = process.env.HOST || "localhost";
const baseUrl = `http://${host}:${port}`;

const { app: apiApp } = createRemoteApp({
  authToken,
  storageDir: process.env.MCP_STORAGE_DIR,
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || [baseUrl],
  logger: process.env.MCP_LOG_FILE
    ? createFileLogger({ logPath: process.env.MCP_LOG_FILE })
    : undefined,
});
app.route("/api", apiApp);

// Then add static file serving (fallback for SPA routing)
app.use(
  "/*",
  serveStatic({
    root: distPath,
    rewriteRequestPath: (path) => {
      // If path doesn't exist and doesn't have extension, serve index.html (SPA routing)
      if (!path.includes(".") && !path.startsWith("/api")) {
        return "/index.html";
      }
      return path;
    },
  }),
);

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(
      `\n🚀 MCP Inspector Web is up and running at:\n   http://${host}:${info.port}\n`,
    );
    console.log(`   Auth token: ${authToken}\n`);
  },
);
```

**Update `web/package.json`:**

- Add `start` script: `"start": "node bin/server.js"`
- Ensure `bin/server.js` is executable (chmod +x)

**Dependencies needed:**

- `@hono/node-server` (add to `web/package.json`)

**Testing:**

- Build: `npm run build`
- Start: `npm start` (via `bin/start.js` - starts Hono server for static files + `/api/*` endpoints, AND Express proxy)
- Verify static files serve correctly: `curl http://localhost:6274/` (should return index.html from Hono server)
- Verify `/api/mcp/connect` endpoint works: `curl http://localhost:6274/api/mcp/connect` (should return 401)
- Verify `/api/fetch` endpoint exists: `curl http://localhost:6274/api/fetch`
- Verify `/api/log` endpoint exists: `curl http://localhost:6274/api/log`
- Verify auth token is logged/available
- **Note:** Both Hono server (serving static files) and Express proxy run simultaneously. Web app uses Express proxy for API calls, but static files come from Hono server.

---

### Step 1.3: Update Start Script (Keep Express Proxy for Now) ✅ COMPLETE

**File:** `web/bin/start.js`

**Status:** ✅ Complete

**Important:** During Phase 1, both servers run:

**As-Built:**

- Start script generates both `proxySessionToken` (for Express) and `honoAuthToken` (for Hono)
- Tokens passed explicitly via environment variables (for spawned processes) and URL params (for browser)
- Both Express proxy and Vite/Hono server run simultaneously in dev/prod mode

- **Hono server**: Serves static files (dev: via Vite middleware, prod: via `bin/server.js`) + `/api/*` endpoints
- **Express proxy**: Handles web app API calls (`/mcp`, `/stdio`, `/sse`, etc.)
- Web app loads static files from Hono server but makes API calls to Express proxy

**Changes:**

1. **Keep server spawning functions (for now):**
   - Keep `startDevServer()` function (spawns Express proxy)
   - Keep `startProdServer()` function (spawns Express proxy)
   - Both Hono (via Vite middleware) and Express will run simultaneously in dev mode

2. **Update `startDevClient()` to pass auth token to Vite:**

   ```typescript
   async function startDevClient(clientOptions) {
     const { CLIENT_PORT, honoAuthToken, abort, cancelled } = clientOptions;
     const clientCommand = "npx";
     const host = process.env.HOST || "localhost";
     const clientArgs = ["vite", "--port", CLIENT_PORT, "--host", host];

     const client = spawn(clientCommand, clientArgs, {
       cwd: resolve(__dirname, ".."),
       env: {
         ...process.env,
         CLIENT_PORT,
         MCP_REMOTE_AUTH_TOKEN: honoAuthToken, // Pass token to Vite (read-only)
         // Note: Express proxy still uses MCP_PROXY_AUTH_TOKEN (different token)
       },
       signal: abort.signal,
       echoOutput: true,
     });

     // Include auth token in URL for client (Phase 3 will use this)
     const params = new URLSearchParams();
     params.set("MCP_REMOTE_AUTH_TOKEN", honoAuthToken);
     const url = `http://${host}:${CLIENT_PORT}/?${params.toString()}`;

     setTimeout(() => {
       console.log(`\n🚀 MCP Inspector Web is up and running at:\n   ${url}\n`);
       console.log(
         `   Static files served by: Vite (dev) / Hono server (prod)\n`,
       );
       console.log(`   Hono API endpoints: ${url}/api/*\n`);
       console.log(
         `   Express proxy: http://localhost:${SERVER_PORT} (web app API calls)\n`,
       );
       if (process.env.MCP_AUTO_OPEN_ENABLED !== "false") {
         console.log("🌐 Opening browser...");
         open(url);
       }
     }, 3000);

     await new Promise((resolve) => {
       client.subscribe({
         complete: resolve,
         error: (err) => {
           if (!cancelled || process.env.DEBUG) {
             console.error("Client error:", err);
           }
           resolve(null);
         },
         next: () => {},
       });
     });
   }
   ```

   **Note:** In dev mode, both servers run:
   - Express proxy: `http://localhost:6277` (web app uses this)
   - Hono API (via Vite): `http://localhost:6274/api/*` (available for validation)

3. **Update `startProdClient()` - Use Hono server for static files:**

   ```typescript
   async function startProdClient(clientOptions) {
     const { CLIENT_PORT, honoAuthToken, abort } = clientOptions;
     const honoServerPath = resolve(__dirname, "bin", "server.js");

     // Hono server serves static files + /api/* endpoints
     // Pass auth token explicitly via env var (read-only, server reads it)
     await spawnPromise("node", [honoServerPath], {
       env: {
         ...process.env,
         CLIENT_PORT,
         MCP_REMOTE_AUTH_TOKEN: honoAuthToken, // Pass token explicitly
       },
       signal: abort.signal,
       echoOutput: true,
     });
   }
   ```

   **Note:** In Phase 1, prod mode uses Hono server to serve static files (just like Vite does in dev mode). Express proxy still runs separately for API calls. Web app loads static files from Hono server but makes API calls to Express proxy. Auth token is passed explicitly via env var (read-only).

4. **Update `main()` function to run both servers in dev mode:**

   ```typescript
   async function main() {
     // ... parse args (same as before) ...

     const CLIENT_PORT = process.env.CLIENT_PORT ?? "6274";
     const SERVER_PORT =
       process.env.SERVER_PORT ?? DEFAULT_MCP_PROXY_LISTEN_PORT;

     // Generate auth tokens (separate tokens for Express proxy and Hono API)
     const proxySessionToken =
       process.env.MCP_PROXY_AUTH_TOKEN || randomBytes(32).toString("hex");
     const honoAuthToken =
       process.env.MCP_REMOTE_AUTH_TOKEN || randomBytes(32).toString("hex");

     const abort = new AbortController();
     let cancelled = false;
     process.on("SIGINT", () => {
       cancelled = true;
       abort.abort();
     });

     let server, serverOk;

     if (isDev) {
       // In dev mode: start Express proxy (web app uses this) AND Vite with Hono middleware
       try {
         const serverOptions = {
           SERVER_PORT,
           CLIENT_PORT,
           sessionToken: proxySessionToken,
           envVars,
           abort,
           command,
           mcpServerArgs,
           transport,
           serverUrl,
         };

         const result = await startDevServer(serverOptions);
         server = result.server;
         serverOk = result.serverOk;
       } catch (error) {
         // Continue even if Express proxy fails - Hono API still works
         console.warn("Express proxy failed to start:", error);
         serverOk = false;
       }

       if (serverOk) {
         // Start Vite with Hono middleware (runs alongside Express proxy)
         try {
           const clientOptions = {
             CLIENT_PORT,
             SERVER_PORT,
             honoAuthToken, // Pass Hono auth token explicitly
             abort,
             cancelled,
           };
           await startDevClient(clientOptions);
         } catch (e) {
           if (!cancelled || process.env.DEBUG) throw e;
         }
       }
     } else {
       // In prod mode: start Express proxy (web app uses this) AND Hono server
       try {
         const serverOptions = {
           SERVER_PORT,
           CLIENT_PORT,
           sessionToken: proxySessionToken,
           envVars,
           abort,
           command,
           mcpServerArgs,
           transport,
           serverUrl,
         };

         const result = await startProdServer(serverOptions);
         server = result.server;
         serverOk = result.serverOk;
       } catch (error) {
         console.warn("Express proxy failed to start:", error);
         serverOk = false;
       }

       if (serverOk) {
         // Start Hono server (serves static files + /api/* endpoints)
         try {
           const clientOptions = {
             CLIENT_PORT,
             honoAuthToken, // Pass token explicitly
             abort,
             cancelled,
           };
           await startProdClient(clientOptions);
         } catch (e) {
           if (!cancelled || process.env.DEBUG) throw e;
         }
       }

       // Both servers run:
       // - Hono server (via startProdClient) serves static files + /api/* endpoints
       // - Express proxy (via startProdServer) handles web app API calls
     }

     return 0;
   }
   ```

   **Key points:**
   - In dev mode: Both Express proxy (port 6277) and Hono API (port 6274/api/\*) run simultaneously
   - Web app continues using Express proxy (no changes needed yet)
   - Hono API endpoints are available for validation/testing
   - Separate auth tokens: `MCP_PROXY_AUTH_TOKEN` (Express) and `MCP_REMOTE_AUTH_TOKEN` (Hono)

---

## Phase 2: Create Web Client Adapter ✅ COMPLETE

### Step 2.1: Create Config to MCPServerConfig Adapter ✅ COMPLETE

**File:** `web/src/lib/adapters/configAdapter.ts` (new file)

**Status:** ✅ Complete

**Existing Code Reference:**

- `client/src/components/Sidebar.tsx` has `generateServerConfig()` (lines 137-160) that converts web client format, but it's missing `type: "stdio"` and doesn't handle `customHeaders`
- `shared/mcp/node/config.ts` has `argsToMcpServerConfig()` for CLI format, but not web client format

Create an adapter that converts the web client's configuration format to `MCPServerConfig`:

```typescript
import type { MCPServerConfig } from "@modelcontextprotocol/inspector-shared/mcp/types";
import type { CustomHeaders } from "../types/customHeaders";

export function webConfigToMcpServerConfig(
  transportType: "stdio" | "sse" | "streamable-http",
  command?: string,
  args?: string,
  sseUrl?: string,
  env?: Record<string, string>,
  customHeaders?: CustomHeaders,
): MCPServerConfig {
  switch (transportType) {
    case "stdio": {
      if (!command) {
        throw new Error("Command is required for stdio transport");
      }
      const config: MCPServerConfig = {
        type: "stdio",
        command,
      };
      if (args?.trim()) {
        config.args = args.split(/\s+/);
      }
      if (env && Object.keys(env).length > 0) {
        config.env = env;
      }
      return config;
    }
    case "sse": {
      if (!sseUrl) {
        throw new Error("SSE URL is required for SSE transport");
      }
      const headers: Record<string, string> = {};
      customHeaders?.forEach((header) => {
        if (header.enabled) {
          headers[header.name] = header.value;
        }
      });
      const config: MCPServerConfig = {
        type: "sse",
        url: sseUrl,
      };
      if (Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      return config;
    }
    case "streamable-http": {
      if (!sseUrl) {
        throw new Error("Server URL is required for streamable-http transport");
      }
      const headers: Record<string, string> = {};
      customHeaders?.forEach((header) => {
        if (header.enabled) {
          headers[header.name] = header.value;
        }
      });
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: sseUrl,
      };
      if (Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      return config;
    }
  }
}
```

**Note:** This is similar to `generateServerConfig()` in `Sidebar.tsx` but:

- Adds `type: "stdio"` for stdio transport
- Converts `customHeaders` array to `headers` object (only enabled headers)
- Returns proper `MCPServerConfig` type (no `note` field)

---

### Step 2.2: Create Environment Factory ✅ COMPLETE

**File:** `web/src/lib/adapters/environmentFactory.ts` (new file)

**Status:** ✅ Complete

Create a factory function that builds the `InspectorClientEnvironment` object:

**As-Built:**

- Fixed "Illegal invocation" error by wrapping `window.fetch` to preserve `this` context: `const fetchFn: typeof fetch = (...args) => globalThis.fetch(...args)`
- Uses `BrowserOAuthStorage` and `BrowserNavigation` for OAuth
- `redirectUrlProvider` consistently returns `/oauth/callback` regardless of mode (mode stored in state, not URL)

```typescript
import type { InspectorClientEnvironment } from "@modelcontextprotocol/inspector-shared/mcp/inspectorClient";
import { createRemoteTransport } from "@modelcontextprotocol/inspector-shared/mcp/remote/createRemoteTransport";
import { createRemoteFetch } from "@modelcontextprotocol/inspector-shared/mcp/remote/createRemoteFetch";
import { createRemoteLogger } from "@modelcontextprotocol/inspector-shared/mcp/remote/createRemoteLogger";
import { BrowserOAuthStorage } from "@modelcontextprotocol/inspector-shared/auth/browser";
import { BrowserNavigation } from "@modelcontextprotocol/inspector-shared/auth/browser";
import type { RedirectUrlProvider } from "@modelcontextprotocol/inspector-shared/auth/types";

export function createWebEnvironment(
  authToken: string | undefined,
  redirectUrlProvider: RedirectUrlProvider,
): InspectorClientEnvironment {
  const baseUrl = `${window.location.protocol}//${window.location.host}`;

  return {
    transport: createRemoteTransport({
      baseUrl,
      authToken,
      fetchFn: window.fetch,
    }),
    fetch: createRemoteFetch({
      baseUrl,
      authToken,
      fetchFn: window.fetch,
    }),
    logger: createRemoteLogger({
      baseUrl,
      authToken,
      fetchFn: window.fetch,
    }),
    oauth: {
      storage: new BrowserOAuthStorage(), // or RemoteOAuthStorage for shared state
      navigation: new BrowserNavigation(),
      redirectUrlProvider,
    },
  };
}
```

**Note:** Consider using `RemoteOAuthStorage` if you want shared OAuth state with TUI/CLI. The auth token should come from the Hono server (same token used to create the server).

---

## Phase 3: Replace useConnection with InspectorClient ⏳ IN PROGRESS

### Step 3.1: Understand useInspectorClient Interface ✅ COMPLETE

**Reference:** `shared/react/useInspectorClient.ts`

**Status:** ✅ Complete - Hook interface understood and used throughout implementation

The `useInspectorClient` hook returns:

```typescript
interface UseInspectorClientResult {
  status: ConnectionStatus; // 'disconnected' | 'connecting' | 'connected' | 'error'
  messages: MessageEntry[];
  stderrLogs: StderrLogEntry[];
  fetchRequests: FetchRequestEntry[];
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  client: Client | null; // The underlying MCP SDK Client
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}
```

**Note:** The hook uses `status` (not `connectionStatus`). You'll need to map this when replacing `useConnection` calls in components.

---

### Step 3.2: Update App.tsx to Use InspectorClient ✅ COMPLETE

**File:** `web/src/App.tsx`

**Status:** ✅ Complete

**Changes:**

**As-Built:**

- Removed local state syncing (`useEffect` blocks) for resources, prompts, tools, resourceTemplates
- Removed local state declarations - now using hook values directly (`inspectorResources`, `inspectorPrompts`, `inspectorTools`, `inspectorResourceTemplates`)
- Updated all component props to use hook values
- InspectorClient instance created in `useMemo` with proper dependencies
- Auth token extracted from URL params (`MCP_REMOTE_AUTH_TOKEN`)
- `useInspectorClient` hook used to get all state and methods

1. **Replace imports:**

   ```typescript
   // Remove
   import { useConnection } from "./lib/hooks/useConnection";

   // Add
   import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/inspectorClient";
   import { useInspectorClientWeb } from "./lib/hooks/useInspectorClientWeb";
   import { createWebEnvironment } from "./lib/adapters/environmentFactory";
   import { webConfigToMcpServerConfig } from "./lib/adapters/configAdapter";
   ```

2. **Get auth token and create InspectorClient instance:**

   ```typescript
   // Get auth token from URL params (set by start script) or localStorage
   const authToken = useMemo(() => {
     const params = new URLSearchParams(window.location.search);
     return params.get("MCP_REMOTE_AUTH_TOKEN") || null;
   }, []);

   const inspectorClient = useMemo(() => {
     if (!command && !sseUrl) return null; // Can't create without config
     if (!authToken) return null; // Need auth token for remote API

     const config = webConfigToMcpServerConfig(
       transportType,
       command,
       args,
       sseUrl,
       env,
       customHeaders,
     );

     const environment = createWebEnvironment(authToken, () => {
       return `${window.location.origin}/oauth/callback`;
     });

     return new InspectorClient(config, {
       environment,
       autoFetchServerContents: true, // Match current behavior
       maxMessages: 1000,
       maxStderrLogEvents: 1000,
       maxFetchRequests: 1000,
       oauth: {
         clientId: oauthClientId || undefined,
         clientSecret: oauthClientSecret || undefined,
         scope: oauthScope || undefined,
       },
     });
   }, [
     transportType,
     command,
     args,
     sseUrl,
     env,
     customHeaders,
     oauthClientId,
     oauthClientSecret,
     oauthScope,
     authToken,
   ]);
   ```

3. **Replace useConnection hook:**

   ```typescript
   // Remove
   const { connectionStatus, ... } = useConnection({ ... });

   // Add
   const {
     status: connectionStatus,  // Map 'status' to 'connectionStatus' for compatibility
     tools,
     resources,
     prompts,
     messages,
     stderrLogs,
     fetchRequests,
     capabilities,
     serverInfo,
     instructions,
     client: mcpClient,
     connect: connectMcpServer,
     disconnect: disconnectMcpServer,
   } = useInspectorClient(inspectorClient);
   ```

4. **Update connect/disconnect handlers:**

   ```typescript
   // These are now provided by useInspectorClient hook:
   // connectMcpServer and disconnectMcpServer are already available from the hook
   // No need to create separate handlers unless you need custom logic
   ```

5. **Update OAuth handlers:**
   - Replace `useConnection` OAuth methods with `InspectorClient` methods:
     - `authenticate()` → `inspectorClient.authenticate()`
     - `completeOAuthFlow()` → `inspectorClient.completeOAuthFlow()`
     - `getOAuthTokens()` → `inspectorClient.getOAuthTokens()`

---

### Step 3.3: Migrate State Format ✅ COMPLETE

**File:** `web/src/App.tsx`

**Status:** ✅ Complete

**Changes:**

1. **Message History:** ✅ Complete
   - **As-Built:** `requestHistory` now uses MCP protocol messages from `inspectorMessages`
   - Filters `inspectorMessages` for `direction === "request"` (non-notification messages)
   - Converts to format: `{ request: string, response?: string }[]` for `HistoryAndNotifications` component
   - **Note:** History tab shows MCP protocol messages (requests/responses), not HTTP requests

2. **Request History:** ✅ Complete
   - **As-Built:** Not using `FetchRequestEntry[]` - instead using MCP protocol messages for History tab
   - `fetchRequests` removed from hook destructuring (not needed for current UI)

3. **Stderr Logs:** ✅ Complete
   - `stderrLogs` destructured from hook and passed to `ConsoleTab`
   - `ConsoleTab` displays `StderrLogEntry[]` with timestamps and messages
   - **As-Built:** Console tab trigger added to UI, only shown when `transportType === "stdio"` (since stderr logs are only available for stdio transports)
   - Console tab added to valid tabs list for routing

4. **Server Data:** ✅ Complete
   - Tools, Resources, Prompts: Using hook values directly (`inspectorTools`, `inspectorResources`, `inspectorPrompts`)
   - Manual fetching logic removed - InspectorClient handles this automatically

---

### Step 3.4: Update Notification Handlers ✅ COMPLETE

**File:** `web/src/App.tsx`

**Status:** ✅ Complete

**Changes:**

1. **Replace notification callbacks:** ✅ Complete
   - **As-Built:** Notifications extracted from `inspectorMessages` via `useEffect`:
     ```typescript
     const notifications = inspectorMessages
       .filter((msg) => msg.direction === "notification" && msg.message)
       .map((msg) => msg.message as ServerNotification);
     ```
   - No separate event listeners needed - notifications come from message stream

2. **Update request handlers:** ✅ Complete
   - **Elicitation:** ✅ Complete - Using `inspectorClient.addEventListener("newPendingElicitation", ...)`
   - **Sampling:** ✅ Complete - Using `inspectorClient.addEventListener("newPendingSample", ...)`
   - **Roots:** ✅ Complete - Using `inspectorClient.getRoots()`, `inspectorClient.setRoots()`, and listening to `rootsChange` event
     - `handleRootsChange()` calls `inspectorClient.setRoots(roots)` which handles sending notification internally
     - Roots synced with InspectorClient via `useEffect` and `rootsChange` event listener

3. **Stderr Logs:** ✅ Complete
   - **As-Built:** `stderrLogs` destructured from `useInspectorClient` hook
   - `ConsoleTab` component updated to accept and display `StderrLogEntry[]`
   - Displays timestamp and message for each stderr log entry
   - Shows "No stderr output yet" when empty

---

### Step 3.5: Update Method Calls ✅ COMPLETE

**File:** `web/src/App.tsx` and component files

**Status:** ✅ Complete

**Changes:**

Replace all `mcpClient` method calls with `inspectorClient` methods:

**As-Built:**

- ✅ `listResources()` → `inspectorClient.listResources(cursor, metadata)`
- ✅ `listResourceTemplates()` → `inspectorClient.listResourceTemplates(cursor, metadata)`
- ✅ `readResource()` → `inspectorClient.readResource(uri, metadata)`
- ✅ `subscribeToResource()` → `inspectorClient.subscribeToResource(uri)`
- ✅ `unsubscribeFromResource()` → `inspectorClient.unsubscribeFromResource(uri)`
- ✅ `listPrompts()` → `inspectorClient.listPrompts(cursor, metadata)`
- ✅ `getPrompt()` → `inspectorClient.getPrompt(name, args, metadata)` (with JsonValue conversion)
- ✅ `listTools()` → `inspectorClient.listTools(cursor, metadata)`
- ✅ `callTool()` → `inspectorClient.callTool(name, args, generalMetadata, toolSpecificMetadata)` (with ToolCallInvocation → CompatibilityCallToolResult conversion)
- ✅ `sendLogLevelRequest()` → `inspectorClient.setLoggingLevel(level)`
- ✅ Ping → `mcpClient.request({ method: "ping" }, EmptyResultSchema)` (direct SDK call)
- ✅ Removed `sendMCPRequest()` wrapper function
- ✅ Removed `makeRequest()` wrapper function
- ✅ All methods include proper error handling with `clearError()` calls

---

## Phase 4: OAuth Integration

### Step 4.1: Understand Current OAuth Callback Flow

**Current Architecture:**

1. **OAuth callback is NOT served by the proxy server** - it's handled entirely by the web app via React Router
2. **OAuth provider redirects to:** `http://localhost:6274/oauth/callback?code=...`
3. **React Router handles the route:** `App.tsx` checks `window.location.pathname === "/oauth/callback"` and renders `OAuthCallback` component
4. **Current callback processing:** Uses `InspectorOAuthClientProvider` + SDK's `auth()` function, which makes requests to the proxy server's `/mcp` endpoint

**After Porting:**

- Same route handling (React Router still catches `/oauth/callback`)
- Replace `InspectorOAuthClientProvider` + `auth()` with `InspectorClient.completeOAuthFlow()`
- Redirect URL remains: `window.location.origin + "/oauth/callback"` (provided by `redirectUrlProvider` in environment)

---

### Step 4.2: Update OAuth Callback Component

**File:** `web/src/components/OAuthCallback.tsx`

**Changes:**

1. **Remove dependency on `InspectorOAuthClientProvider` and SDK `auth()`:**

   ```typescript
   // Remove
   import { InspectorOAuthClientProvider } from "../lib/auth";
   import { auth } from "@modelcontextprotocol/sdk/client/auth";

   // The component will receive inspectorClient as a prop instead
   ```

2. **Update component to use InspectorClient:**

   ```typescript
   interface OAuthCallbackProps {
     inspectorClient: InspectorClient | null;
     onConnect: () => void;
   }

   const OAuthCallback = ({ inspectorClient, onConnect }: OAuthCallbackProps) => {
     const { toast } = useToast();
     const hasProcessedRef = useRef(false);

     useEffect(() => {
       const handleCallback = async () => {
         if (hasProcessedRef.current || !inspectorClient) return;
         hasProcessedRef.current = true;

         const notifyError = (description: string) =>
           void toast({
             title: "OAuth Authorization Error",
             description,
             variant: "destructive",
           });

         const params = parseOAuthCallbackParams(window.location.search);
         if (!params.successful) {
           return notifyError(generateOAuthErrorDescription(params));
         }

         try {
           // Use InspectorClient's OAuth method instead of SDK auth()
           await inspectorClient.completeOAuthFlow(params.code);

           toast({
             title: "Success",
             description: "Successfully authenticated with OAuth",
             variant: "default",
           });

           // Trigger auto-connect
           await inspectorClient.connect();
           onConnect();
         } catch (error) {
           console.error("OAuth callback error:", error);
           return notifyError(`Unexpected error occurred: ${error}`);
         }
       };

       handleCallback().finally(() => {
         window.history.replaceState({}, document.title, "/");
       });
     }, [inspectorClient, toast, onConnect]);

     return (
       <div className="flex items-center justify-center h-screen">
         <p className="text-lg text-gray-500">Processing OAuth callback...</p>
       </div>
     );
   };
   ```

---

### Step 4.3: Update App.tsx OAuth Callback Route

**File:** `web/src/App.tsx`

**Changes:**

1. **Pass inspectorClient to OAuthCallback:**

   ```typescript
   if (window.location.pathname === "/oauth/callback") {
     const OAuthCallback = React.lazy(
       () => import("./components/OAuthCallback"),
     );
     return (
       <Suspense fallback={<div>Loading...</div>}>
         <OAuthCallback
           inspectorClient={inspectorClient}
           onConnect={connectMcpServer}
         />
       </Suspense>
     );
   }
   ```

2. **Update OAuth handlers:**

   ```typescript
   // Replace custom OAuth flow with InspectorClient methods
   const handleOAuthAuth = useCallback(async () => {
     if (!inspectorClient) return;
     const authUrl = await inspectorClient.authenticate();
     // Navigate to authUrl (BrowserNavigation handles this automatically)
     // Or manually: window.location.href = authUrl.href;
   }, [inspectorClient]);

   // OAuth completion is now handled in OAuthCallback component
   // No separate handler needed
   ```

3. **Remove `onOAuthConnect` handler** (if it exists) - connection is handled directly in `OAuthCallback` component

---

### Step 4.4: Update OAuth Storage

**File:** `web/src/lib/adapters/environmentFactory.ts`

**Decision:** Choose storage strategy:

- **Option A:** `BrowserOAuthStorage` (sessionStorage) - Browser-only, no shared state
- **Option B:** `RemoteOAuthStorage` (HTTP API) - Shared state with TUI/CLI

For initial port, use `BrowserOAuthStorage`. Can switch to `RemoteOAuthStorage` later if shared state is needed.

**Note:** OAuth tokens are stored automatically by `InspectorClient` using the storage provided in `environment.oauth.storage`. No manual token management needed.

---

## Phase 5: Remove Express Server Dependency ⏸️ PARTIALLY COMPLETE

**Status:** ⏸️ Partially Complete - `/config` endpoint dependency removed via HTML template injection. Express proxy still runs but is no longer needed for OAuth callbacks (handled client-side by React routing) or MCP communication (handled by Hono server). It may still be referenced in legacy code paths.

### Step 5.1: Update Start Scripts

**File:** `web/bin/start.js`

**Changes:**

- Remove `startDevServer()` and `startProdServer()` functions
- Remove server spawning logic
- Update `startDevClient()` to only start Vite (Hono middleware handles API)
- Update `startProdClient()` to use Hono server instead of `serve-handler`

---

### Step 5.2: Remove Proxy Configuration

**File:** `web/src/utils/configUtils.ts`

**Changes:**

- Remove `getMCPProxyAddress()` function (no longer needed)
- Remove proxy auth token handling (now handled by remote API auth)
- Update any code that references proxy server

---

### Step 5.3: Replace `/config` Endpoint with HTML Template Injection ✅ COMPLETE

**Files:** `web/bin/server.js`, `web/vite.config.ts`, `web/bin/start.js`, `web/src/App.tsx`

**Status:** ✅ Complete

**Approach:** Instead of fetching initial configuration from the Express proxy's `/config` endpoint, we inject configuration values directly into the HTML template served by the Hono server (prod) and Vite dev server (dev). This eliminates the dependency on the Express proxy for initial configuration.

**Implementation:**

1. **Start Script (`web/bin/start.js`):**
   - Passes config values (command, args, transport, serverUrl, envVars) via environment variables (`MCP_INITIAL_COMMAND`, `MCP_INITIAL_ARGS`, `MCP_INITIAL_TRANSPORT`, `MCP_INITIAL_SERVER_URL`, `MCP_ENV_VARS`) to both Vite (dev) and Hono server (prod)

2. **Hono Server (`web/bin/server.js`):**
   - Intercepts requests to `/` (root)
   - Reads `index.html` from dist folder
   - Builds `initialConfig` object from env vars (includes `defaultEnvironment` from `getDefaultEnvironment()` + `MCP_ENV_VARS`)
   - Injects `<script>window.__INITIAL_CONFIG__ = {...}</script>` before `</head>`
   - Returns modified HTML

3. **Vite Config (`web/vite.config.ts`):**
   - Adds middleware to intercept `/` and `/index.html` requests
   - Same injection logic as Hono server (reads from `index.html` source, injects config, returns modified HTML)

4. **App.tsx (`web/src/App.tsx`):**
   - Removed `/config` endpoint fetch
   - Reads from `window.__INITIAL_CONFIG__` in a `useEffect` (runs once on mount)
   - Applies config values to state (env, command, args, transport, serverUrl)

**Benefits:**

- No network request needed for initial config (available immediately)
- Removes dependency on Express proxy for config
- Clean URLs (no query params required for config)
- Works in both dev and prod modes
- Values available synchronously before React renders

**As-Built:**

- Config injection happens in both dev (Vite middleware) and prod (Hono server route)
- Uses `getDefaultEnvironment()` from SDK to get default env vars (PATH, HOME, USER, etc.)
- Merges with `MCP_ENV_VARS` if provided
- Config object structure matches what `/config` endpoint returned: `{ defaultCommand?, defaultArgs?, defaultTransport?, defaultServerUrl?, defaultEnvironment }`

---

## Phase 6: Testing and Validation

### Step 6.1: Functional Testing

Test each feature to ensure parity with `client/`:

- [ ] Connection management (connect/disconnect)
- [ ] Transport types (stdio, SSE, streamable-http)
- [ ] Tools (list, call, test)
- [ ] Resources (list, read, subscribe)
- [ ] Prompts (list, get)
- [ ] OAuth flows (static client, DCR, CIMD)
- [ ] Custom headers
- [ ] Request history
- [ ] Stderr logging
- [ ] Notifications
- [ ] Elicitation requests
- [ ] Sampling requests
- [ ] Roots management
- [ ] Progress notifications

---

### Step 6.2: Integration Testing

- [ ] Dev mode: Vite + Hono middleware works
- [ ] Prod mode: Hono server serves static files and API
- [ ] Same-origin requests (no CORS issues)
- [ ] Auth token handling
- [ ] Storage persistence
- [ ] Error handling

---

### Step 6.3: Performance Testing

- [ ] Message tracking performance
- [ ] Large tool/resource lists
- [ ] Concurrent requests
- [ ] Memory usage

---

## Phase 7: Cleanup

### Step 7.1: Remove Unused Code

- [ ] Delete `useConnection.ts` hook
- [ ] Remove Express server references
- [ ] Remove proxy-related utilities
- [ ] Clean up unused imports

---

### Step 7.2: Update Documentation

- [ ] Update README with new architecture
- [ ] Document Hono integration
- [ ] Update development setup instructions

---

## Implementation Order

**Recommended order:**

1. **Phase 1** (Hono Integration) - Foundation for everything else
2. **Phase 2** (Adapters) - Needed before Phase 3
3. **Phase 3** (InspectorClient Integration) - Core functionality
4. **Phase 4** (OAuth) - Can be done in parallel with Phase 3
5. **Phase 5** (Remove Express) - After everything works
6. **Phase 6** (Testing) - Throughout, but comprehensive at end
7. **Phase 7** (Cleanup) - Final step

---

## Key Differences from Current Client

| Aspect         | Current Client                | New Web App                                    |
| -------------- | ----------------------------- | ---------------------------------------------- |
| **Transport**  | Direct SDK transports + proxy | Remote transport via Hono API                  |
| **Server**     | Separate Express server       | Hono middleware in Vite                        |
| **OAuth**      | Custom state machine          | InspectorClient OAuth methods                  |
| **State**      | Custom formats                | InspectorClient formats (MessageEntry[], etc.) |
| **Connection** | useConnection hook            | InspectorClient + useInspectorClient           |
| **Fetch**      | Direct fetch                  | createRemoteFetch (for OAuth)                  |
| **Logging**    | Console only                  | createRemoteLogger                             |

---

## Success Criteria

The port is complete when:

1. ✅ All features from `client/` work identically in `web/`
2. ✅ No separate Express server required
3. ✅ Same-origin requests (no CORS)
4. ✅ OAuth flows work (static, DCR, CIMD)
5. ✅ All transport types work (stdio, SSE, streamable-http)
6. ✅ Request history, stderr logs, notifications all work
7. ✅ Code is cleaner and more maintainable

---

## Notes

- Keep `client/` unchanged during port (it's the reference implementation)
- Test incrementally - don't try to port everything at once
- Use feature flags if needed to test new code alongside old code
- The web app can be deleted from the PR after POC is complete (if not merging)
