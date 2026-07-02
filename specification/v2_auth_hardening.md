# Inspector V2 — Authorization hardening (MCP 2026-07-28)

### [Brief](README.md) | [V2 Scope](v2_scope.md) | [Mid-session auth](v2_auth_mid_session.md) | [EMA / XAA](v2_auth_ema.md) | [Smoke testing](v2_auth_smoke_testing.md)

Align Inspector v2 with the **authorization hardening** in the upcoming MCP **`2026-07-28`** specification release — six SEPs that tighten OAuth/OIDC client behavior for MCP's single-client, many-server deployment pattern.

## Summary

The [2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) adds six authorization SEPs. All are **OAuth client** requirements. Inspector implements OAuth through a mix of SDK delegation (connect-time standard OAuth via `auth()`) and local code (EMA wire, storage, web callback, mid-session recovery).

**Strategy:** Upgrade to the v2 TypeScript SDK (`@modelcontextprotocol/client`) when its auth-hardening PRs land. Do **not** reimplement SDK OAuth logic in Inspector — delegate connect-time standard OAuth to the SDK and wire the gaps (callback parameters, storage shape, client type). **Mid-session authorization** is a separate, near-term track ([Mid-session auth](v2_auth_mid_session.md)); this doc covers connect-time and storage hardening that mid-session builds on.

## Normative references

- [MCP authorization (draft — 2026-07-28 RC target)](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP authorization (2025-11-25 — current stable)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [2026-07-28 RC announcement — Authorization Hardening](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/#authorization-hardening)
- [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207) — OAuth 2.0 Authorization Server Issuer Identification (`iss` parameter)
- [RFC 6750 §3.1](https://datatracker.ietf.org/doc/html/rfc6750#section-3.1) — Bearer token `insufficient_scope`
- TypeScript SDK tracking: [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) issues `#2197`–`#2201`, `#2198`, `#2256`; PRs `#2265`, `#2271`, `#2272`

## Relationship to mid-session auth

[Mid-session auth](v2_auth_mid_session.md) ships in the **near term**. Overlap:

| Concern | Mid-session spec | This doc |
| ------- | ---------------- | -------- |
| **SEP-2350** scope union on 403 step-up | `handleAuthChallenge()` + `mcpAuth({ forceReauthorization })` for **web remote**, EMA, and **interactive** defer; union persisted on `completeOAuthFlow` success | **Direct streamable HTTP silent step-up:** v2 SDK transport ([#2265](https://github.com/modelcontextprotocol/typescript-sdk/pull/2265)). **Do not** duplicate with client-side fetch intercept or `AuthRecoveryTransport` on TUI/CLI |
| **SEP-2207** refresh / `offline_access` | EMA legs 2–3 re-mint; standard OAuth silent refresh | Connect-time scope selection and DCR metadata |
| **SEP-2468** `iss` validation | Applies to any interactive re-auth redirect (401 mid-session) | Connect-time callback wiring is the first place to land `iss` passthrough |
| **SEP-2352** issuer-bound credentials | Re-register after AS migration may surface as mid-session failure | Storage and `invalidateCredentials` must be correct before mid-session recovery can succeed |
| **TUI/CLI mid-session** | [TUI and CLI implementation](v2_auth_mid_session.md#tui-and-cli-implementation): provider + UX; silent retry via v2 SDK | Provider v2 hooks (`invalidateCredentials`, issuer-keyed storage, `application_type`) |

Implement mid-session auth now. Land auth hardening on the v2 SDK upgrade path without blocking mid-session work — use compatible storage and callback shapes so both tracks merge cleanly.

## The six SEPs

| SEP | Requirement | Primary owner |
| --- | ------------- | ------------- |
| **[SEP-2468](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2468)** | Validate `iss` on authorization responses per RFC 9207; reject mix-up across authorization servers | Client (+ SDK reference impl) |
| **[SEP-837](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/837)** | Declare OIDC `application_type` during Dynamic Client Registration (`native` vs `web`) | Client (+ SDK DCR body) |
| **[SEP-2352](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2352)** | Bind persisted DCR credentials to the AS `issuer`; re-register when resource migrates between ASes | Client storage (+ SDK AS-change detection) |
| **[SEP-2207](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2207)** | Request refresh tokens from OIDC-style ASes (`offline_access` in scope when appropriate); do not assume refresh tokens are issued | Client (+ SDK `determineScope`) |
| **[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350)** | On 403 step-up, re-authorize with **union** of previously requested scopes and challenge scopes; on 401 re-login, **replace** scope | Client (+ SDK transport retry for direct transport) |
| **[SEP-2351](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2351)** | Stable RFC 8414 `.well-known` discovery suffix for authorization and resource metadata | Spec / discovery (SDK helpers) |

Servers emit per-operation scopes in 403 challenges (SEP-2350 server posture). Inspector consumes them; server-side scope-challenge middleware is out of scope unless needed for tests.

## SDK vs Inspector responsibilities

Inspector today uses **`@modelcontextprotocol/sdk` ^1.29.0** (v1 monolith). Auth hardening lands on **v2 `main`** (`@modelcontextprotocol/client`). Upgrade is part of this work.

```text
Connect-time standard OAuth          EMA                         Web remote backend
───────────────────────────          ───                         ──────────────────
SDK auth() + BaseOAuthClientProvider  Local wire (ema/)           Frozen token stub
OAuthStorage keyed by serverUrl       IdP OIDC in idpOidc.ts      No interactive OAuth on node
completeOAuthFlow(code, iss?)         v2 CrossAppAccess optional  Mid-session → browser
                                      (evaluate vs ema/)          fetch intercept (permanent)
                                                                  RemoteClientTransport (permanent)

TUI / CLI direct (not web remote):
──────────────────────────────────
StreamableHTTPClientTransport + live OAuthClientProvider in-process
v2 SDK: silent 401/403 retry + unionScopes on streamable HTTP (#2265)
Inspector: handleAuthChallenge for EMA + interactive defer; TUI/CLI UX only
Do NOT: fetch intercept or AuthRecoveryTransport on client SDK transport
```

### What the v2 SDK provides (after upgrade)

| SEP | SDK status (Jun 2026) | Inspector gets |
| --- | --------------------- | -------------- |
| SEP-2207 | Implemented on v2 `main` ([#2199](https://github.com/modelcontextprotocol/typescript-sdk/issues/2199)) | `offline_access` augmentation in authorize scope for standard OAuth via `auth()` |
| SEP-2350 | Open PR [#2265](https://github.com/modelcontextprotocol/typescript-sdk/pull/2265) | `unionScopes()` + 403 retry uses union on **streamable HTTP direct transport**; SSE unchanged (401 only) |
| SEP-2352 | Open PR [#2271](https://github.com/modelcontextprotocol/typescript-sdk/pull/2271) | AS migration detection → `invalidateCredentials` → re-DCR |
| SEP-2468 | Open PR [#2272](https://github.com/modelcontextprotocol/typescript-sdk/pull/2272) | `iss` validation in code-exchange path when host passes `iss` |
| SEP-837 | Open [#2198](https://github.com/modelcontextprotocol/typescript-sdk/issues/2198) | `application_type` in DCR request body |
| SEP-2351 | Tracking [#2256](https://github.com/modelcontextprotocol/typescript-sdk/issues/2256) | Discovery URL suffix in SDK metadata helpers |

### What Inspector must still implement

| SEP | Inspector work | Why not SDK-only |
| --- | -------------- | ---------------- |
| SEP-2468 | Parse `iss` from OAuth callback URL; extend `completeOAuthFlow(code, iss?)`; pass through to SDK `auth()` | Host owns the redirect handler — SDK cannot read the callback URL |
| SEP-837 | Ensure web vs TUI/CLI set correct client type (`web` / `native`) in provider metadata or environment | SDK may infer from redirect URI; Inspector must not mis-declare cross-environment |
| SEP-2352 | Key `OAuthStorage` credentials by AS `issuer` (not only `serverUrl`); implement `invalidateCredentials` on `BaseOAuthClientProvider`; migrate shared `oauth.json` | Storage is Inspector-owned; SDK calls provider hooks |
| SEP-2207 | EMA leg 1 already requests `openid offline_access` (`IDP_OIDC_SCOPES`); verify standard OAuth path after upgrade | EMA bypasses SDK authorize for leg 1 |
| SEP-2350 | **Web remote:** mid-session union in `handleAuthChallenge()` (bypasses SDK — proxy architecture). **TUI/CLI direct silent step-up:** v2 SDK transport after #2265. **Interactive defer** (step-up modal / Auth tab confirm): Inspector `setSuppressAuthorizationNavigation` + `mcpAuth({ forceReauthorization })` | See [Mid-session auth § Core API](v2_auth_mid_session.md#core-api--handleauthchallenge) and [TUI and CLI implementation](v2_auth_mid_session.md#tui-and-cli-implementation) |
| SEP-2351 | Verify discovery after upgrade; no duplicate discovery logic in Inspector | Uses SDK `discoverOAuthProtectedResourceMetadata` today |

**Do not duplicate** SDK `auth.ts` logic (RFC 9207 decision table, AS migration edge cases, scope union helpers). Upgrade and wire.

## Implementation strategy

### Principles

1. **Delegate** connect-time standard OAuth to the v2 SDK `auth()` flow.
2. **Wire** callback parameters, storage, and client-type metadata in Inspector.
3. **Extend** EMA and mid-session paths locally where the SDK has no EMA/XAA API.
4. **Upgrade** from `@modelcontextprotocol/sdk` v1 to v2 packages as a gated step — not a silent dependency bump.
5. **Do not unify transport layers** between web remote and TUI/CLI — web keeps `RemoteClientTransport` + node fetch intercept; TUI/CLI rely on v2 SDK transport for silent direct retry.

### Transport ownership (v2 upgrade)

| Path | Silent 401/403 + RPC retry | Interactive OAuth | Inspector integration |
| ---- | -------------------------- | ----------------- | --------------------- |
| **Web remote** | `RemoteClientTransport.postSend()` + `pushAuthState` (unchanged) | Browser redirect + resume snapshot | Node fetch intercept only (frozen stub) |
| **TUI/CLI direct (streamable HTTP)** | **v2 SDK transport** (`token()` + retry; #2265 union on 403) | Provider `redirectToAuthorization` + host callback | `handleAuthChallenge()` for EMA + defer-navigate; catch `UnauthorizedError` / `SdkHttpError` |
| **TUI/CLI direct (SSE)** | v2 SDK 401 retry only | Same as streamable | No 403 step-up on SSE |

**v2 SDK hooks (direct):** `AuthProvider` with `token()` + optional `onUnauthorized()`; full `OAuthClientProvider` adapted internally. Inspector extends `BaseOAuthClientProvider` toward the v2 contract — **not** a parallel fetch intercept on the client transport.

**Delete on upgrade:** `core/auth/mcpAuth.ts` body → re-export SDK `auth`; delete `core/auth/scopes.ts` → import `unionScopes` from SDK. **Keep:** `handleAuthChallenge()`, web `RemoteClientTransport`, node `createAuthChallengeInterceptFetch`.

### Order of work

| Step | When | Work |
| ---- | ---- | ---- |
| 1 | **Now (parallel with [TUI/CLI mid-session](v2_auth_mid_session.md#tui-and-cli-implementation))** | Compatible prep: callback `iss`; storage schema reserves `authorizationServerIssuer`; provider v2-shaped hooks; direct mid-session e2e baseline; **no** client-side fetch intercept / `AuthRecoveryTransport` |
| 2 | **When v2 SDK auth PRs merge** | Upgrade to `@modelcontextprotocol/client`; run existing OAuth integration tests |
| 3 | **Immediately after upgrade** | SEP-2468 callback passthrough; SEP-2352 storage + `invalidateCredentials`; SEP-837 `application_type` per environment; wire provider `onUnauthorized` → `handleAuthChallenge` where interactive defer needed |
| 4 | **TUI/CLI Phase C** | Interactive mid-session UX (Auth tab / callback server) — can overlap step 3 |
| 5 | **Verify** | Smoke scenarios in [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md); direct mid-session e2e green on v2 |

Land order in the SDK (maintainer plan): **SEP-2350 → SEP-2352 → SEP-2468**, with **SEP-837** in the same auth-release series.

### Per-SEP Inspector mapping

#### SEP-2468 — `iss` validation (RFC 9207)

- **Web:** `App.tsx` OAuth callback — read `iss` from query string alongside `code`; pass to `InspectorClient.completeOAuthFlow(code, iss?)`.
- **TUI / CLI:** Node callback server — same passthrough.
- **Core:** `OAuthManager.completeOAuthFlow` forwards `iss` to SDK `auth()`.
- **EMA:** Leg 1 OIDC callback is separate (`completeEmaIdpAuthorizationAndMint`); evaluate whether IdP responses require `iss` validation on the OIDC path (may reuse SDK OIDC helpers after upgrade).

#### SEP-837 — `application_type` in DCR

- **Web (`BrowserOAuthClientProvider`):** `application_type: "web"` (https redirect).
- **TUI / CLI:** `application_type: "native"` (localhost / custom scheme redirect).
- **Pre-registered clients:** N/A — no DCR.
- **CIMD:** Portable client IDs — no `application_type` on DCR.

#### SEP-2352 — credentials bound to AS issuer

- Extend `ServerOAuthState` / `oauth.json` with `authorizationServerIssuer` (or key storage by issuer + resource).
- Implement `OAuthClientProvider.invalidateCredentials(scope)` on `BaseOAuthClientProvider` — clear client info and/or tokens per SDK request.
- On AS migration (PRM `authorization_servers` change), SDK triggers invalidation; Inspector storage must honor it and allow re-DCR.
- **CIMD carve-out:** HTTPS `client_id` URLs remain portable across AS changes; tokens still invalidate per SDK behavior.

#### SEP-2207 — OIDC refresh token guidance

- **Standard OAuth:** Inherited from v2 SDK `determineScope()` after upgrade.
- **EMA leg 1:** Already requests `openid offline_access`; IdP refresh in `refreshIdpOidcSession`.
- **Mid-session:** Silent refresh and EMA re-mint per [Mid-session auth](v2_auth_mid_session.md); do not assume refresh tokens exist.

#### SEP-2350 — step-up scope accumulation

- **Web remote (mid-session):** `handleAuthChallenge()` union + `pushAuthState` — SDK transport not involved (proxy).
- **TUI/CLI direct (silent, streamable HTTP):** v2 SDK transport 403 retry with `unionScopes()` after [#2265](https://github.com/modelcontextprotocol/typescript-sdk/pull/2265).
- **Interactive step-up (all clients):** `handleAuthChallenge()` + `mcpAuth({ forceReauthorization })`; `setSuppressAuthorizationNavigation` until user confirms (web modal / TUI Auth tab); `saveScope` on `completeOAuthFlow` success.
- **EMA step-up:** silent legs 2–3 when IdP session valid — Inspector `handleAuthChallenge()`, not SDK transport alone.
- **401 re-login:** Replace scope set (not union) — all clients.
- **SSE:** 401 only; no 403 step-up in v1 or v2 SDK.

#### SEP-2351 — discovery suffix

- Rely on v2 SDK discovery helpers used by `auth()`, CIMD (`core/auth/cimd.ts`), and EMA (`core/auth/ema/resourceContext.ts`).
- No Inspector-specific discovery URL construction unless regression found in smoke tests.

## Non-goals

- Reimplementing MCP authorization-server or resource-server wire formats.
- v1 / v1.5 backport.
- **Client credentials grant** ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225)) — separate track.
- Full MCP **2026-07-28 stateless transport** migration (separate from auth hardening).
- Server-side scope-challenge middleware in Inspector test servers beyond what [Mid-session auth](v2_auth_mid_session.md) requires for 403 fixtures.
- **`AuthRecoveryTransport`** or client-side fetch intercept on TUI/CLI SDK transport (defer silent retry to v2 SDK; web node intercept stays).
- Unifying web remote and TUI/CLI at the transport wrapper layer.

## Testing

| SEP | Test |
| --- | ---- |
| SEP-2468 | Callback with matching `iss` succeeds; mismatched `iss` rejected; AS advertising support without `iss` rejected |
| SEP-837 | DCR succeeds for web (https redirect) and TUI/CLI (localhost redirect) against OIDC AS requiring `application_type` |
| SEP-2352 | Simulated AS migration in PRM → credentials invalidated → re-DCR → connect succeeds |
| SEP-2207 | Authorize request includes `offline_access` when AS advertises it; connect succeeds without refresh token when AS omits one |
| SEP-2350 | Connect-time and mid-session 403 step-up use union scopes; 401 re-login replaces scopes |
| SEP-2351 | Discovery resolves against draft suffix paths |

Document manual scenarios in [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) after implementation.

## File touch list (expected)

| Area | Files |
| ---- | ----- |
| Upgrade | Root and client `package.json`; import paths v1 → `@modelcontextprotocol/client` |
| Callback | `clients/web/src/App.tsx`, `core/auth/node/oauth-callback-server.ts`, `core/mcp/oauthManager.ts`, `core/mcp/inspectorClient.ts` |
| Provider | `core/auth/providers.ts`, `core/auth/browser/providers.ts` — v2 hooks: `invalidateCredentials`, issuer-keyed storage, `application_type` |
| Storage | `core/auth/store.ts`, `core/auth/oauth-storage.ts`, `core/mcp/remote/node/remoteOAuthStorage.ts` (if landed) |
| Web remote (unchanged on v2) | `core/mcp/remote/remoteClientTransport.ts`, `core/mcp/node/authChallengeFetch.ts`, `core/mcp/remote/node/server.ts` |
| TUI/CLI | [Mid-session § TUI and CLI](v2_auth_mid_session.md#tui-and-cli-implementation): `clients/tui/src/App.tsx`; `clients/cli/src/cliOAuth.ts`; provider wiring in `core/mcp/inspectorClient.ts` |
| Mid-session overlap | `core/auth/challenge.ts`, `core/mcp/oauthManager.ts` (`handleAuthChallenge`, `saveScope`) |
| Delete on upgrade | `core/auth/mcpAuth.ts` (re-export SDK), `core/auth/scopes.ts` (use SDK `unionScopes`) |
| Tests | `inspectorClient-oauth*.test.ts`, `inspectorClient-oauth-direct-mid-session-e2e.test.ts` (planned) |
| Smoke doc | `specification/v2_auth_smoke_testing.md` |

## Related specs

| Doc | Relationship |
| --- | ------------ |
| [v2_auth_mid_session.md](v2_auth_mid_session.md) | Mid-session auth (near term); owns runtime SEP-2350 behavior and most recovery UX |
| [v2_auth_ema.md](v2_auth_ema.md) | EMA legs 1–3; SEP-2207 leg 1 scopes; future v2 SDK Layer-2 helpers |
| [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) | Manual verification ladder |
| [v2_scope.md](v2_scope.md) | OAuth handling scope item |
| [v2_storage.md](v2_storage.md) | Shared `oauth.json` — issuer-keyed credentials affect storage schema |
