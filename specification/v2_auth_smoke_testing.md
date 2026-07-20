# Inspector V2 Auth — OAuth smoke testing (real servers)

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | V2 Auth | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [Overview](v2_auth.md) | [EMA / XAA](v2_auth_ema.md) | [Hardening](v2_auth_hardening.md) | [Mid-session](v2_auth_mid_session.md) | Smoke testing | [SDK consolidation](v2_auth_sdk_consolidation.md)

Manual smoke procedures for exercising Inspector OAuth against **hosted** MCP servers. Complements automated coverage in `clients/web/src/test/integration/mcp/inspectorClient-oauth-e2e.test.ts`, which uses the in-repo `TestServerHttp` (`createOAuthTestServerConfig`).

This document does **not** replace CI. It records known-good real endpoints, which client-ID mechanism each server supports, and how to configure Inspector (web, TUI, or CLI).

## Install-level client config (TUI / CLI)

EMA and CIMD credentials live in **`~/.mcp-inspector/storage/client.json`** (same file the web **Client Settings** dialog writes). TUI and CLI load it automatically at startup:

| Flag / env               | Default                                        |
| ------------------------ | ---------------------------------------------- |
| `--client-config <path>` | `~/.mcp-inspector/storage/client.json`         |
| `MCP_CLIENT_CONFIG_PATH` | Same default when `--client-config` is omitted |

For repo smoke fixtures, point at the checked-in template:

```bash
--client-config configs/client.json
```

CLI flags (`--client-metadata-url`, `--client-id`, `--client-secret`) override values from `client.json` when present. Per-server OAuth fields in `mcp.json` still apply for static/DCR/EMA resource credentials.

OAuth callback URL (TUI/CLI only):

| Flag / env               | Default                                       |
| ------------------------ | --------------------------------------------- |
| `--callback-url <url>`   | `http://127.0.0.1:6276/oauth/callback`        |
| `MCP_OAUTH_CALLBACK_URL` | Same default when `--callback-url` is omitted |

Web uses `http://localhost:6274/oauth/callback` on the main app server — not these runner settings.

## Terminology

| Term                              | Meaning in this doc                                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Static / preregistered client** | You supply `oauthClientId` and optionally `oauthClientSecret` in Server Settings. Inspector skips DCR and uses your credentials.                                                                                                              |
| **DCR**                           | Dynamic Client Registration (RFC 7591). Inspector registers at the AS `registration_endpoint` on first connect; no client id in config.                                                                                                       |
| **CIMD**                          | Client ID Metadata Document (SEP-991). Inspector uses an HTTPS metadata URL as `client_id` when the AS advertises `client_id_metadata_document_supported`.                                                                                    |
| **Client credentials grant**      | OAuth 2.0 machine-to-machine `grant_type=client_credentials`. **Not** what we mean by “static client credentials” here. Inspector does not implement this grant yet ([#1225](https://github.com/modelcontextprotocol/inspector/issues/1225)). |

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
      "url": "https://example-server.modelcontextprotocol.io/mcp",
    },
    "github-mcp": {
      "type": "streamable-http",
      "url": "https://api.githubcopilot.com/mcp/",
    },
    "stytch-mcp-demo": {
      "type": "streamable-http",
      "url": "https://stytch-as-demo.val.run/mcp",
    },
    "stytch-mcp": {
      "type": "streamable-http",
      "url": "https://mcp.stytch.dev/mcp",
    },
  },
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

| Server                                | URL                                                  | Mechanism to smoke                          | Credentials in repo?                                                                          |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **MCP Example “Everything”** (hosted) | `https://example-server.modelcontextprotocol.io/mcp` | **DCR**                                     | No — register at connect time                                                                 |
| **GitHub MCP** (remote)               | `https://api.githubcopilot.com/mcp/`                 | **Static OAuth App** (or PAT header bypass) | No — you create a GitHub OAuth App                                                            |
| **Stytch MCP demo** (hosted)          | `https://stytch-as-demo.val.run/mcp`                 | **CIMD** (also DCR)                         | No — use [MCPJam CIMD](#cimd-credentials-for-smoke-mcpjam) (default for smoke)                |
| **Stytch MCP** (management API)       | `https://mcp.stytch.dev/mcp`                         | **CIMD** (also DCR)                         | No — same MCPJam CIMD URL; real Stytch login at `stytch.com`                                  |
| **Composable test server** (local)    | `http://127.0.0.1:<port>/mcp`                        | Static, DCR, CIMD (all)                     | Fake ids in e2e tests only                                                                    |
| **xaa.dev EMA**                       | Local resource + `auth.resource.xaa.dev`             | EMA (not standard OAuth ladder)             | Registered on xaa.dev — see [EMA staging](v2_auth_ema.md#staging-validation-manual--verified) |

---

## 1. MCP Example “Everything” server (DCR)

**Hosted reference server** implementing the full MCP feature surface (tools, resources, prompts, sampling, elicitation). Source: [modelcontextprotocol/example-remote-server](https://github.com/modelcontextprotocol/example-remote-server). Public deployment:

| Field                       | Value                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- |
| MCP URL                     | `https://example-server.modelcontextprotocol.io/mcp`                                    |
| Resource identifier         | `https://example-server.modelcontextprotocol.io/`                                       |
| Authorization server        | Same host (combined resource + AS)                                                      |
| Protected resource metadata | `https://example-server.modelcontextprotocol.io/.well-known/oauth-protected-resource`   |
| AS metadata                 | `https://example-server.modelcontextprotocol.io/.well-known/oauth-authorization-server` |

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

- First connect performs discovery + DCR + authorization code + PKCE. Tokens persist in `~/.mcp-inspector/storage/oauth.json` (CLI/TUI direct file, web via `RemoteOAuthStorage` → same file on the local backend).
- Reconnect should reuse stored DCR `client_id` unless storage was cleared.

---

## 2. GitHub MCP server (static / preregistered OAuth App)

**Remote GitHub MCP** is the usual choice for **static client credential** smoke testing against a production authorization server that does **not** expose DCR to arbitrary MCP clients.

| Field                       | Value                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP URL                     | `https://api.githubcopilot.com/mcp/`                                                                                                                                      |
| Resource identifier         | `https://api.githubcopilot.com/mcp`                                                                                                                                       |
| Protected resource metadata | `https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp`                                                                                                  |
| Authorization server        | `https://github.com/login/oauth`                                                                                                                                          |
| Upstream docs               | [github/github-mcp-server](https://github.com/github/github-mcp-server) — [remote-server.md](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) |

**Verified PRM (June 2026):** `authorization_servers: ["https://github.com/login/oauth"]`. Scopes advertised include `repo`, `read:org`, `read:user`, `user:email`, `gist`, `workflow`, etc.

### Why GitHub is the static-credentials smoke server

- GitHub’s OAuth platform expects a **pre-registered OAuth App** (or GitHub App) with a fixed callback URL. There is no open `registration_endpoint` for Inspector-style DCR.
- VS Code, Cursor, and other hosts register **their own** GitHub OAuth applications; Inspector does not ship shared production client id/secret pairs.
- This matches the “user knows static credentials are required” path: set `oauthClientId` / `oauthClientSecret` in Server Settings before or after the first 401.

### Credentials to use (you create these)

There are **no shared Inspector test credentials** in this repository. Create a **GitHub OAuth App** under your account or org:

1. Open [GitHub Developer settings → OAuth Apps](https://github.com/settings/developers) → **New OAuth App**.
2. Suggested values for local web smoke:

   | Field                      | Value                                  |
   | -------------------------- | -------------------------------------- |
   | Application name           | `MCP Inspector (local dev)`            |
   | Homepage URL               | `http://localhost:6274`                |
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

| Target                                                       | When to use                                                                                                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`stytch-mcp-demo`** — `https://stytch-as-demo.val.run/mcp` | **Default for local CIMD smoke.** Test Stytch project; authorize at the demo app (`/oauth/authorize`) with email OTP / test login — not the `stytch.com` dashboard.        |
| **`stytch-mcp`** — `https://mcp.stytch.dev/mcp`              | **Production-style smoke.** Stytch’s hosted Management API MCP; authorize at `https://stytch.com/oauth/authorize` with a real Stytch workspace account (often social SSO). |

### 3a. Stytch demo MCP (preferred for dev)

| Field                         | Value                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| MCP URL                       | `https://stytch-as-demo.val.run/mcp`                                                              |
| Resource identifier           | `https://stytch-as-demo.val.run/mcp`                                                              |
| Protected resource metadata   | `https://stytch-as-demo.val.run/.well-known/oauth-protected-resource/mcp`                         |
| Authorization server (issuer) | `https://industrious-dress-4239.customers.stytch.dev` _(resolve from PRM — may change)_           |
| AS metadata                   | `https://industrious-dress-4239.customers.stytch.dev/.well-known/oauth-authorization-server`      |
| Token endpoint                | `https://industrious-dress-4239.customers.stytch.dev/v1/oauth2/token`                             |
| DCR registration endpoint     | `https://industrious-dress-4239.customers.stytch.dev/v1/oauth2/register`                          |
| Authorization UI              | `https://stytch-as-demo.val.run/oauth/authorize` (demo-hosted; test login — **not** `stytch.com`) |

**Verified discovery (June 2026):** PRM at the URL above currently returns:

```json
{
  "resource": "https://stytch-as-demo.val.run/mcp",
  "authorization_servers": [
    "https://industrious-dress-4239.customers.stytch.dev"
  ],
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

| Field                       | Value                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| MCP URL                     | `https://mcp.stytch.dev/mcp`                                                                                                             |
| Resource identifier         | `https://mcp.stytch.dev`                                                                                                                 |
| Protected resource metadata | `https://mcp.stytch.dev/.well-known/oauth-protected-resource`                                                                            |
| Product docs                | [Stytch MCP Server](https://stytch.com/docs/resources/workspace-management/stytch-mcp-server), [mcp.stytch.dev](https://mcp.stytch.dev/) |

**Verified discovery (June 2026):** PRM at the URL above currently returns:

```json
{
  "resource": "https://mcp.stytch.dev",
  "authorization_servers": [
    "https://rustic-kilogram-6347.customers.stytch.com"
  ],
  "scopes_supported": [
    "openid",
    "email",
    "profile",
    "admin:projects",
    "manage:api_keys",
    "manage:api_keys:test",
    "manage:project_settings",
    "manage:project_data"
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
  "grant_types": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code"
  ],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "application_type": "native"
}
```

The full `redirect_uris` list also includes other localhost ports and MCPJam app URLs — see the [live document](https://www.mcpjam.com/.well-known/oauth/client-metadata.json).

#### Inspector configuration

| Surface | Setting                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web** | **Client Settings** → **Client ID Metadata Document** → paste the MCPJam URL above → enable **Use Client ID Metadata Document**             |
| **TUI** | `--client-metadata-url https://www.mcpjam.com/.well-known/oauth/client-metadata.json` (or enable CIMD in `client.json` / `--client-config`) |
| **CLI** | Same flags; reuses tokens from `~/.mcp-inspector/storage/oauth.json` when already authorized via web/TUI                                    |

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

| Check                                                       | CIMD                                     | DCR                           |
| ----------------------------------------------------------- | ---------------------------------------- | ----------------------------- |
| **Connection Info → Client ID**                             | MCPJam metadata URL                      | Opaque `connected-app-test-…` |
| **Connection Info → Client registration**                   | Client ID Metadata (CIMD)                | Dynamic (DCR)                 |
| **`POST …/v1/oauth2/token` body → `client_id`**             | Metadata URL                             | `connected-app-test-…`        |
| **Authorize URL → `client_id` param** (browser)             | Metadata URL                             | `connected-app-test-…`        |
| **`POST …/v1/oauth2/register`** (after cleared OAuth state) | **Absent**                               | Present on first connect      |
| **Decoded access token JWT → `client_id`**                  | Internal Stytch id _(same shape as DCR)_ | Internal Stytch id            |

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

Interactive OAuth uses the loopback callback server (same as TUI). First-time connect or mid-session step-up:

```bash
mcp-inspector --cli --catalog configs/mcp.json --server stytch-mcp-demo \
  --client-metadata-url https://www.mcpjam.com/.well-known/oauth/client-metadata.json \
  --method tools/list
```

**Expect:** stdout prints `Please navigate to: …` → open in browser → redirect to `http://127.0.0.1:6276/oauth/callback` → stderr `Authorization complete.` → JSON on stdout.

Reuse tokens from a prior web/TUI/CLI session when `~/.mcp-inspector/storage/oauth.json` already has valid tokens for that server (passive file sharing).

Mid-session / step-up manual validation: [§5](v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation) (web **W1 + W5–W7**, TUI **T1–T2 + T4**, CLI **C1–C2** required; **W8–W11** recommended after auth recovery changes).

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

## 5. Mid-session auth + step-up — manual validation

**Purpose:** Manual checklist for mid-session OAuth recovery across **web**, **TUI**, and **CLI** after changes to auth / step-up UX. Design: [v2_auth_mid_session.md](v2_auth_mid_session.md).

**Fixture:** local composable server `test-servers/configs/oauth-step-up-demo.json` (`echo` unscoped, `get_temp` requires `weather:read`). Catalog scope **`mcp tools:read` only** (omit `weather:read`) so `get_temp` triggers step-up.

### Required vs optional

Run **required** smokes before release or after any auth UX change. **Optional** smokes extend coverage; run when time allows or when touching the listed area.

| ID             | Client | When                                    | Required?                                   |
| -------------- | ------ | --------------------------------------- | ------------------------------------------- |
| **W1**         | Web    | Step-up modal + OAuth resume            | **Yes**                                     |
| W2–W4          | Web    | Connect-time, silent refresh, multi-tab | Optional                                    |
| **W5–W11**     | Web    | P0/P1/P2 code-review UX (below)         | **Recommended** after auth recovery changes |
| **T1, T2, T4** | TUI    | Connect, step-up, clear OAuth           | **Yes**                                     |
| T3, T5–T6      | TUI    | Modal path, tab/server selection        | Optional                                    |
| **C1, C2**     | CLI    | Connect + step-up **y/N**               | **Yes**                                     |
| C3             | CLI    | Built launcher subprocess               | Optional                                    |

**Minimum release gate:** **W1** + **W5–W7** (web), **T1–T2** + **T4** (TUI), **C1–C2** (CLI).

### What CI covers vs what you verify manually

| Capability                                          | Web              | TUI                    | CLI                     | Automated in CI?                                                                     |
| --------------------------------------------------- | ---------------- | ---------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Core `handleAuthChallenge()` / token exchange       | Remote transport | Direct transport       | Direct (`cliOAuth.ts`)  | Yes — `inspectorClient-oauth-*-mid-session-e2e.test.ts`, `oauth-interactive.test.ts` |
| Silent mid-session refresh (valid refresh token)    | Yes              | Yes (reconnect)        | N/A (one-shot)          | Yes — remote e2e                                                                     |
| Connect-time 401 → interactive OAuth                | Yes              | Yes                    | Yes                     | Partial — core/CLI integration; **not** full UI/binary                               |
| Step-up confirm before second OAuth                 | Modal            | Auth tab **A** / **C** | stderr **y/N**          | Partial — unit/modal tests; **not** real browser + Ink/terminal                      |
| OAuth resume after full-page redirect               | Yes (`6274`)     | N/A (loopback)         | N/A (loopback)          | Partial — `oauthResume` unit tests; **not** browser tab restore                      |
| Tab + form restore after step-up                    | Yes              | N/A                    | N/A                     | **Manual only**                                                                      |
| Network log survives redirect                       | Yes              | N/A                    | N/A                     | **Manual only**                                                                      |
| Multi–browser-tab defer (background tab)            | Yes              | N/A                    | N/A                     | **Manual only**                                                                      |
| Tool / prompt / resource modal → auth recovery      | Yes              | Yes                    | CLI one-shot RPC only   | Partial — component unit tests                                                       |
| Loopback callback server (`6276`)                   | N/A              | Yes                    | Yes                     | Partial — integration tests auto-complete authorize URL                              |
| Step-up **decline** (stay connected / exit cleanly) | Modal Cancel     | Auth **C**             | **N**                   | **Manual only**                                                                      |
| ReAuthBanner reconnect without disconnect           | Yes              | N/A                    | N/A                     | **Manual only** (W7)                                                                 |
| Abandoned step-up / reauth snapshot → banner        | Yes              | N/A                    | N/A                     | **Manual only** (W6)                                                                 |
| Step-up pre-redirect toast                          | Yes              | N/A                    | N/A                     | **Manual only** (W5)                                                                 |
| Background-tab defer + resume on visibility         | Yes              | N/A                    | N/A                     | **Manual only** (W8)                                                                 |
| Concurrent step-up → warning toast                  | Yes              | TUI overwrite message  | N/A                     | **Manual only** (W9 / T5)                                                            |
| Partial consent after step-up → warning toast       | Yes              | Yes                    | Yes (stderr message)    | Partial — unit copy only (W10)                                                       |
| Prompt / resource / app command-scoped recovery     | Yes              | Yes                    | N/A (tools only in CLI) | Partial — no full UI e2e (W11)                                                       |
| Built launcher → CLI binary subprocess              | N/A              | N/A                    | Yes                     | `scripts/smoke-cli.mjs` — **no OAuth**                                               |

Run this section when touching mid-session auth UX. CI proves protocol/core paths; **you** prove each client’s interactive UX with a real browser (and terminal for CLI **y/N**).

### Shared setup

1. **Composable OAuth server** (terminal A):

   ```bash
   cd clients/web && npm run test-servers:build
   node ../../test-servers/build/server-composable.js \
     --config ../../test-servers/configs/oauth-step-up-demo.json
   ```

   Confirm stderr: `Composable server listening at http://127.0.0.1:8081/mcp`.

2. **Catalog entry** — add to `~/.mcp-inspector/mcp.json` (all three clients):

   ```json
   "oauth-step-up-demo": {
     "type": "streamable-http",
     "url": "http://127.0.0.1:8081/mcp",
     "oauth": { "scopes": "mcp tools:read" }
   }
   ```

3. **Clean OAuth state** before each client’s run:
   - **Web:** Server Settings → OAuth → **Clear stored OAuth state** (or Connection Info → **Clear and disconnect**)
   - **TUI / CLI:** Auth tab → **S** (TUI), or remove the server key from `~/.mcp-inspector/storage/oauth.json` / use a fresh `HOME` (CLI)

4. **Ports:** composable server **8081**; web callback **6274**; TUI/CLI callback **6276** (only one TUI/CLI listener at a time).

---

### Web — manual validation

**Start web** (terminal B): `npm run web:dev -- --catalog configs/mcp.json` (or your `mcp.json` with the entry above).

#### W1 — Step-up modal + OAuth resume (**required**)

Primary path; CI does **not** exercise modal UX or post-redirect tab restore.

1. Connect to **oauth-step-up-demo** → browser OAuth → **connected**.
2. **Tools** → **echo** → **Run** → success.
3. **Tools** → **get_temp** (city `NYC`, units `C`) → **Run**.
4. **Expect:** **“Additional permissions required”** modal (scopes include `weather:read`); **no** immediate redirect.
5. **Cancel** → modal closes, error shown, still **connected** → **echo** still works.
6. **Run get_temp** again → **Authorize** → redirect to AS on `:8081` → approve → `http://localhost:6274/oauth/callback` → return to app.
7. **Expect:** **Tools** tab, **get_temp** form restored, toast **“Step-up authorization succeeded. Retry your action.”**, network log from pre-redirect still visible.
8. **Run get_temp** → temperature result.

#### W2 — Connect-time OAuth with no prior session (optional)

1. Clear OAuth state, disconnect.
2. Connect → full-page OAuth → callback → toast **“Authentication succeeded. Retry your action.”**

#### W3 — Silent mid-session refresh (optional)

1. Connect, run **echo** successfully.
2. Invalidate access token only (devtools → `sessionStorage` → `mcp-inspector-oauth`), keep refresh token.
3. **Run echo** again → success **without** leaving the page.

> CI: `inspectorClient-oauth-remote-mid-session-e2e.test.ts`. Skip W3 if W1 passed and time is short.

#### W4 — Multi–browser-tab defer (optional, manual only)

1. Tab A: connect, start step-up on **get_temp**, **do not** click Authorize yet.
2. Tab B: same server, run **echo** → should **not** redirect Tab B to OAuth while Tab A’s modal is open.
3. Tab A: **Authorize** → complete flow.

#### W5 — Step-up pre-redirect toast (**recommended**, MR-219)

1. Complete W1 steps 1–3 to open the step-up modal.
2. Click **Authorize**.
3. **Expect:** blue toast **“Step-up authorization for …”** / **“Redirecting to authorize additional permissions…”** appears **before** the browser leaves the page.
4. Complete OAuth → W1 steps 7–8.

#### W6 — Abandoned step-up → re-auth banner (**recommended**, MR-111)

1. Complete W1 steps 1–3; click **Authorize** and reach the AS consent page on `:8081`.
2. **Do not** approve — navigate back to `http://localhost:6274/` (or close the OAuth tab and open the inspector URL without callback query params).
3. **Expect:** persistent red **Re-authentication required** banner mentioning step-up was not completed.
4. Dismiss or use **Re-authenticate** (see W7).

#### W7 — ReAuthBanner reconnect without disconnect (**recommended**, MR-218)

**Prerequisite:** connected session + re-auth banner visible (from W6, OAuth callback error, or invalidate tokens and trigger a `token_expired` / `unauthorized` recovery that shows the banner — not an `insufficient_scope` toast).

1. Confirm Connection toggle still shows **connected** (session not torn down).
2. Click banner **Re-authenticate**.
3. **Expect:** **no** disconnect/reconnect cycle; browser OAuth opens (or silent restore if tokens still valid).
4. After successful OAuth, banner clears; **echo** still works without manual reconnect.

#### W8 — Background-tab defer + resume (**recommended**, MR-104)

1. Connect; open step-up modal on **get_temp** (W1 steps 1–3) but **do not** click Authorize yet.
2. Switch away from the inspector tab (another browser tab or app) so the page is **hidden** (`document.visibilityState === "hidden"` — DevTools → **Rendering** → _Emulate page visibility hidden_ also works).
3. Return to the inspector tab (or disable emulation).
4. **Expect:** deferred recovery runs — step-up modal or OAuth flow resumes without losing the connected session.
5. Complete step-up; run **get_temp** successfully.

#### W9 — Concurrent step-up blocked (**recommended**, MR-110)

1. Connect; open step-up modal on **get_temp**; leave it open.
2. Trigger a second step-up need (e.g. open step-up again via a second **Run** on **get_temp**, or a second scoped action if the fixture supports it).
3. **Expect:** yellow toast **“Step-up authorization in progress…”**; first modal remains; no second redirect.

#### W10 — Partial consent after step-up (**optional**)

1. Complete step-up **Authorize** flow but on the AS consent screen **deny** or omit `weather:read` if the AS offers granular scopes.
2. **Expect:** return to app with **warning** toast about permissions not granted — **not** the green **“Step-up authorization succeeded…”** toast.
3. **Run get_temp** again → step-up modal reappears.

#### W11 — Prompt / resource / app recovery (**optional**, MR-003)

The default `oauth-step-up-demo.json` fixture is **tools-only**. To smoke command-scoped recovery on other surfaces, temporarily add a scoped prompt or resource to the composable config (see [v2_auth_mid_session.md § Test infrastructure](v2_auth_mid_session.md#test-infrastructure)) and restart the server.

1. Connect with `mcp tools:read` only.
2. **Prompts** → run a scoped **Get** (or **Resources** → **Read**, or **Apps** → open) that returns `403 insufficient_scope`.
3. **Expect:** same step-up modal / redirect / resume behavior as W1 — not an unhandled error. Cancel should only affect that panel’s in-flight state (MR-106).

---

### TUI — manual validation

**Start TUI:** `mcp-inspector --tui --catalog ~/.mcp-inspector/mcp.json` (or `--config`). No web dev required.

#### T1 — Connect-time OAuth on 401 (**required**)

CI does **not** run Ink + real browser callback.

1. Clear OAuth state (**Auth** tab → **S**, or fresh `oauth.json`).
2. Select **oauth-step-up-demo** → **Connect** (`c`).
3. **Expect:** Auth tab shows authenticating; terminal/OS opens authorize URL (or log shows URL); browser completes redirect to `http://127.0.0.1:6276/oauth/callback`.
4. **Expect:** connected; **Tools** tab lists **echo** and **get_temp**.

#### T2 — Step-up confirm on Auth tab (**required**)

Requires connected session with **`mcp tools:read` only**. If connect already granted `weather:read`, clear state and retry, or skip to T3 only if `get_temp` succeeds without step-up.

1. **Tools** tab → **get_temp** → run with city/units.
2. **Expect:** focus moves to **Auth** tab; message that extra scopes are needed; prompts **A** (authorize) / **C** (cancel).
3. Press **C** → message “Authorization cancelled.” → still connected → **echo** still works.
4. Run **get_temp** again → press **A** → browser OAuth → callback on **6276**.
5. **Expect:** Auth message **“Step-up authorization succeeded. Retry your action.”**
6. Run **get_temp** again → success.

#### T3 — Tool test modal auth recovery (optional)

1. From **Tools**, open test modal for **get_temp**, trigger step-up as in T2.
2. **Expect:** same Auth tab step-up flow (not a separate modal).

#### T4 — Clear OAuth state (**required**, quick)

1. While connected, **Auth** tab → **S**.
2. **Expect:** tokens cleared, disconnected if was connected.

#### T5 — Step-up while on another tab (**optional**, MR-004)

1. Connect (T1); stay on **Tools** tab (not Auth).
2. Run **get_temp** → step-up needed.
3. **Expect:** focus moves to **Auth** tab; **oauth-step-up-demo** remains selected; step-up prompt visible (T2 step 2).

#### T6 — Concurrent step-up overwrite message (**optional**, MR-110)

1. Connect; open step-up prompt on Auth tab (T2 step 2); leave it open.
2. Trigger another step-up (run **get_temp** again).
3. **Expect:** Auth tab message about an existing step-up prompt; no silent loss of the first prompt.

> CI: `inspectorClient-oauth-direct-mid-session-e2e.test.ts` (core client, no Ink). TUI component tests: `App.test.tsx`, `tuiOAuth.test.ts`.

---

### CLI — manual validation

Uses loopback callback **`http://127.0.0.1:6276/oauth/callback`** (override with `--callback-url`). **Do not** run TUI and CLI OAuth smokes simultaneously on 6276.

#### C1 — Connect-time OAuth + `tools/list` (**required**)

CI auto-completes authorize URL; **you** use a real browser.

1. Shared setup steps 1–3 (web dev **not** required).
2. ```bash
   mcp-inspector --cli --catalog ~/.mcp-inspector/mcp.json --server oauth-step-up-demo \
     --method tools/list
   ```
3. **Expect stdout:** `Please navigate to: http://127.0.0.1:8081/oauth/authorize?...`
4. Open URL → approve → redirect to **6276** → “OAuth complete”.
5. **Expect stderr:** `Authorization complete.`
6. **Expect stdout:** JSON with `echo` and `get_temp`.

#### C2 — Step-up **y/N** + `tools/call get_temp` (**required**)

Session from C1 must have **`mcp tools:read` only**. If step-up does not prompt, clear OAuth state and retry C1.

1. ```bash
   mcp-inspector --cli --catalog ~/.mcp-inspector/mcp.json --server oauth-step-up-demo \
     --method tools/call --tool-name get_temp --tool-arg city=NYC --tool-arg 'units="C"'
   ```
2. **Expect stderr:** scope message + `Proceed with step-up authorization? [y/N]`.
3. Type **`n`** → exit ≠ 0, “Step-up authorization declined.”
4. Re-run; type **`y`** → authorize URL on stdout → browser → **6276** callback.
5. **Expect stderr:** `Authorization complete. Retrying…` then stdout JSON with temperature.

#### C3 — Subprocess binary path (optional)

`scripts/smoke-cli.mjs` (`npm run smoke:cli`) exercises the **built launcher + binary** for catalog/config/`tools/list` — **not** OAuth. Optional sanity check after CLI auth changes; C1/C2 remain the OAuth manual gate.

> CI: `clients/cli/__tests__/oauth-interactive.test.ts`, `cliOAuth.test.ts` (in-process `cliOAuth.ts`, not subprocess).

---

### Manual sign-off checklist

| #   | Check                                   | Web          | TUI               | CLI                              |
| --- | --------------------------------------- | ------------ | ----------------- | -------------------------------- |
| 1   | Connect-time OAuth with empty storage   | W1 prep / W2 | T1                | C1                               |
| 2   | Unscoped tool works after connect       | W1 step 2    | T1                | C1 output                        |
| 3   | Step-up prompt before second OAuth      | W1 step 4    | T2 step 2         | C2 step 2                        |
| 4   | Decline step-up, stay usable            | W1 step 5    | T2 step 3         | C2 step 3                        |
| 5   | Accept step-up + complete browser OAuth | W1 step 6–8  | T2 step 4–6       | C2 step 4–5                      |
| 6   | Clear OAuth state                       | Settings     | T4                | delete `oauth.json` / fresh HOME |
| 7   | Step-up pre-redirect toast              | W5           | —                 | —                                |
| 8   | Abandoned step-up → banner              | W6           | —                 | —                                |
| 9   | ReAuthBanner reconnect (no disconnect)  | W7           | —                 | —                                |
| 10  | Background-tab defer + resume           | W8           | —                 | —                                |
| 11  | Concurrent step-up warning              | W9           | T6                | —                                |
| 12  | Partial consent warning toast           | W10          | T2 (if AS allows) | C2 (if AS allows)                |
| 13  | Prompt / resource / app recovery        | W11          | T3                | —                                |

### Troubleshooting

| Symptom                                              | Likely cause                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Redirect with no modal / no step-up prompt           | Scopes already include `weather:read`; clear OAuth state and ensure catalog has `"scopes": "mcp tools:read"` only |
| Web callback “could not be matched”                  | Missing `mcp-inspector:oauth-resume` in `sessionStorage` — use modal **Authorize**, not manual URL                |
| TUI/CLI `EADDRINUSE` on 6276                         | Another TUI/CLI (or stale process) holds callback port                                                            |
| CLI step-up never prompts                            | Connect-time recovery unioned scopes — clear tokens and retry C1                                                  |
| `get_temp` fails after web step-up without re-run    | Expected — click **Run** again (no auto-replay after full-page OAuth)                                             |
| ReAuthBanner **Re-authenticate** disconnects session | Should **not** happen when already connected — see W7                                                             |
| Step-up shows toast instead of modal                 | `insufficient_scope` recovery failures use a toast, not ReAuthBanner (MR-206)                                     |
| No pre-redirect toast on step-up Authorize           | See W5 — blue toast expected before redirect (MR-219)                                                             |
| Port conflict on 8081                                | Change `transport.port` in config and catalog URL                                                                 |

---

## What to verify (all smokes)

| Check                                                                 | Where                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Negative control** (mechanism off → fail or wrong client id source) | Connection Info / error toast                                                                                                                                                                                                          |
| **Clear OAuth state** between smoke phases                            | **Web:** Server Settings → OAuth → **Clear stored OAuth state**; or Connection Info → **Clear and disconnect** (standard) / **Clear OAuth state** (EMA). **TUI:** Auth tab → **S** (**Clear OAuth State**; disconnects when connected) |
| **Positive path** (mechanism on → authorized session)                 | Connect + `tools/list`                                                                                                                                                                                                                 |
| 401 on first connect without tokens                                   | Network / Requests tab                                                                                                                                                                                                                 |
| OAuth discovery + correct mechanism (DCR vs static vs CIMD)           | Network log (auth category)                                                                                                                                                                                                            |
| **CIMD:** token exchange `client_id` = metadata URL                   | `POST …/v1/oauth2/token` request body                                                                                                                                                                                                  |
| **CIMD:** no DCR register call (after cleared state)                  | Absence of `POST …/v1/oauth2/register`                                                                                                                                                                                                 |
| **Stytch:** JWT `client_id` is internal id (not metadata URL)         | Decode access token — informational only                                                                                                                                                                                               |
| Authorization redirect opens                                          | Browser                                                                                                                                                                                                                                |
| Callback completes (`/oauth/callback`)                                | Web URL or TUI callback server                                                                                                                                                                                                         |
| Second connect uses stored access token                               | Connect without re-login (until expiry)                                                                                                                                                                                                |
| `tools/list` JSON                                                     | Tools tab / CLI `--method tools/list`                                                                                                                                                                                                  |
| Connection Info: protocol, authorized, client id, registration kind   | Connection Info OAuth section                                                                                                                                                                                                          |

## Automated parity

| Mode                               | Real server (this doc)                                                                                                           | CI (in-repo)                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| DCR                                | example-server.modelcontextprotocol.io (or Stytch MCP)                                                                           | `inspectorClient-oauth-e2e.test.ts`                                                                                |
| Static                             | GitHub MCP + your OAuth App                                                                                                      | `test-static-client` / `test-static-secret` on TestServerHttp                                                      |
| CIMD                               | **Stytch demo MCP** (`stytch-as-demo.val.run`) + [MCPJam metadata URL](#cimd-credentials-for-smoke-mcpjam) (or local composable) | `createClientMetadataServer()` in e2e                                                                              |
| EMA                                | xaa.dev staging                                                                                                                  | `inspectorClient-ema-e2e.test.ts` + mocks                                                                          |
| Mid-session / step-up (web remote) | §5 **W1** + **W5–W7** (required gate); W2–W4, W8–W11 optional                                                                    | `inspectorClient-oauth-remote-mid-session-e2e.test.ts`; web unit (`oauthResume`, `StepUpAuthModal`)                |
| Mid-session / step-up (TUI direct) | §5 **T1–T2, T4** (required); T3, T5–T6 optional                                                                                  | `inspectorClient-oauth-direct-mid-session-e2e.test.ts` (core); `App.test.tsx`, `tuiOAuth.test.ts` (no Ink+browser) |
| Mid-session / step-up (CLI direct) | §5 **C1–C2** (required)                                                                                                          | `clients/cli/__tests__/oauth-interactive.test.ts`, `cliOAuth.test.ts` (in-process; not subprocess)                 |

## Known gaps (Inspector)

**Mid-session auth** is implemented for web (remote transport), TUI, and CLI — see [Mid-session authorization](v2_auth_mid_session.md). **Remaining:** optional idle SSE E2E, v2 SDK transport upgrade for direct silent retry.

See **[Auth hardening (MCP 2026-07-28)](v2_auth_hardening.md)** for per-SEP as-built status and automated coverage. Hosted smoke here is complementary for real IdPs — SEPs already covered in CI do not need dedicated smoke scenarios.

- **Mid-session auth:** see [§5 manual validation](v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation) — CI covers core protocol; **W1 + W5–W7 / T1–T2 + T4 / C1–C2** are the required manual gate per client; **W8–W11, T3, T5–T6, C3** extend P0/P1/P2 UX coverage.
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
