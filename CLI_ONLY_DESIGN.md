# MCP Inspector CLI-Only Design

A non-interactive, stateless CLI for exercising and inspecting MCP servers. All inputs provided as flags, all output as JSON to stdout. Designed for use by AI agents (Claude) and automation — no TTY, no prompts, no browser.

---

## Table of Contents

1. [Goals and Constraints](#goals-and-constraints)
2. [What We Delete](#what-we-delete)
3. [What We Extract](#what-we-extract)
4. [What Is New](#what-is-new)
5. [Architecture](#architecture)
6. [Directory Structure](#directory-structure)
7. [Feature Specifications](#feature-specifications)
8. [Transport Layer](#transport-layer)
9. [Output Contract](#output-contract)
10. [Error Handling](#error-handling)
11. [Configuration](#configuration)
12. [Test Strategy](#test-strategy)
13. [Implementation Order](#implementation-order)

---

## Goals and Constraints

### Goals

- Exercise **every MCP protocol method** from the command line
- Output structured JSON that machines can parse
- Support all three transports: STDIO, SSE, StreamableHTTP
- Handle server-initiated requests (sampling, elicitation) via pre-declared response templates
- Be fully non-interactive — every input is a flag or file, every output is stdout/stderr
- Follow functional core / imperative shell architecture
- Full TDD with incremental commits

### Constraints

- **No TTY interaction.** No readline, no prompts, no arrow-key menus, no confirmations.
- **No browser.** OAuth authorization code redirect step cannot be automated. Token must be provided externally.
- **Stateless by default.** Each invocation is one connection → one or more operations → disconnect. No daemon mode.
- **Exception: `--follow` mode.** A long-running mode that keeps the connection open and streams notifications/events as NDJSON lines until the process is killed or times out.

---

## What We Delete

These exist in the current inspector and are **not needed** for CLI-only:

| Component | Why Delete |
|---|---|
| `client/` (entire React app) | No UI. All interaction is flags → JSON. |
| `server/src/` (Express proxy) | Proxy exists to bridge browsers to STDIO. CLI connects directly via SDK transports. |
| `server/src/mcpProxy.ts` | Message forwarding between browser SSE and MCP transport. Not needed — CLI talks directly to MCP server. |
| React components (`*Tab.tsx`, `Sidebar.tsx`, etc.) | UI-only. Feature logic moves to CLI commands. |
| `DynamicJsonForm.tsx`, `JsonView.tsx`, `JsonEditor.tsx` | Form rendering / display. CLI accepts JSON as string flags. |
| `OAuthCallback.tsx`, `OAuthDebugCallback.tsx`, `OAuthFlowProgress.tsx` | Browser redirect handlers. CLI accepts tokens directly. |
| Vite config, Tailwind config, PostCSS config | Build tooling for React app. |
| `client/src/lib/hooks/useConnection.ts` | React hook. Connection logic extracted to pure functions + imperative shell. |
| All Radix UI, Lucide icons, React dependencies | UI framework deps. |
| `index.html`, `public/` assets | Web app entry points. |

### What remains from current `cli/`

The existing `cli/` directory has the right shape but needs significant extension. We keep and refactor:

- `cli/src/transport.ts` — transport factory (keep, extend)
- `cli/src/client/connection.ts` — connect/disconnect (keep, refactor to inject deps)
- `cli/src/client/tools.ts` — tool operations and type coercion (keep, extend)
- `cli/src/client/resources.ts` — resource operations (keep, extend)
- `cli/src/client/prompts.ts` — prompt operations (keep as-is)
- `cli/src/error-handler.ts` — error formatting (keep, extend with Result types)
- `cli/__tests__/` — all existing tests (keep, extend)

---

## What We Extract

Logic that currently lives in React components but is **protocol logic, not UI logic**:

| Source (current location) | Extract To | What It Does |
|---|---|---|
| `App.tsx` task polling loop | `src/client/tasks.ts` | Poll `tasks/get` until terminal state, return result |
| `App.tsx` sampling handler setup | `src/handlers/sampling.ts` | Register `sampling/createMessage` client handler |
| `App.tsx` elicitation handler setup | `src/handlers/elicitation.ts` | Register `elicitation/create` client handler |
| `App.tsx` roots handler setup | `src/handlers/roots.ts` | Register `roots/list` client handler, send `notifications/roots/list_changed` |
| `useConnection.ts` notification routing | `src/client/notifications.ts` | Receive and format notification events |
| `useConnection.ts` capability detection | `src/client/capabilities.ts` | Extract server capabilities after init |
| `utils/schemaUtils.ts` validation logic | `src/lib/schema.ts` | Validate tool output against output schemas |
| `utils/configUtils.ts` | `src/lib/config.ts` | Config file parsing (already partially in `cli.ts`) |
| `lib/auth.ts` OAuth token exchange | `src/client/oauth.ts` | Metadata discovery, client registration, token exchange, refresh |

---

## What Is New

Features that don't exist anywhere in the current codebase:

| Feature | Description |
|---|---|
| `--follow` mode | Keep connection open, stream notifications as NDJSON |
| `--handle-sampling` flag | Pre-declared JSON template for auto-responding to sampling requests |
| `--handle-elicitation` flag | Pre-declared JSON template or `reject`/`cancel` for elicitation requests |
| `--roots` flag | Declare filesystem roots at connection time |
| `--poll` flag for tasks | Call tool with `runAsTask`, poll until terminal, print result |
| `--token` convenience flag | Sugar for `--header "Authorization: Bearer <token>"` |
| `--timeout` flag | Global operation timeout (default 30s, configurable) |
| `--output-schema-validate` flag | Validate tool call results against declared output schema |
| `ping` method | Send ping, print response |
| `completion/complete` method | Request completions for resource/prompt arguments |
| `tasks/*` methods | List, get, cancel tasks |
| `server/info` pseudo-method | Print server capabilities and info from initialization |
| `oauth/discover` subcommand | Fetch and print OAuth metadata |
| `oauth/register` subcommand | Register OAuth client |
| `oauth/token` subcommand | Exchange auth code for token |
| `oauth/refresh` subcommand | Refresh an expired token |
| Notification streaming | Stream all server notifications in `--follow` mode |

---

## Architecture

### Functional Core, Imperative Shell

```
┌─────────────────────────────────────────────────┐
│  CLI Entry Point (imperative shell)             │
│  - Parses flags                                 │
│  - Wires dependencies                           │
│  - Orchestrates connect → call → disconnect     │
│  - Handles process lifecycle (exit codes, sigs) │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Lib (functional core)                          │
│  - Argument parsing & validation (pure)         │
│  - Response formatting (pure)                   │
│  - Schema validation (pure)                     │
│  - Type coercion (pure)                         │
│  - Config file parsing (pure)                   │
│  - OAuth URL/request builders (pure)            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Client (imperative shell)                      │
│  - Transport creation (STDIO, SSE, HTTP)        │
│  - MCP SDK client calls                         │
│  - Notification listeners                       │
│  - Server-initiated request handlers            │
│  - OAuth HTTP requests                          │
└─────────────────────────────────────────────────┘
```

### Dependency Injection

All side effects injected. Core logic never imports transport, I/O, or SDK directly.

```typescript
// Types for injectable dependencies
interface Transport {
  connect(): Promise<void>;
  close(): Promise<void>;
}

interface McpClient {
  request(method: string, params?: unknown): Promise<unknown>;
  getServerCapabilities(): ServerCapabilities;
  getServerVersion(): ServerInfo;
  setRequestHandler(method: string, handler: RequestHandler): void;
}

interface Output {
  result(data: unknown): void;     // JSON to stdout
  error(msg: string): void;        // text to stderr
  notification(data: unknown): void; // NDJSON line to stdout in --follow mode
}

interface Clock {
  now(): number;
  delay(ms: number): Promise<void>;
}

// Connection factory — injected, not imported
type TransportFactory = (config: TransportConfig) => Transport;

// Method dispatcher receives injected client
type MethodHandler = (client: McpClient, args: ParsedArgs, output: Output) => Promise<void>;
```

### State Machine for `--follow` Mode

```
┌──────────┐   connect    ┌───────────┐   notification   ┌──────────────┐
│  INIT    │─────────────→│ CONNECTED │────────────────→│ STREAMING    │
└──────────┘              └───────────┘                  └──────┬───────┘
                                │                               │
                                │ error/timeout                 │ signal/timeout
                                ▼                               ▼
                          ┌───────────┐                  ┌──────────────┐
                          │  ERROR    │                  │ DISCONNECTING│
                          └───────────┘                  └──────────────┘
```

In follow mode:
1. Connect and perform initial method call (if any)
2. Keep connection open
3. Print each notification as one NDJSON line to stdout
4. Handle sampling/elicitation with pre-declared templates
5. Exit on SIGINT, SIGTERM, or `--timeout` expiry

---

## Directory Structure

```
mcp-inspector-cli/
├── src/
│   ├── main.ts                        # Entry point (imperative shell)
│   ├── cli.ts                         # Argument parsing, flag definitions
│   │
│   ├── lib/                           # Functional core (pure, no side effects)
│   │   ├── args.ts                    # Argument parsing & validation
│   │   ├── args.test.ts
│   │   ├── coerce.ts                  # Type coercion from strings to schema types
│   │   ├── coerce.test.ts
│   │   ├── config.ts                  # Config file parsing
│   │   ├── config.test.ts
│   │   ├── format.ts                  # Output formatting (JSON, NDJSON)
│   │   ├── format.test.ts
│   │   ├── headers.ts                 # Header parsing
│   │   ├── headers.test.ts
│   │   ├── metadata.ts                # Metadata parsing & merging
│   │   ├── metadata.test.ts
│   │   ├── oauth-urls.ts             # OAuth URL & request body builders (pure)
│   │   ├── oauth-urls.test.ts
│   │   ├── schema.ts                  # JSON schema validation
│   │   ├── schema.test.ts
│   │   ├── types.ts                   # All type definitions
│   │   └── roots.ts                   # Roots parsing from flag values
│   │       roots.test.ts
│   │
│   ├── client/                        # Imperative shell (I/O, SDK calls)
│   │   ├── connection.ts              # Connect/disconnect lifecycle
│   │   ├── transport.ts               # Transport factory (STDIO, SSE, HTTP)
│   │   ├── methods/                   # One file per method group
│   │   │   ├── tools.ts
│   │   │   ├── resources.ts
│   │   │   ├── prompts.ts
│   │   │   ├── tasks.ts
│   │   │   ├── completions.ts
│   │   │   ├── logging.ts
│   │   │   ├── ping.ts
│   │   │   └── server-info.ts
│   │   ├── handlers/                  # Server-initiated request handlers
│   │   │   ├── sampling.ts
│   │   │   ├── elicitation.ts
│   │   │   └── roots.ts
│   │   ├── notifications.ts           # Notification listener & formatter
│   │   └── oauth.ts                   # OAuth HTTP operations
│   │
│   └── output.ts                      # Output implementation (stdout/stderr)
│
├── tests/                             # Integration tests (spawn CLI as subprocess)
│   ├── fixtures/                      # Mock MCP servers for integration tests
│   │   ├── echo-server.ts            # Returns inputs as outputs
│   │   ├── sampling-server.ts        # Sends sampling requests
│   │   ├── elicitation-server.ts     # Sends elicitation requests
│   │   ├── task-server.ts            # Long-running task server
│   │   └── notification-server.ts    # Emits notifications on connect
│   ├── tools.integration.test.ts
│   ├── resources.integration.test.ts
│   ├── prompts.integration.test.ts
│   ├── tasks.integration.test.ts
│   ├── sampling.integration.test.ts
│   ├── elicitation.integration.test.ts
│   ├── notifications.integration.test.ts
│   ├── oauth.integration.test.ts
│   └── follow-mode.integration.test.ts
│
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Key principle:** Test files for pure `lib/` functions are **co-located** (e.g., `args.test.ts` next to `args.ts`). Integration tests that spawn processes live in `tests/`.

---

## Feature Specifications

### 1. Tools

**Methods:** `tools/list`, `tools/call`

**Existing:** Yes — extract and extend from `cli/src/client/tools.ts`

**Flags:**
```
--method tools/list
--method tools/call --tool-name <name> [--tool-arg key=value...]
```

**New flags for tools/call:**
```
--run-as-task                     # Execute as async task, return task ID
--run-as-task --poll              # Execute as task, poll until terminal, print result
--poll-interval <ms>              # Polling interval (default: 1000)
--task-ttl <ms>                   # Task time-to-live hint
--progress-token <string>        # Progress token for progress notifications
--output-schema-validate          # Validate result against tool's outputSchema
```

**Type coercion:** Existing logic in `convertParameterValue()` — coerces `--tool-arg` values based on the tool's JSON schema (`number`, `integer`, `boolean`, `object`, `array`, default `string`). Extract to `src/lib/coerce.ts` as a pure function.

**Task execution flow (when `--run-as-task --poll`):**
1. Call `tools/call` with `_meta.runAsTask: { ttl: <ttl> }`
2. Receive task ID in response
3. Loop: call `tasks/get` with task ID
4. If status is terminal (`completed`, `failed`, `cancelled`): call `tasks/result`, print, exit
5. If `--timeout` exceeded: print last known status, exit code 124
6. Sleep `--poll-interval` ms, repeat step 3

**Output:**
```json
// tools/list
{ "tools": [...] }

// tools/call (direct)
{ "content": [...], "isError": false }

// tools/call --run-as-task (no --poll)
{ "taskId": "abc-123" }

// tools/call --run-as-task --poll
{ "taskId": "abc-123", "status": "completed", "result": { "content": [...] } }
```

---

### 2. Resources

**Methods:** `resources/list`, `resources/read`, `resources/templates/list`, `resources/subscribe`, `resources/unsubscribe`

**Existing:** List, read, templates — extract from `cli/src/client/resources.ts`

**Flags:**
```
--method resources/list
--method resources/read --uri <uri>
--method resources/templates/list
--method resources/subscribe --uri <uri> [--follow]
--method resources/unsubscribe --uri <uri>
```

**Subscribe + follow:** When `--follow` is combined with `resources/subscribe`:
1. Subscribe to the URI
2. Keep connection open
3. On `notifications/resources/updated` for that URI: auto-call `resources/read` and print result as NDJSON line
4. Exit on signal or `--timeout`

**Output:**
```json
// resources/list
{ "resources": [...] }

// resources/read
{ "contents": [{ "uri": "...", "text": "..." }] }

// resources/subscribe (without --follow)
{}

// resources/subscribe --follow (NDJSON stream, one line per update)
{"event":"subscribed","uri":"file:///foo"}
{"event":"updated","uri":"file:///foo","contents":[...]}
{"event":"updated","uri":"file:///foo","contents":[...]}
```

---

### 3. Prompts

**Methods:** `prompts/list`, `prompts/get`

**Existing:** Yes — extract from `cli/src/client/prompts.ts` as-is.

**Flags:**
```
--method prompts/list
--method prompts/get --prompt-name <name> [--prompt-arg key=value...]
```

**Note:** All prompt argument values are coerced to strings (MCP spec requires string values for prompt arguments).

**Output:**
```json
// prompts/list
{ "prompts": [...] }

// prompts/get
{ "messages": [...], "description": "..." }
```

---

### 4. Tasks

**Methods:** `tasks/list`, `tasks/get`, `tasks/cancel`

**Existing:** No — new implementation. Extract polling logic pattern from `App.tsx`.

**Flags:**
```
--method tasks/list
--method tasks/get --task-id <id>
--method tasks/cancel --task-id <id>
```

**Output:**
```json
// tasks/list
{ "tasks": [...] }

// tasks/get
{ "id": "abc", "status": "completed", "messages": [...] }

// tasks/cancel
{}
```

---

### 5. Completions

**Methods:** `completion/complete`

**Existing:** No — new implementation.

**Flags:**
```
--method completion/complete \
  --completion-ref <type>/<name> \
  --argument-name <name> \
  --argument-value <partial-value>
```

Where `--completion-ref` is one of:
- `ref/resource/<uri>` — completing a resource URI argument
- `ref/prompt/<name>` — completing a prompt argument

**Parsing `--completion-ref`** (pure function in `src/lib/args.ts`):
```typescript
type CompletionRef =
  | { type: "ref/resource"; uri: string }
  | { type: "ref/prompt"; name: string };

function parseCompletionRef(value: string): Result<CompletionRef, string> {
  if (value.startsWith("ref/resource/"))
    return { ok: true, value: { type: "ref/resource", uri: value.slice(13) } };
  if (value.startsWith("ref/prompt/"))
    return { ok: true, value: { type: "ref/prompt", name: value.slice(11) } };
  return { ok: false, error: `Invalid completion ref: ${value}. Must start with ref/resource/ or ref/prompt/` };
}
```

**Output:**
```json
{ "completion": { "values": ["file:///home/user/project", "file:///home/user/docs"], "hasMore": false, "total": 2 } }
```

---

### 6. Ping

**Methods:** `ping`

**Existing:** No — trivial new implementation.

**Flags:**
```
--method ping
```

**Output:**
```json
{}
```

Exit code 0 = server alive. Non-zero = unreachable.

---

### 7. Logging

**Methods:** `logging/setLevel`

**Existing:** Yes — extract from existing CLI.

**Flags:**
```
--method logging/setLevel --log-level <level>
```

Levels: `trace`, `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`

**With `--follow`:** After setting level, keep connection open and stream `notifications/message` log events as NDJSON:
```
--method logging/setLevel --log-level debug --follow
```

**Output:**
```json
// Without --follow
{}

// With --follow (NDJSON stream)
{"level":"info","logger":"server","data":"Processing request..."}
{"level":"debug","logger":"server","data":"Cache hit for resource X"}
```

---

### 8. Server Info

**Pseudo-method:** `server/info`

**Existing:** No — server info is retrieved during `initialize` but never exposed in the current CLI.

**Flags:**
```
--method server/info
```

**Implementation:** Connect, run initialize handshake (SDK does this automatically), extract server capabilities and version info, print, disconnect.

**Output:**
```json
{
  "name": "my-mcp-server",
  "version": "1.2.0",
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": { "subscribe": true, "listChanged": true },
    "prompts": { "listChanged": true },
    "logging": {},
    "tasks": {}
  },
  "protocolVersion": "2025-01-15"
}
```

---

### 9. Roots

**Client capability:** Exposes filesystem roots to the server.

**Existing:** No — extract handler registration pattern from `App.tsx` / `useConnection.ts`.

**Flags:**
```
--roots <root-spec...>
```

Where each `<root-spec>` is either:
- `<uri>` — root with no name (e.g., `file:///home/user/project`)
- `<uri>=<name>` — root with display name (e.g., `file:///home/user/project=My Project`)

**Parsing** (pure function in `src/lib/roots.ts`):
```typescript
interface Root {
  uri: string;
  name?: string;
}

function parseRootSpec(spec: string): Result<Root, string> {
  // Split on last '=' to avoid breaking URIs with '=' in query strings
  // But file:// URIs rarely have '=', so split on first '=' after the URI scheme
  const equalsIdx = spec.indexOf("=", spec.indexOf("://") + 3);
  if (equalsIdx === -1) return { ok: true, value: { uri: spec } };
  return {
    ok: true,
    value: {
      uri: spec.slice(0, equalsIdx),
      name: spec.slice(equalsIdx + 1),
    },
  };
}
```

**Behavior:**
1. During client initialization, register a `roots/list` handler that returns the parsed roots
2. After connection, send `notifications/roots/list_changed`
3. Roots are static for the lifetime of the CLI invocation

---

### 10. Sampling (Server-Initiated)

**Method:** `sampling/createMessage` (server → client)

**Existing:** No — extract handler pattern from `App.tsx`.

**Flags:**
```
--handle-sampling <json-template-or-action>
```

Where the value is one of:
- A JSON string: a complete `CreateMessageResult` template
- `reject` — reject all sampling requests with an error
- `auto` — auto-approve with minimal defaults

**Template format (JSON):**
```json
{
  "model": "claude-sonnet-4-20250514",
  "stopReason": "endTurn",
  "role": "assistant",
  "content": {
    "type": "text",
    "text": "Auto-approved by CLI"
  }
}
```

**`auto` defaults:**
```json
{
  "model": "stub-model",
  "stopReason": "endTurn",
  "role": "assistant",
  "content": {
    "type": "text",
    "text": ""
  }
}
```

**Behavior:**
- If `--handle-sampling` is not provided and the server sends a sampling request, the CLI prints the request to stderr as a warning and returns an error response to the server.
- If provided, the handler is registered during client setup. When the server sends `sampling/createMessage`, the template is returned immediately.
- In `--follow` mode, each sampling request/response pair is also printed as an NDJSON notification line:
  ```json
  {"event":"sampling","request":{...},"response":{...}}
  ```

**Parsing** (pure function in `src/lib/args.ts`):
```typescript
type SamplingAction =
  | { action: "template"; template: CreateMessageResult }
  | { action: "reject" }
  | { action: "auto" };

function parseSamplingAction(value: string): Result<SamplingAction, string> {
  if (value === "reject") return { ok: true, value: { action: "reject" } };
  if (value === "auto") return { ok: true, value: { action: "auto" } };
  try {
    const parsed = JSON.parse(value);
    // Validate required fields: model, stopReason, role, content
    if (!parsed.model || !parsed.role || !parsed.content) {
      return { ok: false, error: "Sampling template must include model, role, and content fields" };
    }
    return { ok: true, value: { action: "template", template: parsed } };
  } catch {
    return { ok: false, error: `Invalid sampling template JSON: ${value}` };
  }
}
```

---

### 11. Elicitation (Server-Initiated)

**Method:** `elicitation/create` (server → client)

**Existing:** No — extract handler pattern from `App.tsx`.

**Flags:**
```
--handle-elicitation <json-response-or-action>
```

Where the value is one of:
- A JSON string: content to return (must validate against the server's requested schema)
- `reject` — decline the elicitation
- `cancel` — cancel the elicitation
- `auto` — accept with empty content `{}`

**Behavior:**
- If `--handle-elicitation` is not provided, the CLI prints the elicitation request to stderr and returns a `decline` action.
- If provided, the handler returns the specified action/content immediately.
- In `--follow` mode, emits NDJSON notification line:
  ```json
  {"event":"elicitation","request":{...},"response":{...}}
  ```

**Parsing** (pure function in `src/lib/args.ts`):
```typescript
type ElicitationAction =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" };

function parseElicitationAction(value: string): Result<ElicitationAction, string> {
  if (value === "reject" || value === "decline")
    return { ok: true, value: { action: "decline" } };
  if (value === "cancel")
    return { ok: true, value: { action: "cancel" } };
  if (value === "auto")
    return { ok: true, value: { action: "accept", content: {} } };
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Elicitation content must be a JSON object" };
    }
    return { ok: true, value: { action: "accept", content: parsed } };
  } catch {
    return { ok: false, error: `Invalid elicitation content JSON: ${value}` };
  }
}
```

---

### 12. OAuth (Non-Interactive Steps)

**Subcommands:** `oauth/discover`, `oauth/register`, `oauth/token`, `oauth/refresh`

**Existing:** No — extract URL/request builders from `client/src/lib/auth.ts`, HTTP execution is new.

**Flags:**
```
# Discover OAuth metadata
--method oauth/discover --server-url <url>

# Register client
--method oauth/register --server-url <url> \
  --client-name <name> \
  --redirect-uri <uri>

# Exchange authorization code for token
--method oauth/token --server-url <url> \
  --oauth-code <code> \
  --oauth-code-verifier <verifier> \
  --oauth-client-id <id> \
  [--oauth-client-secret <secret>]

# Refresh token
--method oauth/refresh --server-url <url> \
  --oauth-refresh-token <token> \
  --oauth-client-id <id> \
  [--oauth-client-secret <secret>]
```

**Convenience flag for pre-obtained tokens:**
```
--token <bearer-token>
# Equivalent to: --header "Authorization: Bearer <bearer-token>"
```

**Implementation notes:**
- `oauth/*` methods do NOT use MCP transports. They are direct HTTP calls to the OAuth endpoints.
- The OAuth metadata endpoint is `<server-url>/.well-known/oauth-authorization-server`
- Registration endpoint comes from metadata `registration_endpoint`
- Token endpoint comes from metadata `token_endpoint`
- Pure functions build URLs and request bodies (`src/lib/oauth-urls.ts`)
- Imperative shell executes HTTP requests (`src/client/oauth.ts`)

**Output:**
```json
// oauth/discover
{ "issuer": "...", "authorization_endpoint": "...", "token_endpoint": "...", "registration_endpoint": "..." }

// oauth/register
{ "client_id": "...", "client_secret": "...", "redirect_uris": [...] }

// oauth/token
{ "access_token": "...", "token_type": "bearer", "expires_in": 3600, "refresh_token": "..." }

// oauth/refresh
{ "access_token": "...", "token_type": "bearer", "expires_in": 3600 }
```

---

### 13. Notifications (Follow Mode)

**Not a method — a mode.**

**Flags:**
```
--follow                          # Keep connection open, stream notifications
--follow --timeout <ms>           # Auto-disconnect after timeout
```

**`--follow` can combine with any method:**
```bash
# Set log level, then stream log notifications
--method logging/setLevel --log-level debug --follow

# List tools, then stream list-changed notifications
--method tools/list --follow

# Subscribe to resource, stream updates
--method resources/subscribe --uri file:///foo --follow

# Just connect and stream everything
--follow
```

**Behavior:**
1. Connect to server
2. Execute the specified method (if any), print result to stdout as a single JSON object
3. Separator line: empty line after initial result
4. Stream notifications as NDJSON (one JSON object per line)
5. Exit on SIGINT/SIGTERM or `--timeout`

**NDJSON notification format:**
```json
{"event":"notification","method":"notifications/tools/list_changed","params":{}}
{"event":"notification","method":"notifications/message","params":{"level":"info","data":"hello"}}
{"event":"notification","method":"notifications/resources/updated","params":{"uri":"file:///foo"}}
{"event":"notification","method":"notifications/progress","params":{"progressToken":"1","progress":50,"total":100}}
{"event":"sampling","request":{...},"response":{...}}
{"event":"elicitation","request":{...},"response":{...}}
```

---

## Transport Layer

### Transport Factory

Extract and extend from `cli/src/transport.ts`.

```typescript
interface TransportConfig {
  type: "stdio" | "sse" | "http";
  // STDIO
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // SSE / HTTP
  url?: string;
  headers?: Record<string, string>;
}

function createTransport(config: TransportConfig): Transport;
```

**Auto-detection logic** (pure function in `src/lib/args.ts`):

```typescript
function detectTransportType(target: string, explicitType?: string): "stdio" | "sse" | "http" {
  if (explicitType) return explicitType;
  if (target.startsWith("http://") || target.startsWith("https://")) {
    if (target.endsWith("/sse")) return "sse";
    return "http";  // default for URLs (StreamableHTTP)
  }
  return "stdio";   // default for commands
}
```

### Connection Lifecycle

```typescript
interface ConnectionConfig {
  transport: TransportConfig;
  roots?: Root[];
  samplingHandler?: SamplingAction;
  elicitationHandler?: ElicitationAction;
  timeout?: number;
}

// Imperative shell — wires handlers, connects, returns client
async function connect(config: ConnectionConfig): Promise<{
  client: McpClient;
  disconnect: () => Promise<void>;
}>;
```

**Implementation:**
1. Create transport from config
2. Create MCP `Client` from SDK
3. If `roots` provided: set client capability `roots: { listChanged: false }`, register `roots/list` handler
4. If `samplingHandler` provided: register `sampling/createMessage` handler
5. If `elicitationHandler` provided: register `elicitation/create` handler
6. Call `client.connect(transport)`
7. Return client + disconnect function

---

## Output Contract

### Standard Output (stdout)

**Single-method mode:** One JSON object, pretty-printed (2-space indent), followed by newline.

```json
{
  "tools": [
    { "name": "get_weather", "inputSchema": { ... } }
  ]
}
```

**Follow mode:** Initial result (if method specified) as JSON, then empty line, then NDJSON stream:

```
{ "tools": [...] }

{"event":"notification","method":"notifications/tools/list_changed","params":{}}
{"event":"notification","method":"notifications/message","params":{"level":"info","data":"..."}}
```

### Standard Error (stderr)

- Error messages (connection failures, invalid args, method errors)
- Warnings (unhandled sampling/elicitation requests when no handler configured)
- Verbose/debug output when `--verbose` flag is set

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error (invalid args, connection failure) |
| 2 | Method error (MCP server returned error response) |
| 124 | Timeout (operation exceeded `--timeout`) |

---

## Error Handling

### Result Type (functional core)

```typescript
type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Used for all parsing functions in `src/lib/`. No exceptions thrown from pure code.

### Error Categories

| Error Type | Strategy | Where |
|---|---|---|
| Invalid CLI arguments | Return `Result` with error message, print to stderr, exit 1 | `src/lib/args.ts` |
| Connection failure | Catch in imperative shell, print to stderr, exit 1 | `src/client/connection.ts` |
| MCP method error | Return error response as JSON to stdout, exit 2 | `src/client/methods/*.ts` |
| Transport timeout | Catch, print timeout message to stderr, exit 124 | `src/main.ts` |
| Unexpected/programmer error | Throw (uncaught handler logs and exits 1) | Anywhere |

### MCP Error Output

When the MCP server returns an error response, output it as structured JSON:

```json
{
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

---

## Configuration

### Config File Support

**Existing** — extract from `cli/src/cli.ts`.

```bash
--config <path> [--server <name>]
```

**Format:**
```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "..." }
    },
    "remote-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer token123"
      }
    }
  }
}
```

Config file values serve as defaults. CLI flags override them.

### Full Flag Reference

```
POSITIONAL:
  <target...>                        Command/URL of MCP server

CONNECTION:
  --transport <stdio|sse|http>       Transport type (auto-detected if omitted)
  --header <Name: Value>             HTTP header (repeatable)
  --token <bearer-token>             Shorthand for Authorization: Bearer header
  --config <path>                    Config file path
  --server <name>                    Server name from config file
  --timeout <ms>                     Operation timeout in ms (default: 30000)
  --roots <uri[=name]>               Filesystem root (repeatable)

METHOD:
  --method <method>                  MCP method to invoke (required unless --follow alone)

METHOD-SPECIFIC:
  --tool-name <name>                 Tool name (tools/call)
  --tool-arg <key=value>             Tool argument (repeatable)
  --uri <uri>                        Resource URI (resources/read, resources/subscribe)
  --prompt-name <name>               Prompt name (prompts/get)
  --prompt-arg <key=value>           Prompt argument (repeatable)
  --task-id <id>                     Task ID (tasks/get, tasks/cancel)
  --log-level <level>                Log level (logging/setLevel)
  --completion-ref <ref>             Completion reference: ref/resource/<uri> or ref/prompt/<name>
  --argument-name <name>             Argument name for completion
  --argument-value <value>           Partial value for completion
  --server-url <url>                 OAuth server URL (oauth/* methods)
  --oauth-code <code>                Authorization code (oauth/token)
  --oauth-code-verifier <verifier>   PKCE verifier (oauth/token)
  --oauth-client-id <id>             OAuth client ID (oauth/token, oauth/refresh)
  --oauth-client-secret <secret>     OAuth client secret (optional)
  --oauth-refresh-token <token>      Refresh token (oauth/refresh)
  --client-name <name>               Client name (oauth/register)
  --redirect-uri <uri>               Redirect URI (oauth/register)

EXECUTION MODE:
  --run-as-task                      Execute tool call as async task
  --poll                             Poll task until terminal state (with --run-as-task)
  --poll-interval <ms>               Task polling interval (default: 1000)
  --task-ttl <ms>                    Task TTL hint
  --progress-token <token>           Progress token for notifications
  --output-schema-validate           Validate tool output against schema

SERVER-INITIATED HANDLERS:
  --handle-sampling <json|auto|reject>        Sampling request handler
  --handle-elicitation <json|auto|reject|cancel>  Elicitation request handler

STREAMING:
  --follow                           Keep connection open, stream notifications

METADATA:
  --metadata <key=value>             Request metadata (repeatable)
  --tool-metadata <key=value>        Tool-specific metadata (repeatable)

OUTPUT:
  --verbose                          Print request/response envelopes to stderr
```

---

## Test Strategy

### Unit Tests (co-located in `src/lib/`)

Pure function tests. No mocks, no I/O. Fast.

```typescript
// src/lib/args.test.ts — test list
// - parseCompletionRef: valid resource ref
// - parseCompletionRef: valid prompt ref
// - parseCompletionRef: invalid ref returns error
// - parseSamplingAction: "reject" returns reject action
// - parseSamplingAction: "auto" returns auto action
// - parseSamplingAction: valid JSON template returns template action
// - parseSamplingAction: invalid JSON returns error
// - parseSamplingAction: JSON missing required fields returns error
// - parseElicitationAction: "reject" returns decline
// - parseElicitationAction: "cancel" returns cancel
// - parseElicitationAction: "auto" returns accept with empty content
// - parseElicitationAction: valid JSON object returns accept with content
// - parseElicitationAction: JSON array returns error
// - parseElicitationAction: invalid JSON returns error
// - detectTransportType: URL ending /mcp returns http
// - detectTransportType: URL ending /sse returns sse
// - detectTransportType: other URL returns http
// - detectTransportType: non-URL returns stdio
// - detectTransportType: explicit type overrides detection

// src/lib/coerce.test.ts — test list
// - coerces string value to number when schema type is number
// - coerces string value to integer when schema type is integer
// - coerces "true" to boolean true
// - coerces "false" to boolean false
// - parses JSON string to object when schema type is object
// - parses JSON string to array when schema type is array
// - falls back to string when JSON parse fails for object type
// - returns string as-is when schema type is string
// - returns string as-is when no schema type

// src/lib/roots.test.ts — test list
// - parses URI-only root spec
// - parses URI=name root spec
// - handles URI with port number containing no =
// - handles file URI with spaces
// - splits on first = after scheme

// src/lib/headers.test.ts — test list (existing, keep)
// src/lib/metadata.test.ts — test list (existing, keep)
// src/lib/config.test.ts — test list (extract from existing cli.test.ts)

// src/lib/schema.test.ts — test list
// - validates matching content against schema
// - returns error for type mismatch
// - validates required fields
// - handles missing outputSchema gracefully (no validation)

// src/lib/format.test.ts — test list
// - formats result as pretty JSON
// - formats NDJSON notification line (compact, no trailing newline in object)
// - formats error result with error envelope
// - handles null/undefined values

// src/lib/oauth-urls.test.ts — test list
// - builds metadata discovery URL from server URL
// - builds authorization URL with PKCE challenge
// - builds token exchange request body
// - builds refresh request body
// - builds client registration request body
// - handles trailing slashes in server URL
```

### Integration Tests (`tests/`)

Spawn CLI as child process against fixture MCP servers. Test real transport, real SDK, real I/O.

```typescript
// tests/fixtures/echo-server.ts
// A minimal MCP server that:
// - Has one tool "echo" that returns its input
// - Has one resource "test://static" with fixed content
// - Has one prompt "test-prompt" with one argument
// - Supports ping
// - Reports all capabilities

// tests/fixtures/sampling-server.ts
// A server with a tool "ask-llm" that:
// - When called, sends sampling/createMessage to client
// - Returns the sampling response as the tool result

// tests/fixtures/elicitation-server.ts
// A server with a tool "ask-user" that:
// - When called, sends elicitation/create to client
// - Returns the elicitation response as the tool result

// tests/fixtures/task-server.ts
// A server with a tool "slow-task" that:
// - Runs as async task
// - Updates progress every 100ms
// - Completes after 500ms

// tests/fixtures/notification-server.ts
// A server that:
// - Emits notifications/message every 100ms after connect
// - Emits notifications/tools/list_changed once on connect
```

**Integration test examples:**

```typescript
// tests/tools.integration.test.ts
// - lists tools from echo server
// - calls echo tool with string argument
// - calls echo tool with typed arguments (number, boolean)
// - returns error for nonexistent tool
// - validates output schema when --output-schema-validate set

// tests/sampling.integration.test.ts
// - without --handle-sampling, prints warning and returns error to server
// - with --handle-sampling auto, auto-responds to sampling request
// - with --handle-sampling <json>, returns template to server
// - with --handle-sampling reject, rejects sampling request

// tests/follow-mode.integration.test.ts
// - streams notifications as NDJSON lines
// - exits on timeout
// - prints initial method result before streaming
// - captures sampling events in follow mode
```

### TDD Commit Sequence

For each feature, follow this exact sequence:

```
1. test: add test list for <feature>
2. test(red): <first behavior> [skip ci]
3. feat(green): <minimal implementation>
4. refactor: <cleanup if needed>
5. test(red): <next behavior> [skip ci]
6. feat(green): <implementation>
   ... repeat ...
```

---

## Implementation Order

Build features in dependency order — each step produces a working, testable CLI.

### Phase 1: Foundation (extract + refactor existing)

1. **Project scaffold** — `package.json`, `tsconfig.json` (strict mode), `vitest.config.ts`
2. **`src/lib/types.ts`** — All type definitions (`Result`, `TransportConfig`, `Root`, `SamplingAction`, `ElicitationAction`, `CompletionRef`, etc.)
3. **`src/lib/args.ts`** — Argument parsing pure functions (extract `parseKeyValuePair`, `parseHeaderPair` from existing; add `parseCompletionRef`, `parseSamplingAction`, `parseElicitationAction`, `parseRootSpec`, `detectTransportType`)
4. **`src/lib/coerce.ts`** — Type coercion (extract `convertParameterValue` from existing `tools.ts`)
5. **`src/lib/headers.ts`** — Header parsing (extract from existing)
6. **`src/lib/metadata.ts`** — Metadata parsing and merging (extract from existing)
7. **`src/lib/format.ts`** — Output formatting (JSON, NDJSON, error envelopes)
8. **`src/lib/config.ts`** — Config file parsing (extract from existing `cli.ts`)
9. **`src/output.ts`** — Output implementation (stdout/stderr, injectable)

### Phase 2: Transport + Connection

10. **`src/client/transport.ts`** — Transport factory (extract + extend existing `transport.ts`)
11. **`src/client/connection.ts`** — Connection lifecycle with DI (extract + refactor existing)

### Phase 3: Existing Methods (extract + test)

12. **`src/client/methods/tools.ts`** — `tools/list`, `tools/call` (extract from existing)
13. **`src/client/methods/resources.ts`** — `resources/list`, `resources/read`, `resources/templates/list` (extract from existing)
14. **`src/client/methods/prompts.ts`** — `prompts/list`, `prompts/get` (extract from existing)
15. **`src/client/methods/logging.ts`** — `logging/setLevel` (extract from existing)

### Phase 4: New Simple Methods

16. **`src/client/methods/ping.ts`** — `ping`
17. **`src/client/methods/server-info.ts`** — `server/info` pseudo-method
18. **`src/client/methods/completions.ts`** — `completion/complete`
19. **`src/client/methods/tasks.ts`** — `tasks/list`, `tasks/get`, `tasks/cancel`

### Phase 5: Task Execution Mode

20. **Extend `tools.ts`** — `--run-as-task` flag support
21. **Task polling** — `--poll` mode with interval and timeout
22. **`src/lib/schema.ts`** — Output schema validation
23. **`--output-schema-validate` flag** — Wire validation into tools/call

### Phase 6: Server-Initiated Handlers

24. **`src/client/handlers/roots.ts`** — Roots handler registration + notification
25. **`src/client/handlers/sampling.ts`** — Sampling auto-response handler
26. **`src/client/handlers/elicitation.ts`** — Elicitation auto-response handler

### Phase 7: Follow Mode

27. **`src/client/notifications.ts`** — Notification listener and NDJSON formatter
28. **`--follow` mode** — Keep-alive, streaming, signal handling
29. **Resource subscribe + follow** — Auto-read on update notification

### Phase 8: OAuth

30. **`src/lib/oauth-urls.ts`** — Pure URL/body builders
31. **`src/client/oauth.ts`** — HTTP execution for oauth/* methods

### Phase 9: Entry Point + CLI Wiring

32. **`src/cli.ts`** — Commander flag definitions and parsing
33. **`src/main.ts`** — Entry point orchestrator (wire deps, dispatch, lifecycle)

### Phase 10: Integration Tests

34. **Test fixtures** — Mock MCP servers
35. **Integration test suite** — End-to-end CLI tests

---

## Dependencies

### Production
```json
{
  "@modelcontextprotocol/sdk": "workspace:*",
  "commander": "^13.1.0"
}
```

### Dev
```json
{
  "vitest": "^3.1.0",
  "typescript": "^5.8.0",
  "@types/node": "^22.0.0"
}
```

**Notably absent:** Express, React, Vite, Tailwind, Radix UI, any HTTP server framework. The CLI is a client only.

---

## Example Usage

```bash
# List tools from a local server
mcp-cli node server.js -- --port 3000 --method tools/list

# Call a tool with typed arguments
mcp-cli node server.js --method tools/call \
  --tool-name get_weather \
  --tool-arg city=London \
  --tool-arg units=metric

# Read a resource via StreamableHTTP
mcp-cli https://mcp.example.com/mcp --method resources/read \
  --uri "file:///data/report.csv" \
  --token "eyJhbG..."

# Get completions for a prompt argument
mcp-cli node server.js --method completion/complete \
  --completion-ref ref/prompt/summarize \
  --argument-name style \
  --argument-value "bul"

# Call a tool that triggers sampling, with auto-response
mcp-cli node agent-server.js --method tools/call \
  --tool-name ask_claude \
  --tool-arg question="What is 2+2?" \
  --handle-sampling '{"model":"claude-sonnet-4-20250514","stopReason":"endTurn","role":"assistant","content":{"type":"text","text":"4"}}'

# Execute a tool as async task, poll until done
mcp-cli node server.js --method tools/call \
  --tool-name long_analysis \
  --tool-arg dataset=sales_2024 \
  --run-as-task --poll --poll-interval 2000 --timeout 60000

# Stream all notifications
mcp-cli node server.js --follow --timeout 30000

# Set log level and stream log messages
mcp-cli node server.js --method logging/setLevel --log-level debug --follow

# Discover OAuth metadata
mcp-cli --method oauth/discover --server-url https://mcp.example.com

# Check server capabilities
mcp-cli node server.js --method server/info

# Use a config file
mcp-cli --config ~/.mcp/servers.json --server my-server --method tools/list

# Provide filesystem roots
mcp-cli node server.js --method tools/call \
  --tool-name read_file \
  --tool-arg path=/src/index.ts \
  --roots "file:///home/user/project=My Project"

# Pipe results to jq
mcp-cli node server.js --method tools/list | jq '.tools[].name'
```
