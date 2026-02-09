# Web Client Port to InspectorClient - Step-by-Step Plan

## Overview

This document provides a step-by-step plan for porting the `web/` application to use `InspectorClient` instead of `useConnection`, integrating the Hono remote API server directly into Vite (eliminating the separate Express server), and ensuring functional parity with the existing `client/` application.

**Goal:** The `web/` app should function identically to `client/` but use `InspectorClient` and the integrated Hono server instead of `useConnection` and the separate Express proxy.

## Progress Summary

- ✅ **Phase 1:** Integrate Hono Server into Vite - **COMPLETE**
- ✅ **Phase 2:** Create Web Client Adapter - **COMPLETE**
- ✅ **Phase 3:** Replace useConnection with InspectorClient - **COMPLETE** (All steps complete)
- ⏸️ **Phase 4:** OAuth Integration - **NOT STARTED**
- ✅ **Phase 5:** Remove Express Server Dependency - **COMPLETE** (Express proxy completely removed, Hono server handles all functionality)
- ⏸️ **Phase 6:** Testing and Validation - **IN PROGRESS** (Unit tests passing, functional testing ongoing)
- ⏸️ **Phase 7:** Cleanup - **PARTIALLY COMPLETE** (useConnection removed, console.log cleaned up)

**Current Status:** Core InspectorClient integration complete. All Phase 3 steps finished. Express proxy completely removed (Phase 5 complete). Recent bug fixes: Fixed infinite loops in `useInspectorClient` hook and `App.tsx` notifications extraction. Remaining work: OAuth integration (Phase 4), comprehensive testing (Phase 6), and cleanup (Phase 7).

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
- Auth token passed via `process.env.MCP_INSPECTOR_API_TOKEN` (read-only, set by start script)

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
    honoMiddlewarePlugin(process.env.MCP_INSPECTOR_API_TOKEN || ""),
  ],
  // ... rest of config
});
```

**Dependencies needed:**

- `@modelcontextprotocol/inspector-shared` (already in workspace)
- `node:crypto` for `randomBytes`

**Auth Token Handling:**

The auth token flow:

1. **Start script (`bin/start.js`)**: Reads `process.env.MCP_INSPECTOR_API_TOKEN` or generates one
2. **Vite plugin**: Receives token via env var (read-only, passed to spawned process). Plugin reads it and passes explicitly to `createRemoteApp()`
3. **Client browser**: Receives token via URL params (`?MCP_INSPECTOR_API_TOKEN=...`)

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
- Auth token read from `process.env.MCP_INSPECTOR_API_TOKEN`

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
  process.env.MCP_INSPECTOR_API_TOKEN || randomBytes(32).toString("hex");

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
         MCP_INSPECTOR_API_TOKEN: honoAuthToken, // Pass token to Vite (read-only)
         // Note: Express proxy still uses MCP_PROXY_AUTH_TOKEN (different token)
       },
       signal: abort.signal,
       echoOutput: true,
     });

     // Include auth token in URL for client (Phase 3 will use this)
     const params = new URLSearchParams();
     params.set("MCP_INSPECTOR_API_TOKEN", honoAuthToken);
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
         MCP_INSPECTOR_API_TOKEN: honoAuthToken, // Pass token explicitly
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
       process.env.MCP_INSPECTOR_API_TOKEN || randomBytes(32).toString("hex");

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
   - Separate auth tokens: `MCP_PROXY_AUTH_TOKEN` (Express) and `MCP_INSPECTOR_API_TOKEN` (Hono)

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

## Phase 3: Replace useConnection with InspectorClient ✅ COMPLETE

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
- Auth token extracted from URL params (`MCP_INSPECTOR_API_TOKEN`)
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
     return params.get("MCP_INSPECTOR_API_TOKEN") || null;
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
   - **As-Built:** Notifications extracted from `inspectorMessages` via `useMemo` + `useEffect` with content comparison to prevent infinite loops:

     ```typescript
     const extractedNotifications = useMemo(() => {
       return inspectorMessages
         .filter((msg) => msg.direction === "notification" && msg.message)
         .map((msg) => msg.message as ServerNotification);
     }, [inspectorMessages]);

     const previousNotificationsRef = useRef<string>("[]");
     useEffect(() => {
       const currentSerialized = JSON.stringify(extractedNotifications);
       if (currentSerialized !== previousNotificationsRef.current) {
         setNotifications(extractedNotifications);
         previousNotificationsRef.current = currentSerialized;
       }
     }, [extractedNotifications]);
     ```

   - **Bug Fix:** Fixed infinite loop caused by `InspectorClient.getMessages()` returning new array references. Fixed in `useInspectorClient` hook by comparing serialized content before updating state.
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

**Status:** ⏸️ NOT STARTED

**Goal:** Replace custom OAuth implementation (`InspectorOAuthClientProvider`, `OAuthStateMachine`, manual state management) with `InspectorClient`'s built-in OAuth support, matching the TUI implementation pattern.

---

### Architecture Overview

**Current State (Web App):**

- Custom `InspectorOAuthClientProvider` and `DebugInspectorOAuthClientProvider` classes (`web/src/lib/auth.ts`)
- Custom `OAuthStateMachine` class (`web/src/lib/oauth-state-machine.ts`) - duplicates shared implementation
- Manual OAuth state management via `AuthGuidedState` in `App.tsx`
- `OAuthCallback` component uses SDK `auth()` directly
- `AuthDebugger` component uses custom state machine for guided flow
- `OAuthFlowProgress` component displays custom state

**Target State (After Port):**

- Use `InspectorClient` OAuth methods: `authenticate()`, `completeOAuthFlow()`, `beginGuidedAuth()`, `proceedOAuthStep()`, `getOAuthState()`, `getOAuthTokens()`
- Use shared `BrowserOAuthStorage` and `BrowserNavigation` (already configured in `createWebEnvironment`)
- Listen to `InspectorClient` OAuth events: `oauthStepChange`, `oauthComplete`, `oauthError`
- Remove custom OAuth providers and state machine
- Simplify components to read from `InspectorClient.getOAuthState()`

**Reference Implementation (TUI):**

- TUI uses `InspectorClient` OAuth methods directly
- Quick Auth: Creates callback server → sets redirect URL → calls `authenticate()` → waits for callback → calls `completeOAuthFlow()`
- Guided Auth: Calls `beginGuidedAuth()` → listens to `oauthStepChange` events → calls `proceedOAuthStep()` for each step
- OAuth state synced via `inspectorClient.getOAuthState()` and `oauthStepChange` events

---

### Step 4.1: Follow TUI Pattern - Components Manage OAuth State Directly

**Approach:** Follow the TUI pattern where components that need OAuth state manage it directly, rather than extending the hook.

**Rationale:** TUI's `AuthTab` component doesn't use `useInspectorClient` for OAuth state. Instead, it:

1. Receives `inspectorClient` as a prop
2. Uses `useState` to manage `oauthState` locally
3. Uses `useEffect` to sync state by calling `inspectorClient.getOAuthState()` directly
4. Listens to `oauthStepChange` and `oauthComplete` events directly on `inspectorClient`

**Alternative Approach (Optional):** We could extend `useInspectorClient` to expose OAuth state, which would be more DRY if multiple components need it. However, since only `AuthDebugger` needs OAuth state in the web app, following the TUI pattern is simpler and more consistent.

**Implementation Pattern (for AuthDebugger):**

```typescript
const AuthDebugger = ({ inspectorClient, onBack }: AuthDebuggerProps) => {
  const { toast } = useToast();
  const [oauthState, setOauthState] = useState<AuthGuidedState | undefined>(
    undefined,
  );
  const [isInitiatingAuth, setIsInitiatingAuth] = useState(false);

  // Sync oauthState from InspectorClient (TUI pattern)
  useEffect(() => {
    if (!inspectorClient) {
      setOauthState(undefined);
      return;
    }

    const update = () => setOauthState(inspectorClient.getOAuthState());
    update();

    const onStepChange = () => update();
    inspectorClient.addEventListener("oauthStepChange", onStepChange);
    inspectorClient.addEventListener("oauthComplete", onStepChange);
    inspectorClient.addEventListener("oauthError", onStepChange);

    return () => {
      inspectorClient.removeEventListener("oauthStepChange", onStepChange);
      inspectorClient.removeEventListener("oauthComplete", onStepChange);
      inspectorClient.removeEventListener("oauthError", onStepChange);
    };
  }, [inspectorClient]);

  // OAuth methods call InspectorClient directly
  const handleQuickOAuth = useCallback(async () => {
    if (!inspectorClient) return;
    setIsInitiatingAuth(true);
    try {
      await inspectorClient.authenticate();
    } catch (error) {
      // Handle error
    } finally {
      setIsInitiatingAuth(false);
    }
  }, [inspectorClient]);

  const handleGuidedOAuth = useCallback(async () => {
    if (!inspectorClient) return;
    setIsInitiatingAuth(true);
    try {
      await inspectorClient.beginGuidedAuth();
    } catch (error) {
      // Handle error
    } finally {
      setIsInitiatingAuth(false);
    }
  }, [inspectorClient]);

  const proceedToNextStep = useCallback(async () => {
    if (!inspectorClient) return;
    setIsInitiatingAuth(true);
    try {
      await inspectorClient.proceedOAuthStep();
    } catch (error) {
      // Handle error
    } finally {
      setIsInitiatingAuth(false);
    }
  }, [inspectorClient]);

  // ... rest of component uses oauthState ...
};
```

**Benefits of This Approach:**

- Matches TUI implementation exactly
- No changes needed to shared hook (avoids affecting TUI)
- Simpler - OAuth state only where needed
- Components have direct access to `inspectorClient` methods

**Note:** If we later need OAuth state in multiple components, we can refactor to extend the hook then. For now, following TUI pattern is the simplest path.

---

### Step 4.2: Update OAuth Callback Component (Normal Flow)

**File:** `web/src/components/OAuthCallback.tsx`

**Current Implementation:**

- Uses `InspectorOAuthClientProvider` + SDK `auth()` function
- Reads `serverUrl` from `sessionStorage`
- Calls `onConnect(serverUrl)` after success

**Changes:**

1. **Remove custom provider imports:**

   ```typescript
   // Remove
   import { InspectorOAuthClientProvider } from "../lib/auth";
   import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
   import { SESSION_KEYS } from "../lib/constants";

   // Add
   import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
   ```

2. **Update component props:**

   ```typescript
   interface OAuthCallbackProps {
     inspectorClient: InspectorClient | null;
     onConnect: () => void;
   }
   ```

3. **Update callback handler:**

   ```typescript
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

         if (!params.code) {
           return notifyError("Missing authorization code");
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
           return notifyError(
             `OAuth flow failed: ${error instanceof Error ? error.message : String(error)}`,
           );
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

**Key Changes:**

- Removed `sessionStorage` dependency (server URL comes from `InspectorClient` config)
- Replaced `InspectorOAuthClientProvider` + `auth()` with `inspectorClient.completeOAuthFlow()`
- Simplified error handling (InspectorClient handles OAuth errors internally)

---

### Step 4.3: Update OAuth Debug Callback Component

**File:** `web/src/components/OAuthDebugCallback.tsx`

**Current Implementation:**

- Similar to `OAuthCallback` but for debug flow
- Restores `AuthGuidedState` from `sessionStorage`
- Passes `authorizationCode` and `restoredState` to `onConnect`

**Changes:**

1. **Update to use InspectorClient:**

   ```typescript
   interface OAuthDebugCallbackProps {
     inspectorClient: InspectorClient | null;
     onConnect: (authorizationCode: string) => void;
   }

   const OAuthDebugCallback = ({
     inspectorClient,
     onConnect,
   }: OAuthDebugCallbackProps) => {
     useEffect(() => {
       let isProcessed = false;

       const handleCallback = async () => {
         if (isProcessed || !inspectorClient) return;
         isProcessed = true;

         const params = parseOAuthCallbackParams(window.location.search);
         if (!params.successful || !params.code) {
           // Display error in UI (already handled by component)
           return;
         }

         // For debug flow, we still need to complete the flow manually
         // The guided flow state is managed by InspectorClient internally
         try {
           await inspectorClient.completeOAuthFlow(params.code);
           onConnect(params.code);
         } catch (error) {
           console.error("OAuth debug callback error:", error);
         }
       };

       handleCallback().finally(() => {
         if (window.location.pathname !== "/oauth/callback/debug") {
           window.history.replaceState({}, document.title, "/");
         }
       });

       return () => {
         isProcessed = true;
       };
     }, [inspectorClient, onConnect]);

     // ... rest of component (display code for manual copying) ...
   };
   ```

**Note:** The debug callback may need to work differently if we're using guided flow. We may need to check `InspectorClient.getOAuthState()` to see if we're in guided mode and handle accordingly.

---

### Step 4.4: Update App.tsx OAuth Routes and Handlers

**File:** `web/src/App.tsx`

**Current Implementation:**

- Routes `/oauth/callback` and `/oauth/callback/debug` render callback components
- `onOAuthConnect` and `onOAuthDebugConnect` handlers manage state
- OAuth config (clientId, clientSecret, scope) stored in component state

**Changes:**

1. **Update OAuth callback routes:**

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

   if (window.location.pathname === "/oauth/callback/debug") {
     const OAuthDebugCallback = React.lazy(
       () => import("./components/OAuthDebugCallback"),
     );
     return (
       <Suspense fallback={<div>Loading...</div>}>
         <OAuthDebugCallback
           inspectorClient={inspectorClient}
           onConnect={async (code: string) => {
             // Debug callback completion - may trigger guided flow continuation
             // InspectorClient handles this internally via completeOAuthFlow
             await connectMcpServer();
           }}
         />
       </Suspense>
     );
   }
   ```

2. **Remove `onOAuthConnect` and `onOAuthDebugConnect` handlers** - connection is handled directly in callback components

3. **Add OAuth authentication handler (for Quick Auth):**

   ```typescript
   const handleQuickOAuth = useCallback(async () => {
     if (!inspectorClient) return;

     try {
       // InspectorClient.authenticate() returns the authorization URL
       // BrowserNavigation (configured in environment) automatically redirects
       const authUrl = await inspectorClient.authenticate();
       // Navigation happens automatically via BrowserNavigation
       // No manual redirect needed
     } catch (error) {
       console.error("OAuth authentication failed:", error);
       // Show error toast
     }
   }, [inspectorClient]);
   ```

**Note:** `BrowserNavigation` automatically redirects when `redirectToAuthorization()` is called, so we don't need manual `window.location.href` assignment.

---

### Step 4.5: Refactor AuthDebugger Component to Use InspectorClient

**File:** `web/src/components/AuthDebugger.tsx`

**Current Implementation:**

- Uses custom `OAuthStateMachine` and `DebugInspectorOAuthClientProvider`
- Manages `AuthGuidedState` manually via `updateAuthState`
- Has "Guided OAuth Flow" and "Quick OAuth Flow" buttons

**Changes:**

1. **Update component props:**

   ```typescript
   interface AuthDebuggerProps {
     inspectorClient: InspectorClient | null;
     onBack: () => void;
   }
   ```

2. **Remove custom state machine and provider:**

   ```typescript
   // Remove
   import { OAuthStateMachine } from "../lib/oauth-state-machine";
   import { DebugInspectorOAuthClientProvider } from "../lib/auth";
   import type { AuthGuidedState } from "../lib/auth-types";

   // Add
   import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
   import type { AuthGuidedState } from "@modelcontextprotocol/inspector-shared/auth/types.js";
   ```

3. **Follow TUI pattern - manage OAuth state directly:**

   ```typescript
   const AuthDebugger = ({
     inspectorClient,
     onBack,
   }: AuthDebuggerProps) => {
     const { toast } = useToast();
     const [oauthState, setOauthState] = useState<AuthGuidedState | undefined>(
       undefined,
     );
     const [isInitiatingAuth, setIsInitiatingAuth] = useState(false);

     // Sync oauthState from InspectorClient (TUI pattern - Step 4.1)
     useEffect(() => {
       if (!inspectorClient) {
         setOauthState(undefined);
         return;
       }

       const update = () => setOauthState(inspectorClient.getOAuthState());
       update();

       const onStepChange = () => update();
       inspectorClient.addEventListener("oauthStepChange", onStepChange);
       inspectorClient.addEventListener("oauthComplete", onStepChange);
       inspectorClient.addEventListener("oauthError", onStepChange);

       return () => {
         inspectorClient.removeEventListener("oauthStepChange", onStepChange);
         inspectorClient.removeEventListener("oauthComplete", onStepChange);
         inspectorClient.removeEventListener("oauthError", onStepChange);
       };
     }, [inspectorClient]);
   ```

4. **Update Quick OAuth handler:**

   ```typescript
   const handleQuickOAuth = useCallback(async () => {
     if (!inspectorClient) return;

     setIsInitiatingAuth(true);
     try {
       // Quick Auth: normal flow (automatic redirect via BrowserNavigation)
       await inspectorClient.authenticate();
       // BrowserNavigation handles redirect automatically
     } catch (error) {
       console.error("Quick OAuth failed:", error);
       toast({
         title: "OAuth Error",
         description: error instanceof Error ? error.message : String(error),
         variant: "destructive",
       });
     } finally {
       setIsInitiatingAuth(false);
     }
   }, [inspectorClient, toast]);
   ```

5. **Update Guided OAuth handler:**

   ```typescript
   const handleGuidedOAuth = useCallback(async () => {
     if (!inspectorClient) return;

     setIsInitiatingAuth(true);
     try {
       // Start guided flow
       await inspectorClient.beginGuidedAuth();
       // State updates via oauthStepChange events (handled in useEffect above)
     } catch (error) {
       console.error("Guided OAuth start failed:", error);
       toast({
         title: "OAuth Error",
         description: error instanceof Error ? error.message : String(error),
         variant: "destructive",
       });
     } finally {
       setIsInitiatingAuth(false);
     }
   }, [inspectorClient, toast]);
   ```

6. **Update proceed to next step handler:**

   ```typescript
   const proceedToNextStep = useCallback(async () => {
     if (!inspectorClient || !oauthState) return;

     setIsInitiatingAuth(true);
     try {
       await inspectorClient.proceedOAuthStep();

       // If we're at authorization_code step and have URL, open it
       // BrowserNavigation should handle redirect automatically, but we can
       // also open in new tab for better UX
       if (
         oauthState.oauthStep === "authorization_code" &&
         oauthState.authorizationUrl
       ) {
         window.open(oauthState.authorizationUrl.href, "_blank");
       }
     } catch (error) {
       console.error("OAuth step failed:", error);
       toast({
         title: "OAuth Error",
         description: error instanceof Error ? error.message : String(error),
         variant: "destructive",
       });
     } finally {
       setIsInitiatingAuth(false);
     }
   }, [inspectorClient, oauthState, toast]);
   ```

7. **Update clear OAuth handler:**

   ```typescript
   const handleClearOAuth = useCallback(async () => {
     if (!inspectorClient) return;

     // InspectorClient doesn't have clearOAuth method yet
     // We may need to add this, or clear storage directly via environment
     // For now, tokens persist until InspectorClient is recreated
     toast({
       title: "OAuth Cleared",
       description: "OAuth tokens will be cleared on next connection",
       variant: "default",
     });
   }, [inspectorClient, toast]);
   ```

8. **Update component to use `oauthState` from local state:**

   ```typescript
   // Replace all `authState` references with `oauthState` from local useState
   // Remove `authState` and `updateAuthState` props
   // Check for existing tokens on mount (if needed):
   useEffect(() => {
     if (inspectorClient && !oauthState?.oauthTokens) {
       inspectorClient.getOAuthTokens().then((tokens) => {
         if (tokens) {
           // State will be updated via getOAuthState() in sync effect
           setOauthState(inspectorClient.getOAuthState());
         }
       });
     }
   }, [inspectorClient, oauthState]);
   ```

**Note:** We may need to add a `clearOAuth()` method to `InspectorClient` or access the storage instance to clear tokens. This can be done in a follow-up if needed.

---

### Step 4.6: Update OAuthFlowProgress Component

**File:** `web/src/components/OAuthFlowProgress.tsx`

**Current Implementation:**

- Receives `authState`, `updateAuthState`, and `proceedToNextStep` as props
- Uses custom `DebugInspectorOAuthClientProvider` to fetch client info

**Changes:**

1. **Update component props:**

   ```typescript
   interface OAuthFlowProgressProps {
     oauthState: AuthGuidedState | undefined;
     proceedToNextStep: () => Promise<void>;
   }
   ```

   **Note:** Component receives `oauthState` as prop (from `AuthDebugger`'s local state) rather than accessing `inspectorClient` directly. This keeps the component simpler and follows React best practices.

2. **Remove custom provider usage:**

   ```typescript
   // Remove
   import { DebugInspectorOAuthClientProvider } from "../lib/auth";

   // Add
   import type { AuthGuidedState } from "@modelcontextprotocol/inspector-shared/auth/types.js";
   import type { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
   ```

3. **Update component to use `oauthState` prop:**

   ```typescript
   export const OAuthFlowProgress = ({
     oauthState,
     proceedToNextStep,
   }: OAuthFlowProgressProps) => {
     const { toast } = useToast();
     const [clientInfo, setClientInfo] = useState<OAuthClientInformation | null>(
       null,
     );

     // Get client info from oauthState
     useEffect(() => {
       if (oauthState?.oauthClientInfo) {
         setClientInfo(oauthState.oauthClientInfo);
       }
     }, [oauthState]);
   ```

4. **Update step rendering to use `oauthState`:**

   ```typescript
   // Replace `authState` references with `oauthState`
   const currentStepIdx = steps.findIndex((s) => s === oauthState?.oauthStep);

   const getStepProps = (stepName: OAuthStep) => ({
     isComplete:
       currentStepIdx > steps.indexOf(stepName) ||
       currentStepIdx === steps.length - 1,
     isCurrent: oauthState?.oauthStep === stepName,
     error: oauthState?.oauthStep === stepName ? oauthState.latestError : null,
   });
   ```

5. **Update `AuthDebugger` to pass `oauthState` prop:**

   ```typescript
   // In AuthDebugger component:
   <OAuthFlowProgress
     oauthState={oauthState}
     proceedToNextStep={proceedToNextStep}
   />
   ```

---

### Step 4.7: Remove Custom OAuth Code

**Files to Delete:**

- `web/src/lib/auth.ts` - Custom `InspectorOAuthClientProvider` and `DebugInspectorOAuthClientProvider`
- `web/src/lib/oauth-state-machine.ts` - Custom `OAuthStateMachine` (duplicates shared implementation)
- `web/src/lib/auth-types.ts` - Custom `AuthGuidedState` type (use shared type instead)

**Files to Update:**

- `web/src/components/AuthDebugger.tsx` - Remove imports of deleted files
- `web/src/components/OAuthFlowProgress.tsx` - Remove imports of deleted files
- `web/src/App.tsx` - Remove imports of deleted files, remove `authState` state management

**Note:** `web/src/utils/oauthUtils.ts` (OAuth URL parsing utilities) should be kept as it's still needed.

---

### Step 4.8: Update Environment Factory (Already Complete)

**File:** `web/src/lib/adapters/environmentFactory.ts`

**Status:** ✅ Already configured correctly

The environment factory already uses `BrowserOAuthStorage` and `BrowserNavigation` from shared:

```typescript
import {
  BrowserOAuthStorage,
  BrowserNavigation,
} from "@modelcontextprotocol/inspector-shared/auth/browser/index.js";

export function createWebEnvironment(
  authToken: string | undefined,
  redirectUrlProvider: RedirectUrlProvider,
): InspectorClientEnvironment {
  // ...
  oauth: {
    storage: new BrowserOAuthStorage(),
    navigation: new BrowserNavigation(),
    redirectUrlProvider,
  },
}
```

**No changes needed.**

---

### Step 4.9: Update Tests

**Files to Update:**

- `web/src/components/__tests__/AuthDebugger.test.tsx` - Mock `InspectorClient` OAuth methods instead of custom providers
- `web/src/components/__tests__/OAuthCallback.test.tsx` (if exists) - Update to use `InspectorClient`
- `web/src/__tests__/App.config.test.tsx` - Verify OAuth config is passed to `InspectorClient`

**Test Strategy:**

1. Mock `InspectorClient` methods: `authenticate()`, `completeOAuthFlow()`, `beginGuidedAuth()`, `proceedOAuthStep()`, `getOAuthState()`, `getOAuthTokens()`
2. Test that OAuth callbacks call `inspectorClient.completeOAuthFlow()` with correct code
3. Test that guided flow calls `beginGuidedAuth()` and `proceedOAuthStep()` correctly
4. Test that OAuth state updates via `oauthStepChange` events

---

### Implementation Order

1. **Step 4.1:** Follow TUI pattern - components manage OAuth state directly (no hook changes needed)
2. **Step 4.2:** Update `OAuthCallback` component (normal flow)
3. **Step 4.3:** Update `OAuthDebugCallback` component (debug flow)
4. **Step 4.4:** Update `App.tsx` routes and handlers
5. **Step 4.5:** Refactor `AuthDebugger` component (includes OAuth state management from Step 4.1)
6. **Step 4.6:** Update `OAuthFlowProgress` component
7. **Step 4.7:** Remove custom OAuth code (cleanup)
8. **Step 4.9:** Update tests

**Dependencies:**

- Step 4.1 is a pattern decision (no code changes) - components will manage OAuth state directly
- Steps 4.2-4.4 can be done independently (they don't need OAuth state)
- Step 4.5 implements the OAuth state management pattern from Step 4.1
- Step 4.6 depends on Step 4.5 (receives `oauthState` as prop)
- Step 4.7 should be done last (after all components updated)
- Step 4.9 should be done alongside component updates

---

### Migration Notes

**Breaking Changes:**

- `OAuthCallback` and `OAuthDebugCallback` now require `inspectorClient` prop
- `AuthDebugger` no longer uses `authState` prop (reads from `InspectorClient`)
- `OAuthFlowProgress` no longer uses `authState` prop

**Backward Compatibility:**

- OAuth redirect URLs remain the same (`/oauth/callback`, `/oauth/callback/debug`)
- OAuth storage location remains the same (sessionStorage via `BrowserOAuthStorage`)
- OAuth flow behavior remains the same (normal vs guided)

**Testing Checklist:**

- [ ] Quick OAuth flow (normal mode) works end-to-end
- [ ] Guided OAuth flow works step-by-step
- [ ] OAuth callback handles success case
- [ ] OAuth callback handles error cases
- [ ] OAuth tokens persist across page reloads
- [ ] OAuth state updates correctly via events
- [ ] Clear OAuth functionality works (if implemented)
- [ ] OAuth works with both SSE and streamable-http transports

---

## Phase 5: Remove Express Server Dependency ✅ COMPLETE

**Status:** ✅ Complete - Express proxy server has been completely removed. No Express server code exists in `web/bin/start.js`. The web app uses only Hono server (via Vite middleware in dev, or `bin/server.js` in prod) for all API endpoints and static file serving.

**Verification:**

- ✅ No Express imports or references in `web/bin/start.js`
- ✅ No Express imports or references in `web/src/` (except one test mock value)
- ✅ No Express dependencies in `web/package.json`
- ✅ No proxy server spawning code in start scripts
- ✅ `/config` endpoint replaced with HTML template injection

**Remaining Legacy References:**

- `web/src/components/__tests__/Sidebar.test.tsx:64` - Test mock has `connectionType: "proxy"` - This is an unused prop in the test mock (not in actual `SidebarProps` interface). Harmless but should be removed for cleanliness.

### Step 5.1: Update Start Scripts ✅ COMPLETE

**File:** `web/bin/start.js`

**Status:** ✅ Complete

**As-Built:**

- `startDevClient()` starts only Vite (Hono middleware handles `/api/*` routes)
- `startProdClient()` starts only Hono server (`bin/server.js`) which serves static files + `/api/*` endpoints
- No Express server spawning code exists
- No `startDevServer()` or `startProdServer()` functions exist

---

### Step 5.2: Remove Proxy Configuration ✅ COMPLETE

**File:** `web/src/utils/configUtils.ts`

**Status:** ✅ Complete

**As-Built:**

- No `getMCPProxyAddress()` function exists
- No proxy auth token handling (uses `MCP_INSPECTOR_API_TOKEN` for remote API auth)
- No proxy server references in code

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

## Phase 6: Testing and Validation ⏸️ IN PROGRESS

### Step 6.1: Functional Testing

Test each feature to ensure parity with `client/`:

- [x] Connection management (connect/disconnect) - ✅ Basic functionality working
- [x] Transport types (stdio, SSE, streamable-http) - ✅ All transport types supported
- [x] Tools (list, call, test) - ✅ Working via InspectorClient
- [x] Resources (list, read, subscribe) - ✅ Working via InspectorClient
- [x] Prompts (list, get) - ✅ Working via InspectorClient
- [ ] OAuth flows (static client, DCR, CIMD) - ⏸️ Not yet integrated (Phase 4)
- [x] Custom headers - ✅ Supported in config adapter
- [x] Request history - ✅ Using MCP protocol messages
- [x] Stderr logging - ✅ ConsoleTab displays stderr logs
- [x] Notifications - ✅ Extracted from message stream
- [x] Elicitation requests - ✅ Event listeners working
- [x] Sampling requests - ✅ Event listeners working
- [x] Roots management - ✅ getRoots/setRoots working
- [ ] Progress notifications - ⏸️ Needs validation

**Recent Bug Fixes:**

- ✅ Fixed infinite loop in `useInspectorClient` hook (messages/stderrLogs/fetchRequests) - root cause: `InspectorClient.getMessages()` returns new array references. Fixed by comparing serialized content before updating state.
- ✅ Fixed infinite loop in `App.tsx` notifications extraction - fixed by using `useMemo` + `useRef` with content comparison
- ✅ Removed debug `console.log` statements from `App.tsx`
- ✅ Added console output capture in tests (schemaUtils, auth tests) to validate expected warnings/debug messages

---

### Step 6.2: Integration Testing

- [ ] Dev mode: Vite + Hono middleware works
- [ ] Prod mode: Hono server serves static files and API
- [ ] Same-origin requests (no CORS issues)
- [ ] Auth token handling
- [ ] Storage persistence
- [ ] Error handling

---

## Phase 7: Cleanup

### Step 7.1: Remove Unused Code

- [x] Delete `useConnection.ts` hook - ✅ Already removed (no files found)
- [x] Remove Express server references - ✅ Express proxy completely removed (no Express code exists)
- [x] Remove proxy-related utilities - ✅ No proxy utilities found in codebase
- [x] Clean up unused imports - ✅ Basic cleanup done (console.log removed)
- [ ] Remove unused test prop - ⏸️ `Sidebar.test.tsx` has unused `connectionType: "proxy"` prop in mock (not in actual interface)

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
6. **Phase 6** (Testing) - Throughout, but comprehensive at end (functional and integration testing only)
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

---

## Issues

Future: Extend useInspectorClient to expose OAuth state (for guided flow in web and TUI)
