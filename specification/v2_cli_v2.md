# Inspector CLI v2 (session-oriented)

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | [V2 UX](v2_ux.md) | [V2 Auth](v2_auth.md) | [V2 New Spec Impact](v2_new_spec_impact.md)

#### [CLI, TUI, Launcher](v2_cli_tui_launcher.md) | CLI v2 | [Catalog / launch config](v2_catalog_launch_config.md)

Documentation of the session-oriented Inspector CLI (`mcp`) and how it relates to the frozen one-shot path (`mcp-inspector --cli`). Tracked by [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432).

**Related:** [CLI, TUI, and Launcher](v2_cli_tui_launcher.md), [Catalog and Launch Configuration](v2_catalog_launch_config.md), [Storage](v2_storage.md), [Auth](v2_auth.md), [`clients/cli/README.md`](../clients/cli/README.md) (end-user reference).

---

## Overview

| | **One-shot** | **Session** |
| --- | --- | --- |
| Entrypoint | `mcp-inspector --cli` | `mcp` |
| Lifecycle | Connect → one `--method` → disconnect | Connect once → many subcommands → disconnect |
| Process | In-process only | Short-lived front-end + implicit session daemon (IPC) |
| Package | `clients/cli` (shared with session) | Same; root `bin.mcp` → `clients/cli/build/mcp-bin.js` |

Both use `@inspector/core` `InspectorClient` and shared `handlers/run-method.ts`. One-shot never starts the daemon. `mcp` does not accept `--method`.

```bash
mcp servers/list --config mcp.json
mcp servers/show my-server --config mcp.json
mcp connect myserver --config mcp.json
mcp tools/list
mcp tools/call search query:=hello
mcp @other resources/list
mcp disconnect
```

Optional private daemon for one shell (`ssh-agent` style):

```bash
eval "$(mcp private)"
mcp connect myserver --config mcp.json
mcp tools/list
```

---

## As-built

### Entrypoints and layout

| Piece | Location |
| --- | --- |
| One-shot | `clients/cli/src/cli.ts`, `cliOAuth.ts`, `index.ts` |
| Session front-end | `clients/cli/src/session/` (`mcp.ts`, `dispatch.ts`, `authorize.ts`, `format-*.ts`, `private-env.ts`, `mcp-bin.ts`) |
| Daemon | `clients/cli/src/daemon/` |
| Shared handlers | `clients/cli/src/handlers/` (`run-method.ts`, `method-types.ts`, `servers-list.ts`, `emit-result.ts`, …) |

```
mcp-inspector --cli …          mcp …
        │                        │
        ▼                        ▼
     cli.ts                 session/mcp.ts
        │                        │ NDJSON IPC
        │                   daemon (build/daemon.js)
        └──────────┬─────────────┘
                   ▼
         handlers/run-method.ts → InspectorClient
```

### One-shot (`mcp-inspector --cli`)

Frozen automation contract. Each invocation: resolve server → connect → `runMethod` → print → disconnect. Never uses the session daemon.

| `--method` | Notes |
| --- | --- |
| `initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/list`, `prompts/get`, `logging/setLevel` | Core one-shot surface |
| `servers/list`, `servers/show` | Catalog only (no MCP connect); `servers/show` needs `--server` |

**Output:** `--format text` = pretty JSON of bare result; `json` = `{ result[, appInfo] }` envelope. Exit codes `0`–`5` + stderr `ErrorEnvelope`.

**Auth:** Interactive OAuth + mid-session recovery in-process (`cliOAuth.ts`); `--stored-auth-only`, `--use-stored-auth`, handoff flags. See [clients/cli/README.md](../clients/cli/README.md).

### Session CLI (`mcp`)

#### Commands

| Category | Commands |
| --- | --- |
| Catalog | `servers/list`, `servers/show <name>` |
| Session | `connect` (`--relogin`), `disconnect`, `sessions/list`, `sessions/use` |
| Auth store | `auth/list`, `auth/clear` / `auth/clear --all` |
| Daemon | `private`, `daemon status`, `daemon stop` |
| MCP | `initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, `logging/setLevel`, `logging/tail`, `tasks/*`, `roots/list`, `roots/set` |

**Globals (before subcommand):** `--format text|json`, `--plain`, `--session <name>`, `--catalog` / `--config`, `--stored-auth-only`.

**Session select:** leading `@name` and/or `--session <name>`. Tool args: `key:=value`, inline JSON, or `--tool-arg` / `--tool-args-json`.

**Connect forms:** catalog entry / `--server` / ad-hoc URL or command; optional `@name` to override session name (default = entry id).

#### Output

| Flag | Behaviour |
| --- | --- |
| `--format text` (default) | Human-readable. On a TTY: ANSI color / bold / dim / OSC 8 links unless `--plain` or `NO_COLOR`. |
| `--format json` | Pretty-printed payload (**no** `{ result }` envelope; never ANSI). |
| Streams | Long-lived until Ctrl-C; human lines or pretty JSON events per `--format`. |

#### Default session (MRU)

- Omit `@name` / `--session` → MRU (TTY).
- Explicit `@name` / `--session` always wins.
- Non-TTY: require explicit session unless `MCP_ALLOW_DEFAULT_SESSION=1`.
- `sessions/list`, `sessions/use <name>`; `daemon status` / `sessions/list` do **not** auto-spawn the daemon.

#### Daemon

**IPC ops:** `ping`, `connect`, `disconnect`, `sessions/list`, `sessions/use`, `daemon/status`, `daemon/stop`, `rpc`, `stream`.

- One `InspectorClient` per named session; auto-spawn on first need; idle exit ~60s after last disconnect; `daemon stop` tears down immediately.
- Socket/lock mode `0600` (best-effort). Config (incl. secrets) over IPC after listen — not on daemon argv.
- Errors that are not already `CliExitCodeError` go through `classifyError` (exit-code parity with one-shot).

| Context | Path |
| --- | --- |
| Shared default | `~/.mcp-inspector/daemon.sock` (+ lock) |
| `MCP_STORAGE_DIR` | Socket/lock under that dir (CI isolation; same family as `oauth.json`) |
| `MCP_INSPECTOR_DAEMON_DIR` | Wins over storage dir when set (spawn pin / private) |
| Private | `~/.mcp-inspector/private/<uuid>/` from `mcp private` |

| Mode | Trust |
| --- | --- |
| **Shared (default)** | No token. Same-UID peer that can open the socket can drive sessions (intentional cross-terminal share). |
| **Private** | `eval "$(mcp private)"` exports `MCP_INSPECTOR_DAEMON_DIR` + `MCP_INSPECTOR_DAEMON_TOKEN`. Daemon requires the token on every request. OAuth store remains shared unless the user also sets `MCP_STORAGE_DIR`. Daemon starts lazily on first IPC. |

#### Auth (session)

- Same `oauth.json` store as other Inspector clients.
- **Connect-time:** daemon connect → on `auth_required`, front-end `authorizeInFrontend()` (unless `--stored-auth-only`) → retry connect.
- **Mid-session** step-up during `rpc` / `stream`: **not implemented** (see To-do). Use one-shot, or disconnect / re-auth / reconnect.
- Session `connect` does not expose one-shot OAuth flags (`--client-id`, `--callback-url`, …); env / defaults / `MCP_OAUTH_CALLBACK_URL` only.

#### One-shot ↔ session mapping

| One-shot | Session |
| --- | --- |
| `… --catalog mcp.json --server s --method tools/list` | `mcp connect --catalog mcp.json s` then `mcp tools/list` |
| `… --method tools/call --tool-name X --tool-args-json '…'` | `mcp tools/call X key:=val` / `'{"…"}'` |
| `… --method servers/list` | `mcp servers/list` |
| `… --method servers/show --server <name>` | `mcp servers/show <name>` |

### Testing

- In-process `runCli()` / `runMcp()`; daemon IPC + stream + private-token tests; thin binary e2e.
- Per-file ≥90 coverage on measured `clients/cli/src`.
- Exclusions: `index.ts`, `mcp-bin.ts`, `daemon/run.ts`, `ipc-glue.ts`, `stream-client.ts`. `session/mcp.ts` is gated.

---

## To-do

| Item | Notes |
| --- | --- |
| **Mid-session auth over IPC** | Challenge + step-up UX on the invoking `mcp` during `rpc`/`stream`. Connect-time only today. |
| **Daemon singleton / exclusive lock** | `daemon.lock` writes a PID but does not enforce exclusive spawn or stale-PID reclaim. Concurrent `ensureDaemon` can race. |
| **Windows daemon transport** | Unix-domain sockets only; named pipes on `win32` when needed. |
| **Per-socket request serialization** | Accept handler is unbounded per NDJSON line; safe while clients use one request per connection. |
| **Per-session RPC mutex** | Parallel `mcp` processes against one session can interleave on one `InspectorClient`. |
| **`streamDaemon` post-open errors** | Socket errors after the initial ok frame are treated as soft end. |
| **Coverage gate for `ipc-glue` / `stream-client`** | Behavioral tests exist; files excluded until the race matrix is stably ≥90. |
| **Shared `createCliInspectorClient`** | Daemon / authorize / one-shot construct clients separately. |
| **Split `registerRpcCommands`** | Large Commander switch in `session/mcp.ts`. |
| **`mcp daemon run`** | Optional foreground debug (not a Commander subcommand; `build/daemon.js` works today). |
| **Launcher help polish** | Make `mcp` vs `--cli` unmistakable in launcher `--help` / docs. |
| **Session `connect` OAuth flag parity** | One-shot has `--client-id` / `--callback-url` / handoff; session authorize uses defaults / env only. |
| **Peer-cred / stronger private IPC** | Private mode uses bearer token; optional OS peer checks beyond that. |
| **Stream fan-out / `mcp attach`** | One consumer per stream invocation today. |
| **Sampling / elicitation CLI** | Still TUI/web. |
| **Ephemeral no-`connect` shortcuts on `mcp`** | Out of scope (keep two mental models). |
| **`MCP_SESSION` env** | Superseded by require-explicit-on-non-TTY + `MCP_ALLOW_DEFAULT_SESSION=1`. |
| **Human `--full` schema dumps** | Optional formatter polish. |
