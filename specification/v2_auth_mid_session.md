# Inspector V2 — Mid-session authorization

### [Brief](README.md) | [V2 Scope](v2_scope.md) | [Auth hardening](v2_auth_hardening.md) | [EMA / XAA](v2_auth_ema.md) | [Smoke testing](v2_auth_smoke_testing.md)

Design and implementation reference for **mid-session authorization** in Inspector: detecting when MCP traffic needs new or elevated credentials, running the correct OAuth or EMA recovery flow, and restoring the session — across **web**, **TUI**, and **CLI**.

For hands-on verification, see [v2_auth_smoke_testing.md §5](v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation).

---

## Summary

Inspector already supports **connect-time** OAuth and EMA: the first `connect()` that hits **401** triggers `authenticate()` / browser redirect / loopback callback, and tokens land in per-client storage.

**Mid-session authorization** covers everything **after** that: a token expires, is revoked, or lacks scopes for a specific operation while the user is working. The server signals this with HTTP **401** (bad/missing token) or **403** + `insufficient_scope` (valid token, not enough scope — **step-up**). Inspector normalizes those signals into an **`AuthChallenge`**, runs **`handleAuthChallenge()`**, and either refreshes silently or starts interactive OAuth.

| Client | Transport model | Auth runs where | Recovery highlights |
| ------ | --------------- | --------------- | ------------------- |
| **Web** | Browser → Hono **remote** backend → MCP server | Browser (`OAuthManager`) | `POST /api/mcp/auth-state` hot-swap; full-page OAuth + **resume snapshot** |
| **TUI / CLI** | **Direct** SDK transport in-process | Node (`OAuthManager`) | Loopback callback on `127.0.0.1:6276`; user retries action after interactive auth |

All three clients share **`core/auth/challenge.ts`** and **`OAuthManager.handleAuthChallenge()`**. UX and wire protocol differ by client.

---

## Background

### Connect-time vs mid-session

| | Connect-time | Mid-session |
| --- | --- | --- |
| **When** | First connect with no valid tokens, or reconnect before a remote session exists | Any MCP RPC **after** credentials were supplied |
| **Typical signal** | `connect()` throws **401** | MCP HTTP **401/403** on an in-flight request |
| **Web handler** | `App.tsx` → `authenticate()` → redirect | `handleAuthChallenge()` → `auth-state` push and/or redirect |
| **Core handler** | Same OAuth primitives | `OAuthManager.handleAuthChallenge()` |

Both paths use the same token storage, refresh, and authorization-code exchange; only **detection** and **session update** mechanics differ.

### Step-up authorization (SEP-2350)

**Step-up** is OAuth for “I have a token, but not permission for *this* operation.” MCP servers usually express it as:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="weather:read"
```

By contrast, **401** means the token is missing, invalid, or expired — fix by refresh or full re-login.

**[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350)** (in the MCP 2026-07-28 authorization hardening) requires clients to **accumulate scopes** on step-up:

| Situation | Client scope behavior |
| --------- | --------------------- |
| **403** step-up | **Union** previously requested scopes with scopes from the challenge — do not drop scopes needed for other tools |
| **401** re-login | **Replace** scope set (user may down-scope at the AS) |

Inspector persists the previously requested set in `OAuthStorage.scope` (`saveScope()`), computes `authorizationScopes` as the union in `handleAuthChallenge()`, and only persists the union after a **successful** `completeOAuthFlow()`.

**UX consequence:** standard-OAuth and **web EMA** step-up need **user-visible consent** before proceeding (web modal, TUI Auth tab confirm, CLI **y/N**). On the web client, EMA `insufficient_scope` shows the same **`StepUpAuthModal`** pattern as standard OAuth, with organization/IdP copy; only after **Authorize** does Inspector run silent re-mint or start an IdP redirect. TUI/CLI may still re-mint silently after their own confirm prompt — see [EMA step-up (web)](v2_auth_ema.md#ema-step-up-web-confirmation).

**Rationale (Inspector as a testing tool):** EMA can often satisfy scope upgrades without a visible IdP prompt when the organization session is still valid. That is convenient in production clients, but Inspector deliberately surfaces the requested scopes first so operators can see *what* permission elevation is happening while exploring MCP servers — the same visibility standard OAuth step-up already provides on web.

Normative background: [MCP authorization — Step-Up Authorization Flow](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#step-up-authorization-flow), [Runtime Insufficient Scope Errors](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#runtime-insufficient-scope-errors), [RFC 6750 §3.1](https://datatracker.ietf.org/doc/html/rfc6750#section-3.1).

---

## Terminology

| Term | Meaning |
| ---- | ------- |
| **App tab** | An Inspector **view** inside one browser window: Tools, Resources, Prompts, etc. (`activeTab` in `App.tsx`). Not a browser tab. |
| **Browser tab** | A top-level browsing context (window/tab) running the Inspector SPA. Each has its own `InspectorClient`, remote session, and OAuth context. |
| **Auth challenge** | Normalized `{ reason, requiredScopes?, … }` — not raw HTTP. Built by `parseAuthChallengeFromResponse()` or received on the remote wire. |
| **`handleAuthChallenge()`** | Core orchestrator: silent refresh / EMA re-mint, or start interactive OAuth. Returns `satisfied`, `step_up_confirm` (EMA/web deferral), `interactive`, or `failed`. |
| **`RemoteAuthState`** | Payload for `POST /api/mcp/auth-state`: fresh `oauthTokens` (+ optional `oauthClient`) pushed to the node backend without tearing down the MCP transport. |
| **Command-scoped recovery** | Failure during an active user action (tool call, connect button). May **retry the same JSON-RPC** once after silent recovery. |
| **Ambient recovery** | Failure with no correlated in-flight command (idle SSE). Prepares the session for the **next** user action — no auto-retry of a specific RPC. |
| **OAuth resume snapshot** | `sessionStorage` blob written before a **full-page** OAuth redirect so the web app can restore server, app tab, and form state after callback. |

---

## Architecture

### Two transport models

Inspector implements mid-session auth twice, by design — not as a shared transport wrapper.

```text
Web remote (browser proxy):
  Browser RemoteClientTransport
    → POST /api/mcp/send
    → Hono RemoteSession + fetch intercept (frozen stub OAuth provider on node)
    → upstream MCP server
  Recovery: handleAuthChallenge() in browser → POST /api/mcp/auth-state → optional send retry

TUI / CLI direct:
  InspectorClient + live OAuthClientProvider on SDK StreamableHTTPClientTransport
  Recovery: handleAuthChallenge() in-process → token swap / reconnect
  Interactive: runRunnerInteractiveOAuth() + loopback callback (127.0.0.1:6276)
```

**Why not unify?** The web node backend uses a **stub** provider (no redirects on the server). TUI/CLI hold a **live** provider. The v2 TypeScript SDK will own **silent** 401/403 retry on direct streamable HTTP ([#2265](https://github.com/modelcontextprotocol/typescript-sdk/pull/2265)); Inspector keeps **`handleAuthChallenge()`**, EMA paths, and **interactive deferral** (modal / confirm / snapshot). See [v2_auth_hardening.md](v2_auth_hardening.md).

**Explicit non-goals for TUI/CLI:** client-side fetch intercept on the SDK transport, `AuthRecoveryTransport`, or mirroring `RemoteClientTransport` on direct paths.

### Recovery shapes

| Shape | When | MCP retry | Page unload |
| ----- | ---- | --------- | ----------- |
| **Silent in-process** | Refresh, EMA re-mint after user confirmed step-up (web modal **Authorize**), TUI/CLI confirm | **Yes** (command-scoped, once) | No |
| **In-app step-up confirm** | Web EMA `insufficient_scope` before re-mint / IdP | **No** — modal only; retry after success toast | No |
| **Interactive full-page** | Standard-OAuth step-up, 401 re-login, EMA IdP leg 1 (after web confirm when applicable) | **No** — user retries action after callback | Yes (web) |

```text
Browser InspectorClient              Hono RemoteSession              MCP server
─────────────────────────            ──────────────────              ──────────
RemoteClientTransport                  StreamableHTTPClientTransport
  OAuthClientProvider (live)             createRemoteAuthProvider (mutable)
       │                                      │
  POST /api/mcp/send ───────────────────────►│ same transport ───────────────►│
       │◄─ { ok: false, auth_challenge }──────│                                │
  handleAuthChallenge()                                                       │
  POST /api/mcp/auth-state { authState } ───►│ setAuthState() → new Bearer    │
  POST /api/mcp/send (retry) ─────────────────►│ same mcp-session-id ────────►│
```

**Why auth-state push?** An earlier approach disconnected and reconnected the remote session on every recovery, which broke upstream MCP session continuity. Hot-swapping credentials on the existing transport matches direct streamable-http behavior.

### Code map

| Area | Primary files |
| ---- | ------------- |
| Challenge types & parsing | `core/auth/challenge.ts`, `core/auth/oauthUx.ts` |
| Handler & storage | `core/mcp/oauthManager.ts`, `core/auth/mcpAuth.ts`, `core/auth/scopes.ts` |
| EMA | `core/auth/ema/emaFlow.ts`, `core/auth/ema/resourceContext.ts` — see [v2_auth_ema.md](v2_auth_ema.md) |
| Web remote backend | `core/mcp/remote/node/server.ts`, `remote-session.ts`, `core/mcp/node/authChallengeFetch.ts` |
| Web remote client | `core/mcp/remote/remoteClientTransport.ts`, `core/mcp/inspectorClient.ts` |
| Web app | `clients/web/src/App.tsx`, `utils/oauthResume.ts`, `utils/pendingReauth.ts`, `utils/browserTabVisibility.ts`, `components/groups/StepUpAuthModal/` |
| TUI | `clients/tui/src/App.tsx`, `utils/tuiOAuth.ts` |
| CLI | `clients/cli/src/cliOAuth.ts` |
| Runner OAuth (TUI/CLI) | `core/auth/node/runner-interactive-oauth.ts`, `oauth-callback-server.ts` |
| Step-up test fixture | `test-servers/configs/oauth-step-up-demo.json`, `test-servers/src/test-server-oauth.ts` |

---

## Auth challenge model

### `AuthChallenge` (`core/auth/challenge.ts`)

```typescript
export type AuthChallengeReason =
  | "unauthorized"
  | "token_expired"
  | "insufficient_scope"
  | "invalid_token";

export interface AuthChallenge {
  reason: AuthChallengeReason;
  requiredScopes?: string[];       // From WWW-Authenticate scope= (this operation)
  authorizationScopes?: string[];  // SEP-2350 union — set before re-auth, not on wire
  resource?: string;
  audience?: string;
  message?: string;
  context?: { method?: string; toolName?: string };
  raw?: { httpStatus?: number; wwwAuthenticate?: string };
}
```

### Parsing

Parsing is **layered** at the point of failure — not by guessing from error messages:

1. HTTP **401/403** on the MCP response (fetch intercept or transport error).
2. **`WWW-Authenticate: Bearer`** — `error`, `scope`, `error_description` (quoted and unquoted RFC 6750 forms).
3. Embedded `authChallenge` on SDK/transport errors.

Mapping highlights:

- **403** + `insufficient_scope` → `reason: "insufficient_scope"`.
- **401** + `invalid_token` → `invalid_token` or `token_expired` as appropriate.
- **401** without Bearer error → `token_expired` (coarse default for silent refresh / reauth UX).
- Parse failure → `unauthorized` (still allows interactive re-auth).

`isAuthChallengeError()` treats mid-session failures only when auth markers are present (challenge object, `WWW-Authenticate`, or `AuthChallengeError`) — not bare HTTP status alone.

Connect-time **401** before tokens exist still uses `isUnauthorizedError()` and `authenticate()` — separate from mid-session detection.

---

## Core API — `handleAuthChallenge()`

**Location:** `OAuthManager.handleAuthChallenge()`; `InspectorClient.handleAuthChallenge()` delegates.

```typescript
export type AuthChallengeOutcome =
  | { kind: "satisfied" }
  | { kind: "interactive"; authorizationUrl: URL; challenge: AuthChallenge }
  | { kind: "failed"; error: Error };
```

### `checkAuthChallengeSatisfied(challenge)`

Read-only check against **current storage** (and token expiry helpers). Used before starting visible OAuth — especially when a background browser tab regains focus and another tab may have already re-authenticated. Does **not** call the authorization server.

- **`token_expired` / `unauthorized`:** valid non-expired access token in storage.
- **`insufficient_scope`:** stored/token scope is a superset of required / union scopes. Empty scope on an `insufficient_scope` challenge returns **false** (do not short-circuit).

### Strategy by protocol

#### Standard OAuth

| Reason | Silent | Interactive |
| ------ | ------ | ----------- |
| `token_expired`, `invalid_token`, `unauthorized` | Refresh via `refresh_token` when supported | Authorization code flow (`authenticate()`) |
| `insufficient_scope` | N/A | Authorize with **`authorizationScopes`** = union(previous, challenge) via `mcpAuth({ forceReauthorization: true })`; navigation **deferred** until UI confirms (web modal / TUI Auth / CLI prompt) |

Union scope is held in `pendingAuthorizationScope` until `completeOAuthFlow()` succeeds; cleared on failure.

#### EMA

Per [v2_auth_ema.md](v2_auth_ema.md): **no** fallback to standard resource-OAuth redirect.

| Reason | Silent | Interactive |
| ------ | ------ | ----------- |
| Resource token expired / unauthorized | Legs 2–3 re-mint | — |
| IdP session missing | — | Leg 1 IdP OIDC redirect, then legs 2–3 |
| `insufficient_scope` | After user confirms (web modal / TUI / CLI), re-mint legs 2–3 with union scopes when IdP session valid | IdP redirect if IdP session invalid |

On **web**, `handleAuthChallenge()` returns **`step_up_confirm`** for EMA `insufficient_scope` until the user clicks **Authorize** in `StepUpAuthModal`; it does **not** call `trySilentEmaAuth()` before that. After confirm, silent re-mint runs in-process when possible; otherwise IdP redirect + callback (same as before).

### Outcomes — what callers do

| Outcome | Web remote | TUI / CLI direct |
| ------- | ---------- | ---------------- |
| **`satisfied`** | `pushAuthState()`; command-scoped: **retry send once** | Reconnect or SDK retry (v2); command wrapper may retry RPC |
| **`step_up_confirm`** | Throw `AuthRecoveryRequiredError` (`emaStepUpConfirm`) → `StepUpAuthModal` (EMA copy) | N/A (web-only deferral) |
| **`interactive`** | Throw `AuthRecoveryRequiredError` (enriched challenge) → App shows modal or redirect + snapshot | `AuthRecoveryRequiredError` or `authChallengeInteractive` → callback server flow |

**InspectorClient events (direct transport):** `authChallengeAmbient` (idle SSE / ambient recovery), `authChallengeCommand` (command-scoped direct recovery — no ambient toast), `authChallengeInteractive`, `authChallengeRecovered`.
| **`failed`** | Toast / banner; stay connected (degraded) | Error message; stay connected (TUI) or exit non-zero (CLI one-shot) |

---

## Web implementation

### Detection and delivery

**Backend** (`core/mcp/remote/node/`):

- **Auth-challenge intercept fetch** on the MCP HTTP transport: on **401/403**, parse headers, throw `AuthChallengeError` **before** the stub provider invokes SDK `auth()`.
- **`createRemoteAuthProvider`**: mutable credentials; `RemoteSession.setAuthState()` updates the upstream Bearer without new `connect()`.

**Dual delivery — one channel per incident:**

| Path | Trigger | Wire | Client behavior |
| ---- | ------- | ---- | --------------- |
| **Command-scoped** | Active `POST /api/mcp/send` | HTTP **200** `{ ok: false, kind: "auth_challenge", authChallenge }` | `handleAuthChallenge()` → `pushAuthState()` → **retry same JSON-RPC once** |
| **Ambient** | Transport error while idle | SSE `auth_challenge` | `handleAmbientAuthChallenge()` → push auth state; **no RPC retry** |

`authReturnedViaHttp` prevents duplicating a command-scoped challenge on SSE.

Inspector API **4xx** are reserved for malformed requests / missing session — not for upstream MCP token expiry.

### `POST /api/mcp/auth-state`

```typescript
interface RemoteSetAuthStateRequest {
  sessionId: string;
  authState: RemoteAuthState;
}

interface RemoteAuthState {
  oauthTokens?: { access_token; token_type; refresh_token?; scope?; … };
  oauthClient?: { client_id; client_secret? };  // reserved for future server-side refresh
}
```

Called by `RemoteClientTransport.pushAuthState()` after browser-side recovery. Seeding uses the same shape on `POST /api/mcp/connect`.

### App orchestration (`clients/web/src/App.tsx`)

**Command-scoped paths** (tool, prompt, resource, app) share `handleCommandScopedAuthRecovery()`:

- Standard-OAuth **or EMA** step-up → `StepUpAuthModal` (defer redirect / re-mint until **Authorize**).
- 401 / EMA IdP (non-step-up) → `prepareOAuthRedirect()` (auto-redirect + snapshot).
- Background browser tab hidden → defer to `pendingReauth`; resume on `visibilitychange` with `checkAuthChallengeSatisfied` first.

**Ambient path:** listens for `authChallengeInteractive` on `InspectorClient` (from SSE when silent recovery cannot complete).

**Disconnect** clears `pendingStepUp`, `pendingReauth`, and `reAuthBanner`.

### Step-up confirmation modal

Shown for **`insufficient_scope`** on **standard OAuth** and **EMA (web)** when recovery will **redirect** to an AS or **re-mint** organization permissions.

- Copy from `core/auth/oauthUx.ts` (`stepUpConfirmMessage`, `stepUpFollowUpMessage`, `stepUpModalTitle`). EMA uses organization / IdP language; standard OAuth uses resource-AS redirect language.
- Lists **`requiredScopes`** (additional scopes only — not the full SEP-2350 union).
- **Authorize (standard OAuth):** write [OAuth resume snapshot](#oauth-resume-snapshot), pre-redirect toast, `beginInteractiveAuthorization()`.
- **Authorize (EMA):** in-progress toast → `handleAuthChallenge(..., { confirmedStepUp: true })` → on `satisfied`, push auth state + success toast (retry hint when command-scoped); on `interactive`, same snapshot + IdP redirect as other EMA flows; on `failed`, error toast.
- **Cancel:** scoped by `StepUpSource` (tool / prompt / resource / app / ambient) — only the triggering panel shows error; session stays connected.

Not shown for: token refresh, 401 re-login, connect-time OAuth.

**Rationale:** Inspector is primarily a **testing and exploration** client. Surfacing step-up scopes before silent EMA re-mint makes permission elevation visible during manual validation (same UX bar as standard OAuth step-up on web). Production MCP clients may skip this confirm when silent re-mint is acceptable.

### OAuth resume snapshot

Full-page redirect (`window.location.href`) destroys in-memory React state. Before navigate, `prepareOAuthRedirect()` writes:

```typescript
interface OAuthResumeSnapshot {
  version: 1;
  serverId: string;
  activeTab: string;           // App tab id ("Tools", …)
  authKind: "step_up" | "reauth";
  tabUi: Partial<Record<InspectorTabId, unknown>>;  // lifted *UiState shells
  remoteSessionId?: string;
  authChallenge?: AuthChallenge;  // step-up: verify scopes after callback
}
```

Key: `mcp-inspector:oauth-resume` in `sessionStorage` (`clients/web/src/utils/oauthResume.ts`).

**Callback flow** (`InspectorClient.resumeAfterOAuth()`):

1. `completeOAuthFlow(code)`.
2. **Consume** snapshot from `sessionStorage` (read + clear — one-shot).
3. `setupClientForServer(serverId)`.
4. If `remoteSessionId` still valid: `attachToSession()` + `pushAuthState()`; else `connect()` (skipped if already connected).
5. Restore `tabUi` and `activeTab` **immediately after consume** (before async token work finishes); clear in-flight result panels. Never re-applied on later reconnect.
6. Step-up: `checkAuthChallengeSatisfied(authChallenge)` — warning toast if scopes still insufficient.
7. Success toast: step-up vs reauth copy; **user manually retries** the action (no auto-replay).

Snapshots **per app tab UI**, not message logs, tool results, or network bodies. Each snapshot is **one-shot**: written immediately before a full-page OAuth redirect, **consumed** (read + cleared from `sessionStorage`) when the `/oauth/callback` handler runs, and UI restored once at that moment. **Explicit user disconnect** clears any pending snapshot and resets `activeTab` to Servers so a later manual reconnect does not pop back to the OAuth-restored tab; transport/client teardown during connect setup does **not** clear the snapshot (so connect-time OAuth can still match the server on callback). A later manual reconnect does not read or apply a consumed snapshot.

### Multiple browser tabs

Each browser tab has its own `RemoteSession` and (today) `BrowserOAuthStorage` in `sessionStorage`. SSE `auth_challenge` is scoped to that session.

When a tab is **hidden**, **interactive** OAuth must not steal focus:

1. Set **`pendingReauth`** (in-memory) instead of modal/redirect.
2. On **`visibilitychange` → visible`:** `checkAuthChallengeSatisfied()` first; if still needed, run visible flow.

Command-scoped recovery (user clicked Run in the foreground tab) is **not** deferred.

Future: shared `RemoteOAuthStorage` → `oauth.json` may use optional `navigator.locks` around silent refresh only — see [v2_auth_ema.md §Shared storage](v2_auth_ema.md).

### Web UX reference

| Situation | Behavior |
| --------- | -------- |
| Silent refresh / EMA re-mint (after confirm) | Toast “Refreshing authorization…” or EMA in-progress toast — no modal |
| **401** interactive | Toast “Session expired…” → auto-redirect; no confirm modal |
| **403** standard-OAuth step-up | Modal → optional pre-redirect toast → redirect → callback restore |
| **403** EMA step-up (web) | Modal (organization copy) → in-progress toast → silent re-mint or IdP redirect → success toast |
| EMA IdP leg 1 (401 / expired IdP) | Toast “Re-authenticating…” → auto-redirect |
| Step-up **Cancel** | Connected; failed action shows error |
| OAuth abort / callback failure | **ReAuthBanner**; Re-authenticate uses in-session `authenticate()` when already connected (no disconnect cycle) |
| Step-up callback, scopes still insufficient | Warning toast — not green success |
| `insufficient_scope` recovery failure (non-banner reasons) | Yellow toast — not ReAuthBanner |
| Concurrent step-up while modal open | Yellow toast — complete or cancel current step-up first |

---

## TUI and CLI implementation

### Principles

- **Live provider** on the SDK transport — same process as MCP.
- **`InspectorClient.withDirectAuthRecovery()`** wraps RPCs: silent `handleAuthChallenge()` + reconnect; **`AuthRecoveryRequiredError`** for interactive.
- **`directAuthRecovery: true`** enables `interceptAuthChallenges` on `createTransportNode` until v2 SDK transport owns silent retry.
- **Interactive OAuth** uses shared **`runRunnerInteractiveOAuth()`** (`core/auth/node/runner-interactive-oauth.ts`): loopback server, browser redirect, `completeOAuthFlow()`, optional post-step-up scope check, **15-minute callback timeout** (configurable).

Default callback: `http://127.0.0.1:6276/oauth/callback` (`--callback-url` / `MCP_OAUTH_CALLBACK_URL`). Only one TUI/CLI listener on that port at a time.

CLI never spawns TUI/web for auth — completes locally or fails.

### TUI UX (`clients/tui/src/App.tsx`)

| Situation | Behavior |
| --------- | -------- |
| Silent recovery | Auth tab: “Refreshing authorization…” |
| **401** | Auto `runOAuthAuthentication()` (same as connect-time) |
| **403** standard-OAuth step-up | Switch to Auth tab; **A** authorize / **C** cancel; browser → callback |
| **403** EMA | Silent re-mint |
| Step-up on connected server | `presentStepUpForServer()` selects server + opens Auth tab |
| Reauth for affected server | `handleAuthRecoveryRequired()` switches server when needed |
| Clear OAuth | Auth tab **S** |

### CLI UX (`clients/cli/src/cliOAuth.ts`)

| Situation | Behavior |
| --------- | -------- |
| Connect-time 401 | `connectInspectorWithOAuth()` → authorize URL on stdout → callback |
| Mid-session interactive | `handleCliAuthRecoveryRequired()` / `withCliAuthRecoveryRetry()` (**one retry**) |
| **403** standard-OAuth step-up | stderr: scope message + `Proceed with step-up authorization? [y/N]` |
| Decline step-up | Exit non-zero |
| Insufficient scope after OAuth | stderr message from `stepUpInsufficientScopeMessage()` |

### SSE limitation

Legacy **SSE** transport: **401 only** on mid-session `send()` (no 403 step-up). Step-up testing targets **streamable HTTP**.

---

## Client matrix

| Concern | Web | TUI | CLI |
| ------- | --- | --- | --- |
| Challenge detection | Inline send + SSE ambient | SDK transport + intercept | Same as TUI |
| Auth execution | Browser `OAuthManager` | Node `OAuthManager` | Node `OAuthManager` |
| OAuth storage | `BrowserOAuthStorage` (sessionStorage) | `NodeOAuthStorage` (file) | Same file as TUI |
| Silent recovery | `auth-state` push + send retry | Reconnect / SDK retry (v2) | One-shot RPC retry |
| Interactive recovery | Modal + full-page redirect + snapshot | Auth tab + callback | stderr **y/N** + callback |
| Step-up confirm | `StepUpAuthModal` | Auth tab **A** / **C** | **y/N** |
| EMA step-up | Web modal + confirm (then silent or IdP) | Confirm on Auth tab, then silent | **y/N**, then silent |
| Multiple browser tabs | Independent sessions; background defer | N/A | N/A |

---

## Test infrastructure

Step-up integration tests and manual smokes use the **composable OAuth server** (`test-servers/build/server-composable.js`) with per-capability scope requirements enforced in HTTP middleware (`test-server-oauth.ts`).

### How scopes work at two levels

| Level | Config field | Role |
| ----- | ------------ | ---- |
| **Authorization server** | `oauth.scopesSupported` | Advertises every scope the AS **may grant** (PRM / AS metadata). Inspector uses this for connect-time consent and step-up union. Must include all scopes referenced by `requiredScopes` below. |
| **Per capability** | `requiredScopes` on a tool, resource, or prompt preset ref | Scopes the **access token must already include** before that RPC succeeds. Missing scope → **403** + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…"`. Omitted → only global bearer validity (401 if no/invalid token). |

**Connect-time vs step-up:** Inspector catalog OAuth scopes control what the user grants on **first connect**. The composable server may accept that token for some operations but reject others until step-up adds more scopes.

Example flow with the sample below:

1. Catalog entry: `"oauth": { "scopes": "mcp tools:read" }` — user connects successfully.
2. `tools/call echo` — no `requiredScopes` → succeeds.
3. `tools/call get_temp` — needs `weather:read` → **403 insufficient_scope** → Inspector step-up with SEP-2350 union (`mcp`, `tools:read`, `weather:read`).
4. After step-up, `get_temp` succeeds; `resources/read` on `file:///secret.txt` still needs another step-up for `secrets:read`.

Step-up is enforced on **use** (`tools/call`, `resources/read`, `prompts/get`), not on discovery (`tools/list`, `resources/list`, `prompts/list`).

### Sample composable config

Illustrates server-level `scopesSupported` plus tool-, resource-, and prompt-level `requiredScopes`. The checked-in smoke fixture [`test-servers/configs/oauth-step-up-demo.json`](../test-servers/configs/oauth-step-up-demo.json) is a **minimal** subset (tools only: `echo` + `get_temp`).

```json
{
  "serverInfo": { "name": "step-up-demo", "version": "1.0.0" },
  "transport": { "type": "streamable-http", "port": 8081 },
  "oauth": {
    "enabled": true,
    "mode": "combined",
    "requireAuth": true,
    "scopesSupported": ["mcp", "tools:read", "weather:read", "secrets:read", "admin:write"],
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
  ],
  "prompts": [
    { "preset": "simple_prompt", "requiredScopes": ["weather:read"] }
  ]
}
```

**Matching Inspector catalog entry** (connect with subset scopes so step-up is exercisable):

```json
"oauth-step-up-demo": {
  "type": "streamable-http",
  "url": "http://127.0.0.1:8081/mcp",
  "oauth": { "scopes": "mcp tools:read" }
}
```

**Run the server:**

```bash
cd clients/web && npm run test-servers:build
node ../../test-servers/build/server-composable.js \
  --config ../../test-servers/configs/oauth-step-up-demo.json
```

### Enforcement (HTTP middleware)

On each MCP request, after bearer validation:

1. Parse JSON-RPC `method` and `params`.
2. Look up `requiredScopes` from the registry built at startup:

| MCP method | Registry key |
| ---------- | ------------ |
| `tools/call` | tool `name` (`params.name`) |
| `resources/read` | resource `uri` (`params.uri`) |
| `prompts/get` | prompt `name` (`params.name`) |
| `resources/templates/read` | template name or URI from `params` |

3. Compare granted scopes on the access token (stored at token issue time in combined mode) against `requiredScopes`.
4. If any required scope is missing, respond **403** with:

   ```http
   WWW-Authenticate: Bearer error="insufficient_scope", scope="weather:read"
   ```

   (`scope=` lists the missing scope(s); body is a JSON-RPC error envelope.)

`requiredScopes` on preset refs is merged in `resolve-config.ts`; no application-code routes — config drives behavior.

### Verification

**Automated (high level):** challenge parsing, scope union, `checkAuthChallengeSatisfied`, `oauthResume`, `runRunnerInteractiveOAuth`; integration suites `inspectorClient-oauth-remote-mid-session-e2e.test.ts`, `inspectorClient-oauth-direct-mid-session-e2e.test.ts`, CLI `oauth-interactive.test.ts` / `cliOAuth.test.ts`.

**Manual:** [v2_auth_smoke_testing.md §5](v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation) — required gate **W1 + W5–W7**, **T1–T2 + T4**, **C1–C2**.

---

## Related specifications

| Document | Relationship |
| -------- | ------------ |
| [v2_auth_hardening.md](v2_auth_hardening.md) | Connect-time SEPs; v2 SDK upgrade; direct transport silent retry delegation |
| [v2_auth_ema.md](v2_auth_ema.md) | EMA legs 2–3 re-mint; scope resolution; no resource-OAuth fallback |
| [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) | Manual OAuth and mid-session validation procedures |
| [v2_storage.md](v2_storage.md) | Target: shared `oauth.json` via `RemoteOAuthStorage` on web |

---

## Future work

- **Web default `RemoteOAuthStorage`** — shared `oauth.json` with TUI/CLI; optional `navigator.locks` for silent refresh single-flight across browser tabs.
- **v2 SDK transport upgrade** — delegate direct streamable HTTP silent 401/403 + SEP-2350 union to SDK; remove `mcpAuth` / client intercept shims where redundant.
- **Server-side token refresh** on the node using `RemoteAuthState.oauthClient` + `refresh_token` (browser owns refresh today).
- **Connection Info** — display effective vs pending scopes.
- **Composable `oauth.operations`** map for method-wide scope defaults in test fixtures.
- **Popup OAuth window** as an alternative to full-page resume (not implemented).

---

## Normative references

- [MCP authorization (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP authorization (draft — 2026-07-28 RC)](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [SEP-2350 — client-side scope accumulation in step-up](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350)
- [EMA extension](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- [RFC 6750 §3.1](https://datatracker.ietf.org/doc/html/rfc6750#section-3.1) — Bearer `insufficient_scope`
