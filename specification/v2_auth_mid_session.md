# Inspector V2 — Mid-session authorization

### [Brief](README.md) | [V2 Scope](v2_scope.md) | [Auth hardening](v2_auth_hardening.md) | [EMA / XAA](v2_auth_ema.md) | [Smoke testing](v2_auth_smoke_testing.md)

Design for **mid-session authorization** in Inspector: detecting when MCP traffic needs new or elevated credentials, responding with the correct OAuth or EMA flow, and restoring the connection — across web, TUI, and CLI.

This spec generalizes beyond **expired access tokens** to include **step-up authorization** (e.g. a tool call returns **403** with `error="insufficient_scope"` and the scopes required for that operation — see [SEP-2350](#sep-2350-step-up-authorization) below).

## Summary

Inspector v2 already supports **connect-time** OAuth and EMA:

- `InspectorClient.authenticate()` / `completeOAuthFlow()` ([V2 Scope](v2_scope.md))
- Connect-time 401 handling in web `App.tsx` and TUI Auth tab hints
- EMA legs 2–3 refresh via `EmaTransportOAuthProvider` when a **live** `OAuthClientProvider` is on the transport ([EMA spec](v2_auth_ema.md))

**Gap:** Authorization can fail whenever the MCP server rejects the credentials in use — **during** `connect()` (including reconnect with a stored token snapshot), **after** a successful connect (expired or revoked tokens), or on **insufficient scope** for a specific request. The web client compounds this: MCP runs on the Hono backend with a **token snapshot** at connect time (`createTokenAuthProvider`), so the backend cannot complete interactive OAuth or reliable silent refresh on its own.

This spec defines:

1. A normalized **`AuthChallenge`** model (what went wrong + what is required).
2. A single core entry point **`handleAuthChallenge()`** (how Inspector responds).
3. **Remote event propagation** so the browser can run auth and reconnect.
4. **Phased delivery** (recovery → step-up → client parity → RPC replay) — see [Architecture](#architecture).

## Architecture

### Code layout

- Challenge types live in `core/auth/challenge.ts`.
- `OAuthManager.handleAuthChallenge()` implements the handler; `InspectorClient` exposes a delegating wrapper.
- Web orchestration starts in `App.tsx`; extract `clients/web/src/utils/authChallengeFlow.ts` if wiring exceeds ~50 lines.

### Web: detection and wire protocol

- **Backend detection:** auth-challenge **intercept fetch** composed with `createFetchTracker` on the transport passed to `createTransportNode` — intercept the MCP HTTP `Response` before the SDK consumes it, parse `WWW-Authenticate`, short-circuit SDK `auth()` on the frozen stub (throw or structured failure; do not rely on stub `auth()`).
- **Dual delivery (mutually exclusive):**
  - **Command-scoped** — failure during an active `POST /api/mcp/send` (or connect handshake send): return **HTTP 200** with `{ ok: false, kind: "auth_challenge" | "transport_error", … }`. Do **not** also emit SSE for the same incident. Client handles recovery and **retries the same JSON-RPC in that call chain** (closure holds the message; no `pendingRequest` echo required).
  - **Ambient** — failure with **no** correlated remote API request in flight (e.g. subprocess exit while idle, background MCP stream drop on stateful transports): SSE `auth_challenge` or `transport_error` only.
- **Remote API vs upstream errors:** reserve HTTP **4xx** on the Inspector remote API for true API failures (bad JSON, missing session, `x-mcp-remote-auth`). Upstream MCP auth/transport outcomes use **`ok: false` + `kind`** on **200** (or a dedicated dependency status if preferred) — do not overload remote **401** with MCP token expiry.
- **HTTP status helpers:** `isAuthChallengeError()` for mid-session 401 and 403; `isUnauthorizedError()` remains for connect-time 401 only.
- **Post-recovery:** `disconnect()` → `connect()` to re-snapshot tokens to the backend. No token-push API in v1.
- **Command retry (in scope Phases 2–3):** after `handleAuthChallenge()` succeeds, **replay the failed send once** in `RemoteClientTransport` / `InspectorClient` (bounded; no loop). `callTool` may stay pending through auth + retry instead of failing then requiring manual retry.
- **Deduplication:** in-memory per session, keyed by `reason` + sorted `requiredScopes`; suppress duplicates until satisfied or scopes change.
- **Multi-tab:** duplicate modals are acceptable until Phase 4 `RemoteOAuthStorage`; then `navigator.locks.request()` single-flight per server URL inside `handleAuthChallenge()`.

### TUI / CLI: detection

- Same `handleAuthChallenge()` entry via a transport fetch wrapper, before the SDK auth retry path.
- Intercept 401 and 403 on streamable HTTP; run union scopes in `handleAuthChallenge()` for step-up. Do not rely on the SDK built-in 403 retry (challenge-only scope, no SEP-2350 union).
- Legacy SSE transport: 401 only (no 403 step-up in SDK).
- Replace TUI `show401AuthHint` with the `authChallenge` event (Phase 4).
- Web remote: command-scoped auth retry in `RemoteClientTransport.send()` (Phases 2–3). TUI/CLI direct transport: same pattern via fetch intercept + local retry (Phase 4).

The SDK (`@modelcontextprotocol/sdk` 1.29.0) auto-retries 401/403 on streamable HTTP `send()` but does not union scopes for step-up — Inspector owns SEP-2350 union in `handleAuthChallenge()`.

### Scope and EMA

- **Previously requested scopes:** `OAuthStorage.scope` / `saveScope()` per server.
- **After successful authorize:** `saveScope(authorizationScopes)`; step-up uses union; 401 re-login replaces scope.
- **EMA mint scopes on 401 refresh:** challenge `scope` from `WWW-Authenticate` if present, else configured `oauth.scope`, else PRM `scopes_supported` (`resolveEmaScopes` order).
- **EMA step-up (valid IdP session):** silent legs 2–3 re-mint with `authorizationScopes` (union). Same toast as 401 refresh. No modal, no resource-AS redirect. Resource MCP scopes are on leg 2/3 token requests, not leg 1 (`openid offline_access` only).

### RPC retry

- After every successful recovery (401 refresh, EMA re-mint, step-up), **retry the failed MCP request once** (bounded; on replay failure surface the tool error, do not loop).
- **Command-scoped (Phases 2–3, in scope):** inline `/api/mcp/send` response → `handleAuthChallenge()` → reconnect → **retry the same JSON-RPC from the caller closure** in `RemoteClientTransport` / `InspectorClient.callTool`. No SSE `pendingRequest` needed.
- **Ambient SSE (Phase 5 / rare):** when auth or transport failure is delivered only via SSE (no active send), attach `context.pendingRequest` if a replay target exists; otherwise mark session degraded until the user acts.

### UX

| Situation | Behavior |
| --------- | -------- |
| Silent recovery (refresh / EMA re-mint / EMA step-up) | Brief toast: “Refreshing authorization…” |
| **401** — interactive re-auth required | Toast “Session expired, re-authenticating…” → auto-start redirect (same as connect-time). No confirm modal. |
| **403** step-up — standard OAuth | Blocking modal: scopes, tool context, **Authorize** / **Cancel** |
| **Cancel** on standard-OAuth step-up modal | Stay connected. Failed tool shows error. Other scoped operations may still work. Do not disconnect. |
| **401** — user aborts IdP redirect or callback fails | Stay connected (degraded). Persistent re-auth banner. Auth-gated calls fail until recovery. Do not auto-disconnect. |
| Hard failure (`kind: "failed"`) | Persistent error toast |

TUI: standard-OAuth step-up uses Auth tab message + Cancel semantics. EMA step-up is silent. CLI mirrors when OAuth is wired (Phase 4).

Connection Info showing effective vs pending scopes is out of scope for v1.

### When silent recovery fails

Silent path = refresh token grant (standard OAuth) or EMA legs 2–3 re-mint (valid IdP session). Falls through to interactive when silent cannot succeed:

| Protocol | Silent fails when |
| -------- | ----------------- |
| Standard OAuth | No `refresh_token`; refresh token expired/revoked; AS rejects refresh; no tokens in storage |
| EMA | No IdP session; legs 2–3 mint error (bad resource client creds, AS/network errors) |
| Step-up (403) | Standard OAuth: interactive consent (modal + resource-AS redirect). EMA (valid IdP session): silent legs 2–3 re-mint — same as 401 refresh |
| Web | Silent runs in the browser after inline send `auth_challenge` or ambient SSE; the backend cannot refresh frozen tokens |

### Test infrastructure — composable server scope requirements

Step-up UX and integration tests need an MCP server that returns **HTTP 403** + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"` on specific operations while accepting a valid token for others. Use the **config-driven composable test server** (`server-composable`, `test-server-http.ts`) — not hard-coded routes in application code.

#### Config: `requiredScopes` on preset refs

Add an optional **`requiredScopes`** field on tool, resource, and prompt **preset refs** in composable config files. `resolve-config.ts` merges it onto the resolved capability definition; at HTTP startup the server builds a lookup registry from that merged config.

```json
{
  "serverInfo": { "name": "step-up-demo", "version": "1.0.0" },
  "transport": { "type": "streamable-http", "port": 8099 },
  "oauth": {
    "enabled": true,
    "requireAuth": true,
    "scopesSupported": ["mcp", "tools:read", "weather:read", "admin:write"],
    "supportDCR": true,
    "supportRefreshTokens": true
  },
  "tools": [
    { "preset": "echo" },
    { "preset": "get_temp", "requiredScopes": ["weather:read"] },
    { "preset": "add", "requiredScopes": ["admin:write"] }
  ],
  "resources": [
    {
      "preset": "static_text",
      "params": { "uri": "file:///secret.txt", "name": "secret" },
      "requiredScopes": ["secrets:read"]
    }
  ]
}
```

| Field | Location | Purpose |
| ----- | -------- | ------- |
| `oauth.scopesSupported` | **Existing** | Advertises scopes in AS / protected-resource metadata (`scopes_supported`). List **every** scope the AS may grant, including those referenced by `requiredScopes`. Inspector discovers these for connect-time and step-up consent. |
| `requiredScopes` | **New** on preset refs | Scopes the bearer token must include for **this** capability. Omitted → only global bearer validity applies (401 if missing/invalid token; no 403 step-up). |

**Smoke flow:** connect with `scopes: "mcp tools:read"` → unscoped tools work → calling `get_temp` → **403 insufficient_scope** with `scope="weather:read"` → Inspector step-up → union re-auth → tool succeeds.

Canonical fixture: `test-servers/configs/oauth-step-up-demo.json` (add with implementation).

#### Enforcement (HTTP middleware)

MCP step-up is signaled at the **streamable-HTTP transport layer**, not as a JSON-RPC error inside HTTP 200. Implement enforcement in **`test-server-oauth.ts`** (or a small helper it calls), **after** bearer token validation and **before** the MCP transport handler:

1. Parse the incoming JSON-RPC body (`method`, `params`).
2. Resolve the target capability and its `requiredScopes` from the registry built at startup.
3. Read granted scopes from the access token (see below).
4. If the token is valid but lacks required scopes, respond **403** with:

   ```http
   HTTP/1.1 403 Forbidden
   WWW-Authenticate: Bearer error="insufficient_scope", scope="weather:read"
   Content-Type: application/json
   ```

   Use the **missing** scope(s) in the `scope=` parameter (space-separated if multiple). Body: JSON-RPC error envelope (same pattern as existing 401 middleware).

**Method → registry lookup:**

| MCP method | Registry key |
| ---------- | ------------ |
| `tools/call` | tool `name` (`params.name`) |
| `resources/read` | resource `uri` (`params.uri`) |
| `prompts/get` | prompt `name` (`params.name`) |
| `resources/templates/read` | template name or URI from `params` |

**Non-goals for v1 fixtures:** do not require step-up on `tools/list`, `resources/list`, or `prompts/list` — real servers typically step up on **use**, not discovery. If list-level challenges are needed later, add an optional advanced `oauth.operations` map (see below); not required for Phase 3 smoke tests.

#### Token scope storage (combined mode prerequisite)

Today combined-mode opaque access tokens are stored in a `Set` with **no granted scope**. Scope enforcement requires:

- **`storeAccessToken(token, { scope })`** at authorization-code and refresh-token issue time (scope from authorize query / stored auth-code data).
- **`getAccessTokenScope(token)`** for middleware checks (space-separated scope string, OAuth convention).
- **Protected-resource mode:** read `scope` from the verified JWT payload when present; fall back to stored metadata for opaque tokens.

Middleware compares granted scopes (split on spaces) against `requiredScopes` (all must be present).

#### Optional advanced: `oauth.operations`

For method-wide defaults (e.g. a baseline scope on every `tools/call`), an optional **`oauth.operations`** map may be added later:

```json
"oauth": {
  "operations": {
    "tools/call": { "requiredScopes": ["tools:execute"] }
  }
}
```

Effective requirement = **union** of matching `oauth.operations` rule(s) and per-capability `requiredScopes`. Defer until a concrete smoke scenario needs list- or method-level challenges.

#### Implementation checklist (Phase 3 test server)

- [ ] Extend `PresetRef` / `load-config.ts` with optional `requiredScopes?: string[]`
- [ ] Extend `ToolDefinition`, `ResourceDefinition`, `PromptDefinition` with `requiredScopes?: string[]`; merge in `resolve-config.ts`
- [ ] Build scope-requirements registry in `test-server-http.ts` from resolved `ServerConfig`
- [ ] Store granted scope on access tokens (combined mode); expose scope lookup for middleware
- [ ] Add scope-check middleware: valid token + missing scope → **403** + `insufficient_scope`
- [ ] Add `test-servers/configs/oauth-step-up-demo.json` and document manual smoke steps in [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md)

## Normative references

- [MCP authorization (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — current stable; includes [Step-Up Authorization Flow](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#step-up-authorization-flow) and [Runtime Insufficient Scope Errors](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#runtime-insufficient-scope-errors)
- [MCP authorization (draft — 2026-07-28 RC target)](https://modelcontextprotocol.io/specification/draft/basic/authorization) — upcoming auth hardening; [release candidate announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) lists six authorization SEPs including **SEP-2350**
- **[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350)** — *Clarify client-side scope accumulation in step-up authorization* ([issue #2349](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2349)); merged into the draft spec's step-up flow
- [EMA extension](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) — see [v2_auth_ema.md](v2_auth_ema.md)
- OAuth 2.0 Bearer Token Usage (`WWW-Authenticate`, `insufficient_scope`) — [RFC 6750 §3.1](https://datatracker.ietf.org/doc/html/rfc6750#section-3.1)
- `@modelcontextprotocol/sdk` **1.29.0** (pinned in repo) — `StreamableHTTPClientTransport` invokes SDK `auth()` on **401** and **403 `insufficient_scope`** during `send()` when an `authProvider` is attached; legacy `SSEClientTransport` handles **401 only** on `send()` (no 403 step-up)

## Goals

### Phase A — Mid-session token recovery (implement first)

- **One core path** for all clients: parse or receive a challenge → `handleAuthChallenge()` → updated tokens or interactive auth.
- **Web remote architecture:** backend detects and **emits** challenges; browser **handles** auth (never runs OAuth redirects on the server).
- Support **token refresh** (silent when possible) for **401 / invalid or expired tokens** at runtime.
- **EMA-aware:** re-run legs 2–3 when the resource token expires; leg 1 only when IdP session is missing or expired ([EMA 401 rules](v2_auth_ema.md)).
- Preserve existing connect-time OAuth behavior — no regressions.

### Phase B — MCP step-up authorization (after Phase A)

- Implement **[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350)** client-side scope accumulation when servers emit runtime **`403 insufficient_scope`** challenges per the [draft Step-Up Authorization Flow](https://modelcontextprotocol.io/specification/draft/basic/authorization#step-up-authorization-flow).
- Align with the upcoming **2026-07-28** MCP authorization revision (Inspector targets the draft semantics even while pinned to SDK/spec `2025-11-25` today).

### Phase C — Command retry (web remote)

- After successful auth recovery on a **command-scoped** failure, **automatically retry the failed MCP request once** (Phases 2–3). Ambient SSE replay edge cases remain Phase 5.

## Non-goals

- v1 / v1.5 backport (v2 only).
- **Client credentials grant** ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225)) — separate track.
- **SAML** EMA leg 1 — out of scope per EMA spec.
- **IdP RP-initiated logout (end-session)** — local sign-out only today; see EMA spec §Future.
- Defining MCP server or authorization-server wire formats — Inspector consumes whatever the SDK and HTTP responses expose; extensibility hooks documented below.

## Terminology

| Term | Meaning |
| ---- | ------- |
| **Auth challenge** | Structured description of why authorization failed and what is required to proceed. Not raw HTTP. |
| **`handleAuthChallenge()`** | Core orchestrator: given a challenge, attempt silent satisfaction, else start interactive auth. |
| **Connect-time auth** | First authorization during `InspectorClient.connect()` when **no** token snapshot is sent (web: `App.tsx` → `authenticate()` on plain 401). Already implemented for that path. |
| **Mid-session auth** | Any authorization failure **after** tokens were supplied to the transport — including reconnect with a stored snapshot, post-connect RPCs, expiry, revocation, and step-up scopes. **This spec.** |
| **Step-up auth** | MCP [Step-Up Authorization Flow](https://modelcontextprotocol.io/specification/draft/basic/authorization#step-up-authorization-flow): token is valid but **insufficient scope** for the current operation. Runtime signal is typically **HTTP 403** + `WWW-Authenticate: Bearer error="insufficient_scope"`. Governed by **[SEP-2350](#sep-2350-step-up-authorization)**. |
| **Recover / refresh** | Informal shorthand for satisfying a **`token_expired`** (or similar) challenge without user interaction when refresh or EMA re-mint succeeds. Prefer **`handleAuthChallenge`** in API names. |
| **Token snapshot** | Web-only: OAuth tokens copied into `POST /api/mcp/connect` and frozen in `createTokenAuthProvider` on the backend. |

## Current architecture (why mid-session fails on web)

```text
TUI / CLI                          Web
─────────                          ───
InspectorClient                    InspectorClient (browser)
  └─ live OAuthClientProvider        └─ live OAuthClientProvider
       └─ MCP SDK transport               └─ RemoteClientTransport.start()
            └─ 401 → provider.auth()            └─ snapshots tokens once
                                                      └─ Hono backend
                                                           └─ createTokenAuthProvider (frozen)
                                                                └─ MCP SDK transport
                                                                     └─ 401 → stub cannot refresh/redirect
```

**TUI/CLI:** OAuth authority and MCP transport live in the same process. The SDK can call `tokens()`, refresh, or fire `oauthAuthorizationRequired`.

**Web:** OAuth authority is in the browser; MCP HTTP is on the backend. Only **connect-time** 401 is wired today when **no** token snapshot is sent (`App.tsx` → `authenticate()`). When the browser **does** send a snapshot (reconnect with stored tokens, or post-OAuth `connect()` where the server still rejects the token), failures on `/api/mcp/send` — **including `initialize` during `connect()`** — do not trigger browser re-auth. The MCP SDK invokes `auth()` on the frozen `createTokenAuthProvider` stub; recovery fails and often surfaces as **HTTP 500** (e.g. SDK error *"OAuth client information must be saveable for dynamic registration"*) instead of **401**, because the stub cannot persist DCR results or run browser redirects.

### Known failure: reconnect with stored tokens (pre–Phase 2)

This is the same root cause as mid-session tool-call failures; only the triggering RPC differs (`initialize` during `connect()` vs e.g. `tools/list` after connected).

| Situation | Today (web remote) | After Phase 2 |
| --------- | ------------------ | ------------- |
| No tokens in storage; user clicks **Connect** | Remote 401 → browser `authenticate()` → OAuth → connect | Unchanged (connect-time path) |
| Stored tokens present (expired, revoked, wrong registration, or server-invalidated); user clicks **Connect** | Token snapshot sent → MCP 401 → stub `auth()` → **500** / opaque SDK error; user sees **Failed to connect**, not re-auth | Fetch wrapper emits **`auth_challenge`** → browser `handleAuthChallenge()` → refresh or interactive re-auth → reconnect |
| Connected; token becomes invalid; user calls a tool | Same stub failure or opaque error on `/api/mcp/send` | Same **`auth_challenge`** → recovery → reconnect |

**Workaround until Phase 2:** **Clear stored OAuth state** for the server (Server Settings or Connection Info), then **Connect** again to take the no-snapshot connect-time path. Do **not** rely on proactive JWT `exp` checks at connect as a substitute for Phase 2 — they only cover clock-expired JWTs, not server-rejected tokens, opaque access tokens, or registration mismatches; challenge detection from the MCP HTTP response remains the source of truth (see [Parsing](#parsing-best-effort-extensible)).

## SEP-2350 — step-up authorization

[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350) clarifies how MCP clients should behave during **step-up authorization** — when a server rejects a request because the access token lacks scopes needed for **that specific operation**.

**Inspector implements SEP-2350 in Phase B** (after basic mid-session 401 / token-refresh handling). Until then, step-up challenges may surface as opaque tool-call failures.

### What the upcoming MCP spec requires

From the [draft authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization) (incorporating SEP-2350):

| Situation | HTTP status | `WWW-Authenticate` | Client behavior |
| --------- | ----------- | ------------------ | --------------- |
| No token / invalid / expired token | **401** | `scope` may guide initial selection | Refresh if possible; else full (re-)authorization. **Replace** scope set on full re-login (down-scoping opportunity). |
| Valid token, insufficient scope (runtime) | **403** | `error="insufficient_scope"`, `scope="…"` per [RFC 6750 §3.1](https://datatracker.ietf.org/doc/html/rfc6750#section-3.1) | **Step-up flow** — see below. |

**Server posture (SEP-2350):** servers emit scopes needed for the **current operation only**, not the union of everything the client was ever granted. Servers remain stateless regarding client scope history.

**Client posture (SEP-2350 — Step-Up Authorization Flow step 2):**

1. Parse `WWW-Authenticate` from the 403 (or AS error) response.
2. Compute **`requiredScopes = union(previouslyRequestedScopes, challengeScopes)`** — union of the client's previously **requested** scope set and the scopes from the current challenge. Do **not** replace the prior set with the challenge scopes alone (that would drop permissions needed for other tools).
3. Initiate (re-)authorization with the union scope set.
4. Retry the original MCP request with the new token (bounded retries).

Reference implementation discussion: [python-sdk PR #2676](https://github.com/modelcontextprotocol/python-sdk/pull/2676) (403 → union; 401 → replace).

### Inspector mapping for SEP-2350

- Persist **`previouslyRequestedScopes`** per server in `OAuthStorage.scope` via `saveScope()`.
- `parseAuthChallengeFromResponse()` maps **403 + `insufficient_scope`** → `AuthChallenge { reason: "insufficient_scope", requiredScopes }`.
- `handleAuthChallenge()` for **standard OAuth**: build authorize URL with **union scopes** (interactive). For **EMA** (valid IdP session): silent legs 2–3 re-mint with **`authorizationScopes`** — resource scopes are on the leg 2/3 token requests, not leg 1 OIDC scopes.
- UX: **standard OAuth** step-up — modal (“**Tool X** needs additional permissions…”). **EMA** step-up — silent toast only (valid IdP session); mint failure surfaces error toast.

## Auth challenge model

### Type shape (`core/auth/challenge.ts`)

```typescript
/** Why authorization failed for this MCP interaction. */
export type AuthChallengeReason =
  | "unauthorized"           // Generic 401 — details unknown
  | "token_expired"          // Access token no longer accepted
  | "insufficient_scope"     // Step-up: more scopes required
  | "invalid_token";         // Malformed or wrong audience/resource

/** Normalized challenge for handleAuthChallenge(). */
export interface AuthChallenge {
  reason: AuthChallengeReason;

  /** Scopes from the current challenge (step-up). Per RFC 6750 §3.1 / MCP Runtime Insufficient Scope Errors — scopes needed for this operation. */
  requiredScopes?: string[];

  /**
   * For step-up (SEP-2350): union of previously requested scopes and requiredScopes.
   * Set by handleAuthChallenge before re-authorization; not sent on the wire.
   */
  authorizationScopes?: string[];

  /** Resource indicator / MCP resource URL when known (EMA RFC 8707). */
  resource?: string;

  /** Resource authorization server audience when known. */
  audience?: string;

  /** Optional human-readable detail from server or SDK (for UI, not parsing). */
  message?: string;

  /** MCP method / tool name that triggered the challenge (for UX: “authorizing for tool X”). */
  context?: {
    method?: string;
    toolName?: string;
    /** Optional: JSON-RPC to replay for ambient SSE delivery only (no caller closure). */
    pendingRequest?: import("@modelcontextprotocol/sdk/types.js").JSONRPCMessage;
  };

  /** Opaque raw hints for logging and forward-compatible parsers. */
  raw?: {
    httpStatus?: number;
    wwwAuthenticate?: string;
  };
}
```

### Parsing (best effort, extensible)

Challenge construction is **layered** — do not message-guess. Parse at the point of failure: when the MCP transport returns **401/403**, when `transport.send()` throws, or when `onerror` fires with an auth status code.

1. **SDK / transport error** — preserve HTTP status / `code` (existing pattern in `core/mcp/remote/node/server.ts`; web uses `isAuthChallengeError()` for mid-session detection). Treat **401** and **403** separately per MCP [Error Handling](https://modelcontextprotocol.io/specification/draft/basic/authorization#error-handling) (401 = invalid/missing token; 403 = insufficient scope).
2. **`WWW-Authenticate` Bearer** — parse `error="insufficient_scope"`, `scope="…"`, `error="invalid_token"`, `resource_metadata="…"`, etc. from the **HTTP response headers on the failing MCP request**. See [Runtime Insufficient Scope Errors](https://modelcontextprotocol.io/specification/draft/basic/authorization#runtime-insufficient-scope-errors).
3. **Future MCP extensions** — challenge payloads attached to JSON-RPC errors; map into the same struct without changing `handleAuthChallenge()`'s signature.

When parsing fails, use `reason: "unauthorized"` and still allow interactive re-auth.

### Challenge vs connect-time 401

| | Connect-time (no snapshot) | Runtime / reconnect (snapshot sent) |
| --- | --- | --- |
| **When** | First connect with no stored tokens; `initialize` gets 401 before any bearer token was sent to the backend | Reconnect with stored tokens, or any MCP request after a token snapshot was frozen on the backend — **including `initialize` during `connect()`** |
| **Detection** | `connect()` throws **401** to the browser | MCP HTTP **401/403** on backend transport → **`auth_challenge`** (Phase 2); today often **500** from stub `auth()` |
| **Handler** | `authenticate()` (today) | `handleAuthChallenge()` (this spec) |
| **Web follow-up** | Redirect or silent connect | Recover tokens in browser → **disconnect + connect** → **inline send retry** (Phases 2–3) |

Both paths may call the same underlying OAuth/EMA primitives (`authenticate()`, refresh, `completeOAuthFlow()`); only **detection** and **re-snapshot reconnect** differ. Phase 2 unifies recovery for the snapshot path; it does **not** replace the no-snapshot connect-time path.

## Core API — `handleAuthChallenge()`

**Location:** `OAuthManager.handleAuthChallenge()`; `InspectorClient` exposes a delegating wrapper.

```typescript
export type AuthChallengeOutcome =
  | { kind: "satisfied" }                    // New tokens in OAuthStorage; caller may reconnect transport
  | { kind: "interactive"; authorizationUrl: URL }
  | { kind: "failed"; error: Error };

/** Satisfy an auth challenge when possible. */
async handleAuthChallenge(challenge: AuthChallenge): Promise<AuthChallengeOutcome>;
```

### Strategy by protocol and reason

#### Standard OAuth (`protocol: "standard"`)

| Reason | Silent path | Interactive path |
| ------ | ----------- | ---------------- |
| `token_expired`, `invalid_token`, `unauthorized` | SDK refresh via stored `refresh_token` when AS supports it | New authorization code flow (`authenticate()`) |
| `insufficient_scope` | Not applicable — need new consent | **[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350):** authorization URL with **`authorizationScopes`** = union(previously requested, `requiredScopes`) — not replace |

Uses existing `BaseOAuthClientProvider`, storage, and `authenticate()` / `completeOAuthFlow()`.

#### EMA (`protocol: "ema"`)

Per [EMA 401 rules](v2_auth_ema.md): **do not** fall back to standard resource-OAuth redirect.

| Reason | Silent path | Interactive path |
| ------ | ----------- | ---------------- |
| `token_expired`, `unauthorized` (resource token) | `refreshEmaResourceTokens()` / legs 2–3; scopes: challenge `WWW-Authenticate` scope → configured `oauth.scope` → PRM `scopes_supported` | — |
| IdP session missing / expired | — | Leg 1 IdP OIDC redirect (`startEmaIdpAuthorization`) then legs 2–3 |
| `insufficient_scope` | **Silent:** re-mint legs 2–3 with **`authorizationScopes`** (union) | **Leg 1** IdP redirect when IdP session invalid — separate from step-up UX; then legs 2–3 with union scopes |

Uses `EmaTransportOAuthProvider`, `emaFlow.ts`, and `resourceContext.ts` (extend scope resolution to prefer challenge scopes when present).

### After `kind: "satisfied"`

| Client | Action |
| ------ | ------ |
| **TUI / CLI** | Live provider; fetch intercept + **send retry** after `handleAuthChallenge()` (Phase 4). |
| **Web** | **`disconnect()` → `connect()`** to re-snapshot tokens, then **inline send retry** (Phases 2–3). |

Ambient SSE failures without a caller closure may require manual retry or Phase 5 `pendingRequest` replay.

### After `kind: "interactive"`

Same as connect-time today:

- **Web (401):** toast → auto-redirect → `/oauth/callback` → `completeOAuthFlow()` → reconnect.
- **Web (403, standard OAuth):** modal → on Authorize, stash pending server id → redirect → `/oauth/callback` → `completeOAuthFlow()` → reconnect.
- **EMA (IdP session missing or expired):** leg 1 IdP redirect → callback → legs 2–3 → reconnect.
- **TUI / CLI:** `oauthAuthorizationRequired` → browser → callback → `completeOAuthFlow()` → reconnect if needed.

### After `kind: "failed"` or user **Cancel** (standard-OAuth step-up modal only)

Do **not** disconnect the MCP session for recoverable challenges.

| Reason | Cancel / failed outcome |
| ------ | ------------------------ |
| `insufficient_scope` (standard OAuth, user Cancelled) | Stay connected; failed tool shows error; other scoped operations may still work |
| `insufficient_scope` (EMA, silent path) | No Cancel — auto re-mint; on mint failure → `kind: "failed"` toast, stay connected (degraded) |
| `token_expired` / `unauthorized` | Stay connected (**degraded**); banner to re-authenticate; auth-gated calls fail until recovery |

## Remote wire protocol (web)

Backend **reports** challenges; browser **handles** them. One internal `AuthChallenge` object; **one delivery channel per incident** (inline **or** SSE, never both).

### Detection

Auth challenges are detected when MCP traffic fails — on the MCP HTTP response (fetch intercept), in `transport.send()` error handling, or in transport `onerror`. The browser runs `handleAuthChallenge()`.

```text
Command-scoped (primary):
  POST /api/mcp/send
    └─ backend transport fetch intercept → parseAuthChallengeFromResponse()
         └─ return 200 { ok: false, kind: "auth_challenge", authChallenge }
              └─ RemoteClientTransport.sendWithAuthRecovery()
                   └─ handleAuthChallenge() → reconnect → retry same JSON-RPC

Ambient (fallback):
  transport.onclose / background MCP failure (no active send)
    └─ RemoteSession.pushEvent({ type: "auth_challenge" | "transport_error", data })
         └─ SSE → shared recoverAuth() handler
```

#### Web — detection (`core/mcp/remote/node/`)

Inside an active `RemoteSession`, when MCP traffic fails with an auth error:

- **Auth-challenge intercept fetch** — composed with `createFetchTracker` on the fetch passed to `createTransportNode`. On **401** or **403**, parse `WWW-Authenticate`, short-circuit SDK `auth()` on the frozen stub.
- **`/api/mcp/send`** — when failure is tied to that request, return structured **`ok: false`** body (not opaque **500**); do **not** push SSE for the same failure.
- **Transport `onerror` / `onclose`** — when no send is correlated, push SSE `auth_challenge` or `transport_error` (preserve status/code; do not collapse to generic 500).

Parse `WWW-Authenticate` from the response headers on the failing request.

Do **not** confuse MCP server OAuth with Inspector launcher auth (`x-mcp-remote-auth` on requests to the Hono API — that is session auth to the remote backend, not MCP server OAuth).

#### `/api/mcp/send` response shape (command-scoped)

```typescript
type RemoteSendResponse =
  | { ok: true }
  | {
      ok: false;
      kind: "auth_challenge";
      authChallenge: AuthChallenge;
    }
  | {
      ok: false;
      kind: "transport_error";
      error: string;
    };
```

Reserve HTTP **4xx/5xx** on the remote API for Inspector API failures only (malformed body, unknown `sessionId`, launcher auth).

#### TUI / CLI — detection (direct transport)

Same **`handleAuthChallenge()`** entry via **transport fetch wrapper** (before SDK auth retry):

- Intercept **401** and **403** on streamable HTTP; run `handleAuthChallenge()` with SEP-2350 union scopes for step-up. Do **not** rely on SDK built-in 403 retry alone.
- Legacy **SSE** transport: **401** only (no 403 step-up in SDK).
- Dispatch **`authChallenge`** on `InspectorClient` (Phase 4 replaces TUI `show401AuthHint`).
- **`oauthAuthorizationRequired`** fires when `handleAuthChallenge()` returns `interactive`.

### SSE event (ambient only)

Extend `RemoteEvent` in `core/mcp/remote/types.ts`:

```typescript
export interface RemoteAuthChallengeEvent {
  type: "auth_challenge";
  data: AuthChallenge & {
    /** Server catalog id — browser resolves InspectorClient instance. */
    serverId?: string;
  };
}
```

**Rules:**

- Use SSE **only when no active `/api/mcp/send` is waiting** for this failure — never duplicate an inline send response.
- Emit **once per recoverable ambient challenge** (dedupe per [Architecture §Web: detection and wire protocol](#web-detection-and-wire-protocol)).
- Do **not** mark transport dead for recoverable auth challenges unless the SDK closed the connection.
- Include `requiredScopes` when parsed from `WWW-Authenticate`.
- Attach **`context.pendingRequest`** only for ambient cases where replay is desired and no caller closure exists.

### Browser handling

**Command-scoped (primary):**

1. `RemoteClientTransport.send()` receives `{ ok: false, kind: "auth_challenge" }`.
2. `sendWithAuthRecovery()` calls `handleAuthChallenge()` (shared with SSE path).
3. On `satisfied` or post-callback success: `disconnect()` → `connect()` to re-snapshot tokens.
4. **Retry the same JSON-RPC once** (bounded); surface error if replay fails.
5. UX toasts/modals via shared `authChallengeFlow.ts` if wiring exceeds ~50 lines.

**Ambient (SSE fallback):**

1. SSE consumer receives `auth_challenge` or `transport_error`.
2. Same `handleAuthChallenge()` / degraded-session handler (no automatic RPC retry unless `pendingRequest` present).
3. UX per [Architecture §UX](#ux).

## Client matrix

| Concern | Web | TUI | CLI |
| ------- | --- | --- | --- |
| Challenge detection | Inline send response (primary); SSE `auth_challenge` (ambient) | Fetch intercept on live transport | Same as TUI when OAuth wired |
| Auth execution | Browser `OAuthManager` | Node `OAuthManager` | Node (when implemented) |
| OAuth storage today | `BrowserOAuthStorage` (sessionStorage) | `NodeOAuthStorage` (file) | None |
| OAuth storage target | `RemoteOAuthStorage` → shared `oauth.json` ([EMA spec §Shared storage](v2_auth_ema.md)) | File | File |
| Post-success | Remote reconnect + **inline send retry** (Phases 2–3) | Reconnect + local send retry (Phase 4) | Same as TUI when OAuth wired |
| Step-up UX | Modal (standard OAuth); silent (EMA) | Same | Same as TUI when OAuth wired |
| EMA IdP config | Client Settings | `client.json` (Phase 4) | `client.json` (Phase 4) |

## Relationship to other specs

| Doc | Relationship |
| --- | ------------ |
| [v2_auth_ema.md](v2_auth_ema.md) | EMA legs 2–3 re-mint on resource-token challenges; scope resolution; no resource-OAuth fallback |
| [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) | Manual smokes after implementation; add mid-session / step-up scenarios |
| [v2_storage.md](v2_storage.md) | Shared `oauth.json` via `RemoteOAuthStorage` |
| [v2_scope.md](v2_scope.md) | Mid-session authorization extends “OAuth Handling” |
| [v2_auth_hardening.md](v2_auth_hardening.md) | Connect-time SEPs (2468, 837, 2352, 2207, 2351); v2 SDK upgrade path; overlaps SEP-2350 scope union |

## Phased implementation

Phases 1–2 deliver **Phase A** (token recovery + **command-scoped retry**). Phase 3 delivers **Phase B** (SEP-2350 step-up + retry). Phase 4 is client parity and shared storage. Phase 5 covers **ambient SSE replay** edge cases and hardening.

### Phase 1 — Foundation (core + types)

- [ ] Add `AuthChallenge`, `AuthChallengeReason`, `AuthChallengeOutcome` in `core/auth/challenge.ts`
- [ ] Add `parseAuthChallengeFromResponse(...)` — **401 and 403**, `WWW-Authenticate`, SDK error
- [ ] Add `isAuthChallengeError()` in web utils
- [ ] Implement `OAuthManager.handleAuthChallenge()` for **standard OAuth** (`token_expired` / generic 401 → refresh or interactive)
- [ ] Unit tests for parser and standard-OAuth branches

### Phase 2 — Web remote propagation (401 / token recovery)

- [ ] Backend auth-challenge intercept fetch: detect MCP **401/403** before frozen stub `auth()` (applies to **`/api/mcp/send` and failures during connect handshake**, e.g. `initialize`)
- [ ] **`/api/mcp/send` structured response:** `{ ok: false, kind: "auth_challenge", authChallenge }` for command-scoped failures; reserve remote HTTP **401** for launcher auth only
- [ ] **`RemoteClientTransport.sendWithAuthRecovery()`:** `handleAuthChallenge()` → reconnect → **retry same JSON-RPC once**
- [ ] Ambient failures only: SSE **`auth_challenge`** / **`transport_error`** (never duplicate inline send)
- [ ] On satisfaction: disconnect + reconnect; wire 401 auto-redirect; standard-OAuth step-up modal
- [ ] Integration test (mid-session): invalidate access token **after** connect → challenge → reconnect → **`tools/list` auto-retries and succeeds**
- [ ] Integration test (reconnect): complete OAuth, invalidate access token (or use expired JWT fixture), **disconnect** → **`connect()`** → challenge → recovery → connected (must **not** throw *saveable for dynamic registration*)
- [ ] Integration test (silent refresh, web remote): static client + `refresh_token`, invalidate access token only → challenge → silent refresh → reconnect → **auto-retry succeeds**

### Phase 3 — SEP-2350 step-up + EMA scope challenges (Phase B)

- [ ] Parse **403 `insufficient_scope`**; scope union via `saveScope(authorizationScopes)`
- [ ] EMA 403: silent legs 2–3 with union scopes (valid IdP session); leg 1 only when IdP session invalid
- [ ] Composable test server: **`requiredScopes`** on preset refs + HTTP scope middleware (**403** + `insufficient_scope`) — see [Test infrastructure](#test-infrastructure--composable-server-scope-requirements)
- [ ] Add **`test-servers/configs/oauth-step-up-demo.json`**; manual smoke steps in [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md)
- [ ] Integration test: 403 step-up → union re-auth → **tool auto-retries and succeeds**
- [ ] Verify **403** inline send path (same intercept fetch as 401; no SSE duplicate)

### Phase 4 — Client parity + storage

- [ ] TUI: fetch wrapper + `authChallenge` event (replace `show401AuthHint`)
- [ ] CLI: wire `environment.oauth`; same handler
- [ ] Web: `RemoteOAuthStorage` (shared `oauth.json`) + `navigator.locks` single-flight
- [ ] Multi-tab dedupe once shared storage lands

### Phase 5 — Ambient replay + hardening

- [ ] Ambient SSE `auth_challenge`: attach `context.pendingRequest` when replay target exists and no caller closure
- [ ] TUI/CLI direct transport: `sendWithAuthRecovery()` parity with web (Phase 4 if not done earlier)
- [ ] Integration tests: ambient transport failure paths; replay failure surfaces tool error; no infinite loop
- [ ] Align with stateless MCP remote invoke (future): inline request/response remains primary delivery

## Testing

| Layer | What to prove |
| ----- | ------------- |
| Unit | Challenge parsing; scope merge; EMA scope preference over config |
| Integration (local AS) | Expired token → silent refresh → success (TUI direct transport) |
| Integration (web remote, mid-session) | Invalidate token after connect → SSE `auth_challenge` → reconnect → `tools/list` |
| Integration (web remote, reconnect) | Invalidate/expired token before `connect()` with stored snapshot → challenge → recovery → connected (no stub DCR **500**) |
| Integration (web remote, refresh) | Invalidate access token only; `refresh_token` present → silent refresh → reconnect |
| Integration (command retry) | 401 / EMA / 403 recovery → original tool call **auto-retries** via inline send (Phases 2–3) |
| Integration (SEP-2350 step-up) | MCP server returns **403** `insufficient_scope` → union re-auth → retried tool call |
| Composable fixture (manual / CI) | `oauth-step-up-demo.json`: connect with subset of `scopesSupported` → scoped tool/resource → **403** → step-up UX |
| EMA | Invalidate resource JWT only; legs 2–3 re-run; IdP session still valid |
| Manual | Document in [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) §Mid-session auth |

## File touch list (expected)

| Area | Files |
| ---- | ----- |
| Types | `core/auth/challenge.ts` |
| Handler | `core/mcp/oauthManager.ts`, `core/auth/ema/emaFlow.ts`, `core/auth/ema/resourceContext.ts` |
| Remote | `core/mcp/remote/types.ts`, `core/mcp/remote/node/remote-session.ts`, `core/mcp/remote/node/server.ts`, `core/mcp/remote/remoteClientTransport.ts`, transport fetch wrapper in `core/mcp/node/transport.ts` |
| Web app | `clients/web/src/App.tsx`, `clients/web/src/utils/authChallengeFlow.ts`, `clients/web/src/utils/oauthFlow.ts` (`isAuthChallengeError`) |
| TUI | `clients/tui/src/App.tsx` |
| Test server | `test-servers/src/test-server-oauth.ts`, `test-servers/src/test-server-http.ts`, `test-servers/src/load-config.ts`, `test-servers/src/resolve-config.ts`, `test-servers/src/composable-test-server.ts`, `test-servers/configs/oauth-step-up-demo.json` |
| Tests | `clients/web/src/test/integration/mcp/inspectorClient-oauth-e2e.test.ts`, new remote auth-challenge + command-retry tests |

