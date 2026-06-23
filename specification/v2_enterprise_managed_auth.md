# Inspector V2 — Enterprise-Managed Authorization (EMA / XAA)

### [Brief](README.md) | [V2 Scope](v2_scope.md) | [Servers file](v2_servers_file.md) | EMA / XAA

Tracks [#1509](https://github.com/modelcontextprotocol/inspector/issues/1509).

## Summary

Add support for [Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) (EMA, also referred to as XAA / ID-JAG in client implementations). EMA extends the existing OAuth flow so an enterprise IdP (OIDC) can authenticate the client once; any MCP resource authorization server (AS) configured to trust that IdP can then be accessed with minimal or no user prompting.

Inspector v2 already has OAuth infrastructure (`core/auth/`, `core/mcp/oauthManager.ts`, guided auth state machine, per-server OAuth fields in `~/.mcp-inspector/mcp.json` — see [Servers file](v2_servers_file.md)). This spec describes how EMA should plug into that stack and records VS Code reference material to inform the design.

## Normative references

- [EMA extension spec](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- [MCP blog: Enterprise-managed auth](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/) (announced stable June 18, 2026)
- GitHub issue: [#1509](https://github.com/modelcontextprotocol/inspector/issues/1509)

## Goals

- Support EMA for HTTP MCP servers, aligned with the MCP extension spec and current TypeScript SDK support.
- **Preserve existing standard OAuth behavior** for non-EMA servers — no regressions to current connect, guided, or configured-credential flows.
- Reuse existing inspector OAuth configuration and secret storage where possible.
- Support **guided** OAuth mode for EMA as well — surface individual EMA legs/steps for debugging (parity with today's guided auth for standard OAuth).
- Work across web, CLI, and TUI clients via shared `core/` auth logic.

## Non-goals

- v1 or v1.5/main backport (v2 only; see issue label).

## EMA spec and SDK audit

_Audited June 2026 against the [EMA extension spec](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization), VS Code's shipped schema, and the TypeScript SDK docs._

### Protocol (EMA extension)

- Extension id: `io.modelcontextprotocol/enterprise-managed-authorization` (stable as of June 2026).
- **Problem solved:** per-server interactive OAuth consent is replaced by enterprise IdP policy — user authenticates to the corporate IdP once; the client obtains an identity assertion and exchanges it for MCP resource tokens without redirecting to each MCP authorization server.
- **Client flow (three legs):**
  1. **IdP SSO** — obtain an OpenID ID Token for the user via OIDC at the enterprise IdP (the MCP protocol also allows SAML assertions; **out of scope for initial EMA implementation**).
  2. **ID-JAG mint** — RFC 8693 token exchange at the IdP: present the ID Token + IdP client credentials → receive an Identity Assertion JWT Authorization Grant (ID-JAG).
  3. **Resource token** — RFC 7523 JWT bearer grant at the MCP resource authorization server: present the ID-JAG + **resource AS** client credentials → receive the MCP access token.
- **No browser redirect to the MCP AS** on the happy path — the MCP AS trusts the IdP-issued assertion.
- Underlying standards: RFC 8693, RFC 7523, RFC 8707 (resource indicators), RFC 9728 (protected resource metadata).

### TypeScript SDK

Inspector today depends on **`@modelcontextprotocol/sdk` v1.x** (`^1.29.0` in root `package.json`). Standard OAuth uses `OAuthClientProvider` from `@modelcontextprotocol/sdk/client/auth.js` via inspector's `BaseOAuthClientProvider` (`core/auth/providers.ts`).

**EMA is not in the v1 SDK package.** A grep of `@modelcontextprotocol/sdk` 1.29 shows no `CrossAppAccess`, `enterpriseManaged`, or ID-JAG helpers.

EMA ships in the **v2 client package**:

| Package | Version (npm) | EMA surface |
| -------- | ------------- | ----------- |
| `@modelcontextprotocol/sdk` | 1.29.0 (inspector today) | Standard OAuth only (`OAuthClientProvider`, protected resource metadata, token storage hooks) |
| `@modelcontextprotocol/client` | 2.0.0-alpha.2 | **`CrossAppAccessProvider`** + Layer-2 utilities |

Key v2 APIs ([client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)):

- **`CrossAppAccessProvider`** — transport-level auth provider; runs legs 2–3. You supply an `assertion` callback that returns the ID-JAG (leg 1 + IdP exchange is app-specific).
- **`discoverAndRequestJwtAuthGrant()`** — IdP discovery + ID-JAG acquisition (leg 2).
- **`requestJwtAuthorizationGrant()`** — ID-JAG request without discovery.
- **`exchangeJwtAuthGrant()`** — JAG → MCP access token at the resource AS (leg 3).

`CrossAppAccessProvider` constructor takes:

- `assertion(ctx)` — `ctx` includes `authorizationServerUrl`, `resourceUrl`, `scope`, `fetchFn`; callback uses IdP credentials to return `jwtAuthGrant`.
- `clientId` / `clientSecret` — **resource AS** client credentials (matches per-server `oauth.clientId` / `oauth.clientSecret` when `enterpriseManaged` is true).

Leg 1 (IdP SSO / ID Token) is always inspector-owned. Wire-format exchange/redemption for legs 2–3 should delegate to the v2 SDK utilities rather than reimplementing RFC 8693/7523 in `core/auth/`.

### Short-term SDK strategy (dual dependency)

Inspector will eventually migrate to the v2 SDK for everything. Until then, **add `@modelcontextprotocol/client` v2 alongside the existing `@modelcontextprotocol/sdk` v1** — separate package names, no npm conflict, shared deps (`jose`, `eventsource`, etc.) dedupe cleanly.

**What does not work short-term:** dropping v2's `CrossAppAccessProvider` into v1's `StreamableHTTPClientTransport`. v2 `CrossAppAccessProvider` relies on `prepareTokenRequest()`, which the v1 SDK auth stack does not expose. The v1 transport auth path is built for authorization-code OAuth, not the EMA JWT-bearer exchange — even if types were forced, end-to-end EMA would not wire up correctly.

Two viable short-term paths:

#### Path A — Layer-2 utilities only (recommended)

Add `@modelcontextprotocol/client` and import **only** the EMA wire helpers:

```ts
import {
  discoverAndRequestJwtAuthGrant,
  exchangeJwtAuthGrant,
} from "@modelcontextprotocol/client";
```

Orchestrate EMA from inspector code; keep v1 `Client`, transports, and `BaseOAuthClientProvider` for everything else.

| Mode | Approach |
| ---- | -------- |
| **Guided** | Call each leg explicitly in `OAuthManager` / guided state machine — leg 2 via `discoverAndRequestJwtAuthGrant`, leg 3 via `exchangeJwtAuthGrant`. |
| **Automatic** | Run legs 2–3 via v2 helpers, then `saveTokens()` on the existing v1 provider and connect with the existing v1 transport (tokens already in session storage). |

Branch in `OAuthManager` on `enterpriseManaged`:

- absent / `false` → current v1 OAuth path (unchanged)
- `true` → v2 Layer-2 helpers → save tokens → v1 connect

**Pros:** smallest diff; no second client/transport stack; guided mode maps naturally to individual Layer-2 calls.

**Cons:** must handle EMA-specific 401 re-auth (re-run the exchange, not authorization-code OAuth); v1/v2 token types live in separate packages — keep EMA handling in a thin adapter.

#### Path B — v2 transport for EMA servers only

For connections with `oauth.enterpriseManaged: true`, use v2 `StreamableHTTPClientTransport` + v2 `CrossAppAccessProvider` (and v2 `Client` if required). All non-EMA connections stay on v1.

**Pros:** uses `CrossAppAccessProvider` as designed; closer to the eventual v2 end state.

**Cons:** two client/transport stacks in parallel until full migration; more branching in `InspectorClient` / transport factory.

#### Recommendation

**Path A (Layer-2 utilities + existing v1 transport/provider)** for the initial EMA implementation. Add the v2 client package with narrow imports; do not pull in v2 `Client` unless Path B is chosen later.

When inspector migrates to v2 wholesale, swap transport/client imports and optionally replace manual Layer-2 orchestration with `CrossAppAccessProvider`.

**Watch items:**

- **Bundle size** — tree-shake to Layer-2 symbols only on Path A.
- **401 re-auth** — EMA connections must re-run the ID-JAG exchange, not fall back to standard OAuth redirect flow.
- **Zod** — v2 client requires zod ^4; v1 sdk allows ^3.25 \|\| ^4 (inspector should stay on zod 4).

## Configuration

Config shape matches VS Code (verified against [`mcpConfiguration.ts`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpConfiguration.ts)). **Two credential planes** — do not merge them:

| Plane | Scope | What it identifies |
| ----- | ----- | ------------------ |
| **IdP (client / tenant)** | Global — one per inspector install or session | Inspector's OIDC client at the enterprise IdP (legs 1–2) |
| **Resource AS (per-server)** | Per MCP server entry | OAuth client trusted by the protected resource (leg 3) |

### 1. Client / tenant IdP credentials (global)

One IdP registration shared across all EMA-enabled servers. VS Code setting key: `mcp.enterpriseManagedAuth.idp`. Shape:

```ts
interface EnterpriseManagedAuthIdpConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}
```

All three fields are the **IdP OIDC client** credentials used in leg 2 (ID-JAG mint). `clientSecret` is sensitive — never persist it in `mcp.json` (server catalog).

#### Near-term persistence: `client.json` (+ `/api/storage/client`)

Until **client profiles** (see below) land, install-level client config — starting with `enterpriseManagedAuth` — is stored in **`~/.mcp-inspector/storage/client.json`** (same generic storage API as other install-level blobs):

| Store | API (web) | On disk | Purpose |
| ----- | --------- | ------- | ------- |
| **`client`** | `GET/POST/DELETE /api/storage/client` | `~/.mcp-inspector/storage/client.json` | **Config** — IdP credentials, later client identity/caps |

**Do not** put IdP credentials in the OAuth store or per-server `mcp.json`. **Do not** use environment variables for IdP config — all clients read/write the same `client.json` file.

**Runtime auth state** (standard OAuth tokens, PKCE, guided metadata, **and** EMA intermediate state such as cached IdP ID Token / ID-JAG) uses the existing **`OAuthStorage`** interface (`core/auth/storage.ts`) — whatever adapter each client already passes to `InspectorClient`. EMA does **not** mandate a specific backing store; it extends the serialized auth state that adapter already persists.

| Client | Config (`client.json`) | Runtime auth state (`OAuthStorage`) |
| ------ | ---------------------- | ----------------------------------- |
| **Web** | `RemoteStorage` adapter → `/api/storage/client` | `BrowserOAuthStorage` → sessionStorage (same as standard OAuth today) |
| **CLI / TUI** | `NodeClientStorage` (file adapter) | `NodeOAuthStorage` → `oauth.json` |
| **Web remote adapter** (if used) | `/api/storage/client` | `RemoteOAuthStorage` → `/api/storage/oauth` |

No EMA-specific migration of web OAuth persistence is required — sessionStorage-backed web sessions keep EMA tokens in sessionStorage; file-backed CLI/TUI sessions keep them in `oauth.json`.

On-disk shape (initial):

```json
{
  "enterpriseManagedAuth": {
    "idp": {
      "issuer": "https://idp.example.com",
      "clientId": "inspector-idp-client-id",
      "clientSecret": "inspector-idp-client-secret"
    }
  }
}
```

Later fields (client identity, capability toggles) extend this document until client profiles replace it.

Core provides:

- Types: `ClientConfig`, `EnterpriseManagedAuthIdpConfig` in `core/mcp/types.ts` (or `core/client/types.ts`).
- Load/save helpers with JSON parse/validate — no `process.env` reads inside `InspectorClient`.
- File path: `getStoreFilePath(getDefaultStorageDir(), "client")` (reuse `store-io.ts` primitives).

Tests write fixture `client.json` files directly or via `/api/storage/client` in integration tests (same as oauth test helpers).

#### Wiring into `InspectorClient`

Pass IdP config explicitly on the options surface — do **not** put it inside per-server `options.oauth` (that block already means resource OAuth client credentials).

Near-term shape on `InspectorClientOptions`:

```ts
enterpriseManagedAuth?: { idp: EnterpriseManagedAuthIdpConfig };
```

Callers load `client.json` once at session startup, then pass into each `InspectorClient` construction:

```ts
const clientConfig = await loadClientConfig(); // client.json
new InspectorClient(serverConfig, {
  ...opts,
  enterpriseManagedAuth: clientConfig.enterpriseManagedAuth,
});
```

Future: nest under **`InspectorClientProfile`** loaded from the profile store; `client.json` migrates into that mechanism.

**IdP session state** (cached ID Token from leg 1, optional refresh token, optional ID-JAG cache) lives in the **OAuth store** via `OAuthStorage`. Use a **store-root `idpSessions` map keyed by issuer** (global across servers — one IdP per install), separate from per-server `servers[url]` resource OAuth state:

```ts
interface OAuthStoreState {
  servers: Record<string, ServerOAuthState>; // existing per-server resource OAuth
  idpSessions?: Record<string, IdpSessionState>; // issuer → { idToken, refreshToken?, expiresAt?, ... }
}
```

Extend `OAuthStorage` / store methods accordingly. IdP **credentials** stay in `client.json`; only runtime tokens belong in `idpSessions`. All adapters (`BrowserOAuthStorage`, `NodeOAuthStorage`, `RemoteOAuthStorage`) serialize the same extended shape through their existing backends.

#### Later: client profiles + UX

Inspector is designing a **client profile** mechanism for install-level client configuration (identity, capabilities, IdP/EMA settings, etc.). That work is not settled yet. When it ships:

- Migrate `client.json` content into the profile store (`clientSecret` in the OS keychain, not plaintext).
- Surface IdP settings in client-level settings UX (issuer, client id, secret).
- `client.json` becomes legacy or an export format.

Near-term IdP config can be edited by hand in `client.json`, via **`POST /api/storage/client`** (web or tests), or via a minimal client-settings UI that reads/writes that API — no env-var path.

### 2. Per-server MCP config (`~/.mcp-inspector/mcp.json`)

Extend the existing per-server `oauth` block already used for standard OAuth ([Servers file](v2_servers_file.md)). When `enterpriseManaged` is true, the server-level OAuth fields mean **resource authorization server** credentials, not IdP credentials:

```json
{
  "mcpServers": {
    "my-enterprise-server": {
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "enterpriseManaged": true,
        "clientId": "resource-as-client-id",
        "clientSecret": "resource-as-client-secret",
        "scopes": "tools:read tools:execute"
      }
    }
  }
}
```

| Field | When `enterpriseManaged: false` | When `enterpriseManaged: true` |
| ----- | ------------------------------- | ------------------------------ |
| `oauth.clientId` | OAuth client id (existing behavior) | **Resource AS** client id trusted by the protected resource |
| `oauth.clientSecret` | OAuth client secret (existing behavior) | **Resource AS** client secret (keychain-backed, same as today) |
| `oauth.scopes` | OAuth scopes (existing behavior) | Scopes for the resource token request |
| `oauth.enterpriseManaged` | omitted / `false` | `true` — route to EMA flow instead of standard authorization-code OAuth |

Types to extend in `core/mcp/types.ts`:

- `StoredMCPServer.oauth.enterpriseManaged?: boolean`
- `InspectorServerSettings` — lift `enterpriseManaged` alongside existing flat `oauthClientId` / `oauthClientSecret` / `oauthScopes` fields.

Normalizers, server list read/write, and API wire shape follow the same patterns as existing OAuth fields ([Servers file](v2_servers_file.md)).

### UX (near-term)

#### Per-server: `enterpriseManaged` (in scope for #1509)

Add **`enterpriseManaged`** to server settings data and surface it in the web UI:

- **Where:** `ServerSettingsForm` OAuth section (`clients/web/src/components/groups/ServerSettingsForm/`) — same panel as existing OAuth client id, client secret, and scopes.
- **Control:** checkbox, e.g. **"Enterprise-managed authorization"**, with brief help text: when enabled, connect via the configured enterprise IdP (global IdP config) instead of interactive OAuth to the MCP authorization server; per-server OAuth fields below are the **resource AS** credentials.
- **Behavior:** toggling updates `InspectorServerSettings.enterpriseManaged` and persists to `mcp.json` under `oauth.enterpriseManaged` on save. When unchecked, standard OAuth behavior is unchanged.
- **Visibility:** HTTP/SSE servers only (EMA applies to remote OAuth transports; hide or disable for stdio).

CLI/TUI can read/write `enterpriseManaged` via catalog/config file without dedicated UX in the first slice; web form is the primary editor.

#### Client / IdP settings (near-term)

IdP config lives in **`client.json`**, not env vars. Minimum paths to set it:

- Hand-edit `~/.mcp-inspector/storage/client.json`
- **`POST /api/storage/client`** from web or tests
- Optional: minimal client-settings UI (reads/writes `/api/storage/client`) — can follow the server OAuth form in a later slice; not required for first EMA connect if the file is edited out of band

Do not store IdP credentials in the OAuth store — only **runtime OAuth/EMA state** (tokens, PKCE, IdP session cache, etc.) belongs there, via whichever `OAuthStorage` adapter the client uses.

### Leg 1 — IdP OIDC (settled)

Leg 1 is **OIDC authorization-code login** against the enterprise IdP using credentials from `client.json` (`issuer`, `clientId`, `clientSecret`). Discover IdP endpoints from the issuer (OpenID Provider Metadata). Exchange the authorization code at the IdP token endpoint; persist the resulting **ID Token** (and refresh token if issued) in `OAuthStorage`.

**Reuse existing OAuth client infrastructure** — leg 1 is not a new auth stack. It uses the same per-client mechanisms already wired for standard MCP resource OAuth (`OAuthManager`, redirect/callback, PKCE, token exchange). Only the target changes: IdP endpoints and `client.json` credentials instead of the resource authorization server and per-server `oauth.*` fields.

| Client | Leg 1 mechanism (same stack as standard OAuth in that client) |
| ------ | ------------------------------------------------------------- |
| **Web** | Browser redirect via `navigation`; callback at `/oauth/callback`; `InspectorClient.completeOAuthFlow(code)`; `BrowserOAuthStorage` |
| **TUI / CLI** | `OAuthCallbackServer` opens local callback; system browser for authorize URL; `completeOAuthFlow(code)`; `NodeOAuthStorage` |

**Silent connect:** if a valid cached ID Token exists for the configured issuer, skip the interactive redirect and proceed to leg 2.

**SAML:** defined in the MCP EMA protocol but **out of scope** for initial EMA implementation.

### Implementation notes (leg 1 + OAuthManager)

Leg 1 reuses the existing OAuth redirect/callback/PKCE machinery but **targets the IdP**, not the resource authorization server. `OAuthManager` today discovers resource AS metadata and builds authorize URLs against the resource AS — the EMA branch must parameterize the same flow with IdP endpoints (from issuer OpenID Provider Metadata) and IdP credentials from `client.json`.

**Web callback disambiguation:** web uses a single `/oauth/callback` path for both resource OAuth and IdP OIDC. Tag pending flows (e.g. extend the existing pending-server / state mechanism) so the callback handler completes the correct flow.

**Scope for leg 2:** compute XAA scopes from protected-resource metadata / challenge (VS Code: appendix §A.3 step 3) — do not fall back to IdP `scopes_supported`.

**401 re-auth:** on EMA connections, re-run legs 2–3 (and leg 1 only if the cached ID Token is missing or expired). Do not fall back to standard resource authorization-code OAuth.

## Inspector mapping

When connecting to an HTTP server with `oauth.enterpriseManaged: true`:

1. Validate protected resource metadata (`resource`, `authorization_servers`).
2. Branch from standard OAuth (VS Code: `mainThreadMcp` — see appendix §A.3).
3. Load tenant IdP config from `client.json` (via `InspectorClientOptions.enterpriseManagedAuth`, loaded at session startup).
4. Obtain or reuse IdP ID Token (leg 1 — OIDC via existing per-client OAuth stack; see §Leg 1 above).
5. Run SDK leg 2 (`discoverAndRequestJwtAuthGrant`) → ID-JAG (scopes from resource metadata; see §Implementation notes).
6. Run SDK leg 3 (`exchangeJwtAuthGrant`) with per-server resource AS `clientId` / `clientSecret` → MCP access token.
7. Connect with the resource access token via the existing v1 transport (Path A).

When `enterpriseManaged` is absent or false, existing standard OAuth path is unchanged.

**Client capability:** declare EMA support in the MCP `initialize` request when connecting EMA-enabled servers:

```json
{
  "capabilities": {
    "extensions": {
      "io.modelcontextprotocol/enterprise-managed-authorization": {}
    }
  }
}
```

Inspector touchpoints to extend:

- `core/mcp/types.ts` — `ClientConfig`, `EnterpriseManagedAuthIdpConfig`, `enterpriseManaged` on server oauth shape, `InspectorClientOptions.enterpriseManagedAuth`
- `core/client/` (or `core/storage/`) — `loadClientConfig` / `saveClientConfig`; `NodeClientStorage`; remote adapter for `/api/storage/client`
- `core/auth/storage.ts` + `core/auth/store.ts` — extend `OAuthStorage` / `OAuthStoreState` with store-root `idpSessions` keyed by issuer; all existing adapters pick up the extended shape automatically
- `core/mcp/inspectorClient.ts` — declare EMA extension in `initialize` capabilities when `enterpriseManaged`; wire 401 re-auth to EMA exchange path
- `core/mcp/oauthManager.ts` — branch on `enterpriseManaged`; parameterize leg 1 for IdP OIDC; IdP creds from client config; orchestrate v2 Layer-2 helpers (Path A)
- `core/auth/` — guided-mode wrappers around SDK Layer-2 functions (legs 2–3)
- `clients/web` — load client config via `/api/storage/client`; `ServerSettingsForm` checkbox; guided EMA UI; web callback flow tagging for IdP vs resource OAuth (reuse existing `BrowserOAuthStorage` for EMA runtime state)
- `clients/cli`, `clients/tui` — load `client.json` at startup; pass into `InspectorClient`; leg 1 via same `OAuthCallbackServer` + `NodeOAuthStorage` stack as TUI standard OAuth today

### Guided mode

EMA guided mode extends the existing guided OAuth model (`AuthGuidedState` / `OAuthStep` in `core/auth/types.ts`). Leg 1 reuses the same redirect/callback/code-exchange steps as standard guided OAuth, pointed at the IdP. Legs 2–3 add EMA-specific steps:

- **IdP OIDC login** (authorization redirect + code exchange — same machinery as guided resource OAuth; skippable when cached ID Token is valid)
- **ID-JAG exchange** (leg 2)
- **Resource metadata / token endpoint discovery** (if not already resolved)
- **Resource token redemption** (leg 3)

On silent success, skip interactive IdP OIDC steps when a valid cached ID Token exists; still run legs 2–3.

### Clients

| Client | Notes |
| ------ | ----- |
| Web | **First** — implement and test EMA here; guided EMA in existing auth UI; leg 1 via browser redirect + `/oauth/callback` (same path as standard OAuth; disambiguate pending flow) |
| TUI | Follow web; extend existing guided/quick OAuth (`clients/tui/src/App.tsx`) for EMA legs 2–3; leg 1 via existing `OAuthCallbackServer` flow |
| CLI | Follow web/TUI; same Node OAuth stack as TUI when interactive IdP login is required |

### Implementation order (settled)

**Web first** for development and testing. Core types, `OAuthManager` EMA branch, and `OAuthStorage` extensions live in `core/` and are client-agnostic, but the first end-to-end connect path, UX (`enterpriseManaged` checkbox, guided EMA UI), and integration tests target `clients/web`. TUI and CLI reuse the same core once web EMA is working.

Design decisions for EMA are complete. Remaining work is the phased plan and checklist below (client profiles are a separate, later track — not a blocker for `#1509`).

### Phased implementation plan

#### Phase 1 — Foundation (core, no EMA connect yet)

1. Add `@modelcontextprotocol/client` v2 dependency; confirm Layer-2 imports compile.
2. Add types: `ClientConfig`, `EnterpriseManagedAuthIdpConfig`, `enterpriseManaged`, `InspectorClientOptions.enterpriseManagedAuth`.
3. Add `enterpriseManaged` to server types, normalizers, and `mcp.json` read/write.
4. Implement `client.json` load/save (`NodeClientStorage` + remote adapter for `/api/storage/client`).
5. Extend `OAuthStorage` / store schema with store-root `idpSessions` keyed by issuer.

#### Phase 2 — Web EMA connect (first end-to-end path)

6. Wire web to load `client.json` at session startup → `InspectorClientOptions.enterpriseManagedAuth`.
7. Web UX: `enterpriseManaged` checkbox in `ServerSettingsForm` OAuth section.
8. `OAuthManager` EMA branch: leg 1 (IdP OIDC, parameterized endpoints) → legs 2–3 (SDK) → `saveTokens` → connect.
9. `InspectorClient`: declare EMA extension in `initialize` when `enterpriseManaged`; EMA 401 re-auth (re-run exchange, not resource OAuth redirect).
10. Web callback: disambiguate IdP OIDC vs resource OAuth pending flows at `/oauth/callback`.

#### Phase 3 — Guided mode + tests

11. Guided EMA: leg 1 reuses guided OAuth redirect/code-exchange steps; add legs 2–3 as new steps.
12. Tests: unit + integration with mock IdP/AS; fixture `client.json` in test harness (extend `test-servers` or dedicated mock endpoints as needed).

#### Phase 4 — Other clients (after web works)

13. Wire TUI/CLI to load `client.json` and pass `enterpriseManagedAuth` into `InspectorClient`.
14. TUI/CLI guided/quick OAuth extensions for EMA legs 2–3.

## Implementation checklist

### Design (complete)

- [x] Audit EMA spec and TypeScript SDK surfaces
- [x] Finalize inspector config shape (server + tenant IdP)
- [x] Choose short-term SDK strategy (Path A: Layer-2 utilities + v1 transport)
- [x] Choose near-term persistence: `client.json` (IdP config) + extend existing `OAuthStorage` per client (OAuth/EMA runtime state)
- [x] Leg 1 mechanism: OIDC authorization-code flow via existing per-client OAuth stack (web redirect/callback; TUI/CLI `OAuthCallbackServer`)
- [x] Implementation order: web client first for EMA development and testing

### Phase 1 — Foundation

- [ ] Add `@modelcontextprotocol/client` v2 dependency (narrow Layer-2 imports)
- [ ] Add types: `ClientConfig`, `EnterpriseManagedAuthIdpConfig`, `enterpriseManaged`, `InspectorClientOptions.enterpriseManagedAuth`
- [ ] Add `enterpriseManaged` to server types, normalizers, and `mcp.json` read/write
- [ ] Implement `client.json` load/save (`NodeClientStorage` + `/api/storage/client` remote adapter)
- [ ] Extend `OAuthStorage` / OAuth store schema with store-root `idpSessions` keyed by issuer

### Phase 2 — Web EMA connect

- [ ] Wire web to load client config at session startup → `InspectorClientOptions.enterpriseManagedAuth`
- [ ] Web UX: `enterpriseManaged` checkbox in `ServerSettingsForm` OAuth section
- [ ] Integrate EMA routing in `OAuthManager` (branch on `enterpriseManaged`; IdP OIDC leg 1; Layer-2 orchestration for legs 2–3)
- [ ] Declare EMA extension in `initialize` when connecting with `enterpriseManaged`
- [ ] EMA 401 re-auth: re-run legs 2–3 (leg 1 only if ID Token expired/missing)
- [ ] Web: disambiguate IdP vs resource OAuth at `/oauth/callback`

### Phase 3 — Guided mode + tests

- [ ] Guided mode: EMA legs 2–3 as new steps; leg 1 reuses guided OAuth redirect/code-exchange steps
- [ ] Tests (unit + integration; mock IdP/AS; fixture `client.json` in test harness)

### Phase 4 — Other clients

- [ ] Wire TUI/CLI to load client config → `InspectorClientOptions.enterpriseManagedAuth`
- [ ] TUI/CLI guided/quick OAuth extensions for EMA

### Later

- [ ] Client profile persistence + IdP settings UX (migrate from `client.json`)

---

## Appendix A — VS Code implementation reference

The following is **reference material only**, adapted from a working document in `/Users/bob/Documents/Auth0/vscode-xaa-implementation-reference.md`. It describes Microsoft's VS Code TypeScript implementation of enterprise-managed MCP auth (XAA / ID-JAG). **Do not treat it as inspector design** — use it to locate patterns and source files when implementing [#1509](https://github.com/modelcontextprotocol/inspector/issues/1509).

### A.1 Changelist that introduced this

- PR: https://github.com/microsoft/vscode/pull/318067
- Merge commit: https://github.com/microsoft/vscode/commit/2d95154af0f50db2a41ceee431acfc6d79638aab
- Release notes section (1.123): https://code.visualstudio.com/updates/v1_123#_enterprise-managed-mcp-authentication-preview

### A.2 Where the feature is configured

#### A.2.1 `mcp.json` server-level opt-in (`oauth.enterpriseManaged`)

- MCP schema (`enterpriseManaged` under HTTP oauth):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpConfiguration.ts
- MCP types (`enterpriseManaged?: boolean`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpTypes.ts

#### A.2.2 Tenant-level IdP config (`mcp.enterpriseManagedAuth.idp`)

- Setting key + TS interface (`issuer`, `clientId`, `clientSecret`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpConfiguration.ts
- Registration of setting in configuration registry (policy-backed, app-scoped, hidden):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts
- Policy metadata for enterprise deployment:
  - https://github.com/microsoft/vscode/blob/main/build/lib/policies/policyData.jsonc

### A.3 Routing logic: where VS Code chooses XAA vs normal OAuth

- MCP HTTP launch data sends enterprise-managed flag to main thread:
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostMcp.ts
- Main routing decision (`if (authDetails.enterpriseManaged) ...`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadMcp.ts

In `mainThreadMcp`, enterprise-managed path does these implementation-specific checks:

1. Validate resource metadata has `resource`.
2. Read resource AS from `authorization_servers[0]`.
3. Compute XAA scopes from challenge/resource metadata (not IdP scopes_supported fallback).
4. Resolve issuer from `mcp.enterpriseManagedAuth.idp.issuer`.
5. Request shared provider via `createOrGetXaaProvider(issuer)`.
6. Resolve resource client secret from secret store using resource + resource client id key.
7. Call session acquisition with `audience` and `resource` in options.

All of this is implemented in:
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadMcp.ts

### A.4 Provider lifecycle and host plumbing

#### A.4.1 Authentication service API additions

- New `createOrGetXaaProvider(issuer)` API contract:
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/authentication/common/authentication.ts
- Browser implementation (one provider per issuer id):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/authentication/browser/authenticationService.ts

#### A.4.2 Main thread registration path

- Creates XAA provider from issuer metadata; prefers configured IdP credentials over cached:
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadAuthentication.ts

#### A.4.3 Ext host registration path

- New RPC methods in protocol (`$registerXaaAuthProvider`, enterpriseManaged metadata shape, prompt for resource secret):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHost.protocol.ts
- Ext host registration of XAA provider (`$registerXaaAuthProvider`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostAuthentication.ts
- Node ext host binds XAA mixin to node provider implementation:
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/node/extHostAuthentication.ts

### A.5 Core XAA implementation class (the most important file)

- Main implementation:
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostXaaAuthProvider.ts

Key implementation methods to mirror in your app:

1. `getSessions(...)`
   - Silent path first.
   - Reuses persisted IdP session.
   - Re-mints resource token silently (no prompts).

2. `createSession(...)`
   - Interactive path.
   - Ensures IdP session, then mints resource token.

3. `_mintResourceToken(...)`
   - Runs leg 2 + leg 3 logic.
   - Resolves resource `client_id` from explicit config first, then from JAG claim fallback.
   - Handles per-resource `client_secret` retrieval/prompt/caching semantics.

4. `_exchangeForIdJag(...)`
   - IdP token exchange request construction and execution.

5. `_discoverResourceTokenEndpoint(...)`
   - Fetches metadata for audience/resource AS.

6. `_redeemAtResource(...)`
   - Resource-side JWT bearer redemption for access token.

7. Caching helpers
   - `cacheKey(...)`, `isExpired(...)`, in-memory resource token cache keyed by `(resource, scopes)`.

### A.6 OAuth wire-format helpers (shared utilities)

- OAuth constants + body builders used by XAA flow:
  - https://github.com/microsoft/vscode/blob/main/src/vs/base/common/oauth.ts

Functions to copy conceptually:

1. `buildIdJagExchangeBody(...)`
2. `buildResourceRedemptionBody(...)`
3. JWT claims parsing helpers used to infer `client_id` from assertion

Tests for body semantics:
- https://github.com/microsoft/vscode/blob/main/src/vs/base/test/common/oauth.test.ts

### A.7 Secret storage model in this implementation

#### A.7.1 Resource client secret prompt + persistence

- Prompt and persistence (`$promptForResourceClientSecret`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadAuthentication.ts

Behavior details implemented:

1. `undefined` means user canceled (do not cache as "no secret").
2. Empty string means explicit "no secret" (valid for public clients).
3. Non-empty values stored in OS secret storage.

#### A.7.2 Secret keying strategy

- Secret key utility is in MCP types (`mcpOAuthClientSecretStorageKey`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpTypes.ts

The feature intentionally keys by **resource indicator + resource client id**, not only client id.

### A.8 Session option surface expansion (`audience`)

The implementation introduces `audience` as part of auth session option shapes so XAA provider can receive resource AS context via standard session APIs.

- Internal service types (`IAuthenticationCreateSessionOptions`, `IAuthenticationGetSessionsOptions`, provider session options):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/authentication/common/authentication.ts
- Proposed VS Code API file:
  - https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.authSessionAudience.d.ts
- Proposal registry inclusion:
  - https://github.com/microsoft/vscode/blob/main/src/vs/platform/extensions/common/extensionsApiProposals.ts

### A.9 Tests added in this changelist

- XAA helper tests (`cacheKey`, `isExpired`, `IDP_SCOPES`):
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/test/browser/extHostXaaAuthProvider.test.ts
- OAuth wire-format tests for ID-JAG and redemption bodies:
  - https://github.com/microsoft/vscode/blob/main/src/vs/base/test/common/oauth.test.ts
- Integration test shape update for new RPC method:
  - https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/test/browser/mainThreadAuthentication.integrationTest.ts

### A.10 Third-party libraries used for this feature

No new third-party runtime dependency appears to be introduced by this changelist.

The implementation relies on:

1. Existing VS Code auth/mcp infrastructure.
2. Web/platform primitives (`fetch`, `URLSearchParams`).
3. Protocol standards (RFC 8693, RFC 7523, RFC 8707, ID-JAG draft semantics).

### A.11 Practical architecture notes reusable in inspector

If implementing this pattern in inspector, mirror these design choices:

1. Split credentials into two planes:
   - IdP client credentials (tenant/global)
   - Resource AS client credentials (per resource/per client id)

2. Cache provider by issuer:
   - One XAA provider per issuer, shared across resources.

3. Keep silent and interactive paths separate:
   - `getSessions` style silent path must not prompt.
   - `createSession` style path can prompt.

4. Use `audience` explicitly:
   - Do not overload `resource` for both meanings.

5. Treat cancel as cancel:
   - Distinguish `undefined` (cancel) from `""` (explicit no secret).

6. Key secrets with resource context:
   - Prevent cross-resource secret confusion.

### A.12 Commit-pinned references (stable snapshot)

If you need a frozen reference (won't drift as `main` changes), use commit-pinned paths under:

- https://github.com/microsoft/vscode/tree/2d95154af0f50db2a41ceee431acfc6d79638aab

For example:
- https://github.com/microsoft/vscode/blob/2d95154af0f50db2a41ceee431acfc6d79638aab/src/vs/workbench/api/common/extHostXaaAuthProvider.ts
- https://github.com/microsoft/vscode/blob/2d95154af0f50db2a41ceee431acfc6d79638aab/src/vs/workbench/api/browser/mainThreadMcp.ts
- https://github.com/microsoft/vscode/blob/2d95154af0f50db2a41ceee431acfc6d79638aab/src/vs/workbench/api/browser/mainThreadAuthentication.ts
