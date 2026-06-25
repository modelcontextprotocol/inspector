# Inspector V2 — Enterprise-Managed Authorization (EMA / XAA)

### [Brief](README.md) | [V2 Scope](v2_scope.md) | [Servers file](v2_servers_file.md) | EMA / XAA

Tracks [#1509](https://github.com/modelcontextprotocol/inspector/issues/1509).

## Summary

Add support for [Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) (EMA, also referred to as XAA / ID-JAG in client implementations). EMA extends the existing OAuth flow so an enterprise IdP (OIDC) can authenticate the client once; any MCP resource authorization server (AS) configured to trust that IdP can then be accessed with minimal or no user prompting.

Inspector v2 already has OAuth infrastructure (`core/auth/`, `core/mcp/oauthManager.ts`, guided auth state machine, per-server OAuth fields in `~/.mcp-inspector/mcp.json` — see [Servers file](v2_servers_file.md)). Phases 1–2 (web **quick** connect) are **implemented** in `core/auth/ema/` and documented below. **Guided EMA is deferred** until the product has a guided OAuth UX (web v2 has connect/quick only today; TUI has guided via `AuthTab`). Phase 4 (CLI/TUI quick EMA) remains planned separately. VS Code reference material in the appendix informs remaining work.

## Normative references

- [EMA extension spec](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- [MCP blog: Enterprise-managed auth](https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/) (announced stable June 18, 2026)
- GitHub issue: [#1509](https://github.com/modelcontextprotocol/inspector/issues/1509)

## Goals

- Support EMA for HTTP MCP servers, aligned with the [MCP EMA extension spec](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization). EMA wire and orchestration live in `core/auth/ema/` — the v1 TypeScript SDK does not expose EMA as a named API.
- **Preserve existing standard OAuth behavior** for non-EMA servers — no regressions to current connect, guided, or configured-credential flows.
- Reuse existing inspector OAuth configuration and secret storage where possible.
- **Guided EMA (deferred):** step-through EMA legs in the UI for debugging — **not in scope for the current #1509 slice.** Deferred until Inspector has a **guided OAuth option in the UX** (web: none today; TUI: `AuthTab` guided/quick/clear). Core APIs (`beginGuidedAuth`, `OAuthFlowState`, etc.) exist; web connect uses quick mode only (`authenticate()`).
- Work across web, CLI, and TUI clients via shared `core/` auth logic.

## Non-goals

- v1 or v1.5/main backport (v2 only; see issue label).
- **Guided EMA UI** on web (or any client) before that client exposes **guided standard OAuth** in the UX — not merely core/API support for guided flows.

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

### TypeScript SDK (implemented)

Inspector depends on **`@modelcontextprotocol/sdk` v1.x** only (`^1.29.0` in root `package.json`). Standard OAuth and EMA both build on that package — there is **no** `@modelcontextprotocol/client` v2 dependency in the tree today.

| Concern | Package / module |
| ------- | ---------------- |
| Standard OAuth | v1 `@modelcontextprotocol/sdk/client/auth.js` via `BaseOAuthClientProvider` (`core/auth/providers.ts`) |
| EMA leg 1 (IdP OIDC) | v1 SDK: `startAuthorization`, `exchangeAuthorization`, `discoverAuthorizationServerMetadata` — `core/auth/ema/idpOidc.ts` |
| EMA legs 2–3 (ID-JAG + resource token) | **Local wire** in `core/auth/ema/wire.ts` (RFC 8693 token exchange + RFC 7523 JWT bearer); reuses v1 SDK for AS discovery, `selectClientAuthMethod`, `OAuthTokensSchema` |
| EMA orchestration | `core/auth/ema/emaFlow.ts` — `mintEmaResourceTokens`, silent connect, connect/callback completion |
| EMA 401 / transport | `core/auth/ema/transportProvider.ts` — `EmaTransportOAuthProvider` wraps v1 `BaseOAuthClientProvider`; re-runs legs 2–3 on expiry, IdP redirect on missing ID Token |
| JWT expiry helpers | `core/auth/ema/jwt.ts` — `jwtExpiresAtMs`, `isJwtExpired` (exp claim only; no signature verification) |
| Leg 1 in-flight PKCE key | `core/auth/ema/storage.ts` — `idpOAuthStorageKey(issuer)` → `ema-idp:{issuer}` in per-server `servers` map (storage key only; not an OAuth `state` param prefix) |
| Wire constants | `core/auth/ema/constants.ts` — grant/type URNs + `IDP_OIDC_SCOPES` for leg 1 |

**EMA is not in the v1 SDK** as a named feature (`CrossAppAccess`, ID-JAG helpers, etc.). Inspector implements the protocol in `core/auth/ema/` instead.

#### v2 `@modelcontextprotocol/client` (not used; future option)

The v2 client package (`CrossAppAccessProvider`, `discoverAndRequestJwtAuthGrant`, `exchangeJwtAuthGrant`) implements the same legs 2–3 wire format internally. It is **not** imported anywhere today. Possible future paths:

| Option | When |
| ------ | ---- |
| **Swap legs 2–3 to v2 Layer-2 helpers** | Replace `wire.ts` calls with `discoverAndRequestJwtAuthGrant` / `exchangeJwtAuthGrant`; keep v1 transport + `EmaTransportOAuthProvider` |
| **Full v2 transport (Path B)** | v2 `StreamableHTTPClientTransport` + `CrossAppAccessProvider` for EMA servers only — requires v2 client stack; does **not** drop into v1 transport today |

**Why v1 + local wire for the first slice:** single SDK surface, custom `fetchFn` threading, inspector-owned scope/audience resolution (`resourceContext.ts`), and v1 `OAuthClientProvider` adapter for 401 re-auth — without pulling in alpha v2 client bundle surface.

**Watch items (unchanged):**

- **401 re-auth** — EMA connections re-run legs 2–3 (leg 1 only if ID Token missing/expired); do not fall back to standard resource OAuth redirect.
- **Future v2 adoption** — when migrating to v2 wholesale, prefer SDK Layer-2 helpers or `CrossAppAccessProvider` over maintaining duplicate wire in `wire.ts`.

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

**Runtime auth state** (standard OAuth tokens, PKCE, guided metadata, **and** EMA runtime state: cached IdP ID Token / refresh token, leg-1 in-flight PKCE under `ema-idp:{issuer}`, and per-server resource tokens tagged `enterpriseManaged: true` when minted via EMA legs 2–3) uses the existing **`OAuthStorage`** interface (`core/auth/storage.ts`) — whatever adapter each client already passes to `InspectorClient`. ID-JAG is **not** cached — legs 2–3 re-mint on each connect or 401 refresh. EMA does **not** mandate a specific backing store; it extends the serialized auth state that adapter already persists.

No EMA-specific migration of web OAuth persistence is required for the initial ship — sessionStorage-backed web sessions work for quick EMA today. **Follow-up:** shared file-backed OAuth via `RemoteOAuthStorage` → `/api/storage/oauth` so web matches CLI/TUI (see §Follow-up work).

| Client | Config (`client.json`) | Runtime auth state (`OAuthStorage`) |
| ------ | ---------------------- | ----------------------------------- |
| **Web (today)** | `RemoteStorage` adapter → `/api/storage/client` | `BrowserOAuthStorage` → sessionStorage |
| **Web (target)** | same | `RemoteOAuthStorage` → `/api/storage/oauth` → `~/.mcp-inspector/storage/oauth.json` |
| **CLI / TUI** | `NodeClientStorage` (file adapter) | `NodeOAuthStorage` → `oauth.json` |

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

When the user turns off **Enable** in Client Settings, credentials are retained but EMA is inactive install-wide:

```json
{
  "enterpriseManagedAuth": {
    "enabled": false,
    "idp": {
      "issuer": "https://idp.example.com",
      "clientId": "inspector-idp-client-id",
      "clientSecret": "inspector-idp-client-secret"
    }
  }
}
```

`isEnterpriseManagedAuthEnabled()` / `getActiveEnterpriseManagedAuthIdp()` in `core/client/types.ts` treat `enabled: false` as inactive while preserving the IdP fields for re-enable without re-entry.

Later fields (client identity, capability toggles) extend this document until client profiles replace it.

Core provides:

- Types: `ClientConfig`, `EnterpriseManagedAuthIdpConfig` in `core/client/types.ts` (imported by `core/mcp/types.ts` for server/oauth shapes).
- Load/save helpers with JSON parse/validate — no `process.env` reads inside `InspectorClient`.
- File path: `getStoreFilePath(getDefaultStorageDir(), "client")` (reuse `store-io.ts` primitives).

Tests write fixture `client.json` files directly or via `/api/storage/client` in integration tests (same as oauth test helpers).

#### Wiring into `InspectorClient`

Pass IdP config explicitly on the options surface — do **not** put it inside per-server `options.oauth` (that block already means resource OAuth client credentials).

Near-term shape on `InspectorClientOptions`:

```ts
/** Active IdP credentials — omitted when install-level EMA is disabled. */
enterpriseManagedAuth?: { idp: EnterpriseManagedAuthIdpConfig };

/**
 * Full install-level EMA config from client.json (including when disabled).
 * Used to produce friendly errors when a server expects EMA but IdP is inactive.
 */
installEnterpriseManagedAuth?: ClientConfig["enterpriseManagedAuth"];
```

Callers load `client.json` once at session startup, then pass into each `InspectorClient` construction:

```ts
const clientConfig = await loadClientConfig(); // client.json
new InspectorClient(serverConfig, {
  ...opts,
  ...(getActiveEnterpriseManagedAuthIdp(clientConfig) && {
    enterpriseManagedAuth: { idp: getActiveEnterpriseManagedAuthIdp(clientConfig)! },
  }),
  ...(clientConfig.enterpriseManagedAuth && {
    installEnterpriseManagedAuth: clientConfig.enterpriseManagedAuth,
  }),
});
```

**Issuer validation:** `parseHttpUrl()` in `core/auth/utils.ts` validates IdP issuer URLs (and other HTTP URLs in EMA paths) with clear, user-facing error labels — e.g. rejects `https;//idp.example.com` at connect time and during `client.json` parse.

Future: nest under **`InspectorClientProfile`** loaded from the profile store; `client.json` migrates into that mechanism.

**IdP session state** (cached ID Token from leg 1, optional refresh token, optional `idTokenExpiresAt`) lives in the **OAuth store** via `OAuthStorage`. Use a **store-root `idpSessions` map keyed by issuer** (global across servers — one IdP per install), separate from per-server `servers[url]` resource OAuth state. Leg-1 in-flight PKCE/metadata uses synthetic server key `ema-idp:{issuer}` in the `servers` map:

```ts
interface ServerOAuthState {
  // ... existing fields ...
  enterpriseManaged?: boolean; // true when resource tokens came from EMA legs 2–3
}

interface IdpSessionState {
  idToken?: string;
  refreshToken?: string;
  idTokenExpiresAt?: number; // epoch ms
}

interface OAuthStoreState {
  servers: Record<string, ServerOAuthState>; // per-server resource OAuth + leg-1 PKCE at ema-idp:{issuer}
  idpSessions?: Record<string, IdpSessionState>; // issuer → IdP session cache
}
```

Extend `OAuthStorage` / store methods accordingly. IdP **credentials** stay in `client.json`; only runtime tokens belong in `idpSessions`. Per-server `ServerOAuthState` may include `enterpriseManaged: true` when EMA legs 2–3 persist resource tokens (`saveTokens(..., { enterpriseManaged: true })`). **Sign out** clears `idpSessions` for the configured issuer and removes tagged EMA resource entries from the shared OAuth blob — standard OAuth server entries are not cleared. All adapters (`BrowserOAuthStorage`, `NodeOAuthStorage`, `RemoteOAuthStorage`) serialize the same extended shape through their existing backends.

#### Later: client profiles

Inspector is designing a **client profile** mechanism for install-level client configuration (identity, capabilities, IdP/EMA settings, etc.). That work is not settled yet. When it ships:

- Migrate `client.json` content into the profile store (`clientSecret` in the OS keychain, not plaintext).
- `client.json` becomes legacy or an export format.

Web **Client Settings** (see §UX) is the near-term editor for IdP credentials; client profiles may subsume or extend that dialog later.

Near-term IdP config can be edited in the **web Client Settings** dialog (primary path), by hand in `client.json`, via **`POST /api/storage/client`** (tests/automation), or through the file adapters on CLI/TUI — no env-var path.

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
- **Control:** checkbox **"Enterprise-managed authorization"**, with help text: connect via the configured enterprise IdP instead of interactive OAuth to the MCP authorization server; OAuth fields below are resource authorization server credentials.
- **Behavior:** toggling updates `InspectorServerSettings.enterpriseManaged` and persists to `mcp.json` under `oauth.enterpriseManaged` on save. When unchecked, standard OAuth behavior is unchanged.
- **Visibility:** OAuth and EMA apply to remote HTTP transports (SSE / streamable-http) only. **Implemented:** the entire **OAuth Settings** accordion section is hidden for stdio servers (`isOAuthCapableServerType` in `core/mcp/config.ts`; `ServerSettingsForm` receives `serverType` from `ServerSettingsModal` / `App.tsx`). Stdio entries may still carry legacy `oauth` fields on disk; they are not used at connect time.

CLI/TUI can read/write `enterpriseManaged` via catalog/config file without dedicated UX in the first slice; web form is the primary editor.

#### Client / IdP settings (web — implemented)

Install-level IdP credentials are edited in **Client Settings**, separate from per-server **Server Settings**. Same modal pattern as server settings: collapsible accordion sections, controlled draft, debounced persist on change, flush on close.

- **Entry point:** gear icon in the top bar (`ViewHeader`), immediately left of the theme toggle. Available connected and disconnected.
- **Components:** `ClientSettingsModal` + `ClientSettingsForm` (`clients/web/src/components/groups/ClientSettingsModal/`, `ClientSettingsForm/`). Storybook: `Groups/ClientSettingsModal`.
- **Section (initial):** **Enterprise-Managed Authorization**
  - **Enable** checkbox — when off, persisted config keeps `enterpriseManagedAuth.idp` but sets `enabled: false` so credentials are not lost; when on (or `enabled` omitted), EMA is active install-wide.
  - When enabled: **Issuer**, **Client ID**, **Client secret** (Inspector's registration with the enterprise IdP).
  - Shows the OAuth **redirect URI** to register with the IdP (`{origin}/oauth/callback`), derived from `window.location.origin`.
- **Persistence:** `POST /api/storage/client` via `saveClientConfigRemote` / `parseClientConfig` (`core/client/remote.ts`, `core/client/config-parse.ts`). Same on-disk shape as hand-edited `client.json` (`enterpriseManagedAuth.idp`, optional `enabled`).
- **Runtime wiring:** `App.tsx` loads config at startup (`loadClientConfigRemote`) and passes **active** IdP via `getActiveEnterpriseManagedAuthIdp()` plus full install config via `installEnterpriseManagedAuth` into each `InspectorClient`. After a successful save, in-memory `clientConfig` updates so the next connect uses new IdP values without a full page reload.
- **Draft hook:** `useClientSettingsDraft` (`core/react/`, alongside `useSettingsDraft`) — mirrors server settings draft behavior; skips debounced persist while EMA is enabled but issuer or client id is still empty (avoids validation errors mid-edit).
- **IdP sign-in state (implemented):** when an issuer is configured, **Client Settings** shows install-level IdP session status derived from `OAuthStorage.idpSessions[issuer]`:
  - **Signed in** — cached ID Token is present and not expired (`core/auth/ema/idpSession.ts` + `isJwtExpired`).
  - **Session expired** — cached ID Token exists but is expired (next EMA connect will prompt for IdP login).
  - **Not signed in** — no cached IdP session (next EMA connect will open IdP login).
  - State is refreshed when the modal opens (`useEmaIdpLoginState` in `core/react/`).
- **Sign out (implemented):** **Sign out** button when a cached IdP session exists (signed in or expired). Calls `clearEmaIdpSession(storage, issuer)` in **`core/auth/ema/idpSession.ts`** — a single core entry point; clients do **not** pass a server catalog. It:
  1. Clears `idpSessions[issuer]`
  2. Clears leg-1 in-flight state at `servers["ema-idp:{issuer}"]`
  3. Calls `OAuthStorage.clearEnterpriseManagedResourceServers()` — scans the shared OAuth blob and removes `servers[url]` entries where `enterpriseManaged === true` (set when EMA legs 2–3 saved tokens via `saveTokens(url, tokens, { enterpriseManaged: true })` in `emaFlow.ts` / `EmaTransportOAuthProvider`). Standard OAuth entries in the same blob are **not** cleared. Untagged legacy EMA tokens (saved before tagging landed) are not removed until the next EMA connect re-saves with the tag.
  The next connect to a cleared EMA server has no cached access token, so a **401** triggers leg 1 (IdP login) via `authenticate()`.
- **Web OAuth store singleton:** web uses `getBrowserOAuthStorage()` (`core/auth/browser/storage.ts`) so Client Settings sign-out updates the same in-memory Zustand store as the active `InspectorClient` (not a separate `BrowserOAuthStorage` instance per consumer).

**Future (not implemented):** explicit **Sign out** may additionally invoke the IdP's OIDC **end-session** / logout endpoint (RP-initiated logout) so the IdP SSO cookie is cleared — not just inspector-local IdP/resource token state. Today sign-out is **local-only** (clear `idpSessions`, tagged EMA resource entries, and leg-1 PKCE); the IdP may still treat the browser as signed in and skip the login prompt on the next authorize redirect until the IdP session expires or the user signs out at the IdP.

**Copy / UX notes:** User-facing text explains enterprise-managed authorization in plain language (org IdP sign-in vs each server's OAuth login). It does **not** reference protocol jargon (`leg 1`, resource AS, etc.) or storage filenames in the form. Per-server EMA enablement and MCP-server OAuth credentials remain in **Server Settings** (see below).

Alternative paths (CLI/TUI, automation, hand-edit):

- Hand-edit `~/.mcp-inspector/storage/client.json`
- **`POST /api/storage/client`** from tests or scripts

Do not store IdP credentials in the OAuth store — only **runtime OAuth/EMA state** (tokens, PKCE, IdP session cache, etc.) belongs there, via whichever `OAuthStorage` adapter the client uses.

CLI/TUI do not yet have a dedicated Client Settings dialog; they read/write `client.json` via file adapters (Phase 4).

#### Connect errors when IdP is missing or disabled (web — implemented)

When the user connects to a server with `oauth.enterpriseManaged: true` but install-level IdP is not active, `OAuthManager.getEmaFlowConfig()` throws `EmaClientNotConfiguredError` (`core/auth/ema/clientConfigError.ts`) with a reason-specific message:

| Reason | When | User-facing guidance |
| ------ | ---- | -------------------- |
| `not_configured` | No IdP block, or issuer/client id missing | Open Client Settings, enable Enterprise IdP, set issuer, client ID, and secret |
| `disabled` | `enterpriseManagedAuth.enabled === false` with IdP credentials retained | Enterprise IdP is turned off in Client Settings — re-enable and retry |

`installEnterpriseManagedAuth` on `InspectorClientOptions` supplies the full install config so the error can distinguish disabled from never configured. Web surfaces this in connect, OAuth auth, and post-callback reconnect paths (`App.tsx`): toast title `Cannot connect to "<server name>"`, message from the error, `autoClose: false` (stays until dismissed).

#### Connection Info — OAuth snapshot (web — implemented)

`InspectorClient.getOAuthState()` (`core/auth/connection-state.ts`) assembles `OAuthConnectionState` from storage and config only — no network. Used by **Connection Info** (`ConnectionInfoContent`, `oauthDetailsFromConnectionState.ts`) for the active server:

- **Protocol** — `standard` or `ema`
- **Authorized** — whether a usable access token exists in storage
- **Client ID** — preregistered or dynamic registration source
- **IdP session** (EMA only) — `none` / `logged_in` / `expired` from `idpSessions[issuer]`
- **Auth URL** — cached from an in-flight or completed quick OAuth flow (`OAuthFlowState`), when present
- **Scopes** — configured vs granted
- **Access token** — `OAuthAccessTokenField`: copy (raw), decode JWT in place (`core/auth/ema/jwt.ts` helpers); multi-line wrap with segment-aware breaking for JWTs

In-flight guided/quick flow state uses `OAuthFlowState` / `getOAuthFlowState()` / `getOAuthFlowStep()` (renamed from the earlier `AuthGuidedState` names). `getOAuthState()` is the persisted connection snapshot; flow state is separate and ephemeral.

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

**Web callback disambiguation:** web uses a single `/oauth/callback` path for both resource OAuth and IdP OIDC. Pending server id is stashed in sessionStorage before redirect; **protocol** (standard vs EMA) comes from `oauth.enterpriseManaged` on that server, not from the OAuth `state` query param. The `state` param carries **execution** (`quick` / `guided`) plus `authId` for CSRF and fetch-log restore (`{execution}:{authId}`).

**Auth axes (orthogonal):** `AuthProtocol` (`standard` | `ema`) from server/client config; `AuthExecution` (`quick` | `guided`) for SDK one-shot vs state-machine stepping. Guided EMA would be `ema` + `guided` — **deferred** (see §Guided mode).

**Scope for leg 2:** `resourceContext.resolveEmaScopes()` — prefer configured per-server `oauth.scopes`; else join `resourceMetadata.scopes_supported` when present; else omit. Do **not** fall back to IdP `scopes_supported`.

**401 re-auth:** on EMA connections, re-run legs 2–3 (and leg 1 only if the cached ID Token is missing or expired). Do not fall back to standard resource authorization-code OAuth.

**EMA resource token tagging + sign-out:** per-server `oauth.enterpriseManaged` in `mcp.json` is **config** (routing); the OAuth store does not read the catalog on sign-out. Instead, when EMA legs 2–3 persist a resource access token, the store tags that entry (`ServerOAuthState.enterpriseManaged: true` via `SaveTokensOptions`). Sign-out uses that tag to find and clear EMA resource state inside the same `OAuthStorage` blob without the client enumerating MCP servers. This avoids clearing standard OAuth servers and avoids clearing EMA catalog entries that were never connected.

## Inspector mapping

When connecting to an HTTP server with `oauth.enterpriseManaged: true`:

1. Validate protected resource metadata (`resource`, `authorization_servers`).
2. Branch from standard OAuth (VS Code: `mainThreadMcp` — see appendix §A.3).
3. Load tenant IdP config from `client.json` (via `InspectorClientOptions.enterpriseManagedAuth`, loaded at session startup).
4. Obtain or reuse IdP ID Token (leg 1 — `idpOidc.ts`, v1 SDK OIDC redirect/callback).
5. Run leg 2 — `wire.exchangeIdJag()` (RFC 8693 at IdP) → ID-JAG (scopes from `resourceContext.ts`; see §Implementation notes).
6. Run leg 3 — `wire.redeemIdJagForAccessToken()` (RFC 7523 at resource AS) with per-server `oauth.clientId` / `oauth.clientSecret` → MCP access token.
7. Connect with the resource access token via the existing v1 transport; persist tokens via `OAuthStorage.saveTokens(serverUrl, tokens, { enterpriseManaged: true })`.

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

- `core/client/types.ts` — `ClientConfig`, `EnterpriseManagedAuthIdpConfig`, `getActiveEnterpriseManagedAuthIdp`, `isEnterpriseManagedAuthEnabled`
- `core/mcp/types.ts` — `enterpriseManaged` on server oauth shape; `InspectorClientOptions.enterpriseManagedAuth`, `installEnterpriseManagedAuth`
- `core/client/` (or `core/storage/`) — `loadClientConfig` / `saveClientConfig`; `NodeClientStorage`; remote adapter for `/api/storage/client`
- `core/auth/utils.ts` — `parseHttpUrl` (issuer and EMA URL validation)
- `core/auth/connection-state.ts` — `buildOAuthConnectionState`, `OAuthConnectionState`
- `core/auth/storage.ts` + `core/auth/store.ts` — `OAuthStorage` / `OAuthStoreState`: store-root `idpSessions`; `ServerOAuthState.enterpriseManaged` tag; `SaveTokensOptions`; `clearEnterpriseManagedResourceServers()`; all adapters pick up the extended shape automatically
- `core/auth/ema/` — `idpOidc.ts` (leg 1), `wire.ts` (legs 2–3), `emaFlow.ts` (orchestration + tagged `saveTokens`), `transportProvider.ts` (401 re-auth + tagged `saveTokens`), `resourceContext.ts`, `idpSession.ts` (`getEmaIdpLoginState`, `clearEmaIdpSession`), `jwt.ts`, `storage.ts`, `constants.ts`, `clientConfigError.ts` (`EmaClientNotConfiguredError`)
- `core/mcp/oauthManager.ts` — branch on `enterpriseManaged`; EMA quick connect via `emaFlow`; `getOAuthState()`; `createOAuthProvider()` returns `EmaTransportOAuthProvider` for EMA servers (401 re-auth); standard quick/guided unchanged
- `core/mcp/inspectorClient.ts` — declare EMA extension in `initialize` capabilities when `enterpriseManaged`; `getOAuthState()`
- `core/react/useEmaIdpLoginState.ts` — Client Settings IdP session status; calls `clearEmaIdpSession` on sign-out (no catalog wiring)
- `core/auth/browser/storage.ts` — `getBrowserOAuthStorage()` singleton (web)
- `clients/web` — **Client Settings** modal; **Connection Info** OAuth snapshot; friendly EMA connect toasts; load client config at startup; `ServerSettingsForm` OAuth section (HTTP/SSE only); web callback flow tagging for IdP vs resource OAuth. **Guided EMA UI: deferred** until guided OAuth is a product option in the UX.
- `clients/cli`, `clients/tui` — load `client.json` at startup; pass into `InspectorClient`; leg 1 via same `OAuthCallbackServer` + `NodeOAuthStorage` stack as TUI standard OAuth today

### Guided mode (deferred)

**Status: deferred.** Guided EMA is out of scope for the current #1509 delivery. It resumes only after Inspector exposes **guided standard OAuth** as a user-facing option (step-through or run-to-completion), not merely as `InspectorClient` / `OAuthManager` APIs used in tests and TUI.

**Why:** Web v2 has no guided OAuth UI. Connect uses **quick** mode only — `App.tsx` calls `InspectorClient.authenticate()` on 401, not `beginGuidedAuth()` / `runGuidedAuth()`. Guided OAuth exists in **core** and in the **TUI** (`AuthTab` — guided / quick / clear), but there is no web affordance to start or step through a guided flow. Building guided EMA on web without guided OAuth would add dead-end APIs with no entry point.

**When unblocked**, EMA guided mode would extend the existing guided OAuth model (`OAuthFlowState` / `OAuthStep` in `core/auth/types.ts`). Leg 1 reuses the same redirect/callback/code-exchange steps as standard guided OAuth, pointed at the IdP. Legs 2–3 add EMA-specific steps:

- **IdP OIDC login** (authorization redirect + code exchange — same machinery as guided resource OAuth; skippable when cached ID Token is valid)
- **ID-JAG exchange** (leg 2)
- **Resource metadata / token endpoint discovery** (if not already resolved)
- **Resource token redemption** (leg 3)

On silent success, skip interactive IdP OIDC steps when a valid cached ID Token exists; still run legs 2–3.

**Possible interim path:** implement guided EMA on **TUI first** (guided OAuth UX already exists there) without waiting for web guided OAuth — that would be an explicit product decision, not the default plan.

### Clients

| Client | Notes |
| ------ | ----- |
| Web | **First** — implement and test EMA here; **Client Settings** for IdP + per-server EMA checkbox (HTTP/SSE only); **quick connect only** (no guided OAuth UI yet — see §Guided mode); leg 1 via browser redirect + `/oauth/callback` (same path as standard OAuth; disambiguate pending flow) |
| TUI | Follow web; extend existing guided/quick OAuth (`clients/tui/src/App.tsx`) for EMA legs 2–3; leg 1 via existing `OAuthCallbackServer` flow |
| CLI | Follow web/TUI; same Node OAuth stack as TUI when interactive IdP login is required |

### Implementation order (settled)

**Web first** for development and testing. Core types, `OAuthManager` EMA branch, and `OAuthStorage` extensions live in `core/` and are client-agnostic; the shipped #1509 path is web **quick** connect plus Client Settings / Server Settings UX. Guided EMA is deferred until guided OAuth is a UX option (see §Guided mode). TUI and CLI quick EMA remain Phase 4.

Design decisions for EMA are complete. Remaining work is the phased plan and checklist below (client profiles are a separate, later track — not a blocker for `#1509`).

### Phased implementation plan

#### Phase 1 — Foundation (core, no EMA connect yet)

1. Add types: `ClientConfig`, `EnterpriseManagedAuthIdpConfig`, `enterpriseManaged`, `InspectorClientOptions.enterpriseManagedAuth`.
2. Add `enterpriseManaged` to server types, normalizers, and `mcp.json` read/write.
3. Implement `client.json` load/save (`NodeClientStorage` + remote adapter for `/api/storage/client`).
4. Extend `OAuthStorage` / store schema: store-root `idpSessions`; `ServerOAuthState.enterpriseManaged` tag; `clearEnterpriseManagedResourceServers()`.
5. Implement EMA wire + orchestration in `core/auth/ema/` (v1 SDK for discovery/OIDC; local `wire.ts` for legs 2–3).

#### Phase 2 — Web EMA connect (first end-to-end path)

6. Wire web to load `client.json` at session startup → active IdP + `installEnterpriseManagedAuth`.
7. Web UX: **Client Settings** dialog for IdP (`ClientSettingsModal` / `/api/storage/client`); IdP sign-in state + sign-out; `enterpriseManaged` checkbox in `ServerSettingsForm` OAuth section; friendly connect errors; Connection Info OAuth snapshot.
8. `OAuthManager` EMA branch: leg 1 (`idpOidc.ts`) → legs 2–3 (`wire.ts` / `emaFlow.ts`) → tagged `saveTokens(..., { enterpriseManaged: true })` → connect.
9. `InspectorClient`: declare EMA extension in `initialize` when `enterpriseManaged`. EMA 401 re-auth via `EmaTransportOAuthProvider` in `OAuthManager.createOAuthProvider()` (re-run legs 2–3, not resource OAuth redirect).
10. Web callback: disambiguate IdP OIDC vs resource OAuth pending flows at `/oauth/callback`.

#### Phase 3 — Guided EMA + tests (deferred)

**Deferred** until a client exposes guided OAuth in the UX (prerequisite for guided EMA). Not part of the current #1509 close-out.

11. *(deferred)* Guided EMA: leg 1 reuses guided OAuth redirect/code-exchange steps; add legs 2–3 as new steps.
12. Tests: EMA wire/orchestration unit tests and mock IdP/AS integration. **Implemented:** `parseClientConfig`, `clientSettingsValues`, `idpSessions` storage, `enterpriseManaged` server-list round-trip, OAuth `state` parsing, `clientConfigError`, `connection-state`, OAuthManager EMA not-configured paths, keychain secret migration on server-id rename (`servers-route.test.ts`), **Phase 3b automated tests** (§Phase 3b test plan — Layers 1–3). **Manual staging:** live xaa.dev quick EMA verified (§Staging validation). **Optional follow-up:** `RemoteOAuthStorage` EMA E2E variant, 401 re-auth stretch case.

#### Phase 4 — Other clients (after web works)

13. Wire TUI/CLI to load `client.json` and pass `enterpriseManagedAuth` into `InspectorClient`. EMA sign-out (`clearEmaIdpSession`) is already client-agnostic in `core/` — Phase 4 clients can call it without catalog enumeration once Client Settings / logout UX lands.
14. TUI/CLI guided/quick OAuth extensions for EMA legs 2–3.

## Implementation checklist

### Design (complete)

- [x] Audit EMA spec and TypeScript SDK surfaces
- [x] Finalize inspector config shape (server + tenant IdP)
- [x] Choose near-term implementation: v1 `@modelcontextprotocol/sdk` + local EMA wire (`core/auth/ema/`), v1 transport unchanged
- [x] Choose near-term persistence: `client.json` (IdP config) + extend existing `OAuthStorage` per client (OAuth/EMA runtime state)
- [x] Leg 1 mechanism: OIDC authorization-code flow via existing per-client OAuth stack (web redirect/callback; TUI/CLI `OAuthCallbackServer`)
- [x] Implementation order: web client first for EMA development and testing

### Phase 1 — Foundation

- [x] Implement EMA core: `core/auth/ema/` (leg 1 via v1 SDK OIDC; legs 2–3 via `wire.ts`; orchestration in `emaFlow.ts`)
- [x] Add types: `ClientConfig`, `EnterpriseManagedAuthIdpConfig`, `enterpriseManaged`, `InspectorClientOptions.enterpriseManagedAuth`
- [x] Add `enterpriseManaged` to server types, normalizers, and `mcp.json` read/write
- [x] Implement `client.json` load/save (`NodeClientStorage` + `/api/storage/client` remote adapter)
- [x] Extend `OAuthStorage` / OAuth store schema: `idpSessions`, `ServerOAuthState.enterpriseManaged`, `clearEnterpriseManagedResourceServers()`

### Phase 2 — Web EMA connect

- [x] Wire web to load client config at session startup → active IdP + `installEnterpriseManagedAuth`
- [x] Web UX: **Client Settings** dialog for IdP credentials (`ClientSettingsModal`, gear icon in header, `/api/storage/client`)
- [x] Web UX: IdP sign-in state + **Sign out** in Client Settings (`idpSession.ts`, `useEmaIdpLoginState`, `clearEmaIdpSession` + tagged resource cleanup)
- [x] Web UX: `enterpriseManaged` checkbox and OAuth settings section in `ServerSettingsForm` (hidden for stdio)
- [x] Web UX: friendly connect errors when EMA server but IdP missing/disabled (`EmaClientNotConfiguredError`, persistent toast)
- [x] Web UX: Connection Info OAuth snapshot (`getOAuthState`, access token copy/decode)
- [x] Integrate EMA routing in `OAuthManager` (branch on `enterpriseManaged`; leg 1 IdP OIDC; legs 2–3 via `wire.ts` / `emaFlow.ts`)
- [x] Declare EMA extension in `initialize` when connecting with `enterpriseManaged`
- [x] EMA 401 re-auth: re-run legs 2–3 (leg 1 only if ID Token expired/missing) via `EmaTransportOAuthProvider`
- [x] Web: disambiguate IdP vs resource OAuth at `/oauth/callback` (shared callback; `completeOAuthFlow` branches on `enterpriseManaged`; protocol from server config, execution in OAuth `state` prefix)

### Phase 3 — Guided EMA (deferred)

- [ ] **Blocked on product:** guided OAuth UX — user-facing step-through or run-to-completion (web: not implemented; TUI: `AuthTab`)
- [ ] *(deferred)* Guided EMA: legs 2–3 as new steps; leg 1 reuses guided OAuth redirect/code-exchange steps
- [ ] *(deferred)* Tests: guided EMA UI steps

### Phase 3b — Integration tests

- [x] **Manual staging validation** — full quick EMA connect against live xaa.dev (see §Staging validation). Confirms legs 1–3 and web UX outside CI.
- [x] **Automated integration tests** — mock IdP + mock resource AS + composable protected-resource server (see §Phase 3b test plan). Live xaa.dev is **not** required for CI.
- [ ] *(optional)* `RemoteOAuthStorage` EMA E2E variant — same happy path via `/api/storage/oauth` (shared-storage follow-up).
- [ ] *(optional)* 401 re-auth stretch — invalidate resource token, assert legs 2–3 re-run.

### Phase 4 — Other clients

- [ ] Wire TUI/CLI to load client config → `InspectorClientOptions.enterpriseManagedAuth`
- [ ] TUI/CLI guided/quick OAuth extensions for EMA

### Later

- [ ] **Guided EMA** (web or cross-client) — after guided OAuth is a UX option; see §Guided mode (deferred)
- [ ] **Remove Zustand from OAuth persistence** — direct read/write of OAuth blob; see §Follow-up work
- [ ] **Web shared OAuth store** — `RemoteOAuthStorage` / `oauth.json` for web + CLI + TUI parity; see §Follow-up work
- [ ] Client profile persistence (migrate from `client.json`; may extend or replace web Client Settings)
- [ ] Optional: adopt `@modelcontextprotocol/client` v2 Layer-2 helpers for legs 2–3 (replace `wire.ts`) or full v2 transport for EMA
- [ ] Optional: IdP **end-session** / RP-initiated logout on explicit **Sign out** (today sign-out clears inspector-local IdP session and tagged EMA resource tokens only; IdP browser SSO may remain active)

---

## Staging validation (manual — verified)

Full end-to-end **quick EMA** has been exercised manually against live **xaa.dev** (June 2026). This validates the #1509 web path outside CI.

### Topology

| Role | Service | Inspector config |
| ---- | ------- | ---------------- |
| **Enterprise IdP** (legs 1–2) | `https://idp.xaa.dev` | **Client Settings** — issuer, requesting-app client id/secret |
| **Resource authorization server** (leg 3) | `https://auth.resource.xaa.dev` (xaa.dev resource AS) | Per-server **Server Settings** — resource test client id/secret, EMA enabled, scopes |
| **Protected MCP resource** | Composable test server (`test-servers/configs/xaa-ema-http.json`) — `protected-resource` mode, local streamable-http | Server catalog entry URL must match registered resource identifier (`http://localhost:8080/` — use `localhost`, not `127.0.0.1`) |

Registration on xaa.dev: composable test server registered as a **resource server**; its AS points at xaa.dev (`authorizationServers` / JWKS in `xaa-ema-http.json`). IdP and resource AS are distinct hosts on xaa.dev.

### Flow exercised

1. Client Settings — Enterprise IdP configured and enabled.
2. Server Settings — `enterpriseManaged` on; resource AS client credentials from xaa.dev resource registration.
3. Connect (quick) — IdP login when needed → ID-JAG mint → resource access token → MCP `initialize` with EMA extension capability.
4. Reconnect / 401 — silent or re-auth paths; Connection Info shows EMA OAuth snapshot.

### Known-good fixture

`test-servers/configs/xaa-ema-http.json` — protected-resource OAuth pointing at `https://auth.resource.xaa.dev`. Use with the composable test server CLI; align Inspector server URL and xaa.dev resource identifier.

---

## Follow-up work (not blocking #1509 close-out)

These items came out of EMA staging and apply beyond EMA. They are **not** required to ship quick EMA on web but should be tracked.

### Remove Zustand from OAuth persistence

Today `OAuthStorage` is backed by a **Zustand** `persist` store (`core/auth/store.ts`) with adapters for sessionStorage (`BrowserOAuthStorage`), file (`NodeOAuthStorage` via `file-storage.ts`), and HTTP (`RemoteOAuthStorage` via `remote-storage.ts`). The Zustand layer wraps a simple `{ servers, idpSessions }` blob and adds:

- `{ state, version }` envelope on file/remote adapters (see [Servers file](v2_servers_file.md) — intentionally avoided for `mcp.json`)
- A second in-memory copy and async persist semantics that complicate sign-out, callback rebuild, and multi-consumer sharing (`getBrowserOAuthStorage()` singleton exists partly to paper over this)

**Direction:** refactor `OAuthStorage` implementations to read/write the serialized shape **directly** (file I/O, `/api/storage/oauth`, or in-memory for tests) without Zustand. Keep the `OAuthStorage` interface stable for `InspectorClient` / `OAuthManager`.

### Shared file-backed OAuth state (web + CLI + TUI)

Today:

| Client | OAuth runtime store |
| ------ | ------------------- |
| **Web** | `BrowserOAuthStorage` → **sessionStorage** (tab-local; lost on new tab / callback page load relies on same tab) |
| **CLI / TUI** | `NodeOAuthStorage` → `~/.mcp-inspector/storage/oauth.json` |

`RemoteOAuthStorage` already exists (`core/auth/remote/storage-remote.ts`) and talks to **`GET/POST/DELETE /api/storage/oauth`** on the local Hono backend — the same generic storage API that persists to disk under `~/.mcp-inspector/storage/`. Integration tests use it (`inspectorClient-oauth-remote-storage-e2e.test.ts`).

**Direction:** wire the **web app** through `RemoteOAuthStorage` (via `environmentFactory.ts` / `App.tsx`) instead of `BrowserOAuthStorage`, so web, CLI, and TUI share one **`oauth.json`** when using the default local backend. Benefits: IdP session and EMA resource tokens survive browser refresh; sign-out in Client Settings and connect use the same store without a sessionStorage singleton; EMA testing matches how CLI/TUI will behave in Phase 4.

**Migration:** one-time import or “start fresh” for existing sessionStorage OAuth blobs; document that enabling shared storage is the default for local dev.

---

## Phase 3b test plan (automated integration)

Goal: CI tests that prove **quick EMA** legs 1–3 through `InspectorClient` / `OAuthManager` without calling live xaa.dev. Manual staging (§Staging validation) already covers live IdP/AS; automation encodes regressions.

**Status (June 2026):** Layers 1–3 implemented and green in CI (`npm run test:integration`). Optional items (RemoteOAuthStorage variant, 401 re-auth) remain open.

### Principles

- **No live xaa.dev in default CI** — flaky, credential-bound, network-dependent. Optional `describe.skipIf` / manual job later.
- **Reuse existing patterns** — `TestServerHttp` + `createExternalResourceOAuthTestServerConfig`, `inspectorClient-oauth-e2e.test.ts`, `inspectorClient-oauth-remote-storage-e2e.test.ts`, `jose` for JWTs (`test-server-protected-resource.test.ts`).
- **Mock at HTTP boundary** — `fetchFn` injection on `InspectorClient` / `EmaFlowConfig` so `wire.ts` and `idpOidc.ts` run real code against local mock servers.
- **Guided execution not required** — quick path only (`authenticate()` / `trySilentEmaAuth` / `completeOAuthFlow`).

### Test layers

#### Layer 1 — `wire.ts` + `emaFlow.ts` (unit / near-unit) — **done**

**Files:** `clients/web/src/test/core/auth/ema/wire.test.ts`, `emaFlow.test.ts`

| Case | Status |
| ---- | ------ |
| `exchangeIdJag` happy path | ✅ Mock IdP token endpoint; assert RFC 8693 request shape |
| `exchangeIdJag` IdP error | ✅ Asserts leg-2 error message |
| `redeemIdJagForAccessToken` happy path | ✅ Mock resource AS token endpoint |
| `mintEmaResourceTokens` end-to-end | ✅ In-memory `OAuthStorage` + mocked fetch; `resourceContext` bypass |
| Missing ID Token | ✅ |
| Missing resource secret | ✅ |
| `trySilentEmaAuth` saves tagged tokens | ✅ `enterpriseManaged: true` on `saveTokens` |
| `trySilentEmaAuth` returns false without IdP session | ✅ |

Uses `vi.fn()` fetch — no listening ports. Runs in `unit` project.

#### Layer 2 — Mock IdP + mock resource AS (local HTTP) — **done**

**File:** `clients/web/src/test/integration/mcp/ema-mock-servers.ts`

Ephemeral `node:http` servers (port `0` on `127.0.0.1`):

1. **Mock IdP** — `/.well-known/oauth-authorization-server` + `openid-configuration`, `/token` (RFC 8693 token exchange → ID-JAG). Fixture client id/secret: `EMA_MOCK_IDP_*` constants.
2. **Mock resource AS** — `/.well-known/oauth-authorization-server`, `/jwks`, `/token` (JWT bearer grant accepts ID-JAG, returns RS256 access token). Fixture client id/secret: `EMA_MOCK_RESOURCE_*` constants.

Shared helper `minimalOAuthAsMetadata()` satisfies SDK OAuth metadata schema. `createMockIdToken()` seeds leg-1 IdP session in storage. Topology mirrors xaa.dev staging — see comment block in helper + `test-servers/configs/xaa-ema-http.json`.

#### Layer 3 — `InspectorClient` EMA connect E2E (integration) — **done**

**File:** `clients/web/src/test/integration/mcp/inspectorClient-ema-e2e.test.ts`

| Step | Status |
| ---- | ------ |
| 1 | ✅ Protected-resource `TestServerHttp` + `createExternalResourceOAuthTestServerConfig` (mock AS JWKS/issuers) |
| 2 | ✅ Mock IdP + mock resource AS on ephemeral ports |
| 3 | ✅ `InspectorClient` with `enterpriseManaged: true`, fixture IdP + resource credentials |
| 4 | ✅ Cached ID Token seeded in `NodeOAuthStorage` (leg 1 shortcut) |
| 5 | ✅ `connect()` → `getOAuthState()` `protocol: "ema"`, `authorized: true`, `ema.idpSession: "logged_in"` |
| 6 | ✅ Second connect reuses silent path; persisted tokens tagged `enterpriseManaged: true` |

Runs under `integration` project; `test-servers:build` prerequisite (existing). Transport: `streamable-http` only (EMA is HTTP-only).

**Storage variant (optional — not implemented):** same flow with `RemoteOAuthStorage` + `createRemoteApp` tmp dir — proves EMA tokens persist via `/api/storage/oauth` (feeds shared-storage follow-up).

#### Layer 4 — Protected-resource discovery — **partial**

**File:** `clients/web/src/test/integration/mcp/test-server-protected-resource.test.ts`

Existing coverage: `xaa-ema-http.json` config load, `ExternalAccessTokenValidator`, protected-resource metadata advertises external `authorization_servers`. Layer 3 E2E exercises `discoverEmaResourceContext` implicitly on connect. Dedicated `discoverEmaResourceContext` unit test not added (optional).

### Out of scope for Phase 3b

- Live xaa.dev (covered by §Staging validation)
- Guided EMA steps (deferred)
- Browser / Playwright UI tests
- TUI/CLI (Phase 4)

### Suggested implementation order

1. ~~Layer 1 (`wire` / `emaFlow` unit tests)~~ — **done**
2. ~~Layer 2 mock servers helper~~ — **done**
3. ~~Layer 3 single happy-path E2E (`streamable-http`)~~ — **done**
4. Layer 3 storage variant with `RemoteOAuthStorage` — optional, aligns with shared-storage refactor.
5. 401 re-auth case — connect, invalidate resource token, assert legs 2–3 re-run (stretch).

### Done criteria for Phase 3b checklist

- [x] Layer 1 tests merged
- [x] Layer 3 happy-path integration test green in CI
- [x] Document in test file how mock topology maps to xaa.dev staging (comment block + link to `xaa-ema-http.json`)
- [ ] *(optional)* `RemoteOAuthStorage` EMA E2E variant
- [ ] *(optional)* 401 re-auth stretch case

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
