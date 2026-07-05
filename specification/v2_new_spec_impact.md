# Inspector V2 - MCP Spec 2026-07-28: SEP Review and Inspector V2 Impact

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | V2 New Spec Impact


<!-- TOC -->
* [1. Executive summary](#1-executive-summary)
* [2. Scope note: milestone vs. release](#2-scope-note-milestone-vs-release)
* [3. High-level overview of the milestone SEPs](#3-high-level-overview-of-the-milestone-seps)
* [4. Functional area: transport, HTTP, and observability](#4-functional-area-transport-http-and-observability)
  * [4.1 SEP-2243 — HTTP Header Standardization (final title: "HTTP Header Standardization for Streamable HTTP Transport")](#41-sep-2243--http-header-standardization-final-title-http-header-standardization-for-streamable-http-transport)
  * [4.2 SEP-2260 — Server requests must be associated with a client request](#42-sep-2260--server-requests-must-be-associated-with-a-client-request)
  * [4.3 SEP-414 — OpenTelemetry trace context in `_meta`](#43-sep-414--opentelemetry-trace-context-in-_meta)
* [5. Functional area: authorization](#5-functional-area-authorization)
  * [5.1 SEP-837 — `application_type` in Dynamic Client Registration](#51-sep-837--application_type-in-dynamic-client-registration)
  * [5.2 SEP-2350 — Client-side scope accumulation in step-up authorization](#52-sep-2350--client-side-scope-accumulation-in-step-up-authorization)
  * [5.3 SEP-2351 — RFC 8414 well-known suffix declaration](#53-sep-2351--rfc-8414-well-known-suffix-declaration)
  * [5.4 SEP-2352 — Authorization server binding and migration](#54-sep-2352--authorization-server-binding-and-migration)
* [6. Functional area: extensibility, UI, and governance](#6-functional-area-extensibility-ui-and-governance)
  * [6.1 SEP-2133 — Extensions framework](#61-sep-2133--extensions-framework)
  * [6.2 SEP-1865 — MCP Apps (`io.modelcontextprotocol/ui`)](#62-sep-1865--mcp-apps-iomodelcontextprotocolui)
  * [6.3 SEP-1730 — SDK tiers](#63-sep-1730--sdk-tiers)
* [7. How the over-the-wire conversation changes](#7-how-the-over-the-wire-conversation-changes)
  * [7.1 Connection establishment](#71-connection-establishment)
  * [7.2 Responses and request-scoped streaming](#72-responses-and-request-scoped-streaming)
  * [7.3 Server→client interactions: MRTR replaces server-initiated requests](#73-serverclient-interactions-mrtr-replaces-server-initiated-requests)
  * [7.4 Push notifications: `subscriptions/listen` replaces the GET stream](#74-push-notifications-subscriptionslisten-replaces-the-get-stream)
  * [7.5 Cancellation, resumability, keepalive](#75-cancellation-resumability-keepalive)
  * [7.6 Logging](#76-logging)
  * [7.7 Errors and version negotiation](#77-errors-and-version-negotiation)
  * [7.8 Backward compatibility: the "era" model](#78-backward-compatibility-the-era-model)
* [8. TypeScript SDK v2: what it handles vs. what bubbles up](#8-typescript-sdk-v2-what-it-handles-vs-what-bubbles-up)
  * [8.1 Structural/API migration (independent of the new spec)](#81-structuralapi-migration-independent-of-the-new-spec)
  * [8.2 Handled automatically by SDK v2](#82-handled-automatically-by-sdk-v2)
  * [8.3 Bubbles up to the application](#83-bubbles-up-to-the-application)
* [9. Impact on MCP Inspector V2 (`v2/main`)](#9-impact-on-mcp-inspector-v2-v2main)
  * [9.1 Connection model and state management](#91-connection-model-and-state-management)
  * [9.2 History and Network tabs (the Inspector's core value)](#92-history-and-network-tabs-the-inspectors-core-value)
  * [9.3 Feature tabs](#93-feature-tabs)
  * [9.4 Auth and the OAuth store](#94-auth-and-the-oauth-store)
  * [9.5 Suggested sequencing](#95-suggested-sequencing)
* [10. Reference: new error codes](#10-reference-new-error-codes)
* [11. Sources](#11-sources)
<!-- TOC -->
---

## 1. Executive summary

The upcoming release (protocol version **`2026-07-28`**, successor to `2025-11-25`) is the largest revision in MCP's history. The milestone's closed SEPs fall into four functional areas — transport/HTTP, authorization, extensibility/UI, and ecosystem governance — but the milestone list alone understates the change: the final draft spec also incorporates several other merged SEPs (**SEP-2567 sessionless**, **SEP-2575 stateless**, **SEP-2322 MRTR**, **SEP-2663 tasks-as-extension**) that dominate the over-the-wire differences and interact directly with the milestone items. Both are covered here, clearly attributed.

The headline for the Inspector:

1. **The HTTP transport is redesigned.** POST-only, no `initialize` handshake, no sessions, no GET stream, no SSE resumability. Every request is self-describing via `_meta`; server→client requests (sampling/elicitation/roots) are replaced by an in-band `input_required` retry pattern (MRTR); push notifications move to a `subscriptions/listen` stream; new `Mcp-Method`/`Mcp-Name` headers are mandatory (SEP-2243).
2. **SDK v2 absorbs most of the mechanics** — era negotiation, `_meta` envelopes, header mirroring, MRTR auto-fulfilment, listen streams — behind the existing handler APIs. But it defaults to **legacy** behavior, and its docs explicitly warn that *debugging tools should not default to auto-negotiation*. Era selection, per-request log levels, response caching, pagination, tasks, and a new error taxonomy all bubble up to Inspector UX and state.
3. **Auth changes are storage-schema changes.** Credentials must be keyed by `(server, issuer)`, DCR must send `application_type`, scope step-up accumulation is a client responsibility. SDK v2 implements the flows but the Inspector's persisted OAuth store and Network-tab visualizations must follow.
4. **Extensions become a first-class concept** (`capabilities.extensions` on both sides), MCP Apps is the flagship extension (already implemented in Inspector v2 via `ext-apps`), and **tasks moves out of core into an extension with a redesigned polling model** — and SDK v2 removed its built-in tasks support entirely.

---

## 2. Scope note: milestone vs. release

The milestone was 41% complete at review time (10 closed, 14 open). The 10 closed items are covered in §3–§6. However, the published **draft spec changelog** already lists as *major changes* several SEPs merged outside this closed list — SEP-2567 (remove sessions), SEP-2575 (stateless + `server/discover` + `subscriptions/listen`), SEP-2322 (MRTR + `resultType`), and SEP-2663 (tasks extension). Since the Inspector must implement the *composite* protocol, §7 (wire changes) and §9 (Inspector impact) describe the full 2026-07-28 picture. Caveat: items could still shift before the July 28 release; the RC window is the time to re-verify.

A reading caveat that applies throughout: **the merged SEP documents themselves contain stale examples** (e.g., SEP-2243's doc still shows `Mcp-Session-Id` and `initialize`, and error code `-32001` before renumbering to `-32020`). The authoritative integration is the draft spec pages at `modelcontextprotocol.io/specification/draft`, not the SEP files.

---

## 3. High-level overview of the milestone SEPs

| SEP | Title | Area | One-liner |
|---|---|---|---|
| [2243](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243) | HTTP Header Standardization | Transport | Mandatory `Mcp-Method`/`Mcp-Name` headers mirroring the JSON-RPC body; opt-in `x-mcp-header` param mirroring; `-32020 HeaderMismatch` |
| [2260](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2260) | Server requests tied to client requests | Transport | Sampling/elicitation/roots MUST be associated with an in-flight client request; no standalone server→client requests. Doctrinal precursor to MRTR |
| [414](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/414) | OTel trace context conventions | Observability | `traceparent`/`tracestate`/`baggage` reserved as bare `_meta` keys (W3C formats) |
| [837](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/837) | Client type in DCR | Auth | Clients MUST send `application_type` (`"native"`/`"web"`) during Dynamic Client Registration |
| [2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350) | Scope accumulation in step-up auth | Auth | Servers challenge per-operation; **clients** union previously requested scopes with challenged scopes before re-authorizing |
| [2351](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2351) | RFC 8414 well-known suffix | Auth | MCP formally declares the default `oauth-authorization-server` suffix; no MCP-specific suffix. Confirmatory, no wire change |
| [2352](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2352) | AS binding and migration | Auth | Credentials MUST be keyed by AS `issuer`; on AS change, re-register (DCR) or error (pre-registered); CIMD IDs are portable |
| [2133](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2133) | Extensions framework | Extensibility | `capabilities.extensions` map on both sides; governance for official (`ext-*`) / experimental / third-party extensions |
| [1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865) | MCP Apps | Extensibility/UI | Extension `io.modelcontextprotocol/ui`: predeclared `ui://` HTML resources, sandboxed-iframe rendering, JSON-RPC-over-postMessage host bridge |
| [1730](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1777) | SDK tiers | Governance | Three-tier SDK classification driven by conformance testing and issue-triage SLAs. No wire impact |

Also landed in the draft (not in the closed milestone list, but essential context): **SEP-2567** (sessionless), **SEP-2575** (stateless, `server/discover`, `subscriptions/listen`, removal of `ping`/`logging/setLevel`/`notifications/roots/list_changed`), **SEP-2322** (MRTR, required `resultType`), **SEP-2663** (tasks redesigned as extension `io.modelcontextprotocol/tasks`), **SEP-2549** (list-response caching hints), **SEP-2577** (deprecation annotations for sampling/roots/logging), **SEP-991** (CIMD; DCR deprecated in its favor), **SEP-2596** (feature lifecycle; HTTP+SSE formally Deprecated).

---

## 4. Functional area: transport, HTTP, and observability

### 4.1 SEP-2243 — HTTP Header Standardization (final title: "HTTP Header Standardization for Streamable HTTP Transport")

The problem: intermediaries (gateways, load balancers, WAFs, rate limiters) could not route or police MCP traffic without parsing JSON bodies. The fix: mirror key body fields into HTTP headers on every Streamable HTTP POST.

Standard headers, **required for compliance**:

- `MCP-Protocol-Version` — must match `_meta["io.modelcontextprotocol/protocolVersion"]` in the body.
- `Mcp-Method` — mirrors the JSON-RPC `method`, on every request.
- `Mcp-Name` — mirrors `params.name`/`params.uri` on `tools/call`, `resources/read`, `prompts/get`.

Opt-in custom headers: a server may annotate tool `inputSchema` properties with `x-mcp-header: "{Name}"`, and conforming clients **MUST** then mirror those argument values into `Mcp-Param-{Name}` headers. Constraints on annotatable properties are strict (primitive types only — string/integer/boolean, no `number`; statically reachable via plain `properties` chains — no `$ref`, `oneOf`, `items`, conditionals). **A violating annotation invalidates the whole tool definition, and clients on Streamable HTTP MUST exclude that tool from `tools/list` results** (a new client-side conformance duty). Values that aren't header-safe ASCII must be encoded with a Base64 sentinel format: `=?base64?{b64}?=`.

Validation: any server processing the body MUST verify header/body consistency and reject mismatches with HTTP `400` + JSON-RPC error **`-32020 HeaderMismatch`** (renumbered from the SEP's draft `-32001`; `-32020`–`-32099` is now reserved for spec-defined errors). Intermediaries forward unknown `Mcp-Param-*` headers untouched.

Client duties beyond sending headers: build `Mcp-Param-*` from the most recently fetched `inputSchema`; on rejection without a schema, re-fetch `tools/list` and retry; handle `413`/`431` gracefully; treat header names case-insensitively but values case-sensitively.

### 4.2 SEP-2260 — Server requests must be associated with a client request

Upgrades the 2025-era "SHOULD relate to the originating request" to **MUST**: `sampling/createMessage`, `elicitation/create`, and `roots/list` may only be sent in association with an in-flight client request, never standalone on an independent stream (`ping` excepted). Clients receiving an orphaned server request SHOULD respond `-32602`.

Strategically this SEP is the bridge that made MRTR (SEP-2322) and GET-stream removal possible. In the final 2026-07-28 protocol its constraint is fully absorbed: **servers cannot send any JSON-RPC requests to clients at all.** Server→client interactions arrive as data inside the client's own response (`InputRequiredResult`), and the client answers by retrying the original request. Against a modern server, SEP-2260 requires no dedicated code; against 2025-era servers it lets a client drop out-of-band request handling from the standalone GET stream.

One operational consequence survives into both eras: transports must tolerate **unbounded human-in-the-loop delays** on the originating request (servers keep streams alive with SSE keepalive comments; clients must not apply short timeouts to requests that may elicit).

### 4.3 SEP-414 — OpenTelemetry trace context in `_meta`

A small, documentation-only standardization: the bare keys `traceparent`, `tracestate`, and `baggage` are **reserved** in `_meta` (an explicit exception to the reverse-DNS prefix rule) and, when present, MUST follow W3C Trace Context / Baggage formats. This codifies what instrumented SDKs already emit and keeps interop with the OTel semantic conventions for MCP. There is no requirement for clients to send or servers to process them.

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"get_weather","arguments":{"location":"NYC"},
  "_meta":{"traceparent":"00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"}}}
```

The carrier is the JSON-RPC body (transport-independent — survives stdio). Note for a tool that displays `_meta` verbatim: `baggage` can carry arbitrary correlation key-values; treat as potentially sensitive.

---

## 5. Functional area: authorization

All four auth SEPs are clarifications/hardening of the OAuth 2.1 framework — no new endpoints or protocol machinery — but two of them (837, 2352) impose hard requirements on client behavior and persisted state. Note also that the draft restructures the authorization spec into four pages and **deprecates DCR in favor of CIMD** (SEP-991, separate PR), so the DCR requirements below live under a deprecated-but-supported mechanism.

### 5.1 SEP-837 — `application_type` in Dynamic Client Registration

OIDC-flavored authorization servers default omitted `application_type` to `"web"`, which forbids loopback redirect URIs — breaking DCR for desktop/CLI/localhost clients. Now: clients **MUST** send an appropriate `application_type` in the DCR request. Native apps (desktop, mobile, CLI, *locally hosted web apps accessed via localhost* — i.e., the Inspector) SHOULD use `"native"`; remote browser-based apps SHOULD use `"web"`. Clients MUST handle registration rejections caused by redirect-URI constraints, SHOULD surface a meaningful error, and MAY retry with adjusted parameters.

### 5.2 SEP-2350 — Client-side scope accumulation in step-up authorization

Resolves an ambiguity: the old spec's `insufficient_scope` example implied servers echo accumulated scopes; RFC 6750 says the `scope` attribute describes the *current* resource. The resolution: **servers stay stateless and challenge per-operation; clients own accumulation.**

- The 403 challenge now carries only the scopes for the failing operation (spec example changed from `scope="files:read files:write user:profile"` to `scope="files:write"`).
- On step-up, the client **computes the union** of its previously requested scope set and the challenged scopes, and re-authorizes with that union. A naive client that requests only the challenged scope will receive a token that silently *lost* its earlier grants.
- Clients MUST NOT assume any set relationship between challenged scopes and `scopes_supported`, and need not deduplicate hierarchical scopes.

Practical requirement: persist the requested scope set per `(server, AS)` pair and union on every challenge.

### 5.3 SEP-2351 — RFC 8414 well-known suffix declaration

Purely declaratory: MCP uses the default `oauth-authorization-server` suffix and **does not define an application-specific suffix**. The existing priority-ordered discovery probing (path-inserted `oauth-authorization-server`, then `openid-configuration` variants) is unchanged. A client that already implements the probing correctly is compliant; the only rule is don't invent an MCP-specific suffix.

### 5.4 SEP-2352 — Authorization server binding and migration

Closes a credential-confusion hole when a server's Protected Resource Metadata changes or lists multiple ASes:

- Persisted client credentials (pre-registered or DCR-obtained) **MUST be keyed by the issuing AS's `issuer` identifier**.
- Multiple ASes in PRM are fully independent; separate registration state per AS, and credentials MUST NOT be reused across ASes.
- On AS change (detected via updated PRM): DCR clients **MUST re-register** with the new AS; pre-registered clients SHOULD surface an error rather than send mismatched credentials; **CIMD client IDs are explicitly portable** (no re-registration).

This is a storage-schema change for any client that caches OAuth state: `(MCP server, AS issuer) → {client_id, tokens, scopes}` instead of `MCP server → client_id`.

The four interact: 2352's re-registration goes through DCR where 837's `application_type` applies; 2350's accumulated scope set is part of the per-issuer state 2352 mandates; 2351's declared suffix governs the AS-metadata fetch used in 2352's issuer comparison.

---

## 6. Functional area: extensibility, UI, and governance

### 6.1 SEP-2133 — Extensions framework

Exactly one core schema change: an optional `extensions` map on both `ClientCapabilities` and `ServerCapabilities`, keyed by `{vendor-prefix}/{extension-name}` (e.g. `io.modelcontextprotocol/ui`), each value being an extension-defined settings object (`{}` = supported, no settings).

```json
"capabilities": {
  "extensions": {
    "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] }
  }
}
```

The rest is governance: official extensions live in `ext-*` repos with delegated maintainers and independent versioning, created via a new Extensions Track SEP type (reference implementation required before review); experimental extensions incubate in `experimental-ext-*` repos; breaking changes require a new identifier. Graceful degradation is normative, SDK extension support must be opt-in/disabled by default, and extension support is **not** required for conformance or SDK tiering. Official extensions now include Apps (`io.modelcontextprotocol/ui`), Tasks (`io.modelcontextprotocol/tasks`), and the `ext-auth` pair (OAuth client credentials, Enterprise-Managed Authorization).

### 6.2 SEP-1865 — MCP Apps (`io.modelcontextprotocol/ui`)

The flagship extension: servers deliver interactive HTML UIs that hosts render inline. Mechanics:

- **Declaration:** UI templates are *predeclared resources* under a `ui://` URI scheme with MIME type `text/html;profile=mcp-app`, fetched via ordinary `resources/read`. Tools link to them via `_meta.ui.resourceUri`; resources can carry `_meta.ui.csp` (origin allowlist over a deny-by-default CSP) and `_meta.ui.permissions` (camera/mic etc.). Predeclaration enables prefetching at `tools/list` time and security review.
- **Negotiation:** via the SEP-2133 `extensions` map, with the client declaring supported `mimeTypes`. Servers SHOULD fall back to text-only tools for non-supporting clients.
- **Runtime:** mandatory sandboxed iframe; iframe↔host communication is a JSON-RPC dialect of MCP over `postMessage`: `ui/initialize` handshake, host→app notifications (`ui/notifications/tool-input`, `tool-input-partial`, `tool-result`, `tool-cancelled`, `host-context-changed`, `size-changed`, `resource-teardown`), and app-initiated `tools/call` proxied — and policed/consent-gated — by the host, plus `ui/message`, `ui/open-link`, `ui/request-display-mode`.
- **No new methods on the client↔server channel.** All new methods live on the postMessage bridge. The normative spec versions independently in `modelcontextprotocol/ext-apps` (`2026-01-26`); `@modelcontextprotocol/ext-apps` ships the host-side `AppBridge`.

### 6.3 SEP-1730 — SDK tiers

Governance only, zero wire impact. Three tiers: Tier 1 (100% conformance via `modelcontextprotocol/conformance`, new spec features within each release's RC window, 2-business-day triage, 7-day P0 fixes), Tier 2 (≥80%, slower SLAs), Tier 3 (experimental). Standardized issue-label taxonomy feeds automated tier metrics; automatic relegation triggers exist. Extensions and experimental features are excluded from conformance scoring. Relevance to the Inspector: it's a signal on SDK dependency choice (the TypeScript SDK targets Tier 1, meaning day-one 2026-07-28 support), and the conformance suite itself is useful tooling for an inspector-class project.

---

## 7. How the over-the-wire conversation changes

This section describes the composite 2026-07-28 Streamable HTTP transport (SEP-2243 + 2567 + 2575 + 2322 + 2260), before vs. after. Verified against the draft spec pages and changelog.

### 7.1 Connection establishment

**Before (2025-11-25):** POST `initialize` → server responds with capabilities + optional `Mcp-Session-Id` header → POST `notifications/initialized` → all subsequent requests carry `Mcp-Session-Id` and `MCP-Protocol-Version` headers. Optional GET opens a standalone SSE stream for server-initiated messages. DELETE terminates the session.

**After (2026-07-28):** there is no handshake and no session. The client either calls `server/discover` (which servers MUST implement) to learn versions/capabilities/identity up front, or just sends its first real request. Every request and notification is its own POST and is self-describing:

```http
POST /mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_weather
Mcp-Param-Region: us-west1

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"get_weather",
  "arguments":{"region":"us-west1","location":"NYC"},
  "_meta":{
    "io.modelcontextprotocol/protocolVersion":"2026-07-28",
    "io.modelcontextprotocol/clientInfo":{"name":"mcp-inspector","version":"2.0.0"},
    "io.modelcontextprotocol/clientCapabilities":{"elicitation":{"form":{},"url":{}}}
  }}}
```

GET and DELETE are gone (modern servers return 405). `Mcp-Session-Id` is gone (modern servers ignore it). One JSON-RPC message per POST; clients never POST JSON-RPC responses; no batching.

### 7.2 Responses and request-scoped streaming

Unchanged in shape: the server answers each request with either `application/json` (single object) or a `text/event-stream` **scoped to that request** — but the stream may now carry only *notifications related to that request* (`notifications/progress`, `notifications/message`) followed by the final response. Servers MUST NOT send JSON-RPC requests on any stream.

### 7.3 Server→client interactions: MRTR replaces server-initiated requests

**Before:** the server sent `elicitation/create` / `sampling/createMessage` / `roots/list` as JSON-RPC *requests* (on the POST's SSE stream, or pre-SEP-2260 even on the GET stream); the client POSTed the response back, correlated by JSON-RPC id.

**After:** all results carry a required **`resultType`** (`"complete"` | `"input_required"`; results from older servers lacking it are treated as complete). When a server needs input, it *returns*:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "resultType":"input_required",
  "inputRequests":{"1":{"method":"elicitation/create","params":{...}}},
  "requestState":"opaque-server-token"}}
```

The client gathers the answers locally and **retries the original request with a new id**, attaching `inputResponses` and echoing `requestState`. There is no server→client JSON-RPC request framing left on the wire.

### 7.4 Push notifications: `subscriptions/listen` replaces the GET stream

The client POSTs `subscriptions/listen` with a filter (`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions: [uris]`); the response is a long-lived SSE stream that begins with `notifications/subscriptions/acknowledged` and thereafter carries only opted-in notification types, each tagged `_meta["io.modelcontextprotocol/subscriptionId"]`. This also replaces `resources/subscribe`/`unsubscribe`. Request-scoped notifications never appear on this stream.

### 7.5 Cancellation, resumability, keepalive

Closing a request's SSE stream **is** cancellation (`notifications/cancelled` is stdio-only now). SSE resumability is removed — no `Last-Event-ID`, no event IDs; a broken stream loses the in-flight request and the client MUST re-issue it with a new id. Servers keep long streams alive with SSE comment lines; `ping` is removed from the modern protocol.

### 7.6 Logging

`logging/setLevel` and its session-scoped level are gone. The client opts into logs **per request** via `_meta["io.modelcontextprotocol/logLevel"]`; servers MUST NOT emit `notifications/message` for requests that omitted it.

### 7.7 Errors and version negotiation

New spec-defined JSON-RPC error codes, all surfaced as HTTP 400 with a JSON-RPC body: **`-32020 HeaderMismatch`**, **`-32021 MissingRequiredClientCapability`**, **`-32022 UnsupportedProtocolVersion`** (the error body lists `supported` versions so the client can retry). Unknown methods return HTTP **404** with JSON-RPC `-32601` — the JSON-RPC body is what distinguishes a modern server from a legacy HTTP+SSE server's bare 404.

### 7.8 Backward compatibility: the "era" model

The spec defines two eras: **modern** (≥2026-07-28, per-request metadata) and **legacy** (≤2025-11-25, initialize handshake). A dual-era client sends a modern request first; on 400 it inspects the body — a recognized modern JSON-RPC error means "modern server, fix and retry"; an empty/unrecognized body means legacy → fall back to `initialize`, and possibly further to the now-formally-Deprecated 2024-11-05 HTTP+SSE transport (GET, look for the `endpoint` event). Era determination is per-origin and SHOULD be cached.

---

## 8. TypeScript SDK v2: what it handles vs. what bubbles up

The Inspector v2 currently depends on `@modelcontextprotocol/sdk@1.29.0`. SDK v2 (`main`, `2.0.0-beta.2`) targets the 2026-07-28 spec, with stable release planned alongside the spec on July 28; v1.x remains supported ≥6 months after. There is also a `v1.x-2026-07-28` backport branch worth watching as a possible lower-effort path.

### 8.1 Structural/API migration (independent of the new spec)

- **Package split:** `@modelcontextprotocol/sdk` → `@modelcontextprotocol/client` (Client, transports, OAuth), `@modelcontextprotocol/core` (public Zod schemas), plus server packages. stdio transport moves to subpath `@modelcontextprotocol/client/stdio` (root barrel is browser-safe — convenient for the Inspector's web/Node split). `WebSocketClientTransport` removed. A codemod exists: `npx @modelcontextprotocol/codemod@beta v1-to-v2 .`
- **Handlers take method strings, not Zod schemas:** `client.setRequestHandler('elicitation/create', ...)`. Result schemas are dropped from `request()`/`callTool()` for spec methods (SDK enforces them); custom/raw passthrough requests need an explicit schema — an Inspector-style "send raw request" feature should pass `ResultSchema` from core.
- **Zod 4 required** (`^4.2.0`); zod 3 unsupported.
- **Error taxonomy rename:** `McpError` → `ProtocolError`; new `SdkError` with string codes (`RequestTimeout`, `ConnectionClosed`, `EraNegotiationFailed`, `MethodNotSupportedByProtocolVersion`, `InputRequiredRoundsExceeded`, ...); `StreamableHTTPError` → `SdkHttpError` (status on `.status`). Unknown-tool calls now *reject* with `-32602` instead of resolving `isError: true`.
- **Elicitation `mode` discriminant:** branch on `params.mode === 'url'` vs. everything-else-is-form; `ElicitResult.content` values strictly `string | number | boolean | string[]`.
- `Protocol` base class no longer exported; `client.fallbackRequestHandler` is the hook for catching arbitrary inbound requests (relevant for a debugging UI).

### 8.2 Handled automatically by SDK v2

- **Era/version negotiation:** `versionNegotiation: { mode: 'auto' }` probes `server/discover` and falls back to `initialize`; `{ pin: '2026-07-28' }` forces modern. **Default is `'legacy'`** — nothing 2026 goes on the wire unless opted in. State accessors: `getProtocolEra()`, `getNegotiatedProtocolVersion()`, `getDiscoverResult()` (persistable; feed back as `connect(transport, { prior })` for a zero-round-trip reconnect).
- **`_meta` envelope** attached to every modern request; `resultType` consumed internally.
- **SEP-2243 headers:** `Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version` emitted; `x-mcp-header` args auto-mirrored into `Mcp-Param-*` (skipped in browsers due to CORS — note for the Inspector's browser-side transport: header mirroring only happens on the Node/proxy path); `-32020` recovery retry built in.
- **MRTR auto-fulfilment:** on modern connections, `input_required` results are fulfilled through the *same* `setRequestHandler` handlers for elicitation/sampling/roots, and the original request is retried automatically (default 10 rounds; opt out with `inputRequired: { autoFulfill: false }` or drive manually with `withInputRequired()`). Existing sampling/elicitation UI handlers work on both eras unchanged.
- **Notifications:** `listChanged` options transparently open/manage a `subscriptions/listen` stream on modern; explicit `client.listen(filter)` returns an `McpSubscription`.
- **Cancellation** switches to stream-abort on modern; calling code unchanged.
- **Auth:** RFC 9207 `iss` validation in `finishAuth(URLSearchParams)`, issuer stamping (SEP-2352), HTTPS token-endpoint enforcement, scope step-up union (SEP-2350, `onInsufficientScope: 'reauthorize' | 'throw'`), DCR `application_type` defaults (SEP-837), CIMD support (DCR marked deprecated).

### 8.3 Bubbles up to the application

- **Negotiation mode is a product decision.** The SDK docs explicitly warn that **debugging tools should not default to `'auto'`** (the probe stalls on silent stdio legacy servers and pollutes recorded transcripts with an extra round trip). The Inspector should expose era/version selection as per-server configuration.
- **List verbs auto-aggregate all pages** (up to `listMaxPages`, default 64) and return `nextCursor: undefined`. **A pagination-debugging UI must drop to raw `client.request({method:'tools/list', ...})` to observe individual pages.**
- **List verbs no longer throw on missing capability** (return empty instead) unless `enforceStrictCapabilities: true` — an Inspector probably wants strictness on, or should annotate the difference.
- **Response caching (SEP-2549):** on 2026 connections, list verbs honor server `ttlMs`/`cacheScope` and may answer *without a round trip*. A debugging tool should default to `cacheMode: 'bypass'`/`'refresh'` or display cache provenance.
- **Per-request log level:** the SDK does **not** auto-attach `logLevel`; server logs are silently absent until the client stamps the `_meta` key per request. An Inspector that displays server logs must manage this itself on modern connections.
- **Tasks: removed from the SDK.** The experimental tasks layer (polling helpers, `callToolStream`, `TaskStore`) is deleted. Task wire types remain importable as deprecated for 2025-11-25 interop, but `tasks/*` calls require the explicit-schema raw-request form. On a 2026 connection, tasks live in the redesigned `io.modelcontextprotocol/tasks` extension (SEP-2663: polling via `tasks/get`, new `tasks/update`, `tasks/list` removed, unsolicited task handles allowed) — with **no SDK support**; the Inspector implements it or waits for an ext package.
- **Extensions:** capability plumbing only — declare via constructor capabilities, read via `getServerCapabilities()?.extensions`; extension methods are custom methods with your own schemas. **MCP Apps has no support in this SDK** (it stays in `@modelcontextprotocol/ext-apps`, which Inspector v2 already uses).
- **OAuth UX details:** under probing negotiation, a connect-time 401 surfaces wrapped as `SdkError(EraNegotiationFailed)` with the `UnauthorizedError` at `error.data.cause` — the Inspector's 401→authorize→`finishAuth`→reconnect flow must unwrap it. `finishAuth` now takes the full callback `URLSearchParams`.
- **Transcript-classification caveat:** the modern probe itself carries the `_meta` envelope *before* era is known — "saw an envelope" ≠ "modern negotiated" when labeling captured traffic in History.

---

## 9. Impact on MCP Inspector V2 (`v2/main`)

Grounded in the current branch architecture: `InspectorClient` (core/mcp/inspectorClient.ts) wrapping SDK 1.29 with typed events → `core/mcp/state` stores → React hooks; browser transport remoted through the Hono backend (`core/mcp/remote/`); file-backed OAuth via `OAuthStorageBase` (`oauth.json`); capability-gated tabs.

### 9.1 Connection model and state management

This is the deepest change. Today `InspectorClient` and the UI assume: connect ⇒ `initialize` exchange ⇒ negotiated capabilities + optional session id ⇒ session-scoped everything. On modern servers none of that exists.

- **Era becomes first-class connection state.** Add per-server config (auto / legacy / pin-2026, defaulting *not* to auto per SDK guidance) and expose `getProtocolEra()` / `getNegotiatedProtocolVersion()` through the event target and stores. Most downstream UI (which tabs show, which affordances render, how messages are interpreted) should gate on era, not just capabilities.
- **`ConnectionInfoModal` needs an era-aware redesign:** for modern servers there is no initialize result or session id to display — show the `server/discover` result, the pinned/negotiated version, and "sessionless" explicitly. Consider persisting `getDiscoverResult()` in the server catalog and passing it as `prior` for instant reconnects.
- **`getServerType` (`core/mcp/config.ts`) hard-codes `stdio | sse | streamable-http`.** Transport type and protocol era are now orthogonal dimensions; the config model and the remote-transport protocol (`/api/mcp/connect`) must carry both. The backend's `RemoteSession` also currently assumes a persistent transport per session — still true mechanically, but "connected" no longer implies any server-side session, which affects reconnect/disconnect semantics and what `/api/mcp/disconnect` means for a modern server (nothing to DELETE).
- **Capability gating changes source:** tabs are currently gated on the `initialize` result. On modern connections capabilities come from `server/discover` (or lazily from error responses). Also new gates: `-32021 MissingRequiredClientCapability` handling, and the `extensions` maps on both sides.

### 9.2 History and Network tabs (the Inspector's core value)

- **New message vocabulary to render and correlate:** `_meta` envelopes on every request, `resultType` on every result, `input_required` results, retried requests with **new ids** linked by `requestState`, `server/discover`, `subscriptions/listen` + `notifications/subscriptions/acknowledged` + `subscriptionId` tagging. The History view's request/response pairing logic must learn that one logical operation can span multiple JSON-RPC ids (MRTR retries) — probably the single most valuable new visualization: group an MRTR conversation (original call → input requests → user answers → retry → final result) as one expandable unit.
- **If MRTR auto-fulfilment is left on**, the SDK hides the retry loop; the Inspector should either drive MRTR manually (`autoFulfill: false` + `withInputRequired()`) to keep its pending-request UX and full visibility, or capture the auto-fulfilled rounds via the transport-level message log. The existing `PendingClientRequests`/inline panels survive either way since handlers are era-agnostic, but the *semantics* shown to the user ("server sent a request" vs. "server returned input_required; response goes back as a retry") should be accurate per era.
- **Network tab:** display and validate the new headers (`Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`, sentinel-encoded values), show `-32020/-32021/-32022` failures distinctly, and reflect that browser-path requests won't carry `Mcp-Param-*` (mirroring happens on the Node side — since Inspector's web client proxies through the backend, mirroring should work, but verify in the remote-transport layer). Cancellation now appears as connection abort, not a `notifications/cancelled` frame.
- **Raw-request passthrough** must supply explicit result schemas (`ResultSchema`) under SDK v2, and is also the only way to exercise page-by-page pagination and cache-bypass behaviors worth surfacing as Inspector features ("fetch single page", "bypass cache", "refresh").

### 9.3 Feature tabs

- **Tools:** parse/validate `x-mcp-header` annotations and *visibly flag tools excluded for invalid annotations* (the spec makes exclusion mandatory — a debugging tool should show *why* a tool vanished). Show which args will be mirrored to headers. Unknown-tool calls now reject with `-32602` rather than returning `isError` results — adjust result rendering.
- **Tasks tab: substantial rework.** The current implementation targets the 2025-11-25 experimental core tasks (including receiver tasks and `tasks/list`). Under SEP-2663 tasks are an extension (`io.modelcontextprotocol/tasks`) with polling `tasks/get`, new `tasks/update`, no `tasks/list`, no blocking `tasks/result`, and unsolicited task handles. SDK v2 gives no help. Plan: keep the current tab for legacy-era servers, build an extension-aware implementation (raw requests + explicit schemas) for modern ones, and gate on the extension being negotiated.
- **Resources:** `resources/subscribe`/`unsubscribe` and `ResourceSubscriptionsState` become legacy-only; on modern, subscriptions are entries in the `subscriptions/listen` filter — the state store should model "one listen stream + filter set + acknowledged state + reconnect-by-re-listen" (no resumability).
- **Logs:** `logging/setLevel` and the `LoggingScreen`'s level selector are legacy-only. On modern, add a per-request (or global stamp-every-request) log-level control and make clear that logs arrive on the originating request's stream. `ping` UI, if any, is legacy-only.
- **Apps:** already ahead of the curve via `ext-apps`. Work is alignment: advertise `io.modelcontextprotocol/ui` with `mimeTypes` through the now-formalized `capabilities.extensions` (the EMA advertisement in `inspectorClient.ts` is the existing precedent to generalize), and track the ext-apps `2026-01-26` spec/`AppBridge` version.
- **Extensions UI (new, small but high-leverage):** display the server's `extensions` map in Connection Info, and let users toggle which extensions the Inspector *advertises* — servers legitimately change tool registration based on client-declared extensions, so this is a real debugging knob.

### 9.4 Auth and the OAuth store

- **Re-key OAuth storage** (`core/auth/store.ts` / `OAuthStorage`) from per-server to per-`(server, issuer)`: stamp `issuer` on stored `clientInformation`/`tokens`, detect issuer changes against freshly fetched PRM/AS metadata on every flow, invalidate + re-register (DCR) / error (static) / continue (CIMD) accordingly. SDK v2 handles the flow logic but expects providers to round-trip issuer-stamped objects and optionally implement `discoveryState()`/`saveDiscoveryState()`.
- **Persist the requested-scope set** per (server, issuer) and show the step-up union computation in the auth visualizations — this is exactly the kind of thing Inspector users will want to see when debugging 403 loops. Surface the `onInsufficientScope` policy as a setting.
- **DCR panel:** show the `application_type` sent (Inspector = `"native"`), render registration rejections meaningfully, and reflect DCR's deprecated-in-favor-of-CIMD status (Inspector v2 already supports CIMD registration kind — good position).
- **401 handling under negotiation:** unwrap `EraNegotiationFailed` → `UnauthorizedError` in `oauthManager.ts`; switch to `finishAuth(callbackParams)` whole-params form (RFC 9207 iss validation happens inside; mismatches throw `IssuerMismatchError` — a new error state to display).
- **Network tab auth capture** continues to work (discovery/DCR/token traffic through `/api/fetch`), but the masked-secret-field list and the flow-step model (`OAuthStep`) should gain the new steps/errors (issuer comparison, step-up union, CIMD fetch).

### 9.5 Suggested sequencing

1. **SDK v2 migration mechanics** (packages, codemod, Zod 4, handler signatures, error taxonomy) with `versionNegotiation: 'legacy'` — behavior-neutral, unblocks everything else. Evaluate the `v1.x-2026-07-28` branch as a hedge if v2-stable slips past your release window.
2. **Auth store re-keying + SEP-837/2350/2352 UX** — independent of transport work, applies to both eras, and the SDK betas already enforce the flows.
3. **Era-aware connection model** (config, remote-transport protocol, Connection Info, capability gating) with explicit era selection UI.
4. **History/Network upgrades** for the new vocabulary (MRTR grouping, listen streams, Mcp-* headers, new error codes).
5. **Tab-by-tab era forks:** logging, resources subscriptions, tasks-as-extension, x-mcp-header tooling, extensions toggle UI.

---

## 10. Reference: new error codes

| Code | Name | HTTP | Source |
|---|---|---|---|
| -32020 | HeaderMismatch | 400 | SEP-2243 (renumbered from draft -32001) |
| -32021 | MissingRequiredClientCapability | 400 | SEP-2575 |
| -32022 | UnsupportedProtocolVersion (body lists `supported`) | 400 | SEP-2575 |
| -32601 | Method not found (era/method mismatch) | **404** | draft transport spec |
| -32602 | Invalid params — incl. orphaned server request (legacy), unknown tool (SDK v2) | — | SEP-2260 / SDK v2 |

`-32020`–`-32099` is now reserved for spec-defined errors; `-32000`–`-32019` remains implementation-defined.

---

## 11. Sources

- Milestone: https://github.com/modelcontextprotocol/modelcontextprotocol/milestone/4?closed=1
- Draft spec + changelog: https://modelcontextprotocol.io/specification/draft (esp. `/basic/transports/streamable-http`, `/basic/authorization/*`, `/basic/patterns/mrtr`, `/basic/patterns/subscriptions`, `/changelog`)
- SEP documents (final): https://modelcontextprotocol.io/seps/2243-http-standardization, `/seps/2575-stateless-mcp`, `/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp`, `/seps/2133-extensions`, `/seps/1730-sdks-tiering-system`
- Extensions & Apps: https://modelcontextprotocol.io/extensions/overview, https://github.com/modelcontextprotocol/ext-apps (spec `2026-01-26`)
- SDK tiers / conformance: https://modelcontextprotocol.io/community/sdk-tiers, https://github.com/modelcontextprotocol/conformance
- TypeScript SDK v2 (`main`, cloned at commit `7635115`, packages `2.0.0-beta.2`): `docs/migration/upgrade-to-v2.md`, `docs/migration/support-2026-07-28.md`, `docs/protocol-versions.md`, `docs/clients/*`
- Inspector `v2/main` (cloned at commit `066676a`): `AGENTS.md`, `core/mcp/inspectorClient.ts`, `core/mcp/remote/`, `core/auth/`, `clients/web/src/`
- Release blog posts: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/, `/posts/sdk-betas-2026-07-28/`

*Verification note: transport and protocol claims were cross-checked three ways — the draft spec pages, the draft changelog, and the SDK v2 source/docs (independently cloned). SEP-level normative wording was diffed against the 2025-11-25 spec where relevant. GitHub API access was intermittently unavailable during research, so PR-level diffs for the four auth SEPs were reconstructed from the published draft vs. 2025-11-25 text; attribution of individual sentences to specific PRs is high-confidence but not diff-verified. Re-verify against the final spec when it ships July 28.*
