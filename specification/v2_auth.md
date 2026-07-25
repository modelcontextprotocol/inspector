# Inspector V2 Authorization - Specification

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | V2 Auth | [V2 New Spec Impact](v2_new_spec_impact.md)

#### Overview | [EMA / XAA](v2_auth_ema.md) | [Hardening](v2_auth_hardening.md) | [Mid-session](v2_auth_mid_session.md) | [Smoke testing](v2_auth_smoke_testing.md) | [SDK consolidation](v2_auth_sdk_consolidation.md)

Inspector v2's authorization support spans OAuth 2.1 connect-time flows, Enterprise-Managed Authorization (EMA / XAA), mid-session credential recovery, and the hardening required by the MCP `2026-07-28` specification. This page is the landing point for that work; each area has its own spec below.

Inspector already ships connect-time OAuth and EMA infrastructure (`core/auth/`, `core/mcp/oauthManager.ts`, per-server OAuth fields in `~/.mcp-inspector/mcp.json` — see [Servers file](v2_servers_file.md)). The specs here cover extending that foundation across web, TUI, and CLI. How that stack maps onto `@modelcontextprotocol/client` after the v2 upgrade is recorded in [SDK consolidation](v2_auth_sdk_consolidation.md).

## Authorization specs

### [EMA / XAA](v2_auth_ema.md)

Support for [Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) (EMA, also referred to as XAA / ID-JAG). EMA extends the OAuth flow so an enterprise IdP (OIDC) can authenticate the client once; any MCP resource authorization server configured to trust that IdP is then accessible with minimal or no user prompting. Covers the web connect flow (implemented in `core/auth/ema/`), install-level `client.json` persistence, and wiring into `InspectorClient`.

### [Hardening](v2_auth_hardening.md)

As-built status for the six MCP `2026-07-28` authorization SEPs ([#1527](https://github.com/modelcontextprotocol/inspector/issues/1527)): what is done (and how), per-SEP automated coverage, and remaining test/era-aware follow-ups.

### [Mid-session](v2_auth_mid_session.md)

Detecting when in-flight MCP traffic needs new or elevated credentials, responding with the correct OAuth or EMA flow, and restoring the connection — across web, TUI, and CLI. Generalizes beyond expired access tokens to **step-up authorization** (a `403` with `insufficient_scope` and per-operation scopes, per SEP-2350). Addresses the web client's token-snapshot constraint, where MCP runs on the Hono backend and cannot complete interactive OAuth on its own.

### [Smoke testing](v2_auth_smoke_testing.md)

Manual smoke procedures for exercising Inspector OAuth against **hosted** MCP servers, complementing the automated integration coverage. Records known-good real endpoints, which client-ID mechanism each server supports, and how to configure Inspector (web, TUI, or CLI) via install-level `client.json`.

### [SDK consolidation](v2_auth_sdk_consolidation.md)

As-built: what auth logic moved onto the v2 SDK, what stayed Inspector-owned (and why), and which small SDK helper gaps would unlock further deletions.
