# TUI OAuth Implementation Plan

## Overview

This document describes OAuth 2.1 support in the TUI for MCP servers that require OAuth (e.g. GitHub Copilot MCP). The implementation supports **DCR**, **CIMD**, and **static client** (clientId/clientSecret in config).

**Goals:**

- Enable TUI to connect to OAuth-protected MCP servers (SSE, streamable-http).
- Use a **localhost callback server** to receive the OAuth redirect (authorization code).
- Share callback-server logic between TUI and CLI where possible.
- Support both **Quick Auth** (automatic flow) and **Guided Auth** (step-by-step) with a **single redirect URL**.

**Scope:**

- **Quick Auth**: Automatic flow via `authenticate()`. Single redirect URI `http://localhost:<port>/oauth/callback`.
- **Guided Auth**: Step-by-step flow via `beginGuidedAuth()`, `proceedOAuthStep()`, `runGuidedAuth()`. Same redirect URI; mode embedded in OAuth `state` parameter.

---

## Implementation Status

### Completed

| Component               | Status                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Callback server**     | Done. `core/auth/oauth-callback-server.ts`, single path `/oauth/callback`, serves both normal and guided flows.               |
| **TUI integration**     | Done. Auth available for all HTTP servers (SSE, streamable-http). Auth tab with Guided / Quick / Clear.                       |
| **Quick Auth**          | Done. `authenticate()`, callback server, `openUrl`, `completeOAuthFlow`.                                                      |
| **Guided Auth**         | Done. `beginGuidedAuth`, `proceedOAuthStep`, `runGuidedAuth`. Step progress UI, Space to advance, Enter to run to completion. |
| **Single redirect URL** | Done. Mode embedded in `state` (`normal:...` or `guided:...`). One `redirect_uri` registered with OAuth server.               |
| **401 handling**        | Done. On connect failure, if 401 seen in fetch history, show "401 Unauthorized. Press A to authenticate."                     |
| **DCR / CIMD**          | Done. InspectorClient supports Dynamic Client Registration and CIMD.                                                          |

### Static Client Auth

**InspectorClient** supports static client configuration (`clientId`, `clientSecret` in oauth config). The **TUI does not yet support static client configuration**—there is no UI or config wiring for `clientId`/`clientSecret`. Adding this is pending work.

### Pending Work

1. **Callback state validation (optional)**
   - Store the state we sent when building the auth URL. On callback, parse `state` via `parseOAuthState()` and verify the random part matches.
   - Hardening step; current flow works without it since only one active flow runs at a time.

2. **OAuth config in TUI**
   - Add support for oauth options: `scope`, `storagePath`, `clientId`, `clientSecret`, `clientMetadataUrl`.
   - Store in auth store for the server (or elsewhere)—**not** in server config.
   - Wire through to InspectorClient when creating auth provider.

3. **Redirect URI / port change**
   - If the callback server restarts with a different port (e.g. between auth attempts), the OAuth server may have the old redirect_uri registered, causing "Unregistered redirect_uri". Workaround: clear OAuth state before retrying. Potential improvement: reuse port or document the limitation.

4. **CLI OAuth**
   - Wire the same callback server into the CLI for HTTP servers. Flow: start callback server, run `authenticate()`, open URL, receive callback, `completeOAuthFlow`, then connect.

---

## Assumptions

- **DCR, CIMD, or static client**: Auth options (clientId, clientSecret, clientMetadataUrl, etc.) live in auth store or similar—not in server config.
- **Discovery runs in Node**: TUI and CLI run in Node. OAuth metadata discovery uses `fetch` in Node—**no CORS** issues.
- **Single redirect URI**: Both normal and guided flows use `http://localhost:<port>/oauth/callback`. Mode is embedded in the `state` parameter.

---

## Single Redirect URL (Mode in State)

We use **one redirect URL** for both normal and guided flows. The **mode** is embedded in the OAuth `state` parameter, which the authorization server echoes back unchanged.

### State Format

```
{mode}:{random}
```

- `normal:a1b2c3...` (64 hex chars after colon)
- `guided:a1b2c3...`

The random part is 32 bytes (64 hex chars) for CSRF protection. Legacy state (plain 64-char hex) is treated as `"normal"`.

### Implementation

- `generateOAuthStateWithMode(mode)` and `parseOAuthState(state)` in `core/auth/utils.ts`
- `BaseOAuthClientProvider.state()` uses mode-embedded state
- `redirect_uris` returns a single URL for both modes
- Callback server serves `/oauth/callback` only

---

## Callback Server

### Location

- `core/auth/oauth-callback-server.ts`
- Exported from `@modelcontextprotocol/inspector-core/auth`

### API

```ts
type OAuthCallbackHandler = (params: { code: string; state?: string }) => Promise<void>;
type OAuthErrorHandler = (params: { error: string; error_description?: string }) => void;

start(options: {
  port?: number;
  onCallback?: OAuthCallbackHandler;
  onError?: OAuthErrorHandler;
}): Promise<{ port: number; redirectUrl: string }>;

stop(): Promise<void>;
```

### Behavior

1. Listens on configurable port (default `0` → OS-assigned).
2. Serves `GET /oauth/callback` only (both normal and guided).
3. On success: invokes `onCallback` with `{ code, state }`, responds with "OAuth complete. You can close this window.", then stops.
4. On error: invokes `onError`, responds with error HTML.
5. Caller must **not** `await callbackServer.stop()` inside `onCallback`; the server stops itself after sending the response (avoids deadlock).

---

## TUI Flow

### Config

- Auth is available for all HTTP servers (SSE, streamable-http).
- **Auth config is not stored in server config.** OAuth options (scope, storagePath, clientId, clientSecret, clientMetadataUrl) will live in the auth store for the server or elsewhere—not in the MCP server config.
- `redirectUrl` is set from the callback server when the user starts auth.

### Auth Tab

- **Guided Auth**: Step-by-step. Space to advance one step, Enter to run to completion.
- **Quick Auth**: Automatic flow.
- **Clear OAuth State**: Clears tokens and state.
- Accelerators: G (Guided), Q (Quick), S (Clear) switch to Auth tab and select the corresponding action.

### End-to-End Flow (Quick Auth)

1. User selects HTTP server, presses Q or selects Quick Auth and Enter.
2. TUI starts callback server, sets `redirectUrl` on provider.
3. Calls `authenticate()`.
4. On `oauthAuthorizationRequired`, opens auth URL in browser.
5. User signs in; IdP redirects to `http://localhost:<port>/oauth/callback?code=...&state=...`.
6. Callback server receives request, calls `completeOAuthFlow(code)`, responds with success page.
7. TUI shows "OAuth complete. Press C to connect."

### End-to-End Flow (Guided Auth)

1. User selects HTTP server, presses G or selects Guided Auth.
2. TUI starts callback server, sets `redirectUrl`, calls `beginGuidedAuth()`.
3. User advances with Space (or runs to completion with Enter).
4. At authorization step, browser opens with auth URL (state includes `guided:...`).
5. User signs in; IdP redirects to same `/oauth/callback` with code and state.
6. Callback server receives, calls `completeOAuthFlow(code)`, responds with success page.
7. TUI shows completion.

---

## Config Shape

**MCP server config:**

```json
{
  "mcpServers": {
    "hosted-everything": {
      "type": "streamable-http",
      "url": "https://example-server.modelcontextprotocol.io/mcp"
    }
  }
}
```

- Auth is available for all HTTP servers. Server config stays clean—**no oauth block**.
- Auth options (scope, storagePath, clientId, clientSecret, clientMetadataUrl) are **not** stored in server config. They will live in the auth store for the server or elsewhere. TUI does not yet support configuring these; defaults only.

---

## References

- [OAuth Support in InspectorClient](./oauth-inspectorclient-design.md)
- [TUI and Web Client Feature Gaps](./tui-web-client-feature-gaps.md)
- `core/auth/`: providers, state-machine, utils, storage-node, oauth-callback-server
- `core/mcp/inspectorClient.ts`: `authenticate`, `beginGuidedAuth`, `runGuidedAuth`, `proceedOAuthStep`, `completeOAuthFlow`, `authProvider`
