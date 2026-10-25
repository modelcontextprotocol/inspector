# MCP Inspector connection CLI (`mcpdo`)

**Experimental** separate client — **bundled into the published `@modelcontextprotocol/inspector` package** as the `mcpdo` bin. Connect once, then run many MCP commands against a named connection via an implicit local daemon (ssh-agent style).

> **Layout note:** Source lives in `clients/mcpdo/`. The method handlers, exit codes / `CliExitCodeError`, interactive OAuth flow and output styling it shares with the one-shot CLI live in [`core/cli/`](../../core/cli), consumed through the ordinary `@inspector/core` alias and bundled like the rest of `core/` (#2461).

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

cd clients/mcpdo
npm run build
npm link

mcpdo --help
```

Rebuild after pulling source changes (`npm run build` in `clients/mcpdo`). You usually do **not** need to re-link unless the package `bin` entry changes.

### Development loop

`mcpdo` itself is a short-lived process re-executed on every invocation, so a
plain rebuild is enough for its changes to take effect on the next command.
The **connection daemon** (`build/mcpdod.js`) is different: `ensureDaemon` (see
`src/daemon/ensure.ts`) reuses an already-running daemon without checking its
code version, so a daemon started before your rebuild keeps running stale
code indefinitely. It sets `process.title = "mcpdod"`, so a stray one is
visible as `mcpdod` in `ps`/`pgrep` and killable with `pkill mcpdod`.

Use `npm run build:dev` instead of `npm run build` while iterating: it runs
`mcpdo daemon stop` first (harmless/no-op if no daemon is running — it treats
"daemon not running" as success) and then `tsup`, so the next daemon-backed
command (`connect`, `tools/list`, …) spawns a fresh daemon from the code you
just built. Commands that never touch the daemon (`servers/list`,
`servers/show`, `--help`) don't need this — a plain `npm run build` is enough
for those.

Without linking, run the built file directly:

```bash
node clients/mcpdo/build/mcp-bin.js --help
```

Remove the link when you’re done:

```bash
npm unlink -g @modelcontextprotocol/mcpdo
```

## Usage

```bash
mcpdo servers/list --config path/to/mcp.json
mcpdo servers/show test-stdio --config path/to/mcp.json
mcpdo connect test-stdio --config path/to/mcp.json
mcpdo connect my-http --config path/to/mcp.json --relogin   # (-r) ignore stored OAuth; login only if auth required
mcpdo auth/list
mcpdo auth/clear https://example.com/mcp
mcpdo auth/clear hosted-everything        # or a catalog/connection name (from auth/list "known as")
mcpdo auth/clear --all --yes
mcpdo tools/list
mcpdo tools/call echo message:=hi
mcpdo tools/call echo '{"message":"hi"}'
mcpdo tools/call echo message:=hi --load --load-requests 500   # load test; see below
mcpdo @test-stdio resources/list
mcpdo logging/tail                        # long-lived; Ctrl-C to stop
mcpdo connections/list
mcpdo disconnect --connection test-stdio
mcpdo disconnect my-http --clear-auth     # (-c) also clear stored OAuth so the next connect re-triggers sign-in
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

**Auth:** shared `oauth.json` with other Inspector clients. Connect-time OAuth only on this CLI; mid-connection step-up remains on one-shot `mcp-inspector --cli`. `auth/list` annotates each stored URL with the catalog/connection names it is "known as" and marks `● live` when a connection currently holds it, so the raw store URLs correlate to the servers you actually use. EMA IdP login records (keyed `ema-idp:<issuer>` in the store) lead with their bare issuer URL and carry a trailing `enterprise IdP login` marker (parallel to `known as:`) rather than showing as unnamed servers. `auth/clear` accepts either a store URL **or** one of those friendly names (a name that maps to no URL — e.g. a stdio server — or to more than one URL is rejected with guidance); an EMA IdP login clears by its bare issuer URL (or its raw `ema-idp:` key). `--relogin` (`-r`) clears any URL-keyed store entry before connect (no-op for stdio). To force a clean logged-out state from an already-open connection, `disconnect <name> --clear-auth` (`-c`) tears the connection down **and** clears its stored tokens in one step, so the next plain `connect` re-triggers sign-in — no-op for stdio / servers with no stored entry. Non-TTY `connect` exits 0 with `pendingAuth: true` and an `authUrl` to relay; after the user signs in, any real command completes the connection, `connections/show` completes it too, and `connections/list` marks the entry `pendingAuthSignedIn` ("signed in — completing on next use") without dialing.

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

## Load testing a tool (`tools/call --load`)

`tools/call --load` is the one-shot CLI's
[load mode](../cli/README.md#load-testing-a-tool---load), run against an open
connection ([#2744](https://github.com/modelcontextprotocol/inspector/issues/2744)).
It calls one tool repeatedly and concurrently and prints a single summary in
place of a result: `ok`, `toolErrors`, `errors`, `errorRate`, `throughput`,
latency `min`/`mean`/`p50`/`p90`/`p99`/`max`, and the most frequent error
messages. Both CLIs run the same engine, so the flags, their defaults and the
summary fields mean the same thing in each.

```bash
# 20 calls in flight for 30 seconds
mcpdo tools/call search query:=mcp --load --load-concurrency 20 --load-duration 30

# exactly 500 calls, started at no more than 50 per second, as JSON
mcpdo @prod tools/call search query:=mcp --load --load-requests 500 --load-rate 50 --format json
```

| Flag                     | Meaning                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `--load`                 | Load-test the tool instead of calling it once.                                                               |
| `--load-concurrency <n>` | Most calls in flight at once (positive integer; default `10`).                                               |
| `--load-duration <sec>`  | Stop starting calls after this many seconds; in-flight calls finish. Default `10` without `--load-requests`. |
| `--load-requests <n>`    | Stop after starting this many calls. With `--load-duration` too, whichever comes first ends the run.         |
| `--load-rate <n>`        | Start at most this many calls per second, spaced evenly (default: unlimited).                                |
| `--load-connections <n>` | Spread the calls over this many independent sessions (HTTP/SSE only; at most `--load-concurrency`; default `1`). |
| `--load-max-error-rate <fraction>` | Exit `10` (`load_error_rate_exceeded`) when the share of failed calls is above this value (`0` to `1`). |
| `--load-max-p99 <ms>`    | Exit `10` (`load_p99_exceeded`) when the p99 latency is above this many milliseconds, or no call completed. |

Each `--load-*` flag requires `--load`, and `--load` cannot be combined with
`--app-info`. `--format json` prints the summary object itself, with no
`{ result }` envelope, as for every other mcpdo command. Without a threshold
flag the exit code is `0` whenever the run completes, however many calls
failed — read `errorRate`.

**Thresholds** ([#2800](https://github.com/modelcontextprotocol/inspector/issues/2800))
make the exit code carry the verdict, as in the one-shot CLI. They are judged
by the `mcpdo` process after the summary has been printed, so a breached run
still shows its numbers; the breach then follows as the usual error envelope,
with the same `code` and exit code `10` the CLI uses.

**Multiple sessions** (`--load-connections`, #2800) open the extra sessions
inside the daemon, before the clock starts, from the connection's stored server
config and settings. They use stored credentials only — an extra never starts a
sign-in, so connect the connection first — and a session that fails to open is
counted in the summary's `connections` block, not as a call error. The
connection's own live client is always the first session. The extras belong to
the run: they never appear in `connections/list`, they are closed when the run
ends (or the daemon stops), and Ctrl-C cancels their in-flight calls too. Over
stdio each session would spawn its own server process, so more than one is
refused there.

How a run behaves on a shared daemon connection:

- **The run happens inside the daemon**, on the connection's live client — its
  transport, headers and OAuth tokens — and the `mcpdo` process makes one round
  trip for the whole run. The IPC call has no client-side deadline, so a long
  `--load-duration` is not cut off; the connection's own request timeout still
  applies to each call.
- **Later commands on the same connection wait for it.** The daemon runs one
  `rpc` command per connection at a time (so that an elicitation can be routed
  to the call that raised it), and the load run is one such command. A
  `tools/list` issued mid-run starts when the run ends. Other connections, and
  an already-running `logging/tail` or `resources/subscribe` stream, are
  unaffected.
- **Ctrl-C ends the run**: no further calls start and those in flight are
  cancelled, so the connection is free for the next command at once. No summary
  is printed, since the caller has gone.
- **A dropped connection ends the run early** with the summary of what
  completed, rather than spending the rest of the window counting instant
  failures. The next command revives the connection as usual.
- **Elicitations are cancelled.** Many calls are in flight at once and none of
  them can be answered mid-run, so a server that elicits during a load run sees
  each request cancelled. Use `connect --elicit off` to keep the server from
  asking at all.

## Relation to one-shot CLI

|               | One-shot                              | Connection (`mcpdo`)            |
| ------------- | ------------------------------------- | ------------------------------- |
| Entrypoint    | `mcp-inspector --cli`                 | `mcpdo`                         |
| Package (dev) | `clients/cli`                         | `clients/mcpdo`            |
| Lifecycle     | Connect → one `--method` → disconnect | Connect once → many subcommands |

One-shot docs: [`clients/cli/README.md`](../cli/README.md).
