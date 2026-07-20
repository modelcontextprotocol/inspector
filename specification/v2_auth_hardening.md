# Inspector V2 Auth — Authorization hardening (MCP 2026-07-28)

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [Overview](v2_auth.md) | [EMA / XAA](v2_auth_ema.md) | Hardening | [Mid-session](v2_auth_mid_session.md) | [Smoke testing](v2_auth_smoke_testing.md) | [SDK consolidation](v2_auth_sdk_consolidation.md)

As-built status for aligning Inspector with the **authorization hardening** SEPs in the MCP **`2026-07-28`** release — tracked by [#1527](https://github.com/modelcontextprotocol/inspector/issues/1527).

Inspector is on `@modelcontextprotocol/client` **2.0.0-beta.4**. Connect-time standard OAuth is delegated to SDK `auth()`; Inspector owns storage, callbacks, remoting, EMA host flow, and mid-session UX. See [SDK consolidation](v2_auth_sdk_consolidation.md).

**Policy:** SEP behavior that can be automated is covered (or should be covered) by unit/integration tests. Hosted-IdP smoke in [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) is complementary for real providers — it is **not** required for every SEP once CI covers the requirement.

---

## Status vs [#1527](https://github.com/modelcontextprotocol/inspector/issues/1527)

| SEP                                                                                    | Topic                            | Status               | How / where                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------- | -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[SEP-2468](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2468)** | RFC 9207 `iss` on auth responses | **Done**             | Host parses `iss` from callback (web `App.tsx`, node loopback server); `completeOAuthFlow(code, iss?)` → `mcpAuth` → SDK `auth()` validates ([#1687](https://github.com/modelcontextprotocol/inspector/pull/1687)). EMA IdP leg 1 forwards `iss` the same way.                                                             |
| **[SEP-837](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/837)**   | DCR `application_type`           | **Done**             | `BaseOAuthClientProvider` declares `application_type: "native"` for all clients (localhost Inspector = RFC 8252 native). [#1625](https://github.com/modelcontextprotocol/inspector/issues/1625) / [#1694](https://github.com/modelcontextprotocol/inspector/pull/1694).                                                    |
| **[SEP-2352](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2352)** | Credentials bound to AS issuer   | **Done**             | `OAuthStorage` `byIssuer` + `activeIssuer`; provider `invalidateCredentials` / `discoveryState`; lazy migration from legacy blobs. Same PRs as SEP-837.                                                                                                                                                                    |
| **[SEP-2207](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2207)** | OIDC refresh / `offline_access`  | **Done** (SDK + EMA) | Standard OAuth: SDK `auth()` / `determineScope` after v2 upgrade ([#1624](https://github.com/modelcontextprotocol/inspector/issues/1624) / [#1688](https://github.com/modelcontextprotocol/inspector/pull/1688)). EMA leg 1: `IDP_OIDC_SCOPES = "openid offline_access"`. Do not assume a refresh token is issued.         |
| **[SEP-2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350)** | Step-up scope union              | **Done**             | Owned by mid-session ([#1526](https://github.com/modelcontextprotocol/inspector/issues/1526) closed; [mid-session spec](v2_auth_mid_session.md)): `handleAuthChallenge`, SDK scope helpers, web remote auth-state, TUI/CLI confirm, `onInsufficientScope` setting, step-up modal. [#1527] deferred this SEP to that track. |
| **[SEP-2351](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2351)** | Stable `.well-known` discovery   | **Done** (via SDK)   | No Inspector-built discovery URLs — `discoverOAuthProtectedResourceMetadata` / `discoverAuthorizationServerMetadata` (and `auth()`) from the v2 client.                                                                                                                                                                    |

**Related closed work:** SDK upgrade [#1624](https://github.com/modelcontextprotocol/inspector/issues/1624); storage/UX hardening [#1625](https://github.com/modelcontextprotocol/inspector/issues/1625); mid-session + step-up [#1526](https://github.com/modelcontextprotocol/inspector/issues/1526); shared web `RemoteOAuthStorage` [#1548](https://github.com/modelcontextprotocol/inspector/issues/1548).

---

## Per-SEP automated test coverage

| SEP                                 | Automated coverage                                                                                | Gap?                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **2350** step-up                    | **Covered** — mid-session remote/direct e2e + challenge/scopes/oauthManager + CLI/TUI oauth tests | No (hosted smoke is complementary, not a gap) |
| **837** `application_type`          | **Covered** — `providers.test.ts` asserts `"native"`; DCR exercised in OAuth e2e                  | No                                            |
| **2352** issuer binding             | **Covered** — `byIssuer` persistence + migration e2e (discovery → issuer B forces re-authorize)   | No                                            |
| **2468** `iss`                      | **Covered** — forwarding + standard-OAuth reject e2e (mismatch / missing when required)           | No                                            |
| **2207** refresh / `offline_access` | **Covered** — refresh-after-401 e2e + authorize `offline_access` assert                           | No                                            |
| **2351** discovery                  | **Covered** — fetchFn asserts PRM + AS well-known URL shapes                                      | No                                            |

Hosted smoke ([v2_auth_smoke_testing.md](v2_auth_smoke_testing.md)) is complementary for real IdP quirks. It does **not** close the CI gaps below.

---

## Remaining changes — explicit plan

**SEP product code for the six hardening SEPs is already shipped.** Steps 1–5 below are **implemented** on branch `v2/auth-sdk-consolidation` (tests + `isUnauthorizedError` unwrap). Step 6 (close #1527) waits on PR merge.

Nothing below is optional: each item is either **do** (with how) or **do not** (with why).

### Decisions

| Item                                | Kind             | Decision   | Status                                                                 |
| ----------------------------------- | ---------------- | ---------- | ---------------------------------------------------------------------- |
| SEP-2468 reject-path e2e            | **Test only**    | **Do**     | **Done** — local AS returns `iss`; e2e happy/mismatch/missing          |
| SEP-2207 `offline_access` assert    | **Test only**    | **Do**     | **Done** — authorize `scope` includes `offline_access` when advertised |
| SEP-2351 discovery URL asserts      | **Test only**    | **Do**     | **Done** — fetchFn tracker asserts PRM + AS well-known paths           |
| SEP-2352 AS-migration e2e           | **Test only**    | **Do**     | **Done** — discovery flip to issuer B forces re-authorize URL          |
| `EraNegotiationFailed` → 401 unwrap | **Product code** | **Do**     | **Done** — `isUnauthorizedError` walks `cause` / `data.cause`          |
| Per-SEP smoke scenarios             | —                | **Do not** | Unchanged — automatable → CI                                           |

### Ordered work (one PR or a tight PR series)

#### A. Tests only (steps 1–4) — no SEP feature work

These close #1527 acceptance gaps. Fixture/harness edits under `test-servers/` and test helpers are allowed solely to make the asserts possible; they are not product features.

##### 1. SEP-2468 — standard-OAuth `iss` reject e2e (**test**)

**Gap:** Local AS never advertises `authorization_response_iss_parameter_supported` and never returns `iss`. `completeOAuthAuthorization` returns only `code`. EMA IdP tests already cover missing/mismatched `iss`; standard `InspectorClient.completeOAuthFlow` does not.

**Changes (tests + fixtures only):**

1. `test-servers/src/test-server-oauth.ts`
   - AS metadata: `authorization_response_iss_parameter_supported: true`
   - `completeAuthorizationRedirect`: append `iss=<issuer>` (same string as metadata `issuer`, no trailing slash)
2. `clients/web/src/test/integration/helpers/oauth-client-fixtures.ts`
   - Extend `completeOAuthAuthorization` to return `{ code, iss }` (or add a sibling helper). Update call sites that need the new shape.
3. `inspectorClient-oauth-e2e.test.ts` (new describe):
   - **Happy:** `completeOAuthFlow(code, correctIss)` → tokens stored / connect works
   - **Mismatch:** `completeOAuthFlow(code, "https://evil.example")` → rejects (`IssuerMismatchError` / message match); **no tokens stored**
   - **Missing when required:** `completeOAuthFlow(code)` with no `iss` → rejects; **no tokens stored**

**Done when:** those three cases pass under the existing streamable-HTTP (or both) transport matrix entry used by neighboring OAuth e2e.

##### 2. SEP-2207 — `offline_access` on standard authorize (**test**)

**Gap:** SDK `determineScope` appends `offline_access` only when AS `scopes_supported` includes it **and** client metadata advertises `refresh_token` (Inspector already does). Default test AS `scopes_supported` is `["mcp"]` only, so authorize never requests `offline_access` in CI.

**Changes (tests + fixtures only):**

1. OAuth e2e fixture: `scopesSupported: ["mcp", "offline_access"]` (and keep `supportRefreshTokens: true`).
2. After `authenticate()`, assert authorize URL `scope` query param includes `offline_access`.
3. Keep existing refresh-after-401 e2e as the refresh-grant proof (no change required there beyond not regressing).

**Done when:** one e2e asserts the authorize scope string; refresh-after-401 still green.

##### 3. SEP-2351 — discovery URL shape asserts (**test**)

**Gap:** `fetchFn integration` only checks that some `well-known` / `oauth` URLs were hit.

**Changes (tests only):** In that same test (or a focused sibling), after `authenticate()` (discovery complete), assert the tracker contains:

- `/.well-known/oauth-protected-resource` (PRM; path-aware variant if the MCP URL has a path)
- `/.well-known/oauth-authorization-server` (and/or the SDK’s documented openid-configuration fallbacks if the AS 404s the first — our combined AS serves oauth-authorization-server, so assert that one)

**Done when:** URL path assertions fail if Inspector/SDK ever regresses to a non-SEP-2351 discovery shape.

##### 4. SEP-2352 — AS migration on connect path (**test**)

**Gap:** We prove `byIssuer` persistence and `invalidateCredentials` mapping. We do **not** prove that when PRM’s `authorization_servers[0]` changes, stamped credentials for the old issuer are not silently reused (#1527 AC3).

**Changes (tests + fixtures only):**

1. Complete static-client OAuth against local AS (issuer A); confirm tokens under `byIssuer[A]`.
2. On the next `authenticate()`, force discovery to resolve issuer B (recommended: `fetchFn` that rewrites PRM `authorization_servers` to a second local AS URL, **or** restart/`protected-resource` mode pointing at a different AS). Second AS can be a second `TestServerHttp` or a stub that only serves AS metadata + authorize/token.
3. Assert outcomes (all required):
   - Old issuer-A tokens are **not** used to connect as authorized against B
   - Client must obtain a **new** authorization URL (or fail closed for static client against unknown AS) — not a silent `AUTHORIZED` with A’s tokens
   - Storage does not leave active bearer state implying B while only A’s slot has tokens

Prefer exercising real `auth()` + provider `discardIfIssuerMismatch` / discovery-state path over a pure storage unit test — AC3 is about migration detection, not blob shape.

**Done when:** one integration test encodes the migration; silent reuse would fail the test.

#### B. Product code (step 5) — only non-test work in this plan

##### 5. `EraNegotiationFailed` unwrap (**product code** + unit tests)

**Gap:** Under `protocolEra: "auto" | "modern"`, a negotiation probe that hits HTTP 401 can throw `SdkError(SdkErrorCode.EraNegotiationFailed)` with the real `UnauthorizedError` at `error.cause` (or `error.data.cause` — match whatever the installed SDK beta actually sets; assert in the unit test). `isUnauthorizedError` in `core/auth/utils.ts` does not walk that chain, so App / connect OAuth UX may never start `authenticate()`.

**Changes:**

1. Extend `isUnauthorizedError` to return true when the error (or a single-level / recursive `cause`) is an unauthorized 401 — including SDK `UnauthorizedError` and wrapped `EraNegotiationFailed`.
2. Unit tests in `clients/web/src/test/core/auth/utils.test.ts` (and any thin re-export tests): bare 401 still true; `SdkError(EraNegotiationFailed, { cause: UnauthorizedError })` true; unrelated `SdkError` false.
3. Prefer fixing the shared detector over scattering unwrap logic in `oauthManager` / `App.tsx`.

**Done when:** unit coverage proves wrapped negotiation 401s are recognized; no behavior change for legacy (unwrapped) 401s.

Ship in the same PR series as steps 1–4 (or immediately adjacent). Not a #1527 SEP AC — do it anyway because era selection already exists.

#### C. Issue hygiene

##### 6. Close [#1527](https://github.com/modelcontextprotocol/inspector/issues/1527) (**do**, after tests 1–4; product step 5 may land with them)

1. Land steps 1–5 (single PR preferred: “auth hardening CI gaps + era 401 unwrap”).
2. Comment on #1527 with links to the PR and this plan; mark ACs 1–5 satisfied by **existing implementation + new CI tests** (AC6 smoke-per-SEP: **waived** per policy above — state that explicitly in the closing comment). Note step 5 as a related product fix, not a SEP AC.
3. Close #1527 and move the board card to **Done**.
4. Do **not** leave #1527 open as an unbounded “nice tests” bucket.

### Out of scope (hard exclusions)

- Mid-session / step-up reimplementation (#1526 done)
- Web remoting redesign / deleting `mcpAuth`
- Client-credentials grant ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225))
- Rewriting [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md) with one scenario per SEP
- EMA leg-3 SDK swap (blocked on SDK `resource`/`scope` — see [SDK consolidation](v2_auth_sdk_consolidation.md))

---

## Per-SEP detail (as-built)

### SEP-2468 — `iss` validation

- **SDK:** validates authorization-response `iss` against metadata when the host passes it into `auth()`.
- **Inspector:** parses `iss` from the callback query string on web and TUI/CLI loopback; forwards through `OAuthManager.completeOAuthFlow` / EMA IdP completion.
- **Tests:** forwarding covered; standard-OAuth reject-path e2e is plan step 1.

### SEP-837 — `application_type`

- **Inspector:** always `"native"` in DCR client metadata (loopback redirects).
- **UX:** `ClientSettingsForm` surfaces DCR `RegistrationRejectedError`; DCR marked deprecated-in-favor-of-CIMD (SEP-991).
- **Tests:** `providers.test.ts` asserts `application_type: "native"`.

### SEP-2352 — issuer-bound credentials

- **Storage:** `byIssuer[issuer]` for client info / tokens / registration kind; `activeIssuer` for ctx-less bearer reads; re-attach `issuer` after Zod parse strips it; lazy legacy fallback until first stamped save.
- **Provider:** `discoveryState` / `saveDiscoveryState`, `invalidateCredentials(scope)`.
- **SDK:** stamps `ctx.issuer`, `discardIfIssuerMismatch` on read.
- **Tests:** storage/provider unit + e2e `byIssuer` persistence; AS-migration connect fixture is plan step 4 (required for #1527 AC3).

### SEP-2207 — refresh tokens

- **Standard OAuth:** SDK scope determination / refresh after v2 upgrade.
- **EMA:** IdP authorize requests `openid offline_access`; IdP session refresh in `refreshIdpOidcSession`.
- **Mid-session:** silent refresh / EMA re-mint; never assume a refresh token exists.
- **Tests:** refresh-after-401 e2e; standard-OAuth `offline_access` authorize assert is plan step 2.

### SEP-2350 — step-up scope accumulation

| Path           | Behavior                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web remote     | `authChallengeFetch` → `AuthChallenge` → browser `handleAuthChallenge` → optional step-up modal → `pushAuthState` |
| TUI/CLI direct | SDK silent 401 / streamable-HTTP 403 retry where `onInsufficientScope` allows; Inspector confirm UX + EMA branch  |
| All            | 403 unions scopes; 401 replaces; `forceReauthorization` when refresh cannot widen; scopes re-exported from SDK    |

See [v2_auth_mid_session.md](v2_auth_mid_session.md). Hosted UX: smoke §5 (complementary to CI).

### SEP-2351 — discovery suffix

Inspector calls SDK discovery helpers only (`core/auth/discovery.ts`, `cimd.ts`, EMA `resourceContext.ts`, and inside `auth()`). No local well-known URL builder. URL-shape asserts are plan step 3.

---

## Architecture (current)

```text
Connect-time standard OAuth     EMA                          Web remote MCP
───────────────────────────     ───                          ──────────────
SDK auth() via mcpAuth()        Leg 1: idpOidc + SDK         Token stub + intercept
BaseOAuthClientProvider         Leg 2: SDK ID-JAG helper     Browser owns OAuth
byIssuer OAuthStorage           Leg 3: local until SDK       auth-state hot-swap
completeOAuthFlow(code, iss?)      grows resource/scope

TUI/CLI: live provider + SDK transport silent retry; handleAuthChallenge for EMA / interactive defer
```

---

## Non-goals

- Reimplementing authorization-server or resource-server wire formats.
- v1 / v1.5 backport.
- Client credentials grant ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225)).
- Full 2026-07-28 era/`versionNegotiation` migration (era UI already exists; plan step 5 only fixes 401 detection under auto/modern — not a default-era flip).
- `AuthRecoveryTransport` or client-side fetch intercept on TUI/CLI SDK transport.
- Unifying web remote and TUI/CLI transport wrappers.
- Per-SEP smoke scenarios for behavior already covered by automated tests.

---

## Normative references

- [MCP authorization (draft — 2026-07-28 RC target)](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [MCP authorization (2025-11-25 — current stable)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [2026-07-28 RC — Authorization Hardening](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/#authorization-hardening)
- [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207) — Authorization Server Issuer Identification
- Tracking issue: [#1527](https://github.com/modelcontextprotocol/inspector/issues/1527)

## Related specs

| Doc                                                          | Relationship                                         |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| [v2_auth_mid_session.md](v2_auth_mid_session.md)             | SEP-2350 runtime + recovery UX (done)                |
| [v2_auth_sdk_consolidation.md](v2_auth_sdk_consolidation.md) | What auth code sits on the v2 SDK vs Inspector       |
| [v2_auth_ema.md](v2_auth_ema.md)                             | EMA legs; SEP-2207 IdP scopes                        |
| [v2_auth_smoke_testing.md](v2_auth_smoke_testing.md)         | Hosted-IdP manual verification (complementary to CI) |
| [v2_storage.md](v2_storage.md)                               | Shared `oauth.json` / issuer-keyed credentials       |
