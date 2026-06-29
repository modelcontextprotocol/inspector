# Inspector V2 — OAuth smoke testing (real servers)

### [Brief](README.md) | [V2 Scope](v2_scope.md) | [Servers file](v2_servers_file.md) | [Auth hardening](v2_auth_hardening.md) | [Mid-session auth](v2_auth_mid_session.md) | [EMA / XAA](v2_auth_ema.md)

Manual smoke procedures for exercising Inspector OAuth against **hosted** MCP servers. Complements automated coverage in `clients/web/src/test/integration/mcp/inspectorClient-oauth-e2e.test.ts`, which uses the in-repo `TestServerHttp` (`createOAuthTestServerConfig`).

This document does **not** replace CI. It records known-good real endpoints, which client-ID mechanism each server supports, and how to configure Inspector (web, TUI, or CLI).

## Install-level client config (TUI / CLI)

EMA and CIMD credentials live in **`~/.mcp-inspector/storage/client.json`** (same file the web **Client Settings** dialog writes). TUI and CLI load it automatically at startup:

| Flag / env | Default |
| ---------- | ------- |
| `--client-config <path>` | `~/.mcp-inspector/storage/client.json` |
| `MCP_CLIENT_CONFIG_PATH` | Same default when `--client-config` is omitted |

For repo smoke fixtures, point at the checked-in template:

```bash
--client-config configs/client.json
```

CLI flags (`--client-metadata-url`, `--client-id`, `--client-secret`) override values from `client.json` when present. Per-server OAuth fields in `mcp.json` still apply for static/DCR/EMA resource credentials.

OAuth callback URL (TUI/CLI only):

| Flag / env | Default |
| ---------- | ------- |
| `--callback-url <url>` | `http://127.0.0.1:6276/oauth/callback` |
| `MCP_OAUTH_CALLBACK_URL` | Same default when `--callback-url` is omitted |

Web uses `http://localhost:6274/oauth/callback` on the main app server — not these runner settings.

## Terminology

| Term | Meaning in this doc |
| ---- | ------------------- |
| **Static / preregistered client** | You supply `oauthClientId` and optionally `oauthClientSecret` in Server Settings. Inspector skips DCR and uses your credentials. |
| **DCR** | Dynamic Client Registration (RFC 7591). Inspector registers at the AS `registration_endpoint` on first connect; no client id in config. |
| **CIMD** | Client ID Metadata Document (SEP-991). Inspector uses an HTTPS metadata URL as `client_id` when the AS advertises `client_id_metadata_document_supported`. |
| **Client credentials grant** | OAuth 2.0 machine-to-machine `grant_type=client_credentials`. **Not** what we mean by “static client credentials” here. Inspector does not implement this grant yet ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225)). |

## Prerequisites

1. **Inspector web, TUI, or CLI** with OAuth environment wired (`environment.oauth` — web always; TUI/CLI for HTTP/SSE servers).
2. **Redirect URI** must match what the authorization server expects:
   - **Web (dev):** `http://localhost:6274/oauth/callback` (default `CLIENT_PORT`; see `clients/web/server/web-server-config.ts`).
   - **Web (prod launcher):** `{origin}/oauth/callback` (same host/port as the Hono server).
   - **TUI / CLI:** loopback callback from `createOAuthCallbackServer()` (TUI) — default **`http://127.0.0.1:6276/oauth/callback`** (port 6276 ≈ T9 “MCPO”, MCP OAuth; separate from web `6274`). Override with `--callback-url` or `MCP_OAUTH_CALLBACK_URL`. Use `http://127.0.0.1:0/oauth/callback` for an OS-assigned ephemeral port when the AS registers redirect URIs dynamically (DCR).
3. **Catalog entry** in `~/.mcp-inspector/mcp.json` (or ad-hoc connect) with `type: "streamable-http"` and the server URL.
4. **Keychain-backed secrets (TUI/CLI):** when OAuth client secrets or stdio env values were saved via web **Server Settings**, they live in the OS keychain — not in `mcp.json`. TUI and CLI merge keychain values on catalog load (same effective config as web `GET /api/servers`; see [Servers file](v2_servers_file.md) §Secret storage). For static/EMA smokes you can also pass `--client-secret` (CLI/TUI), use a local hand-edited `mcp.json` with plaintext secrets (dev only — never commit), or save secrets once via web on the same machine before running the TUI/CLI.

### Example catalog shape (HTTP server)

```jsonc
{
  "mcpServers": {
    "mcp-example-everything": {
      "type": "streamable-http",
      "url": "https://example-server.modelcontextprotocol.io/mcp"
    },
    "github-mcp": {
      "type": "streamable-http",
      "url": "https://api.githubcopilot.com/mcp/"
    },
    "stytch-mcp-demo": {
      "type": "streamable-http",
      "url": "https://stytch-as-demo.val.run/mcp"
    },
    "stytch-mcp": {
      "type": "streamable-http",
      "url": "https://mcp.stytch.dev/mcp"
    }
  }
}
```

Per-server OAuth fields live on the same entry (lifted to `InspectorServerSettings` in memory). On disk (#1358 flat shape):

```jsonc
"oauth": {
  "clientId": "<from GitHub OAuth App>",
  "clientSecret": "<from GitHub OAuth App>",
  "scopes": "repo read:user"
}
```

## Smoke matrix (real servers)

| Server | URL | Mechanism to smoke | Credentials in repo? |
| ------ | --- | ------------------ | -------------------- |
| **MCP Example “Everything”** (hosted) | `https://example-server.modelcontextprotocol.io/mcp` | **DCR** | No — register at connect time |
| **GitHub MCP** (remote) | `https://api.githubcopilot.com/mcp/` | **Static OAuth App** (or PAT header bypass) | No — you create a GitHub OAuth App |
| **Stytch MCP demo** (hosted) | `https://stytch-as-demo.val.run/mcp` | **CIMD** (also DCR) | No — use [MCPJam CIMD](#cimd-credentials-for-smoke-mcpjam) (default for smoke) |
| **Stytch MCP** (management API) | `https://mcp.stytch.dev/mcp` | **CIMD** (also DCR) | No — same MCPJam CIMD URL; real Stytch login at `stytch.com` |
| **Composable test server** (local) | `http://127.0.0.1:<port>/mcp` | Static, DCR, CIMD (all) | Fake ids in e2e tests only |
| **xaa.dev EMA** | Local resource + `auth.resource.xaa.dev` | EMA (not standard OAuth ladder) | Registered on xaa.dev — see [EMA staging](v2_auth_ema.md#staging-validation-manual--verified) |

---

## 1. MCP Example “Everything” server (DCR)

**Hosted reference server** implementing the full MCP feature surface (tools, resources, prompts, sampling, elicitation). Source: [modelcontextprotocol/example-remote-server](https://github.com/modelcontextprotocol/example-remote-server). Public deployment:

| Field | Value |
| ----- | ----- |
| MCP URL | `https://example-server.modelcontextprotocol.io/mcp` |
| Resource identifier | `https://example-server.modelcontextprotocol.io/` |
| Authorization server | Same host (combined resource + AS) |
| Protected resource metadata | `https://example-server.modelcontextprotocol.io/.well-known/oauth-protected-resource` |
| AS metadata | `https://example-server.modelcontextprotocol.io/.well-known/oauth-authorization-server` |

**Verified AS capabilities (June 2026):**

- `registration_endpoint`: present → **DCR supported**
- `client_id_metadata_document_supported`: **not advertised** → CIMD not available on this host
- `token_endpoint_auth_methods_supported`: `["none"]` → public client after DCR
- `code_challenge_methods_supported`: `["S256"]` → PKCE required

### Procedure (web)

1. Add catalog entry (no `oauth` block needed for DCR).
2. Start Inspector web (`mcp-inspector --web --dev` or launcher).
3. Connect → expect **401**, then OAuth redirect (or use Connection flow that calls `authenticate()` on 401).
4. Complete browser authorization on the example AS.
5. **Pass:** `tools/list` succeeds; Connection Info shows authorized + dynamic client id from DCR.

### Procedure (TUI)

1. `mcp-inspector --tui` with catalog containing the server.
2. Press **C** to connect — OAuth starts automatically when the server returns 401.
3. Complete browser flow against callback server (`http://127.0.0.1:6276/oauth/callback` by default).
4. **Pass:** connect succeeds without a second **C**; Auth tab shows authorized state.

### Notes

- First connect performs discovery + DCR + authorization code + PKCE. Tokens persist in `~/.mcp-inspector/storage/oauth.json` (TUI/CLI path) or browser session storage (web).
- Reconnect should reuse stored DCR `client_id` unless storage was cleared.

---

## 2. GitHub MCP server (static / preregistered OAuth App)

**Remote GitHub MCP** is the usual choice for **static client credential** smoke testing against a production authorization server that does **not** expose DCR to arbitrary MCP clients.

| Field | Value |
| ----- | ----- |
| MCP URL | `https://api.githubcopilot.com/mcp/` |
| Resource identifier | `https://api.githubcopilot.com/mcp` |
| Protected resource metadata | `https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp` |
| Authorization server | `https://github.com/login/oauth` |
| Upstream docs | [github/github-mcp-server](https://github.com/github/github-mcp-server) — [remote-server.md](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) |

**Verified PRM (June 2026):** `authorization_servers: ["https://github.com/login/oauth"]`. Scopes advertised include `repo`, `read:org`, `read:user`, `user:email`, `gist`, `workflow`, etc.

### Why GitHub is the static-credentials smoke server

- GitHub’s OAuth platform expects a **pre-registered OAuth App** (or GitHub App) with a fixed callback URL. There is no open `registration_endpoint` for Inspector-style DCR.
- VS Code, Cursor, and other hosts register **their own** GitHub OAuth applications; Inspector does not ship shared production client id/secret pairs.
- This matches the “user knows static credentials are required” path: set `oauthClientId` / `oauthClientSecret` in Server Settings before or after the first 401.

### Credentials to use (you create these)

There are **no shared Inspector test credentials** in this repository. Create a **GitHub OAuth App** under your account or org:

1. Open [GitHub Developer settings → OAuth Apps](https://github.com/settings/developers) → **New OAuth App**.
2. Suggested values for local web smoke:

   | Field | Value |
   | ----- | ----- |
   | Application name | `MCP Inspector (local dev)` |
   | Homepage URL | `http://localhost:6274` |
   | Authorization callback URL | `http://localhost:6274/oauth/callback` |

   For TUI/CLI, register **`http://127.0.0.1:6276/oauth/callback`** (default) on the OAuth app, or override with `--callback-url` / `MCP_OAUTH_CALLBACK_URL`.

3. After creation, copy **Client ID** and generate a **Client secret**.
4. In Inspector **Server Settings → OAuth** for the GitHub MCP entry:
   - **Client ID** → `oauth.clientId` on disk
   - **Client secret** → `oauth.clientSecret` (stored via keychain on web backend when saved through UI)
   - **Scopes** → space-separated subset of PRM scopes, e.g. `read:user repo` (match what you need for `tools/list`; tighter scopes reduce consent friction)

Example `mcp.json` fragment:

```jsonc
"github-mcp": {
  "type": "streamable-http",
  "url": "https://api.githubcopilot.com/mcp/",
  "oauth": {
    "clientId": "Ov23liXXXXXXXXXXXX",
    "clientSecret": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "scopes": "read:user repo"
  }
}
```

**Never commit real secrets.** Use local catalog only.

### Procedure (web)

Run both phases in order. **Clear OAuth state** between phases: **Server Settings → OAuth → Clear stored OAuth state**, or (while connected) **Connection Info → OAuth Details → Clear and disconnect**.

#### Phase 1 — static credentials off (expect failure)

1. Add the GitHub MCP catalog entry with **no** Server Settings OAuth fields (no `oauth` block on disk).
2. Connect → **401** → authenticate → complete or attempt GitHub login.
3. **Pass (negative control):** connect does **not** reach an authorized MCP session. Typical outcomes: token exchange or registration error, or 401 persists after callback — GitHub has no DCR `registration_endpoint`, so Inspector cannot obtain a client id without your OAuth App credentials.

#### Phase 2 — static credentials on (expect success)

1. Create the GitHub OAuth App and fill **Server Settings → OAuth** (Client ID, Client secret, scopes) as above.
2. Clear OAuth state for this server again (Server Settings or Connection Info as above).
3. Connect → **401** → authenticate → GitHub login/consent for **your** OAuth App.
4. **Pass:** connected; `tools/list` returns GitHub tools; Connection Info shows **Client registration = Static (preregistered)** and your OAuth App client id.

### Procedure (TUI)

Same two phases:

1. **Off:** catalog entry without `oauth` block → connect, **A** to authenticate → **expect failure** (no DCR on GitHub).
2. **On:** add `oauth` block or `--client-id` / `--client-secret` → clear stored OAuth tokens for the server → connect → **expect success** as in Phase 2 (web).

### Alternative: Personal Access Token (non-OAuth smoke)

GitHub documents PAT auth with a static header (bypasses OAuth flow entirely). Useful for MCP tool smoke, **not** for testing Inspector OAuth:

```jsonc
"github-mcp-pat": {
  "type": "streamable-http",
  "url": "https://api.githubcopilot.com/mcp/",
  "headers": {
    "Authorization": "Bearer <GITHUB_PAT>"
  }
}
```

See [GitHub MCP README — Using a GitHub PAT](https://github.com/github/github-mcp-server#remote-github-mcp-server).

### GitHub org / enterprise

- Org may block OAuth Apps or MCP policies — see [policies-and-governance.md](https://github.com/github/github-mcp-server/blob/main/docs/policies-and-governance.md).
- **GitHub Enterprise Cloud (ghe.com):** use `https://copilot-api.octocorp.ghe.com/mcp` and enterprise OAuth settings ([README](https://github.com/github/github-mcp-server#github-enterprise)).

---

## 3. Stytch MCP server (CIMD)

Stytch advertises first-class [CIMD support for MCP](https://stytch.com/blog/oauth-client-id-metadata-mcp/). Inspector smoke testing uses **two** hosted Stytch MCP targets:

| Target | When to use |
| ------ | ----------- |
| **`stytch-mcp-demo`** — `https://stytch-as-demo.val.run/mcp` | **Default for local CIMD smoke.** Test Stytch project; authorize at the demo app (`/oauth/authorize`) with email OTP / test login — not the `stytch.com` dashboard. |
| **`stytch-mcp`** — `https://mcp.stytch.dev/mcp` | **Production-style smoke.** Stytch’s hosted Management API MCP; authorize at `https://stytch.com/oauth/authorize` with a real Stytch workspace account (often social SSO). |

### 3a. Stytch demo MCP (preferred for dev)

| Field | Value |
| ----- | ----- |
| MCP URL | `https://stytch-as-demo.val.run/mcp` |
| Resource identifier | `https://stytch-as-demo.val.run/mcp` |
| Protected resource metadata | `https://stytch-as-demo.val.run/.well-known/oauth-protected-resource/mcp` |
| Authorization server (issuer) | `https://industrious-dress-4239.customers.stytch.dev` *(resolve from PRM — may change)* |
| AS metadata | `https://industrious-dress-4239.customers.stytch.dev/.well-known/oauth-authorization-server` |
| Token endpoint | `https://industrious-dress-4239.customers.stytch.dev/v1/oauth2/token` |
| DCR registration endpoint | `https://industrious-dress-4239.customers.stytch.dev/v1/oauth2/register` |
| Authorization UI | `https://stytch-as-demo.val.run/oauth/authorize` (demo-hosted; test login — **not** `stytch.com`) |

**Verified discovery (June 2026):** PRM at the URL above currently returns:

```json
{
  "resource": "https://stytch-as-demo.val.run/mcp",
  "authorization_servers": ["https://industrious-dress-4239.customers.stytch.dev"],
  "scopes_supported": ["openid", "email"]
}
```

AS metadata from that issuer currently includes:

- `issuer`: `https://industrious-dress-4239.customers.stytch.dev`
- `client_id_metadata_document_supported`: **true** → CIMD
- `registration_endpoint`: `…/v1/oauth2/register` → **DCR also works** on the same server
- `token_endpoint`: `…/v1/oauth2/token`
- `authorization_endpoint`: `https://stytch-as-demo.val.run/oauth/authorize` (not `stytch.com`)
- `code_challenge_methods_supported`: `["S256"]`
- `token_endpoint_auth_methods_supported`: `["client_secret_basic", "client_secret_post", "none"]`

Use this server when validating Inspector CIMD/DCR against a **real** Connected Apps AS without needing a Stytch Management workspace login.

**Typical network sequence (CIMD, web):**

1. `POST https://stytch-as-demo.val.run/mcp` → **401** (no token)
2. `GET …/.well-known/oauth-protected-resource/mcp` → PRM
3. `GET …/.well-known/oauth-authorization-server` → AS metadata (on the issuer host from PRM)
4. Browser redirect to `https://stytch-as-demo.val.run/oauth/authorize?client_id=…` (not logged as an Inspector fetch)
5. Callback to `http://localhost:6274/oauth/callback`
6. `POST …/v1/oauth2/token` → **200** (see [Verifying CIMD](#verifying-cimd-vs-dcr-network-and-tokens) for the request body)
7. `POST https://stytch-as-demo.val.run/mcp` → **200**

CIMD does **not** call `POST …/v1/oauth2/register` — Inspector stores the metadata URL as `client_id` locally before `auth()`. Stytch fetches the metadata document **server-side** during authorize; that fetch does not appear in Inspector’s network log.

### 3b. Stytch Management MCP (production-style)

| Field | Value |
| ----- | ----- |
| MCP URL | `https://mcp.stytch.dev/mcp` |
| Resource identifier | `https://mcp.stytch.dev` |
| Protected resource metadata | `https://mcp.stytch.dev/.well-known/oauth-protected-resource` |
| Product docs | [Stytch MCP Server](https://stytch.com/docs/resources/workspace-management/stytch-mcp-server), [mcp.stytch.dev](https://mcp.stytch.dev/) |

**Verified discovery (June 2026):** PRM at the URL above currently returns:

```json
{
  "resource": "https://mcp.stytch.dev",
  "authorization_servers": ["https://rustic-kilogram-6347.customers.stytch.com"],
  "scopes_supported": [
    "openid", "email", "profile",
    "admin:projects", "manage:api_keys", "manage:api_keys:test",
    "manage:project_settings", "manage:project_data"
  ]
}
```

AS metadata from that issuer includes:

- `client_id_metadata_document_supported`: **true** → CIMD
- `registration_endpoint`: present → **DCR also works** on the same server
- `authorization_endpoint`: `https://stytch.com/oauth/authorize` (Stytch workspace login)
- `code_challenge_methods_supported`: `["S256"]`

Resolve `token_endpoint` and `registration_endpoint` fresh from AS metadata on the issuer host (`rustic-kilogram-6347.customers.stytch.com` at time of writing). Issuer hostnames are project-specific and may change — always follow PRM → AS discovery rather than hardcoding.

Use this server when you need to smoke CIMD against Stytch’s **live** Management API MCP and can sign in with a real Stytch account.

### CIMD credentials for smoke (MCPJam)

Inspector Stytch CIMD smoke uses **[MCPJam](https://www.mcpjam.com/)’s public Client ID Metadata Document** — no hosting or OAuth App setup required.

CIMD does **not** use `oauth.clientId` / `oauth.clientSecret` in `mcp.json`. Configure install-wide in **Client Settings** (web), **`client.json`** (TUI/CLI default path or `--client-config`), or **`--client-metadata-url`** (CLI/TUI override).

#### Metadata URL (use this in Client Settings)

```
https://www.mcpjam.com/.well-known/oauth/client-metadata.json
```

Live document (June 2026; fetch fresh if debugging redirect mismatches):

```json
{
  "client_id": "https://www.mcpjam.com/.well-known/oauth/client-metadata.json",
  "client_name": "MCPJam",
  "client_uri": "https://www.mcpjam.com",
  "logo_uri": "https://www.mcpjam.com/mcp_jam_2row.png",
  "redirect_uris": [
    "mcpjam://oauth/callback",
    "mcpjam://authkit/callback",
    "http://127.0.0.1:6274/oauth/callback",
    "http://localhost:6274/oauth/callback",
    "…"
  ],
  "grant_types": ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "application_type": "native"
}
```

The full `redirect_uris` list also includes other localhost ports and MCPJam app URLs — see the [live document](https://www.mcpjam.com/.well-known/oauth/client-metadata.json).

#### Inspector configuration

| Surface | Setting |
| ------- | ------- |
| **Web** | **Client Settings** → **Client ID Metadata Document** → paste the MCPJam URL above → enable **Use Client ID Metadata Document** |
| **TUI** | `--client-metadata-url https://www.mcpjam.com/.well-known/oauth/client-metadata.json` (or enable CIMD in `client.json` / `--client-config`) |
| **CLI** | Same flags; reuses tokens from `~/.mcp-inspector/storage/oauth.json` when already authorized via web/TUI |

#### Why MCPJam’s document works with Inspector

CIMD treats the metadata **HTTPS URL** as the OAuth `client_id`. On authorize, Stytch (or any CIMD-capable AS) fetches that JSON and checks:

1. The document’s `client_id` field matches the URL.
2. The `redirect_uri` on the request appears **exactly** in `redirect_uris`.

Inspector web dev uses `http://localhost:6274/oauth/callback` by default (`CLIENT_PORT=6274`). MCPJam’s published metadata **includes that URI** (and `127.0.0.1:6274`), so a smoke run succeeds without Inspector hosting its own CIMD file.

Implications for smoke (expected, not bugs):

- **Connection Info → Client ID** shows the MCPJam metadata URL, not “MCP Inspector”.
- **Consent UI** may show **“MCPJam”** name/logo from the document — you authorized MCPJam’s published OAuth identity, not a separate Inspector-specific registration.
- **No `POST …/v1/oauth2/register`** — Inspector stores the metadata URL locally; Stytch validates by fetching MCPJam’s HTTPS document server-side.
- **Access token JWT** still carries Stytch’s internal `connected-app-test-…` id; see [Verifying CIMD](#verifying-cimd-vs-dcr-network-and-tokens).

This is appropriate for **protocol smoke only**. MCPJam’s doc is a shared dev identity with permissive localhost redirects; production Inspector deployments should use an Inspector-owned metadata URL (future — see below).

**Reference only (won’t work for Inspector callback):** [client.dev/oauth/metadata.json](https://client.dev/oauth/metadata.json) is Stytch’s public CIMD demo document; its `redirect_uris` point at `client.dev`, not localhost.

Or use **DCR** against the same Stytch server with CIMD disabled (see [Alternative: DCR on Stytch](#alternative-dcr-on-stytch-no-metadata-hosting)).

#### Inspector-owned CIMD (future)

Hosting a dedicated `https://…/inspector/oauth-client.json` with Inspector branding and a minimal `redirect_uris` list (only Inspector callbacks) is the right model for non-smoke use. Not required for Stytch smoke today; document shape and Stytch requirements will be added here when we ship a hosted metadata URL.

### Verifying CIMD vs DCR (network and tokens)

Stytch **normalizes** both CIMD and DCR into internal Connected App records. The **access token JWT** looks the same either way — `client_id` in the decoded payload is Stytch’s internal id (e.g. `connected-app-test-0bb7b586-…`), **not** your metadata URL. **Do not use the JWT alone to distinguish CIMD from DCR.**

| Check | CIMD | DCR |
| ----- | ---- | --- |
| **Connection Info → Client ID** | MCPJam metadata URL | Opaque `connected-app-test-…` |
| **Connection Info → Client registration** | Client ID Metadata (CIMD) | Dynamic (DCR) |
| **`POST …/v1/oauth2/token` body → `client_id`** | Metadata URL | `connected-app-test-…` |
| **Authorize URL → `client_id` param** (browser) | Metadata URL | `connected-app-test-…` |
| **`POST …/v1/oauth2/register`** (after cleared OAuth state) | **Absent** | Present on first connect |
| **Decoded access token JWT → `client_id`** | Internal Stytch id *(same shape as DCR)* | Internal Stytch id |

**Definitive smoke signal:** expand the **`POST …/v1/oauth2/token`** row in the network log (auth category). The form body must include the MCPJam metadata URL as `client_id`. Verified example against **`stytch-mcp-demo`** (June 2026):

```
grant_type=authorization_code
code=<authorization_code>
code_verifier=<pkce_verifier>
redirect_uri=http://localhost:6274/oauth/callback
resource=https://stytch-as-demo.val.run/mcp
client_id=https://www.mcpjam.com/.well-known/oauth/client-metadata.json
```

Example decoded access token payload from the same flow (Stytch internal id — **expected**, not a CIMD failure):

```json
{
  "aud": ["project-test-d06972e8-6af2-4952-bcb0-44d795ec5d6f"],
  "client_id": "connected-app-test-0bb7b586-e16a-43f6-b2b4-6511a146cd1d",
  "iss": "https://industrious-dress-4239.customers.stytch.dev",
  "scope": "openid email",
  "sub": "user-test-5ccf82bc-485d-4919-9e11-40084b02dc28"
}
```

### Procedure (web)

Use **`stytch-mcp-demo`** unless you explicitly need the Management API host. Configure the [MCPJam CIMD URL](#cimd-credentials-for-smoke-mcpjam), then run both phases. **Clear OAuth state** between phases: **Server Settings → OAuth → Clear stored OAuth state**, or (while connected) **Connection Info → OAuth Details → Clear and disconnect**.

**Stytch note:** Both hosts advertise DCR. With CIMD disabled, Inspector may still authorize via dynamic registration. Phase 1 therefore checks that CIMD was **not** used (client id ≠ MCPJam metadata URL), not necessarily that connect hard-fails. For a strict fail-without-CIMD smoke, use the [local composable server](#local-fallback-composable-test-server) with `supportCIMD: true` and `supportDCR: false`.

#### Phase 1 — CIMD off (expect failure or non-CIMD client id)

1. **Client Settings** → **Client ID Metadata Document**: paste the [MCPJam URL](#cimd-credentials-for-smoke-mcpjam) but leave **Use Client ID Metadata Document** **unchecked** (URL stays saved for Phase 2).
2. Add Stytch demo MCP (`https://stytch-as-demo.val.run/mcp`) with **no** per-server OAuth fields.
3. Connect → **401** → authenticate.
4. **Pass (negative control):** either connect **does not** reach an authorized session (e.g. you blocked DCR in your Stytch workspace), **or** Connection Info shows a **dynamic DCR client id** (not the MCPJam metadata URL). If you already see the MCPJam URL as client id, CIMD was still active — clear OAuth storage and confirm the checkbox is off.

#### Phase 2 — CIMD on (expect success)

1. Enable **Use Client ID Metadata Document** (MCPJam URL from [above](#cimd-credentials-for-smoke-mcpjam)).
2. Clear OAuth state for the Stytch server again.
3. Connect → **401** → authenticate → demo login/consent at `stytch-as-demo.val.run` (or `stytch.com` if using Management MCP).
4. **Pass:** connected; `tools/list` succeeds; Connection Info shows **client id = MCPJam metadata URL** and **Client registration = Client ID Metadata (CIMD)**; **`POST …/v1/oauth2/token` request body** shows the same URL as `client_id` (see [Verifying CIMD](#verifying-cimd-vs-dcr-network-and-tokens)).

### Procedure (TUI)

Same two phases (prefer **`stytch-mcp-demo`** URL):

1. **Off:** launch without CIMD enabled in `client.json` and without `--client-metadata-url` → connect (**C**) → complete browser auth if prompted → **expect failure or DCR client id** as in Phase 1 (web).
2. **On:**
   ```bash
   mcp-inspector --tui --catalog configs/mcp.json \
     --client-metadata-url https://www.mcpjam.com/.well-known/oauth/client-metadata.json
   ```
   Or enable CIMD in `client.json` and pass `--client-config configs/client.json` (or rely on the default install path after saving via web Client Settings).
   Clear OAuth tokens → connect (**C**) → **expect success** with client id = metadata URL.

### Procedure (CLI)

Reuse tokens from a prior web/TUI session, or run after interactive auth in TUI:

```bash
mcp-inspector --cli --catalog configs/mcp.json --server stytch-mcp-demo \
  --client-metadata-url https://www.mcpjam.com/.well-known/oauth/client-metadata.json \
  --method tools/list
```

Interactive OAuth on CLI prints the authorize URL to stdout (`ConsoleNavigation`); prefer TUI for first-time login smokes.

### Alternative: DCR on Stytch (no metadata hosting)

Same MCP URL (`stytch-as-demo.val.run/mcp` or `mcp.stytch.dev/mcp`), leave CIMD disabled and `clientMetadataUrl` unset — Inspector registers via `registration_endpoint` on the Stytch AS (demo: `POST https://industrious-dress-4239.customers.stytch.dev/v1/oauth2/register` at time of writing). First connect should show that register call in the network log before authorize. Useful when you only want to verify remote DCR + PKCE without hosting CIMD JSON. Token exchange will use the returned `connected-app-test-…` id as `client_id`, not an HTTPS metadata URL.

### Local fallback (composable test server)

For offline CIMD regression — or a **strict** fail-with-CIMD-off / succeed-with-CIMD-on pair without Stytch’s DCR fallback — use the in-repo `TestServerHttp` with `supportCIMD: true` and **`supportDCR: false`** (see `inspectorClient-oauth-e2e.test.ts`). `ensureCimdClientRegistration` allows `http://127.0.0.1` metadata URLs in tests only.

```bash
cd test-servers && npm run build
node build/server-composable.js --config path/to/oauth-cimd-only.json
```

Example composable OAuth flags: `"supportCIMD": true`, `"supportDCR": false`. With CIMD off in Client Settings, connect + authenticate should **fail**; with CIMD on and a valid local metadata URL, it should **succeed**.

---

## 4. EMA (xaa.dev) — cross-reference

Enterprise-managed auth uses a **different** credential model (IdP in Client Settings + resource AS client on server). Documented in [v2_auth_ema.md § Staging validation](v2_auth_ema.md#staging-validation-manual--verified):

- IdP: `https://idp.xaa.dev`
- Resource AS: `https://auth.resource.xaa.dev`
- Local MCP resource: `test-servers/configs/xaa-ema-http.json`

Do not use xaa.dev for standard DCR/static/CIMD ladder testing unless explicitly testing EMA.

**TUI EMA smoke** (IdP in `client.json`, resource server with `enterpriseManaged: true` in catalog):

```bash
mcp-inspector --tui --catalog configs/mcp.json \
  --client-config configs/client.json
```

Register **`http://127.0.0.1:6276/oauth/callback`** on the xaa.dev IdP before leg 1 (default runner callback). IdP `clientSecret` belongs in `client.json` (web **Client Settings** or `--client-config` fixture). Per-server resource `oauth.clientSecret` belongs in the OS keychain (web **Server Settings** save path) or a local fixture — TUI/CLI rehydrate both IdP and resource secrets from keychain on catalog load (see prerequisite §4 above).

---

## What to verify (all smokes)

| Check | Where |
| ----- | ----- |
| **Negative control** (mechanism off → fail or wrong client id source) | Connection Info / error toast |
| **Clear OAuth state** between smoke phases | **Web:** Server Settings → OAuth → **Clear stored OAuth state**; or Connection Info → **Clear and disconnect** (standard) / **Clear OAuth state** (EMA). **TUI:** Auth tab → **S** (**Clear OAuth State**; disconnects when connected) |
| **Positive path** (mechanism on → authorized session) | Connect + `tools/list` |
| 401 on first connect without tokens | Network / Requests tab |
| OAuth discovery + correct mechanism (DCR vs static vs CIMD) | Network log (auth category) |
| **CIMD:** token exchange `client_id` = metadata URL | `POST …/v1/oauth2/token` request body |
| **CIMD:** no DCR register call (after cleared state) | Absence of `POST …/v1/oauth2/register` |
| **Stytch:** JWT `client_id` is internal id (not metadata URL) | Decode access token — informational only |
| Authorization redirect opens | Browser |
| Callback completes (`/oauth/callback`) | Web URL or TUI callback server |
| Second connect uses stored access token | Connect without re-login (until expiry) |
| `tools/list` JSON | Tools tab / CLI `--method tools/list` |
| Connection Info: protocol, authorized, client id, registration kind | Connection Info OAuth section |

## Automated parity

| Mode | Real server (this doc) | CI (in-repo) |
| ---- | ---------------------- | ------------ |
| DCR | example-server.modelcontextprotocol.io (or Stytch MCP) | `inspectorClient-oauth-e2e.test.ts` |
| Static | GitHub MCP + your OAuth App | `test-static-client` / `test-static-secret` on TestServerHttp |
| CIMD | **Stytch demo MCP** (`stytch-as-demo.val.run`) + [MCPJam metadata URL](#cimd-credentials-for-smoke-mcpjam) (or local composable) | `createClientMetadataServer()` in e2e |
| EMA | xaa.dev staging | `inspectorClient-ema-e2e.test.ts` + mocks |

## Known gaps (Inspector)

See **[Mid-session authorization](v2_auth_mid_session.md)** for the design to address mid-session 401, token refresh, and step-up scope challenges (including web remote reconnect).

See **[Auth hardening (MCP 2026-07-28)](v2_auth_hardening.md)** for connect-time OAuth hardening (SEP-2468, SEP-837, SEP-2352, SEP-2207, SEP-2350, SEP-2351) and the v2 SDK upgrade strategy.

- **CLI interactive OAuth:** no local callback server yet — reuse tokens from web/TUI or complete auth in TUI first; CLI prints authorize URLs to stdout when a new login is required.
- **Client credentials grant:** not implemented ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225)).

## References

- [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [example-remote-server](https://github.com/modelcontextprotocol/example-remote-server)
- [GitHub MCP remote server](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)
- [Stytch MCP demo](https://stytch-as-demo.val.run/mcp) — local CIMD/DCR smoke (test login at demo `/oauth/authorize`)
- [Stytch MCP](https://mcp.stytch.dev/) — Management API MCP (production-style `stytch.com` login)
- [MCPJam CIMD metadata](https://www.mcpjam.com/.well-known/oauth/client-metadata.json) — shared dev metadata URL
- [CIMD for MCP](https://stytch.com/blog/oauth-client-id-metadata-mcp/), [Stytch client types](https://stytch.com/docs/connected-apps/oauth-learn-more/client-types)
- [client.dev](https://client.dev/) — CIMD format reference
- Inspector e2e: `clients/web/src/test/integration/mcp/inspectorClient-oauth-e2e.test.ts`
- Local OAuth AS: `test-servers/src/test-server-oauth.ts`, `createOAuthTestServerConfig()` in `test-server-fixtures.ts`
