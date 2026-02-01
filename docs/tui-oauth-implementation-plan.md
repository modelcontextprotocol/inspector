# TUI OAuth Implementation Plan

## Overview

This document outlines how to implement OAuth 2.1 support in the TUI (and optionally the CLI) for MCP servers that require OAuth (e.g. GitHub Copilot MCP). The plan assumes **DCR or CIMD** support only—no static client ID/secret configuration—so that users can authenticate without providing client credentials.

**Goals:**

- Enable TUI to connect to OAuth-protected MCP servers (SSE, streamable-http).
- Use a **localhost callback server** to receive the OAuth redirect (authorization code).
- Share callback-server logic between TUI and CLI where possible.
- Rely on existing `InspectorClient` OAuth support (discovery, DCR/CIMD, `authenticate`, `completeOAuthFlow`, `authProvider`).

**Scope:**

- **Initial implementation: normal mode only.** We use `authenticate()` (quick/automatic flow), a single redirect URI `http://localhost:<port>/oauth/callback`, and the callback server serves only that path. **Guided mode** (`authenticateGuided()`, step-by-step, `/oauth/callback/guided`) is explicitly **out of scope** for now; we will add it later.

**Implementation status:**

- **Phase 1 (callback server):** ✅ Done. `shared/auth/oauth-callback-server.ts`, `createOAuthCallbackServer()`, unit tests, exports from `@modelcontextprotocol/inspector-shared/auth`.
- **Phase 2 (TUI integration):** ✅ Done. **Auth available for all HTTP servers** (SSE, streamable-http)—no config gate. “Authenticate” action (key **A**), callback server + `openUrl` + `authenticate()` → `completeOAuthFlow`, OAuth status UI, Connect unchanged.
- **401 handling:** ✅ Done. On connect failure we check fetch-request history for 401. If status is error, server is HTTP, and a 401 was seen, we show “401 Unauthorized. Press **A** to authenticate.” [A]uth is already available. **Future:** auto-initiate auth on 401, or auto-retry connect after auth.

---

## Assumptions

- **DCR or CIMD only**: No `clientId` / `clientSecret` in config. We use Dynamic Client Registration or Client ID Metadata Documents.
- **Discovery runs in Node**: TUI and CLI run in Node. OAuth metadata discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) is done via `fetch` in Node—**no CORS** issues, unlike the web client.
- **Redirect URI**: OAuth redirect goes to `http://localhost:<port>/oauth/callback`. We run an HTTP server on that port to receive the redirect. (Guided mode’s `/oauth/callback/guided` is deferred.)

---

## Does “Existing Connect” Just Work?

**Yes, after OAuth is complete.**

- `InspectorClient` already supports OAuth via `oauth` config and `authProvider`.
- When OAuth is configured and tokens exist, `connect()` uses the auth provider; the SDK injects `Authorization: Bearer <token>` and handles 401 (refresh, etc.) inside the transport.
- TUI today creates `InspectorClient` from config and calls `connect()`. If we:
  1. Add `oauth` to config (or `setOAuthConfig`) for HTTP servers that need OAuth,
  2. Run the OAuth flow **before** connect (triggered by user or by 401),
  3. Store tokens (InspectorClient already uses `NodeOAuthStorage` → `~/.mcp-inspector/oauth/state.json`),

then **connect** itself does not need to change. We only need to:

- Run the OAuth flow (discovery, DCR/CIMD, redirect, callback, token exchange) before connect when the server requires OAuth.
- Provide a way to receive the redirect—hence the **callback server**.

---

## Why a Callback Server?

- **Web client**: Browser is redirected to `window.location.origin/oauth/callback?code=...&state=...`. The app serves that route and handles the callback.
- **TUI / CLI**: No browser environment. The user authenticates in a browser (we open the auth URL). The auth server redirects to `redirect_uri` = `http://localhost:<port>/oauth/callback?...`. **Something** must listen on that port to:
  - Receive `GET /oauth/callback?code=...&state=...`,
  - Parse `code` (and optionally validate `state`),
  - Call `InspectorClient.completeOAuthFlow(code)`,
  - Respond with a simple “Success – you can close this tab” page.

That “something” is a small **local HTTP server** (the callback server). We need to implement it and wire it into the TUI (and optionally CLI) OAuth flow.

---

## Shared Callback Server

### Location and scope

- **Package**: `shared` (so both TUI and CLI can use it).
- **Module**: e.g. `shared/auth/oauth-callback-server.ts` (or `shared/oauth/callback-server.ts`).

### Responsibilities

1. **Listen** on a configurable port (default: `0` → OS assigns a free port).
2. **Serve** `GET /oauth/callback` only (normal mode). Guided mode’s `/oauth/callback/guided` is not implemented initially.
3. **On request**:
   - Parse query (`?code=...&state=...` or `?error=...&error_description=...`).
   - Use existing `parseOAuthCallbackParams` from `shared/auth/utils`.
   - On success: invoke a **registered handler** with `{ code, state }`; handler calls `completeOAuthFlow(code)` (or equivalent). Respond with minimal HTML: “OAuth complete. You can close this window.”
   - On error: invoke an error handler if needed; respond with “OAuth failed: …” and optionally close.
4. **Lifecycle**:
   - `start(): Promise<{ port, redirectUrl }>` — start server, return port and `http://localhost:<port>/oauth/callback`.
   - `stop(): Promise<void>` — close server.

### Handler registration

- The server does **not** import `InspectorClient`. It exposes a **callback** (or promise) that the **caller** (TUI or CLI) provides when starting the server.
- Example:

  ```ts
  type OAuthCallbackHandler = (params: { code: string; state?: string }) => Promise<void>;
  type OAuthErrorHandler = (params: { error: string; error_description?: string }) => void;

  start(options: {
    port?: number;
    onCallback?: OAuthCallbackHandler;
    onError?: OAuthErrorHandler;
  }): Promise<{ port: number; redirectUrl: string }>;
  ```

- TUI/CLI passes `onCallback` that calls `client.completeOAuthFlow(params.code)` and then stops the server (or marks flow complete).

### State validation

- We can store `state` when starting the OAuth flow and verify it in the callback. The design doc references `state` in the redirect. For a first version, we can optionally validate `state` if the client provides a checker; otherwise we document that we use a single temporary server per flow to reduce confusion.

### Technology

- Use Node `http` module **or** Express. Express is already used in `server` and `shared/test`; a minimal Express app is simple. Alternatively, a single `http.createServer` with a small router keeps `shared` free of Express if we prefer. **Recommendation**: Start with `http.createServer` to avoid adding Express to `shared`; we can switch to Express later if we want to align with server/test.

---

## TUI Flow (DCR/CIMD, No Client Config)

### Config

- **No config gate for auth.** Auth is available for **all HTTP servers** (SSE, streamable-http). We always pass `oauth: { ...(config.oauth || {}) }` when creating `InspectorClient` for HTTP; `redirectUrl` is set from the callback server when the user triggers “Authenticate.”
- **Optional override**: Per-server `oauth` in config (e.g. `scope`, `storagePath`, `redirectUrl`) is merged in. Normally we derive `redirectUrl` from the callback server.

### When to run OAuth

1. **Explicit “Authenticate” (A):** User triggers “Authenticate” for the selected HTTP server. We run OAuth, then user presses “Connect.”
2. **401 on connect:** If connect fails and we see a **401** in fetch-request history, we show “401 Unauthorized. Press **A** to authenticate.” [A]uth is already available; user presses A, completes flow, then C to connect.
3. **Future:** Auto-initiate auth when we detect 401 on connect, or auto-retry connect after auth completes.

### 401 handling (current)

- On connect failure we inspect `fetchRequests` for `responseStatus === 401`. If status is error, the server is HTTP, and a 401 was seen, we display **“401 Unauthorized. Press A to authenticate.”** We do not auto-start auth; user presses A. Hint is hidden during auth and after “OAuth complete.”

### End-to-end flow

1. User selects an HTTP server and triggers “Authenticate” (or connects first, gets 401, then sees hint and presses “Authenticate”).
2. TUI ensures `InspectorClient` has OAuth config: `setOAuthConfig({ redirectUrl })` (and optionally `storagePath`). `redirectUrl` comes from the callback server (see below).
3. **Start callback server**:
   - `const { port, redirectUrl } = await callbackServer.start({ onCallback, onError })`.
   - `onCallback` calls `selectedInspectorClient.completeOAuthFlow(params.code)` and then `callbackServer.stop()` (or marks done).
4. Set `oauth.redirectUrl` to `redirectUrl` (if not already) and call `client.authenticate()` (normal mode only; guided deferred).
5. InspectorClient runs **discovery** (in Node → no CORS), performs **DCR or CIMD**, gets auth URL, and dispatches `oauthAuthorizationRequired`.
6. TUI **opens the auth URL** in the user’s browser (e.g. `open` on macOS, `xdg-open` on Linux, `start` on Windows), or shows the URL and asks user to open it. We can use Node `child_process.spawn` with the platform-specific command, or a small library (e.g. `open`) if we add it as a dependency.
7. User signs in at the IdP; IdP redirects to `http://localhost:<port>/oauth/callback?code=...&state=...`.
8. Callback server receives the request, parses params, calls `onCallback` → `completeOAuthFlow(code)`, responds with “Success” page, then stops.
9. TUI shows “OAuth complete” and enables Connect (or user clicks Connect).
10. User clicks **Connect**. `connect()` uses existing `authProvider`; tokens are in storage. **No change to connect logic.**

### Existing connect

- Connect already uses `createTransport` with `authProvider` when OAuth is configured. So **connect “just works”** once OAuth has been completed and tokens are stored.

---

## CLI Reuse

- Same **callback server** module in `shared` can be used by the CLI when connecting to HTTP(S) MCP servers with OAuth.
- Flow: `mcp-inspector <url> --transport http` (or similar) with OAuth-enabled config → CLI starts callback server, runs `authenticate()`, opens URL, receives callback, `completeOAuthFlow`, then connect.
- CLI would need:
  - A way to enable OAuth for a given URL (config or flag).
  - Spawning the callback server and wiring `onCallback` to `completeOAuthFlow`.

Details can be folded into a later “CLI OAuth” plan; the important point is that the **callback server lives in `shared`** so both TUI and CLI can reuse it.

---

## Discovery (No CORS)

- Discovery runs **in Node** (TUI/CLI process). `discoverOAuthProtectedResourceMetadata` and `discoverAuthorizationServerMetadata` use `fetch` in Node → **no CORS**.
- This avoids the web client’s GitHub Copilot discovery failures. TUI/CLI can discover metadata for `https://api.githubcopilot.com/mcp/` (and similar) as long as the endpoints are reachable.

---

## Implementation Plan

### Phase 1: Shared OAuth callback server

1. **Add** `shared/auth/oauth-callback-server.ts`:
   - `createOAuthCallbackServer()` or a small class with `start` / `stop`.
   - Uses Node `http` (or Express, if we add it to `shared`).
   - Serves `GET /oauth/callback` only (normal mode).
   - Uses `parseOAuthCallbackParams` from `shared/auth/utils`.
   - Returns `{ port, redirectUrl }` from `start`, invokes `onCallback` / `onError`.
   - Handles only one concurrent flow per server instance (single in-flight OAuth).

2. **Tests**: Unit tests for parsing callback URLs, success vs error responses, and that the server returns the expected redirect URLs.

### Phase 2: TUI integration

1. **“Open URL” helper**: Small shared or TUI-local helper that opens a URL in the default browser (Node `spawn` + platform command, or `open` package). Use when handling `oauthAuthorizationRequired`.

2. **Config**:
   - Extend MCP server config (or TUI-specific config) to allow `oauth: {}` (or `oauth: { ... }`) for HTTP servers.
   - When creating `InspectorClient` for such servers, pass `oauth` into options (or call `setOAuthConfig`) with `redirectUrl` left unset initially.

3. **OAuth flow**:
   - Add an “Authenticate” (or similar) action for the selected server when it has `oauth` config.
   - On trigger:
     - Start callback server.
     - Set `redirectUrl` from callback server, then `authenticate()` (normal mode only).
     - On `oauthAuthorizationRequired`, open the URL (or show it).
     - When callback server `onCallback` runs, call `completeOAuthFlow(code)`, then stop the server and show success.

4. **Connect**:
   - No change. Ensure `oauth` config and `authProvider` are passed through so connect uses tokens.

5. **Optional**: Listen for `oauthError` and surface in TUI (e.g. simple messages). `oauthStepChange` is guided-only; defer with guided mode.

### Phase 3: Documentation and CLI (optional)

1. **Docs**: Update `tui-web-client-feature-gaps.md` and any TUI-specific docs to describe OAuth support, DCR/CIMD-only assumption, and the “Authenticate then Connect” flow.
2. **CLI**: If we add CLI OAuth support, wire the same callback server into the CLI OAuth flow as above.

### Future: Guided mode

- Add `GET /oauth/callback/guided`, `redirectUrlGuided`, and `authenticateGuided()` support.
- Extend callback server API and TUI “Authenticate” to support guided flow; add `oauthStepChange` handling and step-wise UI as needed.

---

## Config Shape (Summary)

**MCP server config (TUI):**

```json
{
  "mcpServers": {
    "my-oauth-server": {
      "type": "streamable-http",
      "url": "https://example.com/mcp/"
    }
  }
}
```

- **No `oauth` required.** Auth is available for all HTTP servers (sse, streamable-http). [A]uth is shown whenever the server is HTTP and status is disconnected/error.
- Optional: `oauth: { "scope": "...", "storagePath": "..." }` to override; we merge with defaults.

**InspectorClient options:**

- `oauth.redirectUrl`: Set from callback server when starting the flow.
- `oauth.storagePath`: Optional; default `~/.mcp-inspector/oauth/state.json`.
- No `clientId` / `clientSecret` for DCR/CIMD-only.

---

## References

- [OAuth Support in InspectorClient](./oauth-inspectorclient-design.md)
- [TUI and Web Client Feature Gaps](./tui-web-client-feature-gaps.md)
- `shared/auth/`: providers, state-machine, utils, storage-node
- `shared/mcp/inspectorClient.ts`: `authenticate`, `completeOAuthFlow`, OAuth config, `authProvider` (guided: `authenticateGuided` later)

## DEBUG

https://example-server.modelcontextprotocol.io//authorize?response_type=code&client_id=c73beafa-07b0-490e-8626-30274ff2593f&code_challenge=cAAo3CYOWGSjF747HINXLhnIBbpZbyqw_bMNYm9RNRo&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A55569%2Foauth%2Fcallback%2Fguided&state=49134cd984f4cd1ac88a6c0fb87fbd7e8f10fe5ca45fe53bbb89d597d4642f30&resource=https%3A%2F%2Fexample-server.modelcontextprotocol.io%2F

{"error":"invalid_request","error_description":"Unregistered redirect_uri"}

What if we can't bring up a browser endpoint for redirect (like if we're in a container or sandbox)?

- Can we get the code somehow and manually enter it? What is that flow like?

CIMD

- We probably need to publish a static document for inspector client info
- How do we indicate the resource location to InspectorClient / auth congig
- Are there tests for this, and if so, how do they work?

We need a way in the TUI to config static client, CIMD, maybe whether to try DCR at all?

## Other

Inspector config elements (verify them, and the we support same set)

- Task TTL
- Max total timeout
- Request timeout
