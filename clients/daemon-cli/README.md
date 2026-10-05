# MCP Inspector connection CLI (`mcpdo`)

**Experimental** separate client — **bundled into the published `@modelcontextprotocol/inspector` package** as the `mcpdo` bin. Connect once, then run many MCP commands against a named connection via an implicit local daemon (ssh-agent style).

> **Layout note:** Source lives in `clients/daemon-cli/`. At build time it bundles some modules from `clients/cli/src` (`handlers/`, `error-handler`, OAuth helpers) via the `@inspector/cli` alias. That reach-in is intentional and temporary — not a published library API — until a cleaner shared package exists (tracked by [#2461](https://github.com/modelcontextprotocol/inspector/issues/2461)).

## Install

`mcpdo` ships with the published package:

```bash
npm install -g @modelcontextprotocol/inspector
mcpdo --help
```

## Install / run (from this repo)

Build, then put `mcpdo` on your PATH with `npm link` (points at this package’s `build/mcp-bin.js`):

```bash
# from the repo root — install deps once if needed
npm install

cd clients/daemon-cli
npm run build
npm link

mcpdo --help
```

Rebuild after pulling source changes (`npm run build` in `clients/daemon-cli`). You usually do **not** need to re-link unless the package `bin` entry changes.

### Development loop

`mcpdo` itself is a short-lived process re-executed on every invocation, so a
plain rebuild is enough for its changes to take effect on the next command.
The **connection daemon** (`build/daemon.js`) is different: `ensureDaemon` (see
`src/daemon/ensure.ts`) reuses an already-running daemon without checking its
code version, so a daemon started before your rebuild keeps running stale
code indefinitely.

Use `npm run build:dev` instead of `npm run build` while iterating: it runs
`mcpdo daemon stop` first (harmless/no-op if no daemon is running — it treats
"daemon not running" as success) and then `tsup`, so the next daemon-backed
command (`connect`, `tools/list`, …) spawns a fresh daemon from the code you
just built. Commands that never touch the daemon (`servers/list`,
`servers/show`, `--help`) don't need this — a plain `npm run build` is enough
for those.

Without linking, run the built file directly:

```bash
node clients/daemon-cli/build/mcp-bin.js --help
```

Remove the link when you’re done:

```bash
npm unlink -g @modelcontextprotocol/daemon-cli
```

## Usage

```bash
mcpdo servers/list --config path/to/mcp.json
mcpdo servers/show test-stdio --config path/to/mcp.json
mcpdo connect test-stdio --config path/to/mcp.json
mcpdo connect my-http --config path/to/mcp.json --relogin   # ignore stored OAuth; login only if auth required
mcpdo auth/list
mcpdo auth/clear https://example.com/mcp
mcpdo auth/clear --all --yes
mcpdo tools/list
mcpdo tools/call echo message:=hi
mcpdo tools/call echo '{"message":"hi"}'
mcpdo @test-stdio resources/list
mcpdo logging/tail                        # long-lived; Ctrl-C to stop
mcpdo connections/list
mcpdo disconnect --connection test-stdio
mcpdo daemon status
mcpdo daemon stop

# Optional: private daemon for this shell only
eval "$(mcpdo private)"
mcpdo connect test-stdio --config path/to/mcp.json
mcpdo tools/list
```

**Private mode:** `eval "$(mcpdo private)"` gives the shell its own daemon and
bearer token, separating its connections and daemon state from other mcpdo
daemons. It is not a security boundary against other processes running as your
user: anything with the same UID that learns the daemon directory can read the
token. For a hard boundary, use OS-level isolation (separate user, container).

**Globals (before subcommand):** `--format text|json`, `--plain`, `--connection <name>` (shorthand: `--conn`), `--catalog` / `--config`, `--stored-auth-only`.

**Output:** `--format text` (default) is human-readable (TTY ANSI unless `--plain` / `NO_COLOR`). `--format json` is pretty-printed payload with **no** `{ result }` envelope.

**Auth:** shared `oauth.json` with other Inspector clients. Connect-time OAuth only on this CLI; mid-connection step-up remains on one-shot `mcp-inspector --cli`. `--relogin` clears any URL-keyed store entry before connect (no-op for stdio). Non-TTY `connect` exits 0 with `pendingAuth: true` and an `authUrl` to relay; after the user signs in, any real command completes the connection, `connections/show` completes it too, and `connections/list` marks the entry `pendingAuthSignedIn` ("signed in — completing on next use") without dialing.

See [`specification/v2_cli_v2.md`](../../specification/v2_cli_v2.md) for the as-built design and to-do list.

## Isolating untrusted stdio servers

The daemon's token controls **who can command the daemon**, not **what a
spawned server can do**: a stdio MCP server runs with your full user
privileges, like in any MCP host. To isolate a server you don't fully trust,
wrap the stdio command in a container — this works today with no mcpdo
support:

```bash
mcpdo connect -- docker run -i --rm --network none -v "$PWD:/work:ro" <server-image>
```

Tighten or loosen the flags per server (drop `--network none` if it needs
egress; adjust the mount to what it should see). HTTP/SSE targets run no
local code, so they need no process isolation.

## Protocol era support

mcpdo shares `core`'s `InspectorClient`, so it negotiates whichever era
(`legacy` 2025-03-26-style vs. `modern`/2026-era, e.g. task-augmented calls,
`server/discover`) the target actually speaks — no extra flags needed for
that to work. Two things are mcpdo-specific:

- **`--era <era>` on `connect`**: `legacy` (default), `auto` (probe via
  `server/discover` before connecting), or `modern`. Overrides whatever a
  catalog/config entry's `protocolEra` says, and is the only way to set it
  for an ad-hoc target (no config entry to read one from).

  ```bash
  mcpdo connect my-modern-server --config path/to/mcp.json --era modern
  mcpdo connect https://example.com/mcp --era auto
  ```

- **Era visibility in connection output**: `connections/list`, `connections/use`, and
  `connect` all show the negotiated era inline (`@name (MRU) — server
[modern]`). `connections/show <name>` gives the full picture — era, negotiated
  protocol version, server info, capabilities, and (when the connect probed
  `server/discover`) the server's supported-versions list:

  ```
  $ mcpdo connections/show my-modern-server
  Connection: my-modern-server
  Server: https://example.com/mcp
  Era: modern (2026-06-18)
  Supported versions: 2025-03-26, 2026-06-18
  ...
  ```

A modern (SEP-2663) task that reaches `status: "input_required"` is **not**
resumed with `tasks/update` from mcpdo. Core polls the task to a terminal
state, so the input round surfaces as an **elicitation** instead — prompted
inline on an interactive TTY, or **parked** (the RPC returns an
`elicitationPending` payload) otherwise. Answer it with `elicitation/respond`,
exactly like any other parked elicitation (see [Elicitation
support](#elicitation-support) below):

```bash
mcpdo elicitation/respond <elicitationId> approved:=true
```

The `elicitationPending` payload carries no `taskId`, and `tasks/list` is
refused while a call is parked, so there is no task id to pass to
`tasks/update` — `elicitation/respond` is the only path that works.

## Elicitation support

mcpdo can prompt interactively for every elicitation delivery mechanism —
legacy server→client `elicitation/create` requests, modern non-task MRTR
(multi-round tool response) rounds, and modern SEP-2663 **task** input rounds
(a task that reaches `status: "input_required"`) — and both modes a server may
ask for:

- **URL mode**: mcpdo prints the URL and waits for you to confirm you've
  finished out-of-band (there's no "decline", only accept-that-you-finished
  or cancel — the actual completion can't be observed locally).
- **Form mode**: mcpdo renders one prompt per field from the schema, with a
  review step (edit any field again, or submit) before answering.

Interactive callers (`--format text` on a TTY) get these prompts inline.
Non-interactive callers — `--format json`, or no TTY at all — don't get a
prompt: the daemon **parks** the elicitation and the RPC returns an
`elicitationPending` payload naming the pending id. Answer it (from any
shell) with `elicitation/respond <id>` — form answers as `key:=value` pairs
or JSON, `--done` for URL mode, or `--decline` / `--cancel` — after which the
original call completes. An unanswered parked elicitation is auto-cancelled
after 10 minutes.

> **Decision — who answers a prompt.** Non-interactive callers never get an
> automatic decline: the elicitation is parked so whoever drives mcpdo (a
> script, an agent relaying to a human) can answer deliberately via
> `elicitation/respond`, on its own schedule. That is deliberate for an
> inspector tool. URL-mode is different: there is never an auto-accept —
> completion is only ever confirmed by an explicit answer, because the
> out-of-band action (typically an auth or consent step in a browser) is the
> user's to perform. Use `--elicit off` on `connect` to keep any elicitation
> from being asked at all.

By default mcpdo advertises **both** modes to the server (`elicit: {url,
form}`), matching pre-#1783 behavior. Override this per connection with
`--elicit <mode>` on `connect`:

- `off` — advertise no elicitation capability at all. Useful when whatever is
  driving mcpdo (a script, an agent) can't handle an interactive prompt itself
  — omitting the capability lets a well-behaved server fall back to its own
  alternative (e.g. proceeding with defaults) instead of the request sitting
  parked until someone answers it.
- `url` — URL mode only.
- `form` — form mode only.
- `both` — the default; both modes.

Like `--era`, this overrides whatever a catalog/config entry's
`elicitCapability` says, and is the only way to set it for an ad-hoc target
(no config entry to read one from):

```bash
mcpdo connect my-server --config path/to/mcp.json --elicit off
mcpdo connect https://example.com/mcp --elicit url
```

## Relation to one-shot CLI

|               | One-shot                              | Connection (`mcpdo`)            |
| ------------- | ------------------------------------- | ------------------------------- |
| Entrypoint    | `mcp-inspector --cli`                 | `mcpdo`                         |
| Package (dev) | `clients/cli`                         | `clients/daemon-cli`            |
| Lifecycle     | Connect → one `--method` → disconnect | Connect once → many subcommands |

One-shot docs: [`clients/cli/README.md`](../cli/README.md).
