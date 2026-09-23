# Inspector CLI v2 (connection-oriented)

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [CLI, TUI, Launcher](v2_cli_tui_launcher.md) | CLI v2 | [Catalog / launch config](v2_catalog_launch_config.md)

Documentation of the **experimental** connection-oriented Inspector CLI (`mcpdo`) and how it relates to the frozen one-shot path (`mcp-inspector --cli`). Tracked by [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432). `mcpdo` is a separate client under `clients/daemon-cli/`, shipped as the `mcpdo` bin in `@modelcontextprotocol/inspector` (experimental).

**Related:** [CLI, TUI, and Launcher](v2_cli_tui_launcher.md), [Catalog and Launch Configuration](v2_catalog_launch_config.md), [Storage](v2_storage.md), [Auth](v2_auth.md), [`clients/daemon-cli/README.md`](../clients/daemon-cli/README.md), [`clients/cli/README.md`](../clients/cli/README.md) (one-shot).

---

## Overview

| | **One-shot** | **Connection** |
| --- | --- | --- |
| Entrypoint | `mcp-inspector --cli` | `mcpdo` |
| Lifecycle | Connect → one `--method` → disconnect | Connect once → many subcommands → disconnect |
| Process | In-process only | Short-lived front-end + implicit connection daemon (IPC) |
| Package | `clients/cli` (ships with `@modelcontextprotocol/inspector`) | `clients/daemon-cli` (experimental; ships the `mcpdo` bin with `@modelcontextprotocol/inspector`) |

Both use `@inspector/core` `InspectorClient` and shared `clients/cli/src/handlers/run-method.ts` (mcpdo reaches in via a temporary `@inspector/cli` build alias). One-shot never starts the daemon. `mcpdo` does not accept `--method`.

```bash
mcpdo servers/list --config mcp.json
mcpdo servers/show my-server --config mcp.json
mcpdo connect myserver --config mcp.json
mcpdo tools/list
mcpdo tools/call search query:=hello
mcpdo @other resources/list
mcpdo disconnect
```

Optional private daemon for one shell (`ssh-agent` style):

```bash
eval "$(mcpdo private)"
mcpdo connect myserver --config mcp.json
mcpdo tools/list
```

---

## As-built

### Entrypoints and layout

| Piece | Location |
| --- | --- |
| One-shot | `clients/cli/src/cli.ts`, `cliOAuth.ts`, `index.ts` |
| Connection front-end | `clients/daemon-cli/src/connection/` (`mcp.ts`, `dispatch.ts`, `authorize.ts`, `format-*.ts`, `private-env.ts`) + `mcp-bin.ts` |
| Daemon | `clients/daemon-cli/src/daemon/` → `clients/daemon-cli/build/daemon.js` |
| Shared handlers | `clients/cli/src/handlers/` (`run-method.ts`, `method-types.ts`, `servers-list.ts`, `emit-result.ts`, …) |

```
mcp-inspector --cli …          mcpdo …
        │                        │
        ▼                        ▼
  clients/cli              clients/daemon-cli
     cli.ts                 connection/mcp.ts
        │                        │ NDJSON IPC
        │                   daemon (build/daemon.js)
        └──────────┬─────────────┘
                   ▼
    clients/cli handlers/run-method.ts → InspectorClient
```

### One-shot (`mcp-inspector --cli`)

Frozen automation contract. Each invocation: resolve server → connect → `runMethod` → print → disconnect. Never uses the connection daemon.

| `--method` | Notes |
| --- | --- |
| `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel` | Core one-shot surface (`ONE_SHOT_METHODS`) |
| `servers/list`, `servers/show` | Catalog only (no MCP connect); `servers/show` needs `--server` |

Anything else (e.g. `logging/tail`, `resources/subscribe`, `tasks/*`, `roots/*`) is a **usage error before connect** — one-shot must not hang on stream outcomes.

**Output:** `--format text` = pretty JSON of bare result; `json` = `{ result[, appInfo] }` envelope. Exit codes `0`–`5` + stderr `ErrorEnvelope`.

**Auth:** Interactive OAuth + mid-session recovery in-process (`cliOAuth.ts`); `--stored-auth-only`, `--use-stored-auth`, handoff flags. See [clients/cli/README.md](../clients/cli/README.md).

### Connection CLI (`mcpdo`)

#### Commands

| Category | Commands |
| --- | --- |
| Catalog | `servers/list`, `servers/show <name>` |
| Connection | `connect` (`--relogin`), `disconnect`, `connections/list`, `connections/use` |
| Auth store | `auth/list`, `auth/clear` / `auth/clear --all` |
| Daemon | `private`, `daemon status`, `daemon stop` |
| MCP | `initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, `logging/setLevel`, `logging/tail`, `tasks/*`, `roots/list`, `roots/set` |

**Globals (before subcommand):** `--format text|json`, `--plain`, `--connection <name>`, `--catalog` / `--config`, `--stored-auth-only`.

**Connection select:** leading `@name` and/or `--connection <name>`. Tool args: `key:=value`, inline JSON, or `--tool-arg` / `--tool-args-json`.

**Connect forms:** catalog entry / `--server` / ad-hoc URL or command; optional `@name` to override connection name (default = entry id).

#### Output

| Flag | Behaviour |
| --- | --- |
| `--format text` (default) | Human-readable. On a TTY: ANSI color / bold / dim / OSC 8 links unless `--plain` or `NO_COLOR`. |
| `--format json` | Pretty-printed payload (**no** `{ result }` envelope; never ANSI). |
| Streams | Long-lived until Ctrl-C; human lines or pretty JSON events per `--format`. |

#### Default connection (MRU)

- Omit `@name` / `--connection` → MRU (TTY).
- Explicit `@name` / `--connection` always wins.
- Non-TTY: require explicit connection unless `MCP_ALLOW_DEFAULT_CONNECTION=1`.
- `connections/list`, `connections/use <name>`; `daemon status` / `connections/list` do **not** auto-spawn the daemon.

#### Daemon

**IPC ops:** `ping`, `connect`, `disconnect`, `connections/list`, `connections/use`, `daemon/status`, `daemon/stop`, `rpc`, `stream`.

- One `InspectorClient` per named connection; auto-spawn on first need; idle exit ~60s after last disconnect **or** after a connection-less spawn with no successful connect; `daemon stop` tears down immediately.
- Socket/lock mode `0600` (best-effort). Config (incl. secrets) over IPC after listen — not on daemon argv.
- Errors that are not already `CliExitCodeError` go through `classifyError` (exit-code parity with one-shot).

| Context | Path |
| --- | --- |
| Shared default | `~/.mcp-inspector/daemon.sock` (+ `daemon.lock`, `daemon.token`, `daemon.log`) |
| `MCP_STORAGE_DIR` | Socket/lock under that dir (CI isolation; same family as `oauth.json`) |
| `MCP_INSPECTOR_DAEMON_DIR` | Wins over storage dir when set (spawn pin / private) |
| Private | `$TMPDIR/mcp-conn-<uid>/<id>/` (0700, short id — `sun_path` caps socket paths at 104 bytes on macOS) from `mcpdo private` |

| Mode | Trust |
| --- | --- |
| **Shared (default)** | Auto-generated token, published to `daemon.token` (0600) in the daemon dir (0700). Same-UID peer that can read the dir can drive connections (intentional cross-terminal share); there is no unauthenticated request path. |
| **Private** | `eval "$(mcpdo private)"` exports `MCP_INSPECTOR_DAEMON_DIR` + `MCP_INSPECTOR_DAEMON_TOKEN`. Daemon requires the token on every request. OAuth store remains shared unless the user also sets `MCP_STORAGE_DIR`. Daemon starts lazily on first IPC. |

#### Auth (connection)

- Same `oauth.json` store as other Inspector clients.
- **Connect-time:** daemon connect → on `auth_required`, front-end `authorizeInFrontend()` (unless `--stored-auth-only`) → retry connect.
- **`--relogin`:** clear any stored OAuth for the server URL before connect; interactive login still runs only if auth is required afterward. No-op for stdio / targets with no URL-keyed store entry (do not reject — same semantics, nothing to clear).
- **Mid-session** step-up during `rpc` / `stream`: **not implemented** (see To-do). Use one-shot, or disconnect / re-auth / reconnect.
- Connection `connect` does not expose one-shot OAuth flags (`--client-id`, `--callback-url`, …); env / defaults / `MCP_OAUTH_CALLBACK_URL` only.

#### One-shot ↔ connection mapping

| One-shot | Connection |
| --- | --- |
| `… --catalog mcp.json --server s --method tools/list` | `mcpdo connect --catalog mcp.json s` then `mcpdo tools/list` |
| `… --method tools/call --tool-name X --tool-args-json '…'` | `mcpdo tools/call X key:=val` / `'{"…"}'` |
| `… --method servers/list` | `mcpdo servers/list` |
| `… --method servers/show --server <name>` | `mcpdo servers/show <name>` |

### Testing

| Client | Runner | Coverage |
| --- | --- | --- |
| One-shot (`clients/cli`) | In-process `runCli()`; thin binary e2e | Per-file ≥90 on `clients/cli/src`. Exclusion: `src/index.ts`. |
| Connection CLI (`clients/daemon-cli`) | In-process `runMcp()`; daemon IPC + stream + private-token tests | Per-file ≥90 on `clients/daemon-cli/src`. Exclusions: `mcp-bin.ts`, `daemon/run.ts` (bootstraps only). |

Both are wired into root `validate` / `coverage`.

---

## To-do

| Item | Notes |
| --- | --- |
| **Mid-session auth over IPC** | Challenge + step-up UX on the invoking `mcpdo` during `rpc`/`stream`. Connect-time only today. |
| **Windows daemon transport** | Unix-domain sockets only; named pipes on `win32` when needed. |
| **Per-socket request serialization** | Requests on one connection are handled as lines arrive (single line capped at 1 MiB); safe while clients use one request per connection. |
| **Per-connection RPC mutex** | Parallel `mcpdo` processes against one connection can interleave on one `InspectorClient`. |
| **`streamDaemon` post-open errors** | Socket errors after the initial ok frame are treated as soft end. |
| **Shared `createCliInspectorClient`** | Daemon / authorize / one-shot construct clients separately. |
| **Split `registerRpcCommands`** | Large Commander switch in `connection/mcp.ts`. |
| **`mcpdo daemon run`** | Optional foreground debug (not a Commander subcommand; `build/daemon.js` works today). |
| **Launcher help polish** | Make `mcpdo` vs `--cli` unmistakable in launcher `--help` / docs. |
| **Connection `connect` OAuth flag parity** | One-shot has `--client-id` / `--callback-url` / handoff; connection authorize uses defaults / env only. |
| **Peer-cred / stronger private IPC** | Private mode uses bearer token; optional OS peer checks beyond that. |
| **Stream fan-out / `mcpdo attach`** | One consumer per stream invocation today. |
| **Sampling CLI** | Still TUI/web. mcpdo handles server-driven *elicitation* (URL + form modes, `--elicit` capability override) since #1783; sampling remains unimplemented. Decision: only `--format json` auto-declines elicitation; any other caller — including a non-TTY agent — is prompted and may answer form-mode questions on the user's behalf. URL mode never auto-accepts: completion is only confirmed by an explicit answer. |
| **Ephemeral no-`connect` shortcuts on `mcpdo`** | Out of scope (keep two mental models). |
| **`MCP_SESSION` env** | Superseded by require-explicit-on-non-TTY + `MCP_ALLOW_DEFAULT_CONNECTION=1`. |
| **Human `--full` schema dumps** | Optional formatter polish. |
