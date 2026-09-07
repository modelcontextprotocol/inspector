# MCP Inspector CLI Client

CLI for the Inspector: connect, run a `--method`, disconnect. Invoked as `mcp-inspector --cli`.

## Running the CLI

You can run the CLI via `npx`:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js
```

Supports tools, resources, and prompts (plus `--method servers/list` / `servers/show` for catalog entries without connecting).

> Coming from the v1 CLI? See the [v1 → v2 migration guide](../../docs/v1-to-v2-migration.md) — every v1 flag still exists, but exit codes, argument ordering, and the `--` separator changed.

### Examples

**Basic usage**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js
```

**With a configuration file**

```bash
npx @modelcontextprotocol/inspector --cli --config path/to/config.json --server myserver
```

**List available tools**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list
```

**Call a specific tool**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name mytool --tool-arg key=value --tool-arg another=value2
```

**Call a tool with JSON arguments**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name mytool --tool-arg 'options={"format": "json", "max_tokens": 100}'
```

**List available resources**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method resources/list
```

**List available prompts**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method prompts/list
```

### Remote Servers

You can also connect to remote MCP servers using HTTP or SSE transports.

**Connect to a remote MCP server (default is SSE)**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com
```

**Connect with Streamable HTTP transport**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com --transport http --method tools/list
```

**Pass custom headers**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com --transport http --method tools/list --header "X-API-Key: your-api-key"
```

When a server is loaded from a `--catalog`/`--config` file, its per-server settings (headers, connection/request timeouts, OAuth, and `roots`) are applied to the connection — the same resolution the TUI uses. A `--header` flag overrides the file's headers for that run while leaving the file's timeouts and OAuth in place.

The file is the only durable way to give a run its roots: there is no roots flag, and `--method roots/set` applies only to that one short-lived connection. Roots configured for a server (the same field the web UI's Server Settings writes) are advertised at connect, so a server that asks for `roots/list` — `@modelcontextprotocol/server-filesystem` does, to learn its allowed directories — gets them.

**Environment-variable semantics.** `MCP_CATALOG_PATH` is honored only when no ad-hoc target is given (positional command, `--server-url`, or `--transport`) — so a shell that exports it can still run one-off ad-hoc invocations without hitting the catalog/ad-hoc conflict. `MCP_STORAGE_DIR` sets the storage directory used by the OAuth persist backend (`<MCP_STORAGE_DIR>/oauth.json`); the per-file `MCP_INSPECTOR_OAUTH_STATE_PATH` override still takes precedence over it.

### HTTP proxy support

Connections to remote HTTP/SSE servers honor the conventional proxy environment variables: `HTTPS_PROXY` / `HTTP_PROXY` (and their lowercase forms) select the proxy, and `NO_PROXY` exempts hosts. This applies to every Node client — CLI, TUI, and the web backend — with no inspector-specific flag. It also covers **OAuth discovery and token requests**, which run through the same fetch.

Proxy routing is powered by the [`undici`](https://www.npmjs.com/package/undici) package (declared in the **root** manifest only; `^8.x` requires Node `>= 22.19.0`, the Inspector's supported floor). It is imported lazily on the first request and only when a proxy variable is set, so runs without a proxy configured pay no cost.

**Both halves of the pair come from userland undici — its `fetch` _and_ its `EnvHttpProxyAgent` ([#2067](https://github.com/modelcontextprotocol/inspector/issues/2067)).** The obvious-looking alternative is to hand the agent to Node's built-in `fetch` as a `dispatcher`, which is what v2.0.0–2.3.0 did. That couples two _different copies_ of undici at the dispatcher handler interface, and that interface is not stable across majors: Node 22 embeds undici 6, Node 24 embeds 7, Node 26 embeds 8. A userland undici 8 agent handed a built-in undici 7 handler is rejected outright — `fetch failed: invalid onRequestStart method` — and the request never leaves the process. Keeping both sides inside one copy is what makes proxying work unchanged from the Node 22.19 floor through Node 26. (Node's own `NODE_USE_ENV_PROXY` is not a substitute: it is unsupported at our 22.19 engine floor.)

Because undici's `Response` is a different class from `globalThis.Response`, the proxied fetch re-wraps each response as a genuine global `Response`, streaming preserved. Without that, `res instanceof Response` is `false` for callers that test it — including the MCP SDK, whose OAuth error formatter would degrade every message to `Raw body: [object Response]`.

`undici` is declared **only** in the root `package.json`, and every client's tsup config lists it as `external`. Both halves matter: tsup auto-externalizes what the _nearest_ manifest declares, so without the explicit entry the web and TUI bundles inlined it — and a CommonJS package inlined into an ESM bundle throws `Dynamic require of "assert" is not supported` the first time it is used. `npm run verify:bundle-externals` is the durable guard.

## Options

### MCP server (which server to connect to)

Options that specify the MCP server (catalog/config file, ad-hoc command/URL, env vars, headers) are shared by the Web, CLI, and TUI and are documented in [MCP server configuration](../../docs/mcp-server-configuration.md): `--catalog` (writable catalog, seeded **empty** if missing; default `~/.mcp-inspector/mcp.json` or `MCP_CATALOG_PATH`), `--config` (read-only session, errors if absent), `--server`, `-e`, `--cwd`, `--header`, `--transport`, `--server-url`, and the positional `[target...]`. `--catalog` and `--config` are mutually exclusive, and neither combines with an ad-hoc target.

### CLI-specific (what to invoke)

| Option                        | Description                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--method <method>`           | MCP method to invoke. Supports `initialize` (connect-only probe → `{serverInfo, protocolVersion, capabilities, instructions}`), `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`, `skills/list`, `skills/get`, `resources/directory/read`, plus catalog-only `servers/list` / `servers/show` (no MCP connect). Stream / session-only methods (e.g. `logging/tail`) are rejected. |
| `--tool-name <name>`          | Tool name (for `tools/call`).                                                                                                                                                                                                                                                                                                                                                                                        |
| `--tool-arg <key=value>`      | Tool argument; repeat for multiple. Use `key='{"json":true}'` for JSON. Values are coerced (JSON-parsed, so `count=1` becomes a number).                                                                                                                                                                                                                                                                             |
| `--tool-args-json <json>`     | Tool arguments as a single JSON object (e.g. `'{"zip":"10001"}'`). Passed verbatim — no `key=value` coercion, so `"012"` stays a string. Mutually exclusive with `--tool-arg`.                                                                                                                                                                                                                                       |
| `--uri <uri>`                 | Resource URI (`resources/read`), directory URI (`resources/directory/read`), or skill URI (`skills/get`).                                                                                                                                                                                                                                                                                                                                                                                 |
| `--cursor <cursor>`           | Opaque pagination cursor for `resources/directory/read` — pass back the `nextCursor` from the previous page. The listing is not recursive and pages are not aggregated: SEP-2640 gives the cursor to the client, and descending is the caller's job. |
| `--prompt-name <name>`        | Prompt name (for `prompts/get`).                                                                                                                                                                                                                                                                                                                                                                                     |
| `--prompt-args <key=value>`   | Prompt arguments; repeat for multiple.                                                                                                                                                                                                                                                                                                                                                                               |
| `--log-level <level>`         | Logging level for `logging/setLevel` (e.g. `debug`, `info`).                                                                                                                                                                                                                                                                                                                                                         |
| `--metadata <key=value>`      | General `_meta` entries (key=value); applied to all methods. The value is JSON-parsed when it parses, so `trace={"id":"abc"}` sends a real object and `n=3` a number; anything that is not valid JSON is sent as the literal string. Merged **over** the server's persisted `metadata` from `mcp.json`, which is sent on every request without this flag (#2093). |
| `--tool-metadata <key=value>` | Tool-specific `_meta` entries for `tools/call`. Same JSON-parsed value handling as `--metadata`. |
| `--connect-timeout <ms>`      | Connection timeout in ms. Defaults to `15000` for ad-hoc `--server-url`/target runs (so a black-holed host fails fast) and to the file-level timeout for `--catalog`/`--config` runs. `0` disables the timeout.                                                                                                                                                                                                      |
| `--app-info`                  | Probe a tool's MCP App UI metadata without invoking it. With `--method tools/call --tool-name <name>`: prints one JSON line (`hasApp`, `resourceUri`, `csp`, `permissions`, `domain`, …) and exits `0` if the tool has an app or `2` (`no_app`) if not. With `--method tools/list`: emits NDJSON — one app-info line per tool over a single connection.                                                              |
| `--strict`                    | With `--method tools/list`: report tool-schema portability problems in full (path, issue, suggested fix) on stderr, and exit `6` if any is error-severity. Without it, a one-line count is printed instead. See [Schema portability](#schema-portability---strict). |
| `--verify`                    | With `--method skills/list` or `--method skills/get`: run the SEP-2640 conformance, digest and frontmatter checks over the skills returned, emit one JSON report per skill on stdout, and exit `7` if any fails. See [Skill verification](#skill-verification---verify). |
| `--format <text\|json>`       | Output format. `text` (default) pretty-prints the result. `json` emits a single JSON object on stdout (`{ "result": … }`, plus `{ "appInfo": … }` as a sibling key for App tools) with no banners, so the whole output pipes cleanly into `jq`.                                                                                                                                                                      |
| `--relogin`                   | Delete stored OAuth for this server URL from the shared store before connect; interactive login still only runs if the server requires auth. Requires an HTTP/SSE URL (rejected for stdio). Conflicts with `--stored-auth-only` / `--use-stored-auth` / `--wait-for-auth` / catalog short-circuits.                                                                                                                  |
| `--no-revoke`                 | With `--relogin`, skip the [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) revocation request that would otherwise end the grant at the authorization server when the local state is deleted. The per-server `oauth.revokeOnClear` setting is the persistent form of the same opt-out; either one is enough to skip it. See [Revoking on `--relogin`](#revoking-on---relogin). |
| `--stored-auth-only`          | **CI / non-interactive safe:** never start interactive OAuth / step-up (and never auto-open a browser); use the shared store if present, otherwise fail immediately with `auth_required`. Prefer this over a bare pipe/CI run that would otherwise attempt interactive login.                                                                                                                                        |

#### Revoking on `--relogin`

`--relogin` deletes this server's stored OAuth state so the next connect cannot silently reuse it. By default it now also **revokes the grant at the authorization server**, per [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) ([#2144](https://github.com/modelcontextprotocol/inspector/issues/2144)) — otherwise the delete is invisible to the AS, and the access token, plus the refresh token when one was issued, stay valid there until they expire on their own.

The request is built from the stored state before the delete and sent after it, so the local delete never waits on the network. That matters because the OAuth store is shared: holding this process's view of it across a five-second request would let another CLI or TUI write a fresh grant that this one then erased.

The request names the refresh token when there is one: RFC 7009 §2.1 asks the authorization server to invalidate the access tokens issued under the same grant, so a single request covers both.

It is best-effort and never changes the exit code. An authorization server that advertises no `revocation_endpoint` gets no request at all; a network error, a non-2xx, or the short timeout prints a one-line warning on stderr and the local delete proceeds either way.

Turn it off per run with `--no-revoke`, or per server with `oauth.revokeOnClear: false` in the catalog — either is enough, and neither can turn it on for the other. Disconnecting while still holding live tokens is a case worth reproducing when the server under test is the thing being debugged.

```bash
mcp-inspector --cli --server-url https://example.com/mcp --relogin --method tools/list
mcp-inspector --cli --server-url https://example.com/mcp --relogin --no-revoke --method tools/list
```

`servers/show` redacts secret-bearing fields (`env` values, sensitive headers, sensitive `settings.metadata` keys whose whole value is replaced whether or not it is structured, `requestInit` / `eventSourceInit` headers, `oauthClientSecret`). It does **not** scrub credentials embedded in a server `url` (userinfo or query tokens) or in stdio `args` — treat `detail` / raw URL fields as potentially sensitive before pasting into issues.

#### App probing (`--app-info`) and machine-readable output (`--format json`)

`--app-info` inspects a tool's [MCP App](https://modelcontextprotocol.io) UI posture **without calling the tool**, so a pipeline can decide whether to open a browser before touching one:

```bash
# Probe one tool. Exits 0 (has app) or 2 (no_app). One JSON line on stdout.
mcp-inspector --cli <server> --method tools/call --tool-name my_tool --app-info
# → {"hasApp":true,"toolName":"my_tool","resourceUri":"ui://…","csp":{…},"permissions":{…},"prefersBorder":true,"resourceMimeType":"text/html"}

# Probe every tool at once — NDJSON, one line per tool, single connection.
mcp-inspector --cli <server> --method tools/list --app-info | jq -c 'select(.hasApp)'
```

Exit semantics: a tool that **has** an app exits `0`; one with **no** app exits `2` (`no_app`); a **missing** tool exits `5` (`tool_not_found`) — distinct so a typo isn't mistaken for "no app". A probe failure (an unreadable UI resource, or a malformed `_meta.ui.resourceUri`) is tolerated and reported in a `resourceError` field rather than aborting — so in `tools/list --app-info` one bad tool never kills the rest of the listing.

`--format json` wraps any method's output in a single stdout envelope with no banners, so App tools and plain tools both pipe cleanly into `jq`:

```bash
mcp-inspector --cli <server> --method tools/call --tool-name my_app_tool --format json
# → {"result":{…tool result…},"appInfo":{"hasApp":true,"resourceUri":"ui://…",…}}
```

> `tools/list --app-info` always emits NDJSON (one raw app-info object per line) **regardless of `--format`** — the per-tool list shape is fixed. `--format json` only reshapes the single-result paths (`tools/call`, `tools/list` without `--app-info`, etc.) into the `{result[, appInfo]}` envelope.

A `tools/call` that returns `isError:true` still prints its payload but exits `5` (`tool_is_error`) so `&&` chains don't proceed on a failed call.

#### Schema portability (`--strict`)

A tool schema can be perfectly legal JSON Schema and still be refused by the
client the server is meant to run against. `--strict` (with `--method
tools/list`) names those constructs — path, what is wrong, and a concrete fix —
on **stderr**, and exits `6` if any is error-severity:

```bash
mcp-inspector --cli <server> --method tools/list --strict
```

The complete **report** against the `unportable-schemas-http.json` showcase —
one block per finding, then the summary. On a non-zero exit the shared error
handler adds one more stderr line after this, the
[`ErrorEnvelope`](#exit-codes--error-envelopes) (`{"error":{"code":"schema_unportable",…}}`):

```text
Error: tool "get_temp"
  Path: outputSchema.properties.data
  Issue: Bare `true` used where a schema object is expected.
  Suggestion: Declare what the value actually is — e.g. `{"type": "object", "additionalProperties": true}` for a free-form object. That is a deliberate change of contract, not an equivalent rewrite: `true` accepts any JSON value at all.

Warning: tool "echo"
  Path: inputSchema.properties.show_ids
  Issue: `type` is an array (["null","boolean"]). The array form is legal JSON Schema, but several MCP clients read `type` as a single string and either reject the tool or drop the constraint.
  Suggestion: Split it into `anyOf` branches, each with a single `type` — `{"anyOf": [{"type": "null"}, {"type": "boolean"}]}`. (Making the property optional instead is a different contract: absent is not the same as `null`.)

Warning: tool "echo"
  Path: inputSchema.properties.opts
  Issue: Schema carries no validation keyword at all, so it accepts any value — the object-literal spelling of a bare `true`.
  Suggestion: Declare what the value actually is — e.g. `{"type": "object", "additionalProperties": true}` for a free-form object. That is a deliberate change of contract, which is the point: as written it constrains nothing.

Warning: tool "add"
  Path: inputSchema.properties.a
  Issue: `$ref` points outside this document (`https://example.com/schemas/number.json`). Clients do not fetch remote schemas, so the constraint is dropped or the tool is rejected.
  Suggestion: Inline the referenced schema, or move it into `$defs` and reference it as `#/$defs/<name>`.

1 error, 3 warnings across 3 tools.
```

Note the shape of that suggestion. Where a replacement genuinely narrows the
schema it says so, rather than implying an equivalent rewrite — and where an
equivalent exists it gives that instead: an array-form `type` becomes `anyOf`
branches (not "drop it from `required`", since absent is not the same as
`null`), and a bare `false` becomes `{"not": {}}` (not "delete the entry",
which would *permit* the property under the default `additionalProperties`).

Severity decides the exit code, not the report: **errors** are constructs a
shipping MCP client refuses outright (a bare `true` or `false` where a schema
object belongs), **warnings** are ones handled unevenly (an array-form `type`,
a remote `$ref`, a schema carrying no constraining keyword at all). Only errors
fail the run — a `--strict` that failed on warnings would be unusable as a CI
gate against servers that are in fact fine.

There is deliberately **no "inputSchema must be an object" check**, even though
MCP requires one. The SDK types `inputSchema` with `type: literal("object")`,
so a tool whose input root is anything else fails `ListToolsResultSchema` and
is dropped from the list before the lint could see it — it is reported through
the malformed-items path instead. A rule that cannot fire would only make this
documentation claim a check the CLI does not perform.

The report goes to stderr, so the result on stdout stays parseable. Under
`--format json` the findings are folded into the same envelope instead
(`{"result":…,"schemaFindings":[…]}`), so a caller reads one document rather
than correlating two.

**Without `--strict` nothing changes except one line.** A `tools/list` whose
schemas have findings prints a single stderr summary — `Schema portability: 1
error, 3 warnings across 3 tools. Re-run with --strict for details.` — and
still exits `0`. A clean list prints nothing at all.

This is deliberately not a JSON Schema validator. A census of 617 public
servers found **zero** that fail the SDK's own parser, so a conformance check
would report nothing on essentially every real server; what bites is the
narrower subset each consumer accepts, which is what these rules encode. The
same verdict drives the TUI's tool detail pane and the web Tools tab — all
three read `core/json/schemaLint`.

### CLI-specific (OAuth for HTTP servers)

The CLI runs the same loopback callback server as the TUI (`http://127.0.0.1:6276/oauth/callback` by default).

**CLI (`mcp-inspector --cli`):** on connect **401** or mid-session interactive auth (re-login / step-up), it:

1. Starts the callback listener on `--callback-url` (or `MCP_OAUTH_CALLBACK_URL`)
2. Prints the authorization URL to stderr (OSC 8 hyperlink when stderr is a TTY) and **opens the default browser** when allowed. Default: open on a **stderr** TTY (so `2>&1 | tee` prints a plain URL into the log but does not auto-open); plain URL only when stderr is non-TTY. `MCP_AUTO_OPEN_ENABLED=false` never opens; `=true` forces open even on a non-TTY (same as the web launcher).
3. Waits for the browser redirect, exchanges the code, and retries connect or the failed RPC

Interactive OAuth (connect-time or mid-RPC) requires a TTY on **stdin or stderr** (so `2>&1 | tee` still works — stdin stays a TTY), or `MCP_AUTO_OPEN_ENABLED=true`. When neither stdin nor stderr is a TTY and that env is unset (typical CI), the CLI fails fast with `auth_required` instead of waiting up to 15 minutes on the loopback callback. Use **`--stored-auth-only`** for non-interactive runs that should only consume the shared store.

**Step-up (standard OAuth):** when an RPC needs extra scopes, the CLI prompts on stderr: `Proceed with step-up authorization? [y/N]`. **y** continues (including piped stdin — `echo y | …` or `printf y | …`); **N** or EOF with no answer (`< /dev/null` / Ctrl-D) declines. Piped answers must be **newline-terminated, or stdin must close** — a bare `y` held open without `\n` or EOF is not flushed as a line and times out. A non-TTY stdin that never sends a line within **5 seconds** fails with `auth_required` (`timed out`, not the same as an explicit **N**). Answering **y** only confirms step-up — the following browser/loopback OAuth can still wait up to 15 minutes; for headless CI prefer **`--stored-auth-only`** with tokens already in the store. EMA step-up re-mints silently (no prompt).

**Shared OAuth storage:** the CLI **reuses** tokens from `~/.mcp-inspector/storage/oauth.json` when they already exist (same file as other Inspector clients). That is passive file sharing, not launching another app.

**Shared with TUI** (config only, not interactive login):

- Per-server OAuth fields from `mcp.json` (static client, EMA resource credentials, scopes)
- Install-level settings from **`~/.mcp-inspector/storage/client.json`** (or `--client-config` / `MCP_CLIENT_CONFIG_PATH`) — EMA IdP, CIMD
- CLI flags `--client-id`, `--client-secret`, `--client-metadata-url` override `client.json` when set
- Keychain-backed secrets in `mcp.json` are rehydrated on catalog load (same as TUI)

#### OAuth callback URL

| Surface | Default callback                                                                   |
| ------- | ---------------------------------------------------------------------------------- |
| **Web** | `http://localhost:6274/oauth/callback`                                             |
| **TUI** | `http://127.0.0.1:6276/oauth/callback` (interactive — callback server)             |
| **CLI** | `http://127.0.0.1:6276/oauth/callback` (interactive — same callback server as TUI) |

Register `http://127.0.0.1:6276/oauth/callback` on static or enterprise IdPs that require pre-registered redirect URIs before using the **TUI** or **CLI**. Override with `--callback-url` or `MCP_OAUTH_CALLBACK_URL`. Only one process should bind the default port at a time.

#### Flags

| Option                        | Env                      | Description                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--client-config <path>`      | `MCP_CLIENT_CONFIG_PATH` | Install-level client config (default: `~/.mcp-inspector/storage/client.json`).                                                                                                                                                                                                                                                               |
| `--client-id <id>`            | —                        | OAuth client ID (static client); overrides `client.json`.                                                                                                                                                                                                                                                                                    |
| `--client-secret <secret>`    | —                        | OAuth client secret; overrides `client.json`.                                                                                                                                                                                                                                                                                                |
| `--client-metadata-url <url>` | —                        | CIMD metadata URL; overrides `client.json`.                                                                                                                                                                                                                                                                                                  |
| `--callback-url <url>`        | `MCP_OAUTH_CALLBACK_URL` | Redirect URI sent to the authorization server (default: `http://127.0.0.1:6276/oauth/callback`). Must bind a **loopback** host (`localhost` / `127.0.0.0/8` / `[::1]`) — the listener receives the authorization code over plaintext `http`, so a non-loopback host hard-errors (no opt-in; use a port-forward if the browser is elsewhere). |
| —                             | `MCP_AUTO_OPEN_ENABLED`  | Browser auto-open **and** non-TTY interactive-OAuth admit: `true` (allow interactive OAuth without a TTY **and** force-open the browser — same as the web launcher), `false` (never open), unset (open on a TTY unless `VITEST` is set). For CI that must not hang, prefer `--stored-auth-only`.                                             |

**Example** — list tools on an OAuth-protected server using stored tokens and CIMD from the command line:

```bash
npx @modelcontextprotocol/inspector --cli --catalog mcp.json --server my-http-server \
  --client-metadata-url https://example.com/.well-known/oauth/client-metadata.json \
  --method tools/list
```

See [EMA / enterprise-managed auth](../../specification/v2_auth_ema.md) and [OAuth smoke testing](../../specification/v2_auth_smoke_testing.md) (§3 Stytch/CIMD; [§5 mid-session manual validation](../../specification/v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation) — CLI **C1–C2**).

#### Stored-auth (web → CLI handoff)

For the common case where OAuth was already completed in the **web inspector on the same machine**, the CLI can reuse the resulting token instead of running its own interactive flow. It reads the shared OAuth state file (the `oauth.json` the web backend writes) directly from disk and injects `Authorization: Bearer <token>` for `--server-url`.

| Option                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--use-stored-auth`     | Read the stored auth for `--server-url` and inject `Authorization: Bearer`. When a `refresh_token` is stored, the CLI runs the OAuth refresh grant first and injects the **fresh** access token (persisting the rotation); otherwise it injects the stored access token. Exits `3` (`no_stored_token`) — listing the stored keys — when nothing matches. Requires `--server-url`.                                                   |
| `--wait-for-auth <sec>` | Poll the OAuth state file (500 ms interval) until an access token for `--server-url` appears, then inject it. Times out at `<sec>` with exit `3` (`auth_wait_timeout`). Use after handing off to a human to complete OAuth in a browser. Unlike `--use-stored-auth`, this injects the freshly-landed access token directly (a token that just completed the browser flow is not expired), so it does **not** run the refresh grant. |
| `--list-stored-auth`    | Print `{ oauthStatePath, storedServerUrls }` (the server keys that currently have a token) and exit. No server connection is made.                                                                                                                                                                                                                                                                                                  |
| `--print-handoff`       | Print a JSON handoff block (`deepLink`, `portForwardCmd`, `oauthStatePath`, `apiToken`) for `--server-url` and exit — everything a script/remote VM needs to drive the browser-side OAuth dance. Requires `--server-url`.                                                                                                                                                                                                           |

**State-file resolution** follows `MCP_INSPECTOR_OAUTH_STATE_PATH` → `<MCP_STORAGE_DIR>/oauth.json` → `~/.mcp-inspector/storage/oauth.json` — the same precedence the rest of the Inspector uses, so the CLI and web backend agree on the file. Server keys are canonicalised with `new URL().href` (the scheme the web store writes), so a trailing-slash or case mismatch between the URL a human opened and the one the agent passed still resolves.

**Token refresh (#1665).** When the stored server state carries a `refresh_token` (plus the `clientInformation` the web inspector persists after a completed flow), `--use-stored-auth` runs the SDK's OAuth `refresh_token` grant to mint a fresh access token before connecting, then writes the rotated tokens back to the state file (owner-only `0o600`, via the shared store writer) so web and CLI stay consistent. The auth-server metadata is reused from the stored state, or discovered from `--server-url` when absent. This covers both an absent and an expired stored access token — the persisted blob carries no expiry, so the refresh token is treated as the durable credential. If the refresh fails (revoked token, transient auth-server error) **and** a stored access token is also present, the CLI falls back to injecting that token rather than hard-failing; only when there is nothing to fall back on does it exit `3` (`auth_required`, envelope `refresh_failed`). Without a stored `refresh_token` the access token is injected as-is, and a stale one surfaces as an HTTP `401` → exit `3`.

Because there is no stored expiry, a `refresh_token` is refreshed on every `--use-stored-auth` run. Two consequences with rotating refresh tokens: two concurrent invocations against the same state file race the single-use token (one wins), and a crash between a successful grant and the write-back leaves the rotated token unsaved. Both are narrow; re-authorize in the web inspector to recover.

**Short-circuit modes.** `--list-stored-auth` and `--print-handoff` each print their output and exit without connecting to a server; they ignore the method/target flags. They are mutually exclusive — if both are passed, `--list-stored-auth` takes precedence.

The `deepLink` is the canonical web deep-link ([#1576](https://github.com/modelcontextprotocol/inspector/issues/1576)) — `http://<host>:<port>/?serverUrl=<url>&transport=<http|sse>&autoConnect=<token>` — so navigating it in a browser reaches a connected inspector in one shot. `transport` is derived from the resolved server (`--transport`, else auto-detected from the URL path: `/sse` → `sse`, else `http`), not hardcoded. `autoConnect` is set to `MCP_INSPECTOR_API_TOKEN`; when that env var is unset the link is still emitted but a `note` field flags that the web app's `autoConnect` gate will reject it until the inspector is launched with a known token.

```bash
# On a remote VM: print what a human needs to complete OAuth in their browser.
mcp-inspector --cli --server-url https://api.example/mcp --print-handoff

# Then block until the token lands and run the call with it.
mcp-inspector --cli --transport http --server-url https://api.example/mcp \
  --wait-for-auth 120 --method tools/list
```

#### Skill verification (`--verify`)

SEP-2640 puts real obligations on whoever consumes a skill: verify each fetched
file against the digest its manifest advertised, check that the served
`SKILL.md`'s frontmatter matches the one the listing advertised, and honour the
per-skill limits. `--verify` runs all of them over a whole catalog and turns the
answer into an exit code, so a server author can gate CI on it:

```sh
mcp-inspector --cli <server> --method skills/list --verify
```

Stdout is **NDJSON, one report per skill**, in listing order:

```json
{
  "uri": "skill://tampered-notes/SKILL.md",
  "name": "tampered-notes",
  "conformance": [],
  "frontmatter": [],
  "files": [
    { "uri": "skill://tampered-notes/SKILL.md", "status": "verified", "…": "…" },
    { "uri": "skill://tampered-notes/notes.md", "status": "mismatch", "…": "…" }
  ],
  "ok": false
}
```

Stderr gets a one-line summary, so a reader who piped stdout into `jq` still
sees the verdict. `--method skills/get --uri <skill>` verifies exactly one
skill, in the same shape.

**What fails the run.** `ok` is false — and the exit code is `7` — for anything
SEP-2640 makes a MUST: an error-severity conformance finding, a digest or size
mismatch, or a manifest file that could not be read. A **warning** does not fail
it. That distinction matters most for `resources: "dynamic"`, which is a
*conforming* wire form for generated content: it means integrity cannot be
verified, which is worth reporting, but failing CI for it would tell server
authors their valid skill is broken.

**Three checks, three different jobs**, and the second is the one nothing else
covers:

- **Conformance** — structural checks against the entry as listed (name grammar,
  the name/URI invariant, digest and size formats, manifest completeness, the
  interoperability limits).
- **Frontmatter** — the served `SKILL.md`'s own YAML frontmatter, compared field
  by field against the frontmatter the listing advertised. A digest cannot cover
  this: it is taken over the bytes the server served, so it proves the file was
  not altered in transit and says nothing about whether the *listing* described
  it honestly. A server can advertise one description, serve another, and pass
  every digest check.
- **Files** — each manifest entry fetched and hashed. Reads are sequential: a
  conforming manifest may declare 512 entries, and a parallel walk would open
  512 `resources/read` calls against the server under test.

A read failure is recorded against the file it happened on and the walk
continues, so one unreadable file never hides the findings after it.

## Exit codes & error envelopes

Every non-zero exit maps to a stable failure class, so a programmatic caller
(CI, a script, an agent) can branch on _why_ the CLI failed without scraping
prose from stderr:

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Success.                                                                      |
| `1`  | Usage / unexpected error (the catch-all).                                     |
| `2`  | No MCP App found on the tool (`--app-info` probe).                            |
| `3`  | Server requires authentication (401/403, `WWW-Authenticate`, OAuth).          |
| `4`  | Server unreachable (DNS, connection refused, timeout, `fetch failed`).        |
| `5`  | Tool error (`tools/call` returned `isError:true`, or the tool was not found). |
| `6`  | `--strict` found an error-severity tool-schema portability problem (`schema_unportable` — the schema is valid JSON Schema, just not portable). |
| `7`  | `--verify` found a SEP-2640 violation (`skills_nonconformant` — a conformance error, a digest or size mismatch, or an unreadable manifest file). |

On any non-zero exit the CLI also writes a single JSON line to **stderr** — the
`ErrorEnvelope`:

```json
{
  "error": {
    "code": "auth_required",
    "message": "Unauthorized",
    "status": 401,
    "url": "https://api.example/mcp"
  }
}
```

The `code` is a stable identifier for the failure class; `message` is the
human-readable error; `cause`, `status`, and `url` are included when known.
Because it is one line, a caller can parse it with `2>&1 | tail -1 | jq .error`.

## Why use the CLI?

For a copyable connect → list → call → assert workflow built on the flags above,
see [Smoke-testing an MCP server](../../docs/cli-smoke-testing.md).

While the Web Client provides a rich visual interface, the CLI is designed for:

- **Automation**: Ideal for CI/CD pipelines and batch processing.
- **AI Coding Assistants**: Provides a direct, machine-readable interface (JSON) for tools like Cursor or Claude to verify changes immediately.
- **Log Analysis**: Easier integration with command-line utilities (like `jq`) to process and analyze MCP server output.

## Development

Like the other clients, the CLI self-validates from its own folder:

```bash
npm run validate       # format:check && lint && typecheck && test  (fast; no coverage gate)
npm test               # build test-servers + binary, then run all tests
npm run test:coverage  # build + tests under the per-file ≥90 coverage gate
```

The CLI's `test` / `test:coverage` **build the binary first** (out-of-process
`e2e.test.ts` spawns it). `validate` is `format:check && lint && typecheck && test`
with no separate `build` step (`pretest` builds). Repo-root `validate:cli`
delegates here; the coverage gate is `npm run coverage` / `coverage:cli` (also in
`npm run local:gate`), matching AGENTS.md.

Tests run the CLI **in-process** (importing `runCli()`) so `src/` is measured
under coverage, with a thin out-of-process spawn layer for the real binary. See
[`__tests__/README.md`](./__tests__/README.md) for details.
