# MCP Inspector session CLI (`mcpi`)

**Experimental** separate client — not part of the published `@modelcontextprotocol/inspector` package. Connect once, then run many MCP commands against a named session via an implicit local daemon (ssh-agent style).

> **Layout note:** Source lives in `clients/mcpi/`. At build time it bundles some modules from `clients/cli/src` (`handlers/`, `error-handler`, OAuth helpers) via the `@inspector/cli` alias. That reach-in is intentional and temporary — not a published library API — until a cleaner shared package exists.

## Install / run (from this repo)

Build, then put `mcpi` on your PATH with `npm link` (points at this package’s `build/mcp-bin.js`):

```bash
# from the repo root — install deps once if needed
npm install

cd clients/mcpi
npm run build
npm link

mcpi --help
```

Rebuild after pulling source changes (`npm run build` in `clients/mcpi`). You usually do **not** need to re-link unless the package `bin` entry changes.

### Development loop

`mcpi` itself is a short-lived process re-executed on every invocation, so a
plain rebuild is enough for its changes to take effect on the next command.
The **session daemon** (`build/daemon.js`) is different: `ensureDaemon` (see
`src/daemon/ensure.ts`) reuses an already-running daemon without checking its
code version, so a daemon started before your rebuild keeps running stale
code indefinitely.

Use `npm run build:dev` instead of `npm run build` while iterating: it runs
`mcpi daemon stop` first (harmless/no-op if no daemon is running — it treats
"daemon not running" as success) and then `tsup`, so the next daemon-backed
command (`connect`, `tools/list`, …) spawns a fresh daemon from the code you
just built. Commands that never touch the daemon (`servers/list`,
`servers/show`, `--help`) don't need this — a plain `npm run build` is enough
for those.

Without linking, run the built file directly:

```bash
node clients/mcpi/build/mcp-bin.js --help
```

Remove the link when you’re done:

```bash
npm unlink -g @modelcontextprotocol/mcpi
```

## Usage

```bash
mcpi servers/list --config path/to/mcp.json
mcpi servers/show test-stdio --config path/to/mcp.json
mcpi connect test-stdio --config path/to/mcp.json
mcpi connect my-http --config path/to/mcp.json --relogin   # ignore stored OAuth; login only if auth required
mcpi auth/list
mcpi auth/clear https://example.com/mcp
mcpi auth/clear --all --yes
mcpi tools/list
mcpi tools/call echo message:=hi
mcpi tools/call echo '{"message":"hi"}'
mcpi @test-stdio resources/list
mcpi logging/tail                        # long-lived; Ctrl-C to stop
mcpi sessions/list
mcpi disconnect --session test-stdio
mcpi daemon status
mcpi daemon stop

# Optional: private daemon for this shell only
eval "$(mcpi private)"
mcpi connect test-stdio --config path/to/mcp.json
mcpi tools/list
```

**Globals (before subcommand):** `--format text|json`, `--plain`, `--session <name>`, `--catalog` / `--config`, `--stored-auth-only`.

**Output:** `--format text` (default) is human-readable (TTY ANSI unless `--plain` / `NO_COLOR`). `--format json` is pretty-printed payload with **no** `{ result }` envelope.

**Auth:** shared `oauth.json` with other Inspector clients. Connect-time OAuth only on this CLI; mid-session step-up remains on one-shot `mcp-inspector --cli`. `--relogin` clears any URL-keyed store entry before connect (no-op for stdio).

See [`specification/v2_cli_v2.md`](../../specification/v2_cli_v2.md) for the as-built design and to-do list.

## Protocol era support

mcpi shares `core`'s `InspectorClient`, so it negotiates whichever era
(`legacy` 2025-03-26-style vs. `modern`/2026-era, e.g. task-augmented calls,
`server/discover`) the target actually speaks — no extra flags needed for
that to work. Two things are mcpi-specific:

- **`--era <era>` on `connect`**: `legacy` (default), `auto` (probe via
  `server/discover` before connecting), or `modern`. Overrides whatever a
  catalog/config entry's `protocolEra` says, and is the only way to set it
  for an ad-hoc target (no config entry to read one from).

  ```bash
  mcpi connect my-modern-server --config path/to/mcp.json --era modern
  mcpi connect https://example.com/mcp --era auto
  ```

- **Era visibility in session output**: `sessions/list`, `sessions/use`, and
  `connect` all show the negotiated era inline (`@name (MRU) — server
[modern]`). `sessions/show <name>` gives the full picture — era, negotiated
  protocol version, server info, capabilities, and (when the connect probed
  `server/discover`) the server's supported-versions list:

  ```
  $ mcpi sessions/show my-modern-server
  Session: my-modern-server
  Server: https://example.com/mcp
  Era: modern (2026-06-18)
  Supported versions: 2025-03-26, 2026-06-18
  ...
  ```

A paused modern (SEP-2663) task — one whose `tasks/get` shows
`status: "input_required"` — can be resumed with `tasks/update`:

```bash
mcpi tasks/update <taskId> --input-responses '{"<requestId>":{"approved":true}}'
```

## Elicitation support

mcpi can prompt interactively for both elicitation delivery mechanisms —
legacy server→client `elicitation/create` requests and modern non-task MRTR
(multi-round tool response) rounds — and both modes a server may ask for:

- **URL mode**: mcpi prints the URL and waits for you to confirm you've
  finished out-of-band (there's no "decline", only accept-that-you-finished
  or cancel — the actual completion can't be observed locally).
- **Form mode**: mcpi renders one prompt per field from the schema, with a
  review step (edit any field again, or submit) before answering.

Only `--format json` callers get an automatic decline (URL mode: cancel)
instead of a prompt.

> **Decision — who answers a prompt.** Only `--format json` auto-declines
> (its stdout must stay a single machine-readable payload). Everything else —
> including a plain non-TTY stdin — gets a real prompt, which means an agent
> driving mcpi can routinely read a form-mode question and answer on the
> user's behalf. That is deliberate for an inspector tool. URL-mode is
> different: there is never an auto-accept — completion is only ever
> confirmed by an explicit answer to the prompt, because the out-of-band
> action (typically an auth or consent step in a browser) is the user's to
> perform. Use `--elicit off` on `connect` to keep any elicitation from
> being asked at all.

By default mcpi advertises **both** modes to the server (`elicit: {url,
form}`), matching pre-#1783 behavior. Override this per connection with
`--elicit <mode>` on `connect`:

- `off` — advertise no elicitation capability at all. Useful when whatever is
  driving mcpi (a script, an agent) can't handle an interactive prompt itself
  — omitting the capability lets a well-behaved server fall back to its own
  alternative (e.g. proceeding with defaults) instead of the request being
  auto-declined.
- `url` — URL mode only.
- `form` — form mode only.
- `both` — the default; both modes.

Like `--era`, this overrides whatever a catalog/config entry's
`elicitCapability` says, and is the only way to set it for an ad-hoc target
(no config entry to read one from):

```bash
mcpi connect my-server --config path/to/mcp.json --elicit off
mcpi connect https://example.com/mcp --elicit url
```

## Relation to one-shot CLI

|               | One-shot                              | Session (`mcpi`)                |
| ------------- | ------------------------------------- | ------------------------------- |
| Entrypoint    | `mcp-inspector --cli`                 | `mcpi`                          |
| Package (dev) | `clients/cli`                         | `clients/mcpi`                  |
| Lifecycle     | Connect → one `--method` → disconnect | Connect once → many subcommands |

One-shot docs: [`clients/cli/README.md`](../cli/README.md).
