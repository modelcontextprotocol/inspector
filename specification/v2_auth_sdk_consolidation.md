# Inspector V2 Auth — SDK consolidation (as-built)

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [Overview](v2_auth.md) | [EMA / XAA](v2_auth_ema.md) | [Hardening](v2_auth_hardening.md) | [Mid-session](v2_auth_mid_session.md) | [Smoke testing](v2_auth_smoke_testing.md) | SDK consolidation

Record of how Inspector uses `@modelcontextprotocol/client` **2.0.0-beta.4** for authorization after the v2 SDK upgrade: what we moved onto the SDK, what we left Inspector-owned and why, and which small SDK API gaps would let us delete more local wire later.

Related as-built specs: [Hardening](v2_auth_hardening.md), [EMA](v2_auth_ema.md), [Mid-session](v2_auth_mid_session.md).

---

## Summary

Inspector already delegated **connect-time standard OAuth** to SDK `auth()` (via a thin `mcpAuth()` wrapper) as part of the v2 upgrade and hardening work. A follow-up pass looked for remaining protocol code that still duplicated the SDK.

**Changed:**

| Change                  | Detail                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| EMA leg 2 (ID-JAG mint) | `exchangeIdJag` → SDK `discoverAndRequestJwtAuthGrant`                   |
| Scope union helpers     | `scopes.ts` re-exports SDK `computeScopeUnion` / `isStrictScopeSuperset` |

**Not changed** (host integration or incomplete SDK helpers): remoting recovery, durable `OAuthStorage`, navigation/callbacks, EMA leg 1 + leg 3, `AuthChallenge` pipeline, `mcpAuth()`, step-up UX, `CrossAppAccessProvider`.

Net effect: ~30 lines of duplicate protocol logic removed; no files deleted (`tokenEndpoint.ts` remains for leg 3).

---

## Constraint: two transport models

```text
Web:  browser owns OAuth UX + storage API
      Hono owns MCP transport with a frozen/mutable token stub
      401/403 → auth_challenge envelope → browser handleAuthChallenge → POST /api/mcp/auth-state

TUI/CLI: in-process StreamableHTTP/SSE + live OAuthClientProvider
         silent SDK retry where policy allows; Inspector owns interactive confirm + EMA
```

The SDK’s in-process 401/403 retry assumes the live provider and redirect owner share a process. On web they do not — interactive OAuth cannot run on the Hono stub, and recovery must hot-swap tokens on the existing remote session. That architecture is intentional and permanent; consolidation only targets protocol helpers that work on both paths.

---

## Ownership (as-built)

| Concern                                     | Owner                                   | Notes                                                             |
| ------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Standard OAuth flow                         | **SDK** `auth()`                        | Forwarded by `core/auth/mcpAuth.ts`                               |
| `OAuthClientProvider` bridge                | **Inspector** `BaseOAuthClientProvider` | Storage + navigation                                              |
| Issuer-keyed `OAuthStorage`                 | **Inspector**                           | File / remote / session adapters; SEP-2352 `byIssuer`             |
| Discovery / CIMD / refresh / start+exchange | **SDK**                                 | Called from Inspector host code                                   |
| Scope union / strict superset               | **SDK** (re-export)                     | `core/auth/scopes.ts`                                             |
| Grant persistence helpers                   | **Inspector**                           | `resolvePersistedScopeAfterGrant`, `resolveEffectiveGrantedScope` |
| EMA leg 1 (IdP OIDC)                        | **Inspector** + SDK primitives          | `idpOidc.ts`                                                      |
| EMA leg 2 (ID-JAG)                          | **SDK**                                 | Wrapped by `exchangeIdJag`                                        |
| EMA leg 3 (resource token)                  | **Inspector**                           | `redeemIdJagForAccessToken` + `tokenEndpoint.ts`                  |
| EMA transport adapter                       | **Inspector**                           | `EmaTransportOAuthProvider`                                       |
| Mid-session orchestration                   | **Inspector**                           | `OAuthManager.handleAuthChallenge()`                              |
| WWW-Authenticate → `AuthChallenge`          | **Inspector**                           | `challenge.ts` (string + remoting wire)                           |
| Web remoting auth                           | **Inspector**                           | Stub provider, intercept fetch, auth-state push                   |
| TUI/CLI loopback callback                   | **Inspector**                           | `127.0.0.1:6276`                                                  |
| Step-up / OAuth UX copy                     | **Inspector**                           | Modal, Auth tab, CLI confirm                                      |

All three clients share `core/auth` + `OAuthManager`. Per-client code is navigation, storage adapter choice, and confirmation UX only.

---

## What we changed

### EMA leg 2 → SDK `discoverAndRequestJwtAuthGrant`

`core/auth/ema/wire.ts` `exchangeIdJag` wraps the SDK helper. `emaFlow.mintEmaResourceTokens` always passes a real resource (`resourceUrl ?? resourceMetadata.resource`). SDK errors are mapped to existing Inspector prefixes for tests/UX.

Accepted tradeoff: the SDK helper always posts `client_id` / `client_secret` in the body (`client_secret_post`). That matches our declared method and EMA mocks; a Basic-only IdP for ID-JAG would need a local fallback or an SDK `authMethod` option (see wishlist).

### Scope helpers → SDK re-exports

`core/auth/scopes.ts` re-exports `computeScopeUnion` and `isStrictScopeSuperset` (semantics matched existing tests). Local RFC 6749 persistence helpers stay — the SDK does not export equivalents, and `OAuthManager` depends on them.

---

## What we decided not to change (and why)

### EMA leg 3 — keep local `redeemIdJagForAccessToken`

SDK `exchangeJwtAuthGrant` only sends `grant_type` + `assertion`. It has no `resource` or `scope` parameters. Inspector’s leg 3 (and `wire.test.ts`) set both on the JWT-bearer body. Adopting the helper today would drop wire fields. Tracked as a wishlist gap, not a permanent architectural split.

### `CrossAppAccessProvider` — do not adopt

In-memory tokens, IdP assertion callback only (no IdP OIDC leg 1 / session cache), no durable storage, aimed at direct `auth()` + transport. Inspector needs shared `oauth.json`, IdP redirect/loopback, remoting token stub, and step-up UX. Wrapping it would be larger than `EmaTransportOAuthProvider` without covering web remoting. **Not a wishlist item** — that would mean reshaping the SDK around Inspector’s host model.

### WWW-Authenticate — keep Inspector `parseWwwAuthenticateBearer`

SDK `extractWWWAuthenticateParams` takes a `Response` only. Remoting/`parseAuthChallengeFromError` work from header **strings**. The SDK parser also mishandles `Bearer` + extra whitespace and `scope=""`. Using it on the Response path only would create two parsers. Keep the local string parser + `AuthChallenge` builder.

### Web remoting recovery — keep Inspector protocol

Do not run interactive SDK `auth()` on Hono; do not replace `POST /api/mcp/auth-state` with in-process transport retry. See [Mid-session](v2_auth_mid_session.md).

### `mcpAuth()` — keep the thin wrapper

Sole production boundary over SDK `auth()` for standard OAuth. Pins `McpAuthOptions`, guards `forceReauthorization` + `authorizationCode`, provides the `vi.mock` seam for `OAuthManager` tests, and a stable `@inspector/core` import. Inlining would save almost nothing and cost that discipline. `handleAuthChallenge()` stays for the same reason: no SDK orchestrator covers EMA + remoting + step-up confirm across clients.

### M2M / `withOAuth` — unused

No product feature needs `ClientCredentialsProvider`, `PrivateKeyJwtProvider`, or `withOAuth` today.

---

## SDK adoption wishlist

Only gaps where the **SDK’s own helpers are incomplete or buggy**, such that a normal fix would let Inspector call them without asking the SDK to adopt Inspector’s remoting/storage shape.

| Gap                                                                                                                                                                               | Fix in SDK                                                            | Then Inspector can…                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `exchangeJwtAuthGrant` omits optional `resource` / `scope` on the JWT-bearer body (leg-2 helpers and `CrossAppAccessProvider.prepareTokenRequest` already deal in resource/scope) | Add optional `resource?` / `scope?` and set them when present         | Replace `redeemIdJagForAccessToken`; likely delete `tokenEndpoint.ts`                        |
| Leg-2 helpers hardcode body `client_secret_post`                                                                                                                                  | Optional `authMethod?: ClientAuthMethod`                              | Pass through when an IdP is Basic-only                                                       |
| `extractWWWAuthenticateParams` is Response-only; brittle on whitespace / empty quoted `scope`                                                                                     | String overload (or shared header parser) with those edge cases fixed | Optionally thin-wrap in `parseWwwAuthenticateBearer` if behavior matches `challenge.test.ts` |

**Out of wishlist** (would require the SDK to mold itself to Inspector): durable/`OAuthStorage`-backed `CrossAppAccessProvider`, remoting-aware interactive auth on a node stub, replacing auth-state hot-swap, exporting host-only scope persistence policy.

When a wishlist row ships: bump the client package, swap behind existing tests, update this section and [v2_auth_ema.md](v2_auth_ema.md).

---

## Code map

| Role                                     | Path                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| SDK `auth()` forwarder                   | `core/auth/mcpAuth.ts`                                                                      |
| Provider / storage / challenges / scopes | `core/auth/providers.ts`, `oauth-storage.ts`, `challenge.ts`, `scopes.ts`                   |
| EMA                                      | `core/auth/ema/*` (`wire.ts` leg 2 = SDK; leg 3 local)                                      |
| Orchestration                            | `core/mcp/oauthManager.ts`                                                                  |
| Remoting                                 | `tokenAuthProvider.ts`, `authChallengeFetch.ts`, `remoteClientTransport.ts`                 |
| Client UX                                | web `App.tsx` / step-up modal; TUI `tuiOAuth.ts`; CLI `cliOAuth.ts`; node loopback callback |
