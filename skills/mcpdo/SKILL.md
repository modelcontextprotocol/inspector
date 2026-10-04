---
name: mcpdo
description: Access MCP (Model Context Protocol) servers and their tools, resources, and prompts through the mcpdo CLI — connections it holds extend your capabilities alongside any built-in MCP support. Use this skill for any question or task about MCP servers, connections, or tools (e.g. "what MCP servers am I connected to?", "what MCP tools do I have?"), and whenever a task requires inspecting, testing, or scripting against an MCP server (stdio or HTTP) rather than writing custom client code.
disable-model-invocation: false
---

# mcpdo — MCP Inspector connection CLI

Connect to an MCP server once, then run many commands against that named
connection.

```bash
mcpdo servers/list                           # catalog entries you can connect
mcpdo connect entry-name                     # connect a catalog entry
mcpdo connect https://example.com/mcp        # ad-hoc HTTP/SSE target
mcpdo connect node server.js                 # ad-hoc stdio target

mcpdo connections/list                       # open connections
mcpdo @entry-name tools/list
mcpdo @entry-name tools/call <toolName> arg:=value
mcpdo @entry-name resources/list
mcpdo @entry-name resources/read <uri>
mcpdo @entry-name prompts/list

mcpdo --connection entry-name tools/list     # flag form of @entry-name

mcpdo disconnect entry-name
```

The canonical flow is `servers/list` → `connect <entry>` → `@entry <command>`.
Run `mcpdo help` or `mcpdo <command> --help` for the full, authoritative list of
commands and flags (auth management, elicitation controls, daemon control, and
more).

## How to think about mcpdo

- **Connections extend your toolset.** Treat every open connection's tools,
  resources, and prompts as part of your available capabilities: when facing a
  task (or before saying "I can't do that"), check `mcpdo connections/list`
  and the connected servers' `tools/list`, and call those tools mid-task like
  any built-in tool.
- **Answer capability questions with it.** "What MCP servers/tools do I have?"
  includes mcpdo connections (`connections/list`) and catalog entries that are
  connectable but not connected (`servers/list`).
- **Don't auto-connect.** Catalog entries don't describe capabilities, and
  connecting can start an auth flow involving the human. Connect when the user
  directs it, or when a task clearly needs it — and say so first.
- **Inspect via commands, not the filesystem.** Entries, connections, auth
  state, and daemon state all have read commands; never list or read
  `~/.mcp-inspector` directly. The one exception is _editing_ the catalog
  (below).
- **Make it always-on (optional).** Skills load only on demand; for standing
  awareness of mcpdo in a project, append `mcpdo agent-help --instructions`
  output to the project's `CLAUDE.md`/`AGENTS.md`. (`mcpdo agent-help`
  prints this guide; `--skill-path` prints the installable skill file's
  path.)

## The catalog

- `servers/list` / `servers/show <name>` read the **catalog**: the writable
  entry file at `~/.mcp-inspector/mcp.json` (standard `mcpServers` shape),
  overridable per shell via `--catalog <path>` or `MCP_CATALOG_PATH`.
  `servers/list` prints the resolved source path.
- `servers/*` shows entries on disk; `connections/*` shows live daemon state.
  Two shells with different catalogs share the same connections.
- There are no CLI edit commands, by design: add or remove entries by editing
  the catalog file directly. `mcpdo connect entry --config path/to/mcp.json`
  instead connects an entry from a read-only foreign config file.

## Conventions

- `--format json` outputs JSON; the default, `--format text`, is
  human-readable.
- Always qualify commands with `@name` or `--connection <name>` (shorthand
  `--conn`) from an agent shell: with non-interactive (non-TTY) stdin, mcpdo
  requires an explicit connection and errors without one. Omitting it falls
  back to the most-recently-used connection only on an interactive TTY, or
  anywhere when `MCP_ALLOW_DEFAULT_CONNECTION=1` is set.
- Connections persist across separate `mcpdo` invocations and **self-heal**: a
  dropped transport (expired session, exited stdio child) transparently
  re-dials on next use with stored credentials. Don't monitor or reconnect
  manually; only an `auth_required` error needs action (re-run `connect`).
  `mcpdo disconnect` ends one connection; `mcpdo daemon stop` resets
  everything.
- The `[legacy]` / `[modern]` era tag on `connections/list` is the negotiated
  protocol generation (`legacy` = classic `initialize` handshake — current and
  fine, not deprecated). Informational only.

## Auth

- Auth is automatic at connect time and stored for reuse (`mcpdo auth/list` /
  `mcpdo auth/clear`). When a browser sign-in is needed and stdin is non-TTY,
  `connect` exits 0 immediately with `pendingAuth: true` and an `authUrl`:
  relay that URL to the user verbatim, then finish the job — the connection
  completes automatically once they sign in, which often takes only moments.
  Retry the intended command (sleep a few seconds between attempts) and only
  hand back to the user if sign-in still hasn't completed after a few tries.
  To check progress without running the real command:
  `connections/show @name` completes a finished sign-in itself, and
  `connections/list` stays read-only but reports `pendingAuthSignedIn: true`
  ("signed in — completing on next use") once the user's part is done.
  Never reconnect to fix a pending sign-in.
- Enterprise-managed auth (EMA) works the same way. `mcpdo auth/ema-login`
  from a non-TTY shell exits 0 immediately with `pendingLogin: true` and an
  `authUrl`: relay that URL to the user verbatim, then poll
  `mcpdo auth/ema-status` until `loginState` is `logged_in` — the sign-in
  completes in the background. After that, connects to EMA servers mint
  tokens silently with no further sign-in. Connecting to an EMA server
  *without* a prior IdP login parks like any other pending sign-in, with the
  IdP link as its `authUrl`. `mcpdo auth/ema-logout` clears local EMA state
  only; when the IdP advertises an end-session endpoint the output includes a
  URL to end the IdP browser session too — relay it to the user, who may
  ignore it if they only meant to reset local state.

## Elicitations (server asks a question mid-call)

- On an interactive TTY, mcpdo prompts inline. From an agent shell (non-TTY or
  `--format json`), the **command returns immediately** (exit 0) with an
  `elicitationPending` payload carrying the question, schema, and an
  `elicitationId`; the underlying MCP **tool call stays parked** on the daemon
  awaiting your response. Never wait on or time-box the mcpdo command itself —
  it has already exited; the pending work lives daemon-side.
- Answer with `mcpdo elicitation/respond <elicitationId> field:=value ...`
  (repeat if the server asks again), or end it with `--decline` or `--cancel`.
  For URL-mode elicitations, relay the URL to the user, then confirm with
  `elicitation/respond <id> --done` (or `--cancel`; URL mode has no decline).
  The response returns the
  final tool result.
- Parked calls expire after 10 minutes; one parked call per connection. Pass
  `--elicit off` on `connect` to have well-behaved servers fall back to their
  own defaults instead of asking.
