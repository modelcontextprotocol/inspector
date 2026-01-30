# Web Client OAuth Proxy Fetch

Standalone fix to resolve OAuth discovery CORS failures in the web client. Can be implemented as a separate PR before or after the remote transport redesign.

## Problem

When the web client attempts OAuth against servers like GitHub MCP (`https://api.githubcopilot.com/mcp/`), discovery fails with:

```
Failed to start OAuth flow: Failed to discover OAuth metadata
```

**Root cause**: The SDK's auth functions make HTTP requests to well-known OAuth endpoints. In the browser, these are blocked by CORS.

**Solution**: Pass `fetchFn` to all SDK auth calls. The fetch function routes requests through the existing proxy server (Node.js, no CORS restrictions).

## Current Implementation (Researched)

### OAuth Entry Points

There are two OAuth flows in the web client:

1. **401 flow** (`useConnection.ts` → `handleAuthError`)
   - Triggered when connect fails with 401
   - Calls `auth(provider, { serverUrl, scope })` directly
   - Does not pass `fetchFn`

2. **Guided flow** (`AuthDebugger.tsx` → `OAuthStateMachine`)
   - Triggered when user clicks "Quick OAuth" or steps through "Guided OAuth Flow"
   - Calls SDK functions directly: `discoverOAuthProtectedResourceMetadata`, `discoverAuthorizationServerMetadata`, `registerClient`, `exchangeAuthorization`
   - Also calls `discoverScopes` from `auth.ts`, which calls `discoverAuthorizationServerMetadata`
   - None of these pass `fetchFn`

### Data Flow

**useConnection.ts**:

- Receives `config: InspectorConfig` and `connectionType: "direct" | "proxy"` (default `"proxy"`) in options
- `handleAuthError` is in closure; has access to `config`, `connectionType`, `sseUrl`, `oauthScope`
- `getMCPProxyAddress(config)` and `getMCPProxyAuthToken(config)` come from `configUtils.ts`; both require `config`

**AuthDebugger.tsx**:

- Props: `serverUrl`, `onBack`, `authState`, `updateAuthState` — does **not** receive `config` or `connectionType`
- Rendered by `AuthDebuggerWrapper` in `App.tsx`, which passes only those four props
- `App.tsx` has `config` (state) and `connectionType` (from sidebar); passes them to `useConnection` but not to `AuthDebugger`

**OAuthStateMachine** (`oauth-state-machine.ts`):

- Constructor: `(serverUrl: string, updateState: (updates) => void)`
- `executeStep(state)` creates context: `{ state, serverUrl, provider, updateState }`
- Creates `provider = new DebugInspectorOAuthClientProvider(serverUrl)` on each step
- Context does **not** include `fetchFn`

**auth.ts discoverScopes**:

- Signature: `(serverUrl: string, resourceMetadata?: OAuthProtectedResourceMetadata): Promise<string | undefined>`
- Calls `discoverAuthorizationServerMetadata(new URL("/", serverUrl))` with one argument; no `fetchFn`

### Proxy Server

- File: `server/src/index.ts`
- Existing endpoints: `GET/POST/DELETE /mcp`, `GET /stdio`, `GET /sse`, `POST /message`, `GET /config`
- No `/fetch` endpoint exists
- All MCP routes use `originValidationMiddleware` and `authMiddleware`
- Auth header: `x-mcp-proxy-auth: Bearer <token>`
- `getMCPProxyAuthToken(config)` returns `{ token, header: "X-MCP-Proxy-Auth" }` — header key is capitalized in return but Express normalizes to lowercase

### SDK Function Signatures

| Function                                                           | fetchFn parameter              |
| ------------------------------------------------------------------ | ------------------------------ |
| `auth(provider, { serverUrl, scope, fetchFn })`                    | Optional in options            |
| `discoverOAuthProtectedResourceMetadata(serverUrl, opts, fetchFn)` | Third arg, defaults to `fetch` |
| `discoverAuthorizationServerMetadata(url, { fetchFn })`            | In options object              |
| `registerClient(url, { metadata, clientMetadata, fetchFn })`       | In options object              |
| `exchangeAuthorization(url, { ..., fetchFn })`                     | In options object              |

## Implementation Plan

### 1. Add `/fetch` endpoint to proxy server

**File**: `server/src/index.ts`

Add after existing route definitions (e.g., after `/config`):

```typescript
app.post(
  "/fetch",
  originValidationMiddleware,
  authMiddleware,
  async (req, res) => {
    try {
      const { url, init } = req.body as { url: string; init?: RequestInit };

      const response = await fetch(url, {
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body,
      });

      const responseBody = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      res.status(response.status).json({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers,
        body: responseBody,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);
```

### 2. Create `proxyFetch.ts`

**File**: `client/src/lib/proxyFetch.ts` (new file)

```typescript
import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import type { InspectorConfig } from "./configurationTypes";

interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export function createProxyFetch(config: InspectorConfig): typeof fetch {
  const proxyAddress = getMCPProxyAddress(config);
  const { token, header } = getMCPProxyAuthToken(config);

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    const proxyResponse = await fetch(`${proxyAddress}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [header]: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url,
        init: {
          method: init?.method,
          headers: init?.headers
            ? Object.fromEntries(new Headers(init.headers))
            : undefined,
          body: init?.body,
        },
      }),
    });

    if (!proxyResponse.ok) {
      throw new Error(`Proxy fetch failed: ${proxyResponse.statusText}`);
    }

    const data: ProxyFetchResponse = await proxyResponse.json();

    return new Response(data.body, {
      status: data.status,
      statusText: data.statusText,
      headers: new Headers(data.headers),
    });
  };
}
```

### 3. Update `useConnection.ts`

**File**: `client/src/lib/hooks/useConnection.ts`

- Import `createProxyFetch` from `../proxyFetch`.
- In `handleAuthError`, use proxy fetch only when `connectionType === "proxy"` (direct connections have no proxy):

```typescript
const handleAuthError = async (error: unknown) => {
  if (is401Error(error)) {
    let scope = oauthScope?.trim();
    const fetchFn =
      connectionType === "proxy" ? createProxyFetch(config) : undefined;

    if (!scope) {
      let resourceMetadata;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          new URL("/", sseUrl),
          {},
          fetchFn,
        );
      } catch {
        // Resource metadata is optional
      }
      scope = await discoverScopes(sseUrl, resourceMetadata, fetchFn);
    }

    saveScopeToSessionStorage(sseUrl, scope);
    const serverAuthProvider = new InspectorOAuthClientProvider(sseUrl);

    const result = await auth(serverAuthProvider, {
      serverUrl: sseUrl,
      scope,
      ...(fetchFn && { fetchFn }),
    });
    return result === "AUTHORIZED";
  }
  return false;
};
```

### 4. Update `auth.ts` discoverScopes

**File**: `client/src/lib/auth.ts`

Add optional `fetchFn` and pass it to `discoverAuthorizationServerMetadata`:

```typescript
export const discoverScopes = async (
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
  fetchFn?: typeof fetch,
): Promise<string | undefined> => {
  try {
    const metadata = await discoverAuthorizationServerMetadata(
      new URL("/", serverUrl),
      { fetchFn },
    );
    // ... rest unchanged
  }
};
```

### 5. Update `oauth-state-machine.ts`

**File**: `client/src/lib/oauth-state-machine.ts`

- Add `fetchFn?: typeof fetch` to `StateMachineContext`.
- Pass `fetchFn` to every SDK call that accepts it:

| Transition             | SDK call                                                                         | Change                                        |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| metadata_discovery     | `discoverOAuthProtectedResourceMetadata(context.serverUrl)`                      | Add `{}, context.fetchFn` as 2nd and 3rd args |
| metadata_discovery     | `discoverAuthorizationServerMetadata(authServerUrl)`                             | Add `{ fetchFn: context.fetchFn }` as 2nd arg |
| client_registration    | `registerClient(context.serverUrl, { metadata, clientMetadata })`                | Add `fetchFn: context.fetchFn` to options     |
| authorization_redirect | `discoverScopes(context.serverUrl, context.state.resourceMetadata ?? undefined)` | Add `context.fetchFn` as 3rd arg              |
| token_request          | `exchangeAuthorization(context.serverUrl, { ... })`                              | Add `fetchFn: context.fetchFn` to options     |

- Add `fetchFn` to `OAuthStateMachine` constructor: `(serverUrl, updateState, fetchFn?)`
- In `executeStep`, pass `fetchFn` into context: `context = { ..., fetchFn: this.fetchFn }`

### 6. Update `AuthDebugger.tsx` and `App.tsx`

**File**: `client/src/components/AuthDebugger.tsx`

- Add to `AuthDebuggerProps`: `config?: InspectorConfig`, `connectionType?: "direct" | "proxy"`.
- When creating `OAuthStateMachine`, pass `fetchFn`:

```typescript
const fetchFn =
  connectionType === "proxy" && config ? createProxyFetch(config) : undefined;

const stateMachine = useMemo(
  () => new OAuthStateMachine(serverUrl, updateAuthState, fetchFn),
  [serverUrl, updateAuthState, fetchFn],
);
```

**File**: `client/src/App.tsx`

- In `AuthDebuggerWrapper`, pass `config` and `connectionType` to `AuthDebugger`:

```typescript
<AuthDebugger
  serverUrl={sseUrl}
  onBack={() => setIsAuthDebuggerVisible(false)}
  authState={authState}
  updateAuthState={updateAuthState}
  config={config}
  connectionType={connectionType}
/>
```

### 7. Update `AuthDebugger.test.tsx`

- Add `config` and `connectionType` to `defaultProps` (or mock them) where needed for tests that exercise OAuth flow.

## When Proxy Fetch Is Used

- **401 flow**: Only when `connectionType === "proxy"`. `handleAuthError` has `connectionType` from closure.
- **Guided flow**: Only when `connectionType === "proxy"` and `config` is provided. `AuthDebugger` receives both from `App.tsx`.

Direct connections do not use the proxy; passing `fetchFn` would fail. Both flows already guard on `connectionType === "proxy"`.

## Limitations

- Requires proxy mode: Only helps when connecting via proxy. Direct connections still hit CORS.
- Proxy must be running: OAuth fails if proxy is down.
- Token: Proxy session token must be set in config (proxy prints it on startup).

## Future

When the remote transport design is implemented, the bridge's `/api/mcp/fetch` replaces this. This standalone fix can then be removed or refactored to use the bridge.
